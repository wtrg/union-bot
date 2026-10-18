/**
 * @file r04_approval_security.test.ts
 * @description Official R04 Test Vectors: R04-G01, R04-G02, R04-G03, R04-G12.
 * Validates payload digest binding, anti-tampering, approver authentication,
 * and zero-token-burn under cost policy rejection for both native SQLite and worker process.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

import {
  StorageEngine,
  ApprovalGateManager,
  UnionBotError,
  computeCanonicalDigest,
  CANONICALIZATION_VERSION,
} from '../src/index.ts';

import { createEnvelope } from '../../protocol/src/index.ts';
import { Orchestrator } from '../../orchestrator/src/orchestrator.ts';

const { StorageServiceClient } = require('../../../apps/desktop/src/storage-service.cjs');
const { Orchestrator: DesktopOrchestrator } = require('../../../apps/desktop/src/orchestrator.cjs');
const { computeCanonicalDigest: desktopComputeDigest } = require('../../../apps/desktop/src/canonical-json.cjs');

describe('Union Bot Phase P2 Gate R04: Approval Security Vectors (G01, G02, G03, G12)', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'union-bot-r04-approval-'));
    dbPath = path.join(tmpDir, 'r04_approval.db');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // =========================================================================
  // R04-G01: Approved action A, submit nested action B
  // PASS: ERR_APPROVAL_HASH_MISMATCH, token remains APPROVED, 0 consume
  // Tested on both Native StorageEngine and dedicated Worker StorageService
  // =========================================================================
  it('R04-G01: Approved action A, submit nested action B is rejected fail-closed (Native & Worker)', async () => {
    // 1. Native StorageEngine
    {
      const storage = new StorageEngine({ filename: dbPath, wal: true });
      const gate = new ApprovalGateManager(storage);

      const actionA = {
        tool: 'write_file',
        args: { path: 'project/a.txt', overwrite: false, content: 'safe' },
      };

      const token = gate.createToken({
        actionType: 'write_file',
        payload: actionA,
        origin: 'ui:admin',
        workspaceId: 'ws_prod',
        roomId: 'room_dev',
        actorId: 'usr_dev',
        recipient: 'agent_coder',
      });

      // PO approves action A with verified trusted context
      gate.approveToken(token.tokenId, { id: 'po_lead', role: 'LEADER', isTrustedContext: true });

      // Attack: Same token, but change nested args.path to secrets.txt
      const actionB_path = {
        tool: 'write_file',
        args: { path: 'project/secrets.txt', overwrite: false, content: 'safe' },
      };
      assert.throws(
        () => gate.validateAndConsume(token.tokenId, 'write_file', actionB_path, {
          workspaceId: 'ws_prod',
          roomId: 'room_dev',
          actorId: 'usr_dev',
          recipient: 'agent_coder',
        }),
        (err: any) => err instanceof UnionBotError && err.code === 'ERR_APPROVAL_HASH_MISMATCH'
      );

      // Attack: Same token, but change overwrite flag to true
      const actionB_overwrite = {
        tool: 'write_file',
        args: { path: 'project/a.txt', overwrite: true, content: 'safe' },
      };
      assert.throws(
        () => gate.validateAndConsume(token.tokenId, 'write_file', actionB_overwrite, {
          workspaceId: 'ws_prod',
          roomId: 'room_dev',
          actorId: 'usr_dev',
          recipient: 'agent_coder',
        }),
        (err: any) => err instanceof UnionBotError && err.code === 'ERR_APPROVAL_HASH_MISMATCH'
      );

      // Attack: Same token, but change content
      const actionB_content = {
        tool: 'write_file',
        args: { path: 'project/a.txt', overwrite: false, content: 'malicious payload' },
      };
      assert.throws(
        () => gate.validateAndConsume(token.tokenId, 'write_file', actionB_content, {
          workspaceId: 'ws_prod',
          roomId: 'room_dev',
          actorId: 'usr_dev',
          recipient: 'agent_coder',
        }),
        (err: any) => err instanceof UnionBotError && err.code === 'ERR_APPROVAL_HASH_MISMATCH'
      );

      // Verify token remains APPROVED (NOT consumed)
      const tokenRecord = gate.getToken(token.tokenId);
      assert.equal(tokenRecord?.status, 'APPROVED');
      assert.equal(tokenRecord?.consumedAt, undefined);

      // Exact action A now succeeds
      gate.validateAndConsume(token.tokenId, 'write_file', actionA, {
        workspaceId: 'ws_prod',
        roomId: 'room_dev',
        actorId: 'usr_dev',
        recipient: 'agent_coder',
      });
      assert.equal(gate.getToken(token.tokenId)?.status, 'CONSUMED');

      storage.close();
    }

    // 2. Dedicated Worker Client
    {
      const workerDbPath = path.join(tmpDir, 'r04_worker_g01.db');
      const client = new StorageServiceClient(workerDbPath, { forceWorker: true });
      await client.ready;

      const actionA = {
        tool: 'write_file',
        args: { path: 'project/a.txt', overwrite: false, content: 'safe' },
      };
      const digestA = desktopComputeDigest(actionA, 1);

      const token = await client.createApprovalToken({
        tokenId: 'tok_worker_g01',
        actionType: 'write_file',
        payloadDigest: digestA,
        origin: 'ui:admin',
        workspaceId: 'ws_prod',
        roomId: 'room_dev',
        actorId: 'usr_dev',
        recipient: 'agent_coder',
      });

      // PO approves token with server-side TrustedPrincipal
      await client.approveToken(token.tokenId, {
        id: 'local-operator',
        role: 'OPERATOR',
        isTrustedContext: true,
      });

      // Attack: submit action B with different path
      const actionB = {
        tool: 'write_file',
        args: { path: 'project/secrets.txt', overwrite: false, content: 'safe' },
      };
      const digestB = desktopComputeDigest(actionB, 1);

      await assert.rejects(
        () => client.validateAndConsumeApproval(token.tokenId, 'write_file', digestB, {
          workspaceId: 'ws_prod',
          roomId: 'room_dev',
          actorId: 'usr_dev',
          recipient: 'agent_coder',
        }),
        (err: any) => err.message.includes('ERR_APPROVAL_HASH_MISMATCH')
      );

      // Token in DB is still APPROVED
      const tokenRow = await client.getApprovalToken(token.tokenId);
      assert.equal(tokenRow.status, 'APPROVED');
      assert.equal(tokenRow.consumed_at, null);

      // Exact action A digest succeeds
      const consumeRes = await client.validateAndConsumeApproval(token.tokenId, 'write_file', digestA, {
        workspaceId: 'ws_prod',
        roomId: 'room_dev',
        actorId: 'usr_dev',
        recipient: 'agent_coder',
      });
      assert.equal(consumeRes.success, true);

      const consumedRow = await client.getApprovalToken(token.tokenId);
      assert.equal(consumedRow.status, 'CONSUMED');

      client.close();
    }
  });

  // =========================================================================
  // R04-G02: Missing/untrusted digest and stale preview
  // PASS: Tất cả bị từ chối trước consume và trước side-effect
  // =========================================================================
  it('R04-G02: Missing, empty, or untrusted payload digest is strictly rejected before consume', async () => {
    const storage = new StorageEngine({ filename: dbPath, wal: true });
    const gate = new ApprovalGateManager(storage);

    const actionA = { tool: 'deploy', config: { target: 'prod', replicas: 3 } };
    const token = gate.createToken({
      actionType: 'deploy',
      payload: actionA,
      origin: 'ui',
    });

    gate.approveToken(token.tokenId, { id: 'admin', role: 'ADMIN', isTrustedContext: true });

    // 1. Null payload
    assert.throws(
      () => gate.validateAndConsume(token.tokenId, 'deploy', null),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_APPROVAL_HASH_MISMATCH'
    );

    // 2. Undefined payload
    assert.throws(
      () => gate.validateAndConsume(token.tokenId, 'deploy', undefined),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_APPROVAL_HASH_MISMATCH'
    );

    // 3. Empty string payload
    assert.throws(
      () => gate.validateAndConsume(token.tokenId, 'deploy', ''),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_APPROVAL_HASH_MISMATCH'
    );

    // 4. Desktop Worker Client rejecting empty/malformed digest string
    const client = new StorageServiceClient(path.join(tmpDir, 'r04_worker_g02.db'), { forceWorker: true });
    await client.ready;

    const tokWorker = await client.createApprovalToken({
      tokenId: 'tok_g02',
      actionType: 'deploy',
      payloadDigest: computeCanonicalDigest(actionA, 1),
      origin: 'ui',
    });
    await client.approveToken(tokWorker.tokenId, { id: 'admin', role: 'ADMIN', isTrustedContext: true });

    // Call consume with null digest
    await assert.rejects(
      () => client.validateAndConsumeApproval(tokWorker.tokenId, 'deploy', null),
      (err: any) => err.message.includes('ERR_APPROVAL_HASH_MISMATCH')
    );

    // Call consume with non-hex / malformed digest
    await assert.rejects(
      () => client.validateAndConsumeApproval(tokWorker.tokenId, 'deploy', 'not_a_64_char_hex_digest'),
      (err: any) => err.message.includes('ERR_APPROVAL_HASH_MISMATCH')
    );

    client.close();
    storage.close();
  });

  // =========================================================================
  // R04-G03: Spoofed approver principal
  // PASS: Tất cả DENY, zero APPROVED audit/DB; chỉ TrustedPrincipal hợp lệ
  // =========================================================================
  it('R04-G03: Spoofed approver principal from untrusted IPC/caller is strictly DENIED', async () => {
    const storage = new StorageEngine({ filename: dbPath, wal: true });
    const gate = new ApprovalGateManager(storage);

    const token = gate.createToken({
      actionType: 'reboot_cluster',
      payload: { cluster: 'prod' },
      origin: 'ui',
    });

    // 1. Spoofed caller omitting isTrustedContext
    assert.throws(
      () => gate.approveToken(token.tokenId, { id: 'attacker', role: 'LEADER' } as any),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_UNTRUSTED_SENDER'
    );

    // 2. Caller claiming isTrustedContext: false
    assert.throws(
      () => gate.approveToken(token.tokenId, { id: 'attacker', role: 'LEADER', isTrustedContext: false }),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_UNTRUSTED_SENDER'
    );

    // 3. Unauthorized role (e.g. IMPLEMENTER, RESEARCHER)
    assert.throws(
      () => gate.approveToken(token.tokenId, { id: 'agent_coder', role: 'IMPLEMENTER' as any, isTrustedContext: true }),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_UNTRUSTED_SENDER'
    );

    // 4. Missing role
    assert.throws(
      () => gate.approveToken(token.tokenId, { id: 'attacker', isTrustedContext: true } as any),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_UNTRUSTED_SENDER'
    );

    // Token remains PENDING
    assert.equal(gate.getToken(token.tokenId)?.status, 'PENDING');

    // Also verify dedicated Worker rejects all spoofed principals
    const client = new StorageServiceClient(path.join(tmpDir, 'r04_worker_g03.db'), { forceWorker: true });
    await client.ready;

    const tokWorker = await client.createApprovalToken({
      tokenId: 'tok_g03_w',
      actionType: 'exec',
      payloadDigest: computeCanonicalDigest({ cmd: 'ls' }, 1),
      origin: 'ui',
    });

    await assert.rejects(
      () => client.approveToken(tokWorker.tokenId, { id: 'attacker', role: 'USER' }), // missing isTrustedContext
      (err: any) => err.message.includes('ERR_UNTRUSTED_SENDER')
    );

    await assert.rejects(
      () => client.approveToken(tokWorker.tokenId, { id: 'attacker', role: 'LEADER', isTrustedContext: false }),
      (err: any) => err.message.includes('ERR_UNTRUSTED_SENDER')
    );

    await assert.rejects(
      () => client.approveToken(tokWorker.tokenId, { id: 'attacker', role: 'RESEARCHER', isTrustedContext: true }),
      (err: any) => err.message.includes('ERR_UNTRUSTED_SENDER')
    );

    const checkRow = await client.getApprovalToken(tokWorker.tokenId);
    assert.equal(checkRow.status, 'PENDING');
    assert.equal(checkRow.approved_at, null);

    client.close();
    storage.close();
  });

  // =========================================================================
  // R04-G12: Approval không bị burn khi Cost Guard từ chối
  // PASS: zero side-effect, zero QUEUED external dispatch; token không bị silent CONSUMED
  // =========================================================================
  it('R04-G12: Approval token is NOT burned/consumed when action is denied by Zero-Cost AdmissionPolicyGate', async () => {
    // 1. Canonical TypeScript Orchestrator
    {
      const storage = new StorageEngine({ filename: dbPath, wal: true });
      const gate = new ApprovalGateManager(storage);
      const orch = new Orchestrator({ storage, approvalGate: gate });

      const dangerousAction = { cmd: 'rm -rf /' };
      const token = gate.createToken({
        actionType: 'exec_cli',
        payload: dangerousAction,
        origin: 'ui',
      });

      // PO approves token
      gate.approveToken(token.tokenId, { id: 'po_lead', role: 'LEADER', isTrustedContext: true });
      assert.equal(gate.getToken(token.tokenId)?.status, 'APPROVED');

      // Renderer dispatches envelope containing the action, BUT action has undefined estimatedCost (DENY_UNKNOWN_COST)
      const envelope = createEnvelope({
        id: 'env_g12_ts_001',
        sender: { kind: 'user', id: 'usr_001', name: 'User', role: 'USER' },
        recipient: { kind: 'room', id: 'orchestration' },
        roomId: 'orchestration',
        parts: [
          {
            kind: 'action',
            tool: 'exec_cli',
            callId: 'call_g12_001',
            status: 'requested',
            input: dangerousAction,
            approvalTokenId: token.tokenId,
            // estimatedCost is omitted -> triggers DENY_UNKNOWN_COST
          },
        ],
      });

      const dispatchRes = await orch.dispatchEnvelope(envelope, { isFromRenderer: true });
      assert.equal(dispatchRes.success, false);
      assert.match(dispatchRes.error!, /DENY_UNKNOWN_COST/);

      // Verify approval token was NOT consumed! It must remain APPROVED.
      const tokenRecord = gate.getToken(token.tokenId);
      assert.equal(tokenRecord?.status, 'APPROVED', 'Token must remain in APPROVED status when admission denies cost');
      assert.equal(tokenRecord?.consumedAt, undefined);

      // Verify no outbox entries were queued
      const outbox = storage.getRawDatabase().prepare('SELECT COUNT(*) as count FROM outbox').get() as { count: number };
      assert.equal(outbox.count, 0);

      storage.close();
    }

    // 2. Desktop Orchestrator (CJS parity)
    {
      const desktopDbPath = path.join(tmpDir, 'r04_desktop_g12.db');
      const storageClient = new StorageServiceClient(desktopDbPath, { forceWorker: true });
      await storageClient.ready;

      const desktopOrch = new DesktopOrchestrator({ storage: storageClient });

      const actionPayload = { command: 'purchase_tokens', tier: 'premium' };
      const actionDigest = desktopComputeDigest(actionPayload, 1);

      const token = await storageClient.createApprovalToken({
        tokenId: 'tok_desktop_g12',
        actionType: 'exec_payment',
        payloadDigest: actionDigest,
        origin: 'renderer',
      });

      // Approve token
      await storageClient.approveToken(token.tokenId, {
        id: 'local-operator',
        role: 'OPERATOR',
        isTrustedContext: true,
      });

      const approvedRow = await storageClient.getApprovalToken(token.tokenId);
      assert.equal(approvedRow.status, 'APPROVED');

      // Dispatch envelope where action has estimatedCost: 500 (PAID API BLOCKED)
      const desktopEnv = {
        schemaVersion: '1.0.0',
        id: 'env_desktop_g12',
        traceId: 'trc_g12',
        timestamp: Date.now(),
        sender: { kind: 'user', id: 'usr_desk', name: 'Desk User', role: 'USER' },
        recipient: { kind: 'room', id: 'orchestration' },
        roomId: 'orchestration',
        fidelity: 'L0_RAW_TEXT',
        parts: [
          {
            kind: 'action',
            tool: 'exec_payment',
            callId: 'call_desk_g12',
            status: 'requested',
            input: { ...actionPayload, approvalTokenId: token.tokenId, estimatedCost: 500 },
          },
        ],
      };

      const dispatchRes = await desktopOrch.dispatchEnvelope(desktopEnv, { fromRenderer: true });
      assert.equal(dispatchRes.success, false);
      assert.match(dispatchRes.error, /DENY_PAID_API_DISABLED/);

      // Verify token in database is NOT consumed!
      const finalToken = await storageClient.getApprovalToken(token.tokenId);
      assert.equal(finalToken.status, 'APPROVED', 'Token must remain in APPROVED status after Zero-Cost denial');
      assert.equal(finalToken.consumed_at, null);

      storageClient.close();
    }
  });
});
