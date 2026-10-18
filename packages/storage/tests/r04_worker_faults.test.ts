/**
 * @file r04_worker_faults.test.ts
 * @description Official R04 Test Vector: R04-G09.
 * Validates fault injection inside production storage worker transaction across all 5 checkpoints:
 * - after_idempotency
 * - after_envelope
 * - after_event
 * - after_outbox
 * - before_commit
 * Enforces strict all-or-nothing atomicity across all 4 tables, verifies worker crash/kill recovery,
 * and confirms that fault injection is strictly inactive in production mode.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { StorageServiceClient } = require('../../../apps/desktop/src/storage-service.cjs');

describe('Union Bot Phase P2 Gate R04: Worker Fault Injection Vectors (G09)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'union-bot-r04-faults-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
    delete process.env.UNION_BOT_TEST_FAULT_INJECTION;
  });

  it('R04-G09: Transaction rollback on fault injection at all checkpoints guarantees all-or-nothing atomicity', async () => {
    process.env.UNION_BOT_TEST_FAULT_INJECTION = '1';

    const checkpoints = [
      'after_idempotency',
      'after_envelope',
      'after_event',
      'after_outbox',
      'before_commit',
    ];

    for (const checkpoint of checkpoints) {
      const dbPath = path.join(tmpDir, `fault_${checkpoint}.db`);
      const client = new StorageServiceClient(dbPath, { forceWorker: true });
      await client.ready;

      const envelope = {
        schemaVersion: '1.0.0',
        id: `env_fault_${checkpoint}`,
        traceId: `trc_${checkpoint}`,
        timestamp: Date.now(),
        sender: { kind: 'user', id: 'usr_001', name: 'User', role: 'USER' },
        recipient: { kind: 'room', id: 'orchestration' },
        roomId: 'orchestration',
        fidelity: 'L0_RAW_TEXT',
        parts: [{ kind: 'text', text: `Test message with fault at ${checkpoint}` }],
      };

      // Attempt insert with injected error
      await assert.rejects(
        () => client.sendRequest('insertEnvelope', {
          envelope,
          injectFaultAt: checkpoint,
          faultAction: 'throw',
        }),
        (err: any) => err.message.includes(`ERR_TEST_INJECTED_FAULT: Injected fault at ${checkpoint}`)
      );

      await client.closeAsync();

      // Inspect SQLite disk state with raw DatabaseSync
      const rawDb = new DatabaseSync(dbPath);
      const envCount = (rawDb.prepare('SELECT COUNT(*) as c FROM envelopes WHERE id = ?').get(envelope.id) as any).c;
      const keyCount = (rawDb.prepare('SELECT COUNT(*) as c FROM idempotency_keys WHERE key = ?').get(envelope.id) as any).c;
      const evtCount = (rawDb.prepare('SELECT COUNT(*) as c FROM events WHERE payload_json LIKE ?').get(`%${envelope.id}%`) as any).c;
      const outCount = (rawDb.prepare('SELECT COUNT(*) as c FROM outbox WHERE payload_json LIKE ?').get(`%${envelope.id}%`) as any).c;

      assert.equal(envCount, 0, `Checkpoint ${checkpoint}: envelopes must have 0 rows`);
      assert.equal(keyCount, 0, `Checkpoint ${checkpoint}: idempotency_keys must have 0 rows`);
      assert.equal(evtCount, 0, `Checkpoint ${checkpoint}: events must have 0 rows`);
      assert.equal(outCount, 0, `Checkpoint ${checkpoint}: outbox must have 0 rows`);

      rawDb.close();
    }
  });

  it('R04-G09: Hard process exit/kill at before_commit rolls back all 4 tables upon worker restart', async () => {
    process.env.UNION_BOT_TEST_FAULT_INJECTION = '1';

    const dbPath = path.join(tmpDir, 'fault_kill_before_commit.db');
    const client = new StorageServiceClient(dbPath, { forceWorker: true });
    await client.ready;

    const envelope = {
      schemaVersion: '1.0.0',
      id: 'env_kill_before_commit',
      traceId: 'trc_kill',
      timestamp: Date.now(),
      sender: { kind: 'user', id: 'usr_001', name: 'User', role: 'USER' },
      recipient: { kind: 'room', id: 'orchestration' },
      roomId: 'orchestration',
      fidelity: 'L0_RAW_TEXT',
      parts: [{ kind: 'text', text: 'Message that triggers hard worker kill before commit' }],
    };

    // Attempt insert with hard worker kill
    await assert.rejects(
      () => client.sendRequest('insertEnvelope', {
        envelope,
        injectFaultAt: 'before_commit',
        faultAction: 'kill',
      }),
      (err: any) => err.message.includes('ERR_STORAGE_UNAVAILABLE')
    );

    client.close();

    // Verify raw SQLite state has zero partial writes
    const rawDb = new DatabaseSync(dbPath);
    const envCount = (rawDb.prepare('SELECT COUNT(*) as c FROM envelopes WHERE id = ?').get(envelope.id) as any).c;
    const keyCount = (rawDb.prepare('SELECT COUNT(*) as c FROM idempotency_keys WHERE key = ?').get(envelope.id) as any).c;
    const evtCount = (rawDb.prepare('SELECT COUNT(*) as c FROM events WHERE payload_json LIKE ?').get(`%${envelope.id}%`) as any).c;
    const outCount = (rawDb.prepare('SELECT COUNT(*) as c FROM outbox WHERE payload_json LIKE ?').get(`%${envelope.id}%`) as any).c;

    assert.equal(envCount, 0, 'Hard kill: envelopes must have 0 rows');
    assert.equal(keyCount, 0, 'Hard kill: idempotency_keys must have 0 rows');
    assert.equal(evtCount, 0, 'Hard kill: events must have 0 rows');
    assert.equal(outCount, 0, 'Hard kill: outbox must have 0 rows');

    rawDb.close();
  });

  it('R04-G09: In production mode (UNION_BOT_TEST_FAULT_INJECTION undefined), injection hooks are completely inactive', async () => {
    // Explicitly delete test flag to simulate production
    delete process.env.UNION_BOT_TEST_FAULT_INJECTION;

    const dbPath = path.join(tmpDir, 'prod_no_fault.db');
    const client = new StorageServiceClient(dbPath, { forceWorker: true });
    await client.ready;

    const envelope = {
      schemaVersion: '1.0.0',
      id: 'env_prod_safe',
      traceId: 'trc_prod',
      timestamp: Date.now(),
      sender: { kind: 'user', id: 'usr_001', name: 'User', role: 'USER' },
      recipient: { kind: 'room', id: 'orchestration' },
      roomId: 'orchestration',
      fidelity: 'L0_RAW_TEXT',
      parts: [{ kind: 'text', text: 'Production safe message' }],
    };

    // Even if an attacker or buggy client sends injectFaultAt, it MUST be ignored
    const res = await client.sendRequest('insertEnvelope', {
      envelope,
      injectFaultAt: 'before_commit',
      faultAction: 'kill',
    });

    assert.equal(res.success, true);
    assert.equal(res.envelopeId, 'env_prod_safe');

    await client.closeAsync();

    // Verify in SQLite that the envelope committed cleanly
    const rawDb = new DatabaseSync(dbPath);
    const envCount = (rawDb.prepare('SELECT COUNT(*) as c FROM envelopes WHERE id = ?').get('env_prod_safe') as any).c;
    assert.equal(envCount, 1, 'In production mode, envelope must commit normally');

    rawDb.close();
  });
});
