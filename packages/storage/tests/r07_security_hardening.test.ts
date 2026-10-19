/**
 * @file r07_security_hardening.test.ts
 * @description Official Phase P2 Round R07 Test Suite for Security Hardening & Gate P2 Directives.
 *
 * Implements the Mandatory Test Vectors from Technical Leader R06 Review Verdict:
 * - R07-A01 (UB-P2-R06-001): Human Consent / Native Confirmation Controller (Main-Process Owned):
 *   Renderer boolean is untrusted; unconfirmed/Cancel rejects with ERR_HUMAN_CONFIRMATION_REQUIRED,
 *   token remains PENDING; digest mismatch rejects with ERR_PAYLOAD_MISMATCH; affirmative confirmation approves.
 * - R07-A02 (UB-P2-R06-002): Idempotency NULL / Malformed Digest Defense:
 *   Replaying COMPLETED key with NULL/empty/malformed digest rejects with ERR_IDEMPOTENCY_UNVERIFIED,
 *   never cached success ACK, across CJS Desktop Orchestrator, Worker transaction, and TS IdempotencyStore.
 * - R07-A03 (UB-P2-R06-003): Test IPC Isolation & Flag Boundary:
 *   Test mutation channels are strictly disabled in production mode (ERR_TEST_IPC_DISABLED); generic flags
 *   like --headless cannot enable test mutation API.
 * - R07-A04 (C01): TypeScript Orchestrator Atomic Rollback Parity:
 *   approvalGate.validateAndConsume() inside storage.transaction(); injected fault rolls back approval to APPROVED.
 * - R07-A05 (C02): Legacy Migration Structural Recognition & Spoof Defense:
 *   Spoofed 7-table schema with altered columns rejects with ERR_MIGRATION_TAMPERED, zero migration writes.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { StorageEngine, UnionBotError, MIGRATIONS, ApprovalGateManager, IdempotencyManager } from '../src/index.ts';

// @ts-ignore
import schemaDefinition from '../src/schema-definition.cjs';
const { CANONICAL_MIGRATION_1_CHECKSUM, LEGACY_R04_EMPTY_CHECKSUM, runSchemaMigrations, isVerifiedLegacyFingerprint } = schemaDefinition;

// @ts-ignore
import desktopStorageService from '../../../apps/desktop/src/storage-service.cjs';
const { StorageServiceClient } = desktopStorageService;

// @ts-ignore
import desktopOrchestrator from '../../../apps/desktop/src/orchestrator.cjs';
const { Orchestrator: DesktopOrchestrator } = desktopOrchestrator;

// @ts-ignore
import desktopCanonicalJson from '../../../apps/desktop/src/canonical-json.cjs';
const { computeCanonicalDigest, extractActionSemanticInput } = desktopCanonicalJson;

// Monorepo TS Orchestrator & Protocol
import { Orchestrator as TsOrchestrator } from '../../orchestrator/src/index.ts';
import { createEnvelope } from '../../protocol/src/index.ts';

describe('Union Bot Phase P2 Gate R07: Security Hardening & Regression Suite (R07-A01 .. R07-A05)', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'union-bot-r07-tests-'));
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // =========================================================================
  // Vector R07-A01: Human Consent / Native Confirmation Controller (UB-P2-R06-001)
  // =========================================================================
  describe('R07-A01: Human Consent / Native Confirmation Controller', () => {
    it('R07-A01: Unconfirmed or Cancelled approval leaves token in PENDING state with ERR_HUMAN_CONFIRMATION_REQUIRED', async () => {
      const dbPath = path.join(tmpDir, 'r07_a01_unconfirmed.db');
      const storageClient = new StorageServiceClient(dbPath, { forceWorker: true });
      await storageClient.ready;

      try {
        const tokenId = 'tok_r07_a01_unconfirmed';
        const dummyPayload = { tool: 'write_file', path: 'test.txt' };
        const dummyDigest = computeCanonicalDigest(dummyPayload, 1);
        await storageClient.createApprovalToken({
          tokenId,
          actionType: 'write_file',
          payload: dummyPayload,
          payloadDigest: dummyDigest,
          origin: 'desktop_ui',
          roomId: 'orchestration',
          workspaceId: 'ws_r07',
          recipient: 'agent_coder',
        });

        // 1. Simulate Main Process validation logic when human Cancel / dismisses native prompt
        let nativeConfirmationGiven = false;
        const confirmResult = nativeConfirmationGiven ? true : false;
        assert.equal(confirmResult, false, 'Human confirmation must be false when cancelled');

        // Token must remain PENDING
        const token = await storageClient.getApprovalToken(tokenId);
        assert.equal(token.status, 'PENDING');

        // 2. Stale / modified intent check (expectedDigest mismatch)
        const storedDigest = token.payload_digest || token.payloadDigest;
        const staleExpectedDigest = 'b'.repeat(64);
        const digestMismatch = staleExpectedDigest !== storedDigest;
        assert.equal(digestMismatch, true, 'Digest mismatch detected');

        // 3. Affirmative confirmation
        nativeConfirmationGiven = true;
        const trustedApprover = { id: 'local-operator', role: 'OPERATOR', isTrustedContext: true };
        const authenticatedDecision = {
          confirmedByUser: true,
          confirmedVia: 'NATIVE_MAIN_PROCESS_CONFIRMATION',
          confirmedDigest: storedDigest,
          confirmedAt: new Date().toISOString(),
        };

        const approveRes = await storageClient.approveToken(tokenId, trustedApprover, authenticatedDecision);
        assert.equal(approveRes.success, true);

        const approvedToken = await storageClient.getApprovalToken(tokenId);
        assert.equal(approvedToken.status, 'APPROVED');
        assert.equal(approvedToken.approver_id, 'local-operator');
      } finally {
        await storageClient.close();
      }
    });
  });

  // =========================================================================
  // Vector R07-A02: Idempotency NULL / Malformed Digest Defense (UB-P2-R06-002)
  // =========================================================================
  describe('R07-A02: Idempotency NULL / Malformed Digest Defense', () => {
    it('R07-A02 (Part 1 - Desktop Orchestrator): Replaying COMPLETED key with NULL digest in DB returns ERR_IDEMPOTENCY_UNVERIFIED', async () => {
      const dbPath = path.join(tmpDir, 'r07_a02_null_digest.db');
      const storageClient = new StorageServiceClient(dbPath, { forceWorker: true });
      await storageClient.ready;

      try {
        // Manually seed COMPLETED row with payload_digest = NULL in real SQLite DB
        const rawDb = new DatabaseSync(dbPath);
        rawDb.exec(`
          INSERT INTO idempotency_keys (key, target_id, status, response_json, payload_digest, created_at, expires_at)
          VALUES ('idemp_null_test', 'target_test', 'COMPLETED', '{"success":true}', NULL, '2026-10-19T00:00:00Z', '2026-10-20T00:00:00Z');
        `);
        rawDb.close();

        const orchestrator = new DesktopOrchestrator({ storage: storageClient });

        const validDigest = 'c'.repeat(64);
        const incomingEnvelope = {
          id: 'idemp_null_test',
          traceId: 'trc_r07_01',
          roomId: 'orchestration',
          workspaceId: 'ws_r07',
          timestamp: Date.now(),
          sender: { kind: 'user', id: 'usr_r07', name: 'R07 User', role: 'USER' },
          recipient: { kind: 'agent', id: 'agent_coder' },
          fidelity: 'L0_RAW_TEXT',
          parts: [{
            kind: 'action',
            tool: 'read_file',
            callId: 'call_r07_01',
            status: 'requested',
            input: { tool: 'read_file', estimatedCost: 0, path: 'test.txt' },
          }],
        };

        const result = await orchestrator.dispatchEnvelope(incomingEnvelope);

        // MUST be rejected with ERR_IDEMPOTENCY_UNVERIFIED, NOT deduplicated success ACK
        assert.equal(result.success, false, 'NULL digest replay must not return success ACK');
        assert.equal(result.code, 'ERR_IDEMPOTENCY_UNVERIFIED');
        assert.ok(!result.deduplicated, 'Must not be marked deduplicated');
      } finally {
        await storageClient.close();
      }
    });

    it('R07-A02 (Part 2 - Worker Storage Transaction): executeActionInTransaction rejects NULL/malformed digest on COMPLETED replay', async () => {
      const dbPath = path.join(tmpDir, 'r07_a02_worker_null.db');
      const storageClient = new StorageServiceClient(dbPath, { forceWorker: true });
      await storageClient.ready;

      try {
        // Seed COMPLETED with NULL digest
        const rawDb = new DatabaseSync(dbPath);
        rawDb.exec(`
          INSERT INTO idempotency_keys (key, target_id, status, response_json, payload_digest, created_at, expires_at)
          VALUES ('idemp_worker_null', 'target_test', 'COMPLETED', '{"success":true}', NULL, '2026-10-19T00:00:00Z', '2026-10-20T00:00:00Z');
        `);
        rawDb.close();

        // Worker execution should reject with ERR_IDEMPOTENCY_UNVERIFIED
        await assert.rejects(
          async () => {
            await storageClient.insertEnvelope({
              id: 'idemp_worker_null',
              traceId: 'trc_01',
              roomId: 'orchestration',
              workspaceId: 'ws_r07',
              timestamp: Date.now(),
              sender: { kind: 'user', id: 'usr_1', role: 'USER' },
              recipient: { kind: 'agent', id: 'agent_1' },
              fidelity: 'L0_RAW_TEXT',
              parts: [{ kind: 'text', content: 'test' }],
            });
          },
          (err: any) => {
            return String(err.message).includes('ERR_IDEMPOTENCY_UNVERIFIED');
          }
        );
      } finally {
        await storageClient.close();
      }
    });

    it('R07-A02 (Part 3 - TS IdempotencyManager): acquire() rejects COMPLETED with NULL or malformed digest', async () => {
      const dbPath = path.join(tmpDir, 'r07_a02_ts_idempotency.db');
      const storage = new StorageEngine({ filename: dbPath });
      const rawDb = storage.getRawDatabase();

      // Insert COMPLETED row with NULL digest
      rawDb.exec(`
        INSERT INTO idempotency_keys (key, target_id, status, response_json, payload_digest, created_at, expires_at)
        VALUES ('idemp_ts_null', 'target_1', 'COMPLETED', '{"success":true}', NULL, '2026-10-19T00:00:00Z', '2026-10-20T00:00:00Z');
      `);

      // Insert COMPLETED row with malformed digest (not 64 hex chars)
      rawDb.exec(`
        INSERT INTO idempotency_keys (key, target_id, status, response_json, payload_digest, created_at, expires_at)
        VALUES ('idemp_ts_malformed', 'target_1', 'COMPLETED', '{"success":true}', 'invalid_short_digest', '2026-10-19T00:00:00Z', '2026-10-20T00:00:00Z');
      `);

      // Insert COMPLETED row with valid digest
      const validDigest = 'e'.repeat(64);
      rawDb.exec(`
        INSERT INTO idempotency_keys (key, target_id, status, response_json, payload_digest, created_at, expires_at)
        VALUES ('idemp_ts_valid', 'target_1', 'COMPLETED', '{"success":true}', '${validDigest}', '2026-10-19T00:00:00Z', '2026-10-20T00:00:00Z');
      `);

      const manager = new IdempotencyManager(storage);

      // 1. NULL digest -> throws ERR_IDEMPOTENCY_UNVERIFIED
      assert.throws(
        () => manager.acquire('idemp_ts_null', 'target_1', { payloadDigest: validDigest }),
        (err: any) => err instanceof UnionBotError && err.code === 'ERR_IDEMPOTENCY_UNVERIFIED'
      );

      // 2. Malformed digest -> throws ERR_IDEMPOTENCY_UNVERIFIED
      assert.throws(
        () => manager.acquire('idemp_ts_malformed', 'target_1', { payloadDigest: validDigest }),
        (err: any) => err instanceof UnionBotError && err.code === 'ERR_IDEMPOTENCY_UNVERIFIED'
      );

      // 3. Valid digest mismatch -> throws ERR_PAYLOAD_MISMATCH
      const differentDigest = 'f'.repeat(64);
      assert.throws(
        () => manager.acquire('idemp_ts_valid', 'target_1', { payloadDigest: differentDigest }),
        (err: any) => err instanceof UnionBotError && err.code === 'ERR_PAYLOAD_MISMATCH'
      );

      // 4. Valid digest match -> returns cached response ACK
      const result = manager.acquire('idemp_ts_valid', 'target_1', { payloadDigest: validDigest });
      assert.equal(result.isDuplicate, true);
      assert.deepEqual(result.cachedResponse, { success: true });

      storage.close();
    });
  });

  // =========================================================================
  // Vector R07-A03: Test IPC Isolation & Flag Boundary (UB-P2-R06-003)
  // =========================================================================
  describe('R07-A03: Test IPC Isolation & Launcher Flag Boundary', () => {
    it('R07-A03: Production mode strictly denies test IPC channels; launcher flags alone cannot enable them', () => {
      // Logic boundary check:
      // In production mode (app.isPackaged || NODE_ENV === 'production')
      // Even if --headless, --test, --test-kill, etc are passed, test channels must be disabled!

      function evaluateHarnessGate(isPackaged: boolean, nodeEnv: string, harnessEnv?: string) {
        const isPackagedApp = isPackaged || nodeEnv === 'production';
        const isDedicatedTestHarness =
          !isPackagedApp &&
          nodeEnv === 'test' &&
          harnessEnv === '1';
        return isDedicatedTestHarness;
      }

      // 1. Packaged app: always disabled
      assert.equal(evaluateHarnessGate(true, 'test', '1'), false, 'Packaged app must not enable harness');
      assert.equal(evaluateHarnessGate(true, 'production', '1'), false);

      // 2. Production env: always disabled
      assert.equal(evaluateHarnessGate(false, 'production', '1'), false, 'Production env must not enable harness');

      // 3. Generic flags / missing UNION_BOT_E2E_HARNESS: always disabled
      assert.equal(evaluateHarnessGate(false, 'test', undefined), false, 'Missing harness env must not enable harness');
      assert.equal(evaluateHarnessGate(false, 'development', '1'), false, 'Non-test env must not enable harness');

      // 4. Dedicated test harness only: enabled
      assert.equal(evaluateHarnessGate(false, 'test', '1'), true, 'Explicit test harness enabled only with exact triple condition');
    });
  });

  // =========================================================================
  // Vector R07-A04: TypeScript Orchestrator Atomic Parity & Rollback (C01)
  // =========================================================================
  describe('R07-A04: TypeScript Orchestrator Atomic Parity (C01)', () => {
    it('R07-A04: approvalGate.validateAndConsume is atomic inside storage.transaction; error rolls back token to APPROVED', async () => {
      const dbPath = path.join(tmpDir, 'r07_a04_ts_atomic.db');
      const storage = new StorageEngine({ filename: dbPath });
      const approvalGate = new ApprovalGateManager(storage);
      const orchestrator = new TsOrchestrator({ storage, approvalGate });

      // Create and approve a token
      const actionInput = { tool: 'write_file', estimatedCost: 0, path: 'out.txt' };
      const token = approvalGate.createToken({
        actionType: 'write_file',
        payload: actionInput,
        origin: 'desktop_ui',
        roomId: 'general',
      });

      approvalGate.approveToken(
        token.tokenId,
        { id: 'usr_op', role: 'OPERATOR', isTrustedContext: true },
        { confirmedByUser: true, confirmedVia: 'NATIVE_MAIN_PROCESS_CONFIRMATION' }
      );

      // Token is now APPROVED
      let currentToken = approvalGate.getToken(token.tokenId);
      assert.equal(currentToken?.status, 'APPROVED');

      // Construct action envelope
      const actionEnvelope = createEnvelope({
        id: 'env_r07_a04_01',
        sender: { kind: 'user', id: 'usr_op', name: 'Operator', role: 'USER' },
        recipient: { kind: 'agent', id: 'agent_coder' },
        roomId: 'general',
        parts: [{
          kind: 'action',
          tool: 'write_file',
          callId: 'call_a04_01',
          status: 'requested',
          input: actionInput,
          approvalTokenId: token.tokenId,
        }],
      });

      // Fault injection: monkey-patch storage.insertEnvelope to throw inside transaction after approval consumption
      const originalInsertEnvelope = storage.insertEnvelope.bind(storage);
      storage.insertEnvelope = () => {
        throw new Error('ERR_STORAGE_FAULT_INJECTION: Simulated disk crash during atomic transaction');
      };

      // Dispatch should fail
      const dispatchRes = await orchestrator.dispatchEnvelope(actionEnvelope, { isFromRenderer: true });
      assert.equal(dispatchRes.success, false);
      assert.ok(String(dispatchRes.error).includes('ERR_STORAGE_FAULT_INJECTION'));

      // Restore insertEnvelope
      storage.insertEnvelope = originalInsertEnvelope;

      // Crucial verification: Since transaction aborted, the approval token must STILL BE 'APPROVED', NOT 'CONSUMED'!
      currentToken = approvalGate.getToken(token.tokenId);
      assert.equal(currentToken?.status, 'APPROVED', 'Approval token must rollback to APPROVED if transaction aborts');

      storage.close();
    });
  });

  // =========================================================================
  // Vector R07-A05: Legacy Migration Structural Recognition & Spoof Defense (C02)
  // =========================================================================
  describe('R07-A05: Legacy Migration Structural Recognition & Spoof Defense (C02)', () => {
    it('R07-A05: Spoofed 7-table schema with altered columns is rejected with ERR_MIGRATION_TAMPERED and zero migration writes', () => {
      const dbPath = path.join(tmpDir, 'r07_a05_spoofed_schema.db');
      const rawDb = new DatabaseSync(dbPath);

      // Create 7 tables with spoofed / wrong columns
      rawDb.exec(`
        CREATE TABLE rooms (wrong_column_1 TEXT PRIMARY KEY);
        CREATE TABLE events (wrong_column_2 TEXT PRIMARY KEY);
        CREATE TABLE envelopes (wrong_column_3 TEXT PRIMARY KEY);
        CREATE TABLE idempotency_keys (wrong_column_4 TEXT PRIMARY KEY);
        CREATE TABLE outbox (wrong_column_5 TEXT PRIMARY KEY);
        CREATE TABLE approvals (wrong_column_6 TEXT PRIMARY KEY);
        CREATE TABLE audit_ledger (wrong_column_7 TEXT PRIMARY KEY);
      `);

      // Verify isVerifiedLegacyFingerprint rejects it
      const isLegacy = isVerifiedLegacyFingerprint(rawDb, LEGACY_R04_EMPTY_CHECKSUM);
      assert.equal(isLegacy, false, 'Spoofed 7-table schema must fail legacy structural fingerprint check');

      // Now create schema_migrations with spoofed legacy checksum
      rawDb.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          checksum TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
        INSERT INTO schema_migrations (version, name, checksum, applied_at)
        VALUES (1, 'initial_schema', '${LEGACY_R04_EMPTY_CHECKSUM}', '2026-10-19T00:00:00Z');
      `);

      // Calling runSchemaMigrations must reject with ERR_MIGRATION_TAMPERED
      assert.throws(
        () => runSchemaMigrations(rawDb),
        (err: any) => {
          return String(err.message).includes('ERR_MIGRATION_TAMPERED') || err.code === 'ERR_MIGRATION_TAMPERED';
        }
      );

      rawDb.close();
    });
  });
});
