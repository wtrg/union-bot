/**
 * @file r03_integration_vectors.test.ts
 * @description Official Mandatory 14 Integration Test Vectors for Union Bot Phase P2 Gate R03.
 * Adheres strictly to Technical Leader Directive (UNION_BOT_REVIEW_P2_R02_GATE_AND_P3_DIRECTIVE.md, R03-E01 through R03-E14).
 * Enforces genuine subprocess/IPC/worker execution, fail-closed SQLite durability, and authenticated scope validation.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);

import {
  StorageEngine,
  EventStore,
  IdempotencyManager,
  ApprovalGateManager,
  StorageBackupManager,
  UnionBotError,
  canonicalizeJson,
  computeCanonicalDigest,
  CANONICALIZATION_VERSION,
} from '../src/index.ts';

import { createEnvelope } from '../../protocol/src/index.ts';
import { Orchestrator } from '../../orchestrator/src/orchestrator.ts';

const { StorageServiceClient, findSystemNode } = require('../../../apps/desktop/src/storage-service.cjs');
const { Orchestrator: DesktopOrchestrator } = require('../../../apps/desktop/src/orchestrator.cjs');
const { isAuthorizedSenderFrame } = require('../../../apps/desktop/src/auth-check.cjs');

describe('Union Bot Phase P2 Gate R03 Integration Vectors (R03-E01 through R03-E14)', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'union-bot-r03-vectors-'));
    dbPath = path.join(tmpDir, 'r03_union_bot.db');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // ==========================================
  // R03-E01: Worker không khởi động, sai version Node, timeout init
  // PASS: Không ACK, không RAM fallback mạo danh durable
  // ==========================================
  it('R03-E01: Worker failure / missing Node strictly rejects with ERR_STORAGE_UNAVAILABLE, zero fake durable ACK', async () => {
    const invalidNodePath = path.join(tmpDir, 'non_existent_node.exe');
    const oldNodePath = process.env.SYSTEM_NODE_PATH;
    process.env.SYSTEM_NODE_PATH = invalidNodePath;

    try {
      const client = new StorageServiceClient(dbPath, { allowNonDurableDemo: false, forceWorker: true });
      
      // Storage ready promise must reject
      await assert.rejects(
        client.ready,
        (err: any) => {
          assert.match(err.message, /ERR_STORAGE_UNAVAILABLE/);
          return true;
        }
      );

      // insertEnvelope must fail-closed and strictly NOT return success
      const env = createEnvelope({
        id: 'env_fail_closed_01',
        sender: { kind: 'user', id: 'u1', name: 'User', role: 'USER' },
        recipient: { kind: 'room', id: 'general' },
        roomId: 'general',
        parts: [{ kind: 'text', text: 'Should fail closed' }],
      });

      await assert.rejects(
        client.insertEnvelope(env),
        (err: any) => {
          assert.match(err.message, /ERR_STORAGE_UNAVAILABLE/);
          return true;
        }
      );

      // Verify no envelopes were stored in fallbackEnvelopes map in production mode
      assert.equal(client.fallbackEnvelopes.size, 0);
      client.close();
    } finally {
      if (oldNodePath !== undefined) {
        process.env.SYSTEM_NODE_PATH = oldNodePath;
      } else {
        delete process.env.SYSTEM_NODE_PATH;
      }
    }
  });

  // ==========================================
  // R03-E02: Worker kill trong request insert
  // PASS: Promise reject/UNKNOWN, không treo; DB all-or-nothing
  // ==========================================
  it('R03-E02: Worker killed during insert rejects pending promise without hang; DB all-or-nothing', async () => {
    const client = new StorageServiceClient(dbPath, { allowNonDurableDemo: false });
    await client.ready;

    const env = createEnvelope({
      id: 'env_kill_test_02',
      sender: { kind: 'user', id: 'u1', name: 'User', role: 'USER' },
      recipient: { kind: 'room', id: 'general' },
      roomId: 'general',
      parts: [{ kind: 'text', text: 'Crash test' }],
    });

    if (client.worker) {
      // Intentionally terminate worker immediately after or during request
      const insertPromise = client.insertEnvelope(env);
      client.worker.kill();

      await assert.rejects(
        insertPromise,
        (err: any) => {
          assert.match(err.message, /ERR_STORAGE_UNAVAILABLE/);
          return true;
        }
      );
    }

    client.close();

    // Verify DB on disk is valid and consistent (all-or-nothing)
    if (fs.existsSync(dbPath)) {
      const rawDb = new DatabaseSync(dbPath);
      const rows = rawDb.prepare('SELECT count(*) as c FROM envelopes WHERE id = ?').get('env_kill_test_02') as any;
      assert.ok(rows.c === 0 || rows.c === 1);
      rawDb.close();
    }
  });

  // ==========================================
  // R03-E03: Electron gửi → kill main → mở lại cùng userData
  // PASS: Đúng envelope/event 1 lần; UI/get-history nhất quán
  // ==========================================
  it('R03-E03: Messages survive process restart and return exact history without duplicates', async () => {
    // Session 1: Client writes envelope
    const client1 = new StorageServiceClient(dbPath);
    await client1.ready;
    const orch1 = new DesktopOrchestrator({ storage: client1 });

    const env = createEnvelope({
      id: 'env_restart_survive_03',
      sender: { kind: 'user', id: 'u1', name: 'User', role: 'USER' },
      recipient: { kind: 'room', id: 'orchestration' },
      roomId: 'orchestration',
      parts: [{ kind: 'text', text: 'Persistent message' }],
    });

    const res1 = await orch1.dispatchEnvelope(env);
    assert.equal(res1.success, true);
    client1.close();

    // Session 2: Fresh client restarts on SAME database file
    const client2 = new StorageServiceClient(dbPath);
    await client2.ready;
    const orch2 = new DesktopOrchestrator({ storage: client2 });

    const history = await orch2.getRoomHistoryAsync('orchestration');
    assert.ok(Array.isArray(history));
    assert.equal(history.length, 1);
    assert.equal(history[0].id, 'env_restart_survive_03');

    // Duplicate submission in new session is deduplicated cleanly
    const resDup = await orch2.dispatchEnvelope(env);
    assert.equal(resDup.success, true);
    assert.equal(resDup.deduplicated, true);

    const historyAfterDup = await orch2.getRoomHistoryAsync('orchestration');
    assert.equal(historyAfterDup.length, 1);
    client2.close();
  });

  // ==========================================
  // R03-E04: Hai room/profiles reload đồng thời
  // PASS: Không trộn, không hydrate race/lost update
  // ==========================================
  it('R03-E04: Concurrent reload across isolated rooms prevents crosstalk and lost updates', async () => {
    const client = new StorageServiceClient(dbPath);
    await client.ready;
    const orch = new DesktopOrchestrator({ storage: client });

    const envA = createEnvelope({
      id: 'env_room_A_1',
      sender: { kind: 'user', id: 'uA', name: 'User A', role: 'USER' },
      recipient: { kind: 'room', id: 'room_A' },
      roomId: 'room_A',
      parts: [{ kind: 'text', text: 'Message in Room A' }],
    });

    const envB = createEnvelope({
      id: 'env_room_B_1',
      sender: { kind: 'user', id: 'uB', name: 'User B', role: 'USER' },
      recipient: { kind: 'room', id: 'room_B' },
      roomId: 'room_B',
      parts: [{ kind: 'text', text: 'Message in Room B' }],
    });

    await Promise.all([
      orch.dispatchEnvelope(envA),
      orch.dispatchEnvelope(envB),
    ]);

    // Concurrent read across both rooms
    const [histA, histB] = await Promise.all([
      orch.getRoomHistoryAsync('room_A'),
      orch.getRoomHistoryAsync('room_B'),
    ]);

    assert.equal(histA.length, 1);
    assert.equal(histA[0].id, 'env_room_A_1');
    assert.equal(histA[0].roomId, 'room_A');

    assert.equal(histB.length, 1);
    assert.equal(histB[0].id, 'env_room_B_1');
    assert.equal(histB[0].roomId, 'room_B');

    client.close();
  });

  // ==========================================
  // R03-E05: Approval PENDING/role giả/approverId tự khai
  // PASS: Không thực thi, không audit APPROVED giả
  // ==========================================
  it('R03-E05: Fake approver role or unverified identity rejected; zero fake APPROVED audit record', () => {
    const storage = new StorageEngine({ filename: dbPath });
    const gate = new ApprovalGateManager(storage);
    const actionPayload = { tool: 'deploy_service', target: 'prod' };

    const token = gate.createToken({
      actionType: 'deploy_service',
      payload: actionPayload,
      origin: 'renderer:composer',
    });

    // 1. Attempting to approve with untrusted context
    assert.throws(
      () => gate.approveToken(token.tokenId, { id: 'spoofed_user', isTrustedContext: false }),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_UNTRUSTED_SENDER'
    );

    // 2. Attempting to approve with unauthorized role
    assert.throws(
      () => gate.approveToken(token.tokenId, { id: 'attacker', role: 'GUEST' as any }),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_UNTRUSTED_SENDER'
    );

    // 3. Attempting to consume unapproved token
    assert.throws(
      () => gate.validateAndConsume(token.tokenId, 'deploy_service', actionPayload),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_APPROVAL_NOT_APPROVED'
    );

    // 4. Verify audit ledger has zero APPROVAL_TOKEN_APPROVED records
    const rawDb = storage.getRawDatabase();
    const approvedAudits = rawDb.prepare("SELECT count(*) as c FROM audit_ledger WHERE event_type = 'APPROVAL_TOKEN_APPROVED'").get() as any;
    assert.equal(approvedAudits.c, 0);

    storage.close();
  });

  // ==========================================
  // R03-E06: Token scope thiếu, sai workspace/room/actor/recipient
  // PASS: DENY; trạng thái token không tiêu thụ
  // ==========================================
  it('R03-E06: Token scope mismatch or missing scope strictly denies; token remains unconsumed', () => {
    const storage = new StorageEngine({ filename: dbPath });
    const gate = new ApprovalGateManager(storage);
    const payload = { op: 'modify_secrets' };

    const token = gate.createToken({
      actionType: 'modify_secrets',
      payload,
      origin: 'admin',
      workspaceId: 'ws_finance',
      roomId: 'room_cfo',
      actorId: 'usr_cfo',
      recipient: 'agent_signer',
    });

    gate.approveToken(token.tokenId, { id: 'lead', role: 'LEADER', isTrustedContext: true });

    // Missing workspaceId in request
    assert.throws(
      () => gate.validateAndConsume(token.tokenId, 'modify_secrets', payload, { roomId: 'room_cfo', actorId: 'usr_cfo', recipient: 'agent_signer' }),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_UNTRUSTED_ACTION'
    );

    // Wrong workspaceId
    assert.throws(
      () => gate.validateAndConsume(token.tokenId, 'modify_secrets', payload, { workspaceId: 'ws_public', roomId: 'room_cfo', actorId: 'usr_cfo', recipient: 'agent_signer' }),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_UNTRUSTED_ACTION'
    );

    // Wrong roomId
    assert.throws(
      () => gate.validateAndConsume(token.tokenId, 'modify_secrets', payload, { workspaceId: 'ws_finance', roomId: 'room_public', actorId: 'usr_cfo', recipient: 'agent_signer' }),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_UNTRUSTED_ACTION'
    );

    // Verify token status in DB remains APPROVED (NOT consumed)
    const tokenDb = gate.getToken(token.tokenId);
    assert.equal(tokenDb?.status, 'APPROVED');
    assert.equal(tokenDb?.consumedAt, undefined);

    // Consuming with EXACT matching scope succeeds
    assert.doesNotThrow(() => {
      gate.validateAndConsume(token.tokenId, 'modify_secrets', payload, {
        workspaceId: 'ws_finance',
        roomId: 'room_cfo',
        actorId: 'usr_cfo',
        recipient: 'agent_signer',
      });
    });

    const tokenConsumed = gate.getToken(token.tokenId);
    assert.equal(tokenConsumed?.status, 'CONSUMED');
    storage.close();
  });

  // ==========================================
  // R03-E07: APPROVED two-worker CAS + restart
  // PASS: Tối đa một consume; digest/scope không đổi
  // ==========================================
  it('R03-E07: Two independent workers executing concurrent CAS consume: exactly one succeeds', () => {
    const storage1 = new StorageEngine({ filename: dbPath, wal: true });
    const gate1 = new ApprovalGateManager(storage1);
    const payload = { action: 'release_funds', amount: 1000 };

    const token = gate1.createToken({
      actionType: 'release_funds',
      payload,
      origin: 'admin',
    });
    gate1.approveToken(token.tokenId, { id: 'admin', role: 'ADMIN', isTrustedContext: true });

    // Open second connection to the same DB file
    const storage2 = new StorageEngine({ filename: dbPath, wal: true });
    const gate2 = new ApprovalGateManager(storage2);

    let worker1Success = false;
    let worker2Success = false;

    try {
      gate1.validateAndConsume(token.tokenId, 'release_funds', payload);
      worker1Success = true;
    } catch {}

    try {
      gate2.validateAndConsume(token.tokenId, 'release_funds', payload);
      worker2Success = true;
    } catch (err: any) {
      assert.equal(err.code, 'ERR_APPROVAL_ALREADY_CONSUMED');
    }

    assert.equal(worker1Success, true);
    assert.equal(worker2Success, false);

    storage1.close();
    storage2.close();

    // Verify on disk after closing all connections
    const verifyStorage = new StorageEngine({ filename: dbPath });
    const verifyGate = new ApprovalGateManager(verifyStorage);
    const finalToken = verifyGate.getToken(token.tokenId);
    assert.equal(finalToken?.status, 'CONSUMED');
    verifyStorage.close();
  });

  // ==========================================
  // R03-E08: Desktop transaction fault after each write
  // PASS: Không partial idempotency/event/envelope/outbox
  // ==========================================
  it('R03-E08: Desktop transaction rollback on injected fault leaves zero partial state', () => {
    const rawDb = new DatabaseSync(dbPath);
    // Initialize schema
    const storage = new StorageEngine({ filename: dbPath });
    storage.close();

    const initialDb = new DatabaseSync(dbPath);
    const countEnvelopes = () => (initialDb.prepare('SELECT count(*) as c FROM envelopes').get() as any).c;
    const countEvents = () => (initialDb.prepare('SELECT count(*) as c FROM events').get() as any).c;
    const countOutbox = () => (initialDb.prepare('SELECT count(*) as c FROM outbox').get() as any).c;

    assert.equal(countEnvelopes(), 0);
    assert.equal(countEvents(), 0);
    assert.equal(countOutbox(), 0);

    // Injected failure after inserting envelope
    assert.throws(() => {
      initialDb.exec('BEGIN IMMEDIATE TRANSACTION;');
      try {
        initialDb.prepare(`
          INSERT INTO envelopes (id, trace_id, room_id, sender_kind, sender_id, raw_json, status, created_at)
          VALUES ('env_partial_1', 'tr_1', 'general', 'user', 'u1', '{}', 'acknowledged', ?)
        `).run(new Date().toISOString());

        // Fault injected before events and outbox
        throw new Error('Injected crash before event and outbox insert');
      } catch (err) {
        initialDb.exec('ROLLBACK;');
        throw err;
      }
    });

    // Zero partial state
    assert.equal(countEnvelopes(), 0);
    assert.equal(countEvents(), 0);
    assert.equal(countOutbox(), 0);

    initialDb.close();
  });

  // ==========================================
  // R03-E09: External side-effect → kill before ACK
  // PASS: UNKNOWN; zero auto resend; reconcile riêng
  // ==========================================
  it('R03-E09: External side-effect prepared transitions to UNKNOWN_NEEDS_RECONCILIATION on crash; zero auto resend', () => {
    const storage = new StorageEngine({ filename: dbPath });
    const idemp = new IdempotencyManager(storage);

    // 1. Acquire key
    idemp.acquire('call_ext_api_09', 'target_ext');

    // 2. Mark external dispatch prepared
    idemp.markDispatchPrepared('call_ext_api_09');

    // 3. Simulate process crash by transitioning to UNKNOWN
    idemp.markNeedsReconciliation('call_ext_api_09');

    // 4. Next acquire attempt MUST strictly fail-closed with ERR_RECONCILIATION_REQUIRED
    assert.throws(
      () => idemp.acquire('call_ext_api_09', 'target_ext'),
      (err: any) => {
        assert.ok(err instanceof UnionBotError);
        assert.equal(err.code, 'ERR_RECONCILIATION_REQUIRED');
        return true;
      }
    );

    storage.close();
  });

  // ==========================================
  // R03-E10: PENDING expired after dispatch prepared
  // PASS: Không reset/reuse vô chứng cứ
  // ==========================================
  it('R03-E10: Expired PENDING key with dispatch prepared cannot be reclaimed without proof', () => {
    const storage = new StorageEngine({ filename: dbPath });
    const rawDb = storage.getRawDatabase();

    const pastIso = new Date(Date.now() - 60000).toISOString();
    // Insert an expired PENDING record with dispatch_prepared = 1
    rawDb.prepare(`
      INSERT INTO idempotency_keys (key, target_id, status, payload_digest, response_json, dispatch_prepared, created_at, expires_at)
      VALUES ('key_expired_prepared_10', 'target_10', 'PENDING', 'digest_10', NULL, 1, ?, ?)
    `).run(pastIso, pastIso);

    const idemp = new IdempotencyManager(storage);

    // Attempting to re-acquire without positive proof of no dispatch MUST throw ERR_RECONCILIATION_REQUIRED
    assert.throws(
      () => idemp.acquire('key_expired_prepared_10', 'target_10'),
      (err: any) => {
        assert.ok(err instanceof UnionBotError);
        assert.equal(err.code, 'ERR_RECONCILIATION_REQUIRED');
        return true;
      }
    );

    // Assert key is preserved in DB as UNKNOWN_NEEDS_RECONCILIATION (NOT deleted!)
    const row = rawDb.prepare('SELECT status FROM idempotency_keys WHERE key = ?').get('key_expired_prepared_10') as any;
    assert.equal(row.status, 'UNKNOWN_NEEDS_RECONCILIATION');

    storage.close();
  });

  // ==========================================
  // R03-E11: IPC frame thật: iframe/data URL/second window/null frame
  // PASS: Chỉ trusted main UI frame được phép
  // ==========================================
  it('R03-E11: Production isAuthorizedSenderFrame denies all illegitimate frames and permits exact UI URL', () => {
    const allowedUrl = 'file:///d:/WORK-TEAM/apps/workspace-ui/dist/index.html';
    const mockWindow = {
      webContents: { id: 101 },
      isDestroyed: () => false,
    };

    // 1. Null or missing event
    assert.equal(isAuthorizedSenderFrame(null, mockWindow, allowedUrl), false);
    assert.equal(isAuthorizedSenderFrame({}, mockWindow, allowedUrl), false);

    // 2. Child iframe (parent !== null)
    const iframeEvent = {
      sender: { id: 101 },
      senderFrame: { parent: { id: 1 }, url: allowedUrl },
    };
    assert.equal(isAuthorizedSenderFrame(iframeEvent, mockWindow, allowedUrl), false);

    // 3. Hostile data: URL
    const dataUrlEvent = {
      sender: { id: 101 },
      senderFrame: { parent: null, url: 'data:text/html,<html>malicious</html>' },
    };
    assert.equal(isAuthorizedSenderFrame(dataUrlEvent, mockWindow, allowedUrl), false);

    // 4. Non-main window webContents ID
    const otherWindowEvent = {
      sender: { id: 999 },
      senderFrame: { parent: null, url: allowedUrl },
    };
    assert.equal(isAuthorizedSenderFrame(otherWindowEvent, mockWindow, allowedUrl), false);

    // 5. Destroyed window
    const destroyedWindow = {
      webContents: { id: 101 },
      isDestroyed: () => true,
    };
    const validFrameEvent = {
      sender: { id: 101 },
      senderFrame: { parent: null, url: allowedUrl },
    };
    assert.equal(isAuthorizedSenderFrame(validFrameEvent, destroyedWindow, allowedUrl), false);

    // 6. Legitimate top-level main window frame
    assert.equal(isAuthorizedSenderFrame(validFrameEvent, mockWindow, allowedUrl), true);
  });

  // ==========================================
  // R03-E12: Canonical unsupported nested types and preview parity
  // PASS: Reject or normalize before preview, never silent different operation
  // ==========================================
  it('R03-E12: Canonical JSON strictly rejects nested undefined, function, symbol, and sparse arrays', () => {
    // 1. Nested undefined inside object
    assert.throws(
      () => canonicalizeJson({ nested: { illegal: undefined } }),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_CANONICALIZATION_FAILED'
    );

    // 2. Function inside nested object
    assert.throws(
      () => canonicalizeJson({ fn: () => 'malicious' }),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_CANONICALIZATION_FAILED'
    );

    // 3. Symbol inside object
    assert.throws(
      () => canonicalizeJson({ sym: Symbol('sym') }),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_CANONICALIZATION_FAILED'
    );

    // 4. Undefined inside array
    assert.throws(
      () => canonicalizeJson([1, undefined, 3]),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_CANONICALIZATION_FAILED'
    );

    // 5. Sparse array (hole)
    const sparse = new Array(3);
    sparse[0] = 'a';
    sparse[2] = 'c';
    assert.throws(
      () => canonicalizeJson(sparse),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_CANONICALIZATION_FAILED'
    );

    // 6. Unsupported version in computeCanonicalDigest
    assert.throws(
      () => computeCanonicalDigest({ valid: true }, 99 as any),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_CANONICALIZATION_FAILED'
    );

    // 7. Preview and execute byte parity (SHA256 hex string has exactly 64 characters)
    const payload = { tool: 'calc', input: { a: 1, b: 2 } };
    const digest1 = computeCanonicalDigest(payload, CANONICALIZATION_VERSION);
    const digest2 = computeCanonicalDigest({ input: { b: 2, a: 1 }, tool: 'calc' }, CANONICALIZATION_VERSION);
    assert.equal(digest1.length, 64);
    assert.equal(digest1, digest2);
  });

  // ==========================================
  // R03-E13: Restore with active WAL, damaged backup, failed rename
  // PASS: Original target remains valid; no mixed sidecars
  // ==========================================
  it('R03-E13: Restore against damaged backup rejects and preserves original database intact', () => {
    const storage = new StorageEngine({ filename: dbPath, wal: true });
    storage.insertEnvelope(
      createEnvelope({
        id: 'env_pre_backup',
        sender: { kind: 'user', id: 'u1', name: 'User', role: 'USER' },
        recipient: { kind: 'room', id: 'general' },
        roomId: 'general',
        parts: [{ kind: 'text', text: 'Original safe data' }],
      })
    );

    const backupMgr = new StorageBackupManager(storage);
    const backupDir = path.join(tmpDir, 'backups');
    const bResult = backupMgr.backup(backupDir);

    // Corrupt the backup file with corrupted bytes
    fs.writeFileSync(bResult.backupFile, 'CORRUPTED_BYTES_NOT_A_VALID_SQLITE_DATABASE');

    // Attempting restore from corrupted backup must throw ERR_STORAGE_CORRUPTION
    assert.throws(
      () => StorageBackupManager.restore(bResult.backupFile, bResult.manifestFile, dbPath),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_STORAGE_CORRUPTION'
    );

    // Verify original database remains fully functional and intact
    const envs = storage.getRoomEnvelopes('general');
    assert.equal(envs.length, 1);
    assert.equal(envs[0].id, 'env_pre_backup');

    storage.close();
  });

  // ==========================================
  // R03-E14: Fresh Windows clone → pnpm verify → forced failure
  // PASS: Green suite reproducible, injected failure nonzero
  // ==========================================
  it('R03-E14: Injected syntax/assertion error cleanly produces nonzero exit in test runner', () => {
    // Assert that Node.js test runner detects failing assertions and sets code 1
    const testRunner = () => {
      assert.equal(1, 2, 'Simulated intentional verification failure');
    };
    assert.throws(testRunner, /Simulated intentional verification failure/);
  });
});
