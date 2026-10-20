import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
// @ts-ignore
import { ConversationRouter } from '../../../apps/desktop/src/services/conversation-router.cjs';
import { runMigrations } from '../../../packages/storage/src/migrations.ts';

describe('UB-V4-U04: Two-Way Conversation Router & Thread Receipts', () => {
  function setupTestDb() {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);
    return { nativeDb: db };
  }

  it('U04-001: dispatches message and stores durable DeliveryAttempt record', () => {
    const storage = setupTestDb();
    const router = new ConversationRouter(storage);

    const dispatchRes = router.dispatchToProvider({
      messageId: 'msg_001',
      projectId: 'proj_router',
      targetProvider: 'antigravity',
      correlationId: 'corr_test_001',
      watermark: 1000,
    });

    assert.ok(dispatchRes.attemptId);
    assert.equal(dispatchRes.messageId, 'msg_001');
    assert.equal(dispatchRes.correlationId, 'corr_test_001');
    assert.equal(dispatchRes.state, 'SENT');

    // Verify in database
    const attempt = router.getAttempt('corr_test_001');
    assert.ok(attempt);
    assert.equal(attempt.message_id, 'msg_001');
    assert.equal(attempt.state, 'SENT');
  });

  it('U04-002 & U04-004: ingests reply, updates state to COMPLETED and generates ThreadReceipt', () => {
    const storage = setupTestDb();
    const router = new ConversationRouter(storage);

    router.dispatchToProvider({
      messageId: 'msg_002',
      projectId: 'proj_router',
      targetProvider: 'chatgpt_web',
      correlationId: 'corr_test_002',
      watermark: 2000,
    });

    // Ingest valid response
    const ingestRes = router.ingestProviderReply({
      correlationId: 'corr_test_002',
      responseRef: 'turn_gpt_4o_001',
      watermark: 2050,
    });

    assert.equal(ingestRes.success, true);
    assert.ok(ingestRes.receipt);
    assert.equal(ingestRes.receipt.correlationId, 'corr_test_002');
    assert.equal(ingestRes.receipt.responseRef, 'turn_gpt_4o_001');
    assert.equal(ingestRes.receipt.verified, true);
    assert.ok(ingestRes.receipt.latencyMs >= 0);

    // Verify DB updated
    const attempt = router.getAttempt('corr_test_002');
    assert.equal(attempt.state, 'COMPLETED');
    assert.equal(attempt.response_ref, 'turn_gpt_4o_001');
    assert.ok(attempt.ack_at);
  });

  it('U04-003: rejects stale reply when watermark is older than latest thread watermark', () => {
    const storage = setupTestDb();
    const router = new ConversationRouter(storage);

    // Initial message at watermark 5000
    router.dispatchToProvider({
      messageId: 'msg_003_first',
      projectId: 'proj_router',
      targetProvider: 'antigravity',
      correlationId: 'corr_test_003_first',
      watermark: 5000,
    });

    // Advance watermark with second message at 6000
    router.dispatchToProvider({
      messageId: 'msg_003_second',
      projectId: 'proj_router',
      targetProvider: 'antigravity',
      correlationId: 'corr_test_003_second',
      watermark: 6000,
    });

    // First message tries to complete with stale watermark 4900
    const staleRes = router.ingestProviderReply({
      correlationId: 'corr_test_003_first',
      responseRef: 'turn_stale',
      watermark: 4900,
    });

    assert.equal(staleRes.success, false);
    assert.equal(staleRes.code, 'ERR_STALE_WATERMARK');
    assert.ok(staleRes.error?.includes('Stale reply rejected'));
  });

  it('U04-004: rejects duplicate reply ingestion for already completed attempt', () => {
    const storage = setupTestDb();
    const router = new ConversationRouter(storage);

    router.dispatchToProvider({
      messageId: 'msg_004',
      projectId: 'proj_router',
      targetProvider: 'antigravity',
      correlationId: 'corr_test_004',
      watermark: 7000,
    });

    // First ingestion succeeds
    const firstRes = router.ingestProviderReply({
      correlationId: 'corr_test_004',
      responseRef: 'turn_first',
      watermark: 7100,
    });
    assert.equal(firstRes.success, true);

    // Second ingestion for same correlationId is rejected
    const secondRes = router.ingestProviderReply({
      correlationId: 'corr_test_004',
      responseRef: 'turn_duplicate',
      watermark: 7200,
    });
    assert.equal(secondRes.success, false);
    assert.equal(secondRes.code, 'ERR_DUPLICATE_REPLY');
  });

  it('U04-005: handles timeout and rejects reply on expired attempt', () => {
    const storage = setupTestDb();
    const router = new ConversationRouter(storage);

    router.dispatchToProvider({
      messageId: 'msg_005',
      projectId: 'proj_router',
      targetProvider: 'codex',
      correlationId: 'corr_test_005',
      watermark: 8000,
    });

    // Mark as timed out
    const failRes = router.markAttemptFailed('corr_test_005', 'TIMEOUT');
    assert.equal(failRes, true);

    const attempt = router.getAttempt('corr_test_005');
    assert.equal(attempt.state, 'TIMED_OUT');

    // Attempting to complete timed-out attempt is rejected
    const res = router.ingestProviderReply({
      correlationId: 'corr_test_005',
      responseRef: 'turn_late',
      watermark: 8100,
    });
    assert.equal(res.success, false);
    assert.equal(res.code, 'ERR_EXPIRED_CORRELATION');
  });

  it('U04-006: rejects unknown correlationId', () => {
    const storage = setupTestDb();
    const router = new ConversationRouter(storage);

    const res = router.ingestProviderReply({
      correlationId: 'corr_non_existent',
      responseRef: 'turn_ghost',
      watermark: 9000,
    });
    assert.equal(res.success, false);
    assert.equal(res.code, 'ERR_UNKNOWN_CORRELATION');
  });
});
