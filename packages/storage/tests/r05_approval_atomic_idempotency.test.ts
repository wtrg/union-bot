/**
 * @file r05_approval_atomic_idempotency.test.ts
 * @description Official Phase P2 Round R05 Test Suite for Atomic Approval Consumption & Idempotency Tamper Protection (UB-P2-R04-02, UB-P2-R04-03).
 *
 * Implements:
 * - R05-H04: Crash after approval consume but before commit across 4 fault checkpoints.
 * - R05-H06: Same action ID with modified nested payload fields (path, overwrite, content, recipient, workspaceId, roomId, policyVersion).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

// @ts-ignore
import desktopStorageService from '../../../apps/desktop/src/storage-service.cjs';
const { StorageServiceClient } = desktopStorageService;

// @ts-ignore
import desktopCanonicalJson from '../../../apps/desktop/src/canonical-json.cjs';
const { computeCanonicalDigest, extractActionSemanticInput, computeEnvelopeDigest } = desktopCanonicalJson;

describe('Union Bot Phase P2 Gate R05: Atomic Approval & Idempotency Vectors (H04, H06)', () => {
  let tmpDir: string;

  before(() => {
    process.env.UNION_BOT_TEST_FAULT_INJECTION = '1';
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'union-bot-r05-approval-'));
  });

  after(() => {
    delete process.env.UNION_BOT_TEST_FAULT_INJECTION;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // =========================================================================
  // R05-H04: Crash sau approval consume nhưng trước commit
  // =========================================================================
  describe('R05-H04: Crash after approval consume but before commit', () => {
    const checkpoints = [
      'after_approval_consume',
      'before_envelope_insert',
      'after_event',
      'before_commit',
    ];

    for (const cp of checkpoints) {
      it(`R05-H04 (${cp}): Fault injection rolls back transaction, token remains APPROVED, zero orphaned records`, async () => {
        const dbPath = path.join(tmpDir, `h04_fault_${cp}.db`);

        // 1. Setup DB with an approved token
        const client = new StorageServiceClient(dbPath, { forceWorker: true });
        await client.ready;

        const actionInput = { tool: 'write_file', path: 'output.txt', content: 'test content' };
        const semanticInput = extractActionSemanticInput(actionInput);
        const payloadDigest = computeCanonicalDigest(semanticInput, 1);
        const tokenId = `appr_h04_${cp}`;

        await client.createApprovalToken({
          tokenId,
          actionType: 'write_file',
          payload: semanticInput,
          payloadDigest,
          origin: 'desktop_ui',
          roomId: 'orchestration',
          workspaceId: 'ws_h04',
          recipient: 'agent_writer',
        });

        // Approve token with trusted principal
        await client.approveToken(tokenId, {
          id: 'lead_operator',
          role: 'OPERATOR',
          isTrustedContext: true,
        });

        const tokenBefore = await client.getApprovalToken(tokenId);
        assert.equal(tokenBefore.status, 'APPROVED', 'Token must start in APPROVED status');

        // 2. Prepare action envelope
        const envelope = {
          id: `env_h04_${cp}`,
          traceId: `trc_h04_${cp}`,
          roomId: 'orchestration',
          workspaceId: 'ws_h04',
          timestamp: Date.now(),
          sender: { kind: 'user', id: 'usr_h04', role: 'USER' },
          recipient: { kind: 'agent', id: 'agent_writer' },
          fidelity: 'L0_RAW_TEXT',
          parts: [
            {
              kind: 'action',
              tool: 'write_file',
              callId: `call_h04_${cp}`,
              status: 'requested',
              input: actionInput,
              approvalTokenId: tokenId,
            },
          ],
        };

        const approvalReq = {
          tokenId,
          actionType: 'write_file',
          payloadDigest,
          scope: {
            workspaceId: 'ws_h04',
            roomId: 'orchestration',
            actorId: 'usr_h04',
            recipient: 'agent_writer',
          },
        };

        // 4. Dispatch with fault injection at target checkpoint
        await assert.rejects(
          () => client.insertEnvelope(envelope, {
            approval: approvalReq,
            injectFaultAt: cp,
          }),
          (err: any) => {
            assert.ok(err.message.includes('ERR_TEST_INJECTED_FAULT') || err.message.includes(cp));
            return true;
          },
          `Must reject with injected fault at checkpoint '${cp}'`
        );

        // 5. Close client and verify database state via direct SQLite inspection
        await client.closeAsync();

        const rawDb = new DatabaseSync(dbPath);

        // Verification 1: Token MUST STILL BE 'APPROVED', NEVER 'CONSUMED'
        const tokenAfter = rawDb.prepare('SELECT status, consumed_at FROM approvals WHERE token_id = ?').get(tokenId) as any;
        assert.equal(tokenAfter.status, 'APPROVED', `Token must remain APPROVED upon rollback at checkpoint '${cp}'`);
        assert.equal(tokenAfter.consumed_at, null, 'consumed_at must remain NULL');

        // Verification 2: Zero orphaned envelope records
        const envRow = rawDb.prepare('SELECT id FROM envelopes WHERE id = ?').get(envelope.id);
        assert.equal(envRow, undefined, 'Envelope must NOT be recorded when transaction rolls back');

        // Verification 3: Zero orphaned event records
        const evtCount = (rawDb.prepare('SELECT COUNT(*) as c FROM events WHERE stream_id = ?').get('room:orchestration') as any).c;
        assert.equal(evtCount, 0, 'Event journal must contain 0 events');

        // Verification 4: Zero orphaned outbox records
        const outCount = (rawDb.prepare('SELECT COUNT(*) as c FROM outbox').get() as any).c;
        assert.equal(outCount, 0, 'Outbox must contain 0 records');

        // Verification 5: Idempotency key must not be marked COMPLETED
        const keyRow = rawDb.prepare('SELECT status FROM idempotency_keys WHERE key = ?').get(envelope.id) as any;
        assert.equal(keyRow, undefined, 'Idempotency key must not exist');

        rawDb.close();
      });
    }

    it('R05-H04 (Success case): Commits atomically, token is CONSUMED if and only if envelope/event/outbox exist', async () => {
      const dbPath = path.join(tmpDir, 'h04_success.db');
      const client = new StorageServiceClient(dbPath, { forceWorker: true });
      await client.ready;

      const actionInput = { tool: 'write_file', path: 'success.txt', content: 'committed content' };
      const semanticInput = extractActionSemanticInput(actionInput);
      const payloadDigest = computeCanonicalDigest(semanticInput, 1);
      const tokenId = 'appr_h04_success';

      await client.createApprovalToken({
        tokenId,
        actionType: 'write_file',
        payload: semanticInput,
        payloadDigest,
        origin: 'desktop_ui',
        roomId: 'orchestration',
        workspaceId: 'ws_success',
        recipient: 'agent_writer',
      });

      await client.approveToken(tokenId, {
        id: 'lead_operator',
        role: 'OPERATOR',
        isTrustedContext: true,
      });

      const envelope = {
        id: 'env_h04_success',
        traceId: 'trc_h04_success',
        roomId: 'orchestration',
        workspaceId: 'ws_success',
        timestamp: Date.now(),
        sender: { kind: 'user', id: 'usr_success', role: 'USER' },
        recipient: { kind: 'agent', id: 'agent_writer' },
        fidelity: 'L0_RAW_TEXT',
        parts: [
          {
            kind: 'action',
            tool: 'write_file',
            callId: 'call_h04_success',
            status: 'requested',
            input: actionInput,
            approvalTokenId: tokenId,
          },
        ],
      };

      const approvalReq = {
        tokenId,
        actionType: 'write_file',
        payloadDigest,
        scope: {
          workspaceId: 'ws_success',
          roomId: 'orchestration',
          actorId: 'usr_success',
          recipient: 'agent_writer',
        },
      };

      const result = await client.insertEnvelope(envelope, { approval: approvalReq });
      assert.equal(result.success, true);
      assert.equal(result.envelopeId, envelope.id);

      await client.closeAsync();

      // Verify all records exist atomically together
      const rawDb = new DatabaseSync(dbPath);
      const token = rawDb.prepare('SELECT status, consumed_at FROM approvals WHERE token_id = ?').get(tokenId) as any;
      assert.equal(token.status, 'CONSUMED');
      assert.ok(token.consumed_at);

      const envRow = rawDb.prepare('SELECT id FROM envelopes WHERE id = ?').get(envelope.id) as any;
      assert.equal(envRow.id, envelope.id);

      const evtRow = rawDb.prepare('SELECT event_id FROM events WHERE stream_id = ?').get('room:orchestration') as any;
      assert.ok(evtRow);

      const outRow = rawDb.prepare('SELECT status FROM outbox WHERE stream_id = ?').get('room:orchestration') as any;
      assert.equal(outRow.status, 'QUEUED');

      const keyRow = rawDb.prepare('SELECT status FROM idempotency_keys WHERE key = ?').get(envelope.id) as any;
      assert.equal(keyRow.status, 'COMPLETED');

      rawDb.close();
    });
  });

  // =========================================================================
  // R05-H06: Cùng action ID nhưng thay đổi nested payload
  // =========================================================================
  describe('R05-H06: Modified nested payload fields rejected with ERR_PAYLOAD_MISMATCH', () => {
    it('R05-H06: Every meaningful mutation on completed action causes ERR_PAYLOAD_MISMATCH (Native & Worker)', async () => {
      const dbPath = path.join(tmpDir, 'h06_tamper_matrix.db');

      // Test both native and worker engines
      for (const forceWorker of [false, true]) {
        const client = new StorageServiceClient(dbPath, { forceWorker });
        await client.ready;

        const baseActionInput = {
          tool: 'file_writer',
          args: {
            path: 'project/config.json',
            options: { overwrite: false },
            content: 'initial content',
          },
        };

        const originalEnvelope = {
          id: `env_h06_base_${forceWorker ? 'worker' : 'native'}`,
          traceId: 'trc_h06_001',
          roomId: 'orchestration',
          workspaceId: 'ws_union_1',
          policyVersion: '1.0.0',
          timestamp: Date.now(),
          sender: { kind: 'user', id: 'usr_tester', role: 'USER' },
          recipient: { kind: 'agent', id: 'agent_editor' },
          fidelity: 'L0_RAW_TEXT',
          parts: [
            {
              kind: 'action',
              tool: 'file_writer',
              callId: 'call_base_001',
              status: 'requested',
              input: baseActionInput,
            },
          ],
        };

        // 1. Insert original envelope successfully
        const baseRes = await client.insertEnvelope(originalEnvelope);
        assert.equal(baseRes.success, true);

        // 2. Exact duplicate replay returns cached ACK
        const replayRes = await client.insertEnvelope(originalEnvelope);
        assert.equal(replayRes.success, true);
        assert.equal(replayRes.deduplicated, true);

        // 3. Matrix of modifications: each must be strictly rejected with ERR_PAYLOAD_MISMATCH
        const tamperVariations: Array<{ label: string; modified: any }> = [
          {
            label: 'args.path changed',
            modified: {
              ...originalEnvelope,
              parts: [{
                ...originalEnvelope.parts[0],
                input: {
                  ...baseActionInput,
                  args: { ...baseActionInput.args, path: 'project/MALICIOUS_OVERWRITE.json' },
                },
              }],
            },
          },
          {
            label: 'args.options.overwrite changed',
            modified: {
              ...originalEnvelope,
              parts: [{
                ...originalEnvelope.parts[0],
                input: {
                  ...baseActionInput,
                  args: { ...baseActionInput.args, options: { overwrite: true } },
                },
              }],
            },
          },
          {
            label: 'args.content changed',
            modified: {
              ...originalEnvelope,
              parts: [{
                ...originalEnvelope.parts[0],
                input: {
                  ...baseActionInput,
                  args: { ...baseActionInput.args, content: 'MODIFIED_PAYLOAD_ATTACK' },
                },
              }],
            },
          },
          {
            label: 'recipient changed',
            modified: {
              ...originalEnvelope,
              recipient: { kind: 'agent', id: 'agent_rogue_receiver' },
            },
          },
          {
            label: 'workspaceId changed',
            modified: {
              ...originalEnvelope,
              workspaceId: 'ws_foreign_attacker',
            },
          },
          {
            label: 'roomId changed',
            modified: {
              ...originalEnvelope,
              roomId: 'review-briefing',
            },
          },
          {
            label: 'policyVersion changed',
            modified: {
              ...originalEnvelope,
              policyVersion: '2.0.0',
            },
          },
        ];

        for (const variation of tamperVariations) {
          await assert.rejects(
            () => client.insertEnvelope(variation.modified),
            (err: any) => {
              assert.ok(
                err.message.includes('ERR_PAYLOAD_MISMATCH'),
                `Variation '${variation.label}' must throw ERR_PAYLOAD_MISMATCH. Got: ${err.message}`
              );
              return true;
            },
            `Tampered envelope '${variation.label}' must be denied fail-closed`
          );
        }

        // 4. Concurrent requests with mismatched payload
        const racePromises = tamperVariations.slice(0, 3).map((v) =>
          client.insertEnvelope(v.modified).catch((e: Error) => e.message)
        );
        const raceResults = await Promise.all(racePromises);
        for (const res of raceResults) {
          assert.ok(
            typeof res === 'string' && res.includes('ERR_PAYLOAD_MISMATCH'),
            'Concurrent tampered replays must all be rejected with ERR_PAYLOAD_MISMATCH'
          );
        }

        await client.closeAsync();
      }
    });
  });
});
