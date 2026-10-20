/**
 * @file conversation-router.cjs
 * @description Two-Way Conversation Router & Thread Receipts Engine (UB-V4-U04).
 * Enforces:
 * - Durable DeliveryAttempt tracking bound to message_id and correlation_id.
 * - Stale reply rejection using monotonic thread watermarks.
 * - Anti-duplicate reply ingestion.
 * - Deterministic Thread Receipts on roundtrip completion.
 */

const crypto = require('node:crypto');

class ConversationRouter {
  constructor(storageService, options = {}) {
    this.storage = storageService;
    this.defaultTimeoutMs = options.defaultTimeoutMs || 30000;
    this.threadWatermarks = new Map(); // threadId -> number
  }

  /**
   * Helper to obtain raw SQLite database handle.
   */
  getDb() {
    return this.storage.nativeDb || (this.storage.client && this.storage.client.db);
  }

  /**
   * Dispatches a message to a provider, recording a durable DeliveryAttempt (U04-001).
   */
  dispatchToProvider(params) {
    const rawDb = this.getDb();
    if (!rawDb) throw new Error('Database unavailable for ConversationRouter');

    const messageId = params.messageId;
    if (!messageId) throw new Error('messageId is required');

    const projectId = params.projectId || 'default';
    const targetProvider = params.targetProvider || 'antigravity';
    const correlationId = params.correlationId || `corr_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const attemptId = `att_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const sentAt = new Date().toISOString();
    const watermark = params.watermark || Date.now();

    // Update thread watermark
    const threadKey = `${projectId}:${targetProvider}`;
    const currentWatermark = this.threadWatermarks.get(threadKey) || 0;
    if (watermark > currentWatermark) {
      this.threadWatermarks.set(threadKey, watermark);
    }

    rawDb.prepare(`
      INSERT INTO delivery_attempts (
        id, message_id, project_id, target_provider, correlation_id, state, sent_at
      ) VALUES (?, ?, ?, ?, ?, 'SENT', ?)
    `).run(attemptId, messageId, projectId, targetProvider, correlationId, sentAt);

    return {
      attemptId,
      messageId,
      projectId,
      targetProvider,
      correlationId,
      watermark,
      sentAt,
      state: 'SENT',
    };
  }

  /**
   * Ingests an incoming reply from a provider (U04-002, U04-003, U04-004).
   * Verifies correlationId freshness, watermark validity, and prevents duplicate completion.
   */
  ingestProviderReply(params) {
    const rawDb = this.getDb();
    if (!rawDb) return { success: false, error: 'Database unavailable' };

    const { correlationId, responseRef, watermark } = params;
    if (!correlationId) {
      return { success: false, error: 'Missing correlationId', code: 'ERR_MISSING_CORRELATION' };
    }

    const attempt = rawDb.prepare(
      'SELECT * FROM delivery_attempts WHERE correlation_id = ?'
    ).get(correlationId);

    if (!attempt) {
      return {
        success: false,
        error: `Unknown correlationId: '${correlationId}'`,
        code: 'ERR_UNKNOWN_CORRELATION',
      };
    }

    // Anti-replay / duplicate completion prevention
    if (attempt.state === 'COMPLETED' || attempt.state === 'ACKNOWLEDGED') {
      return {
        success: false,
        error: `Attempt '${correlationId}' has already been completed with state '${attempt.state}'`,
        code: 'ERR_DUPLICATE_REPLY',
      };
    }

    if (attempt.state === 'TIMED_OUT' || attempt.state === 'FAILED') {
      return {
        success: false,
        error: `Attempt '${correlationId}' is expired or failed (${attempt.state})`,
        code: 'ERR_EXPIRED_CORRELATION',
      };
    }

    // Freshness Watermark Check (U04-003)
    const threadKey = `${attempt.project_id}:${attempt.target_provider}`;
    const threadLatestWatermark = this.threadWatermarks.get(threadKey) || 0;

    if (watermark && watermark < threadLatestWatermark) {
      return {
        success: false,
        error: `Stale reply rejected: reply watermark (${watermark}) is older than thread watermark (${threadLatestWatermark})`,
        code: 'ERR_STALE_WATERMARK',
      };
    }

    if (watermark && watermark > threadLatestWatermark) {
      this.threadWatermarks.set(threadKey, watermark);
    }

    const now = new Date();
    const ackAt = now.toISOString();
    const sentTime = new Date(attempt.sent_at).getTime();
    const latencyMs = Math.max(0, now.getTime() - sentTime);

    // Update attempt record to COMPLETED
    rawDb.prepare(`
      UPDATE delivery_attempts
      SET state = 'COMPLETED', ack_at = ?, response_ref = ?
      WHERE id = ?
    `).run(ackAt, responseRef || null, attempt.id);

    // Thread Receipt (U04-004)
    const receipt = {
      attemptId: attempt.id,
      correlationId: attempt.correlation_id,
      messageId: attempt.message_id,
      targetProvider: attempt.target_provider,
      sentAt: attempt.sent_at,
      ackAt,
      latencyMs,
      responseRef: responseRef || null,
      verified: true,
    };

    return {
      success: true,
      receipt,
    };
  }

  /**
   * Marks an in-flight attempt as timed out or failed (U04-005).
   */
  markAttemptFailed(correlationId, reason = 'TIMEOUT') {
    const rawDb = this.getDb();
    if (!rawDb) return false;

    const state = reason === 'TIMEOUT' ? 'TIMED_OUT' : 'FAILED';
    const now = new Date().toISOString();

    const res = rawDb.prepare(`
      UPDATE delivery_attempts
      SET state = ?, ack_at = ?
      WHERE correlation_id = ? AND state = 'SENT'
    `).run(state, now, correlationId);

    return res.changes > 0;
  }

  /**
   * Retrieves attempt by correlationId.
   */
  getAttempt(correlationId) {
    const rawDb = this.getDb();
    if (!rawDb) return null;
    return rawDb.prepare('SELECT * FROM delivery_attempts WHERE correlation_id = ?').get(correlationId) || null;
  }

  /**
   * Lists attempts for a project.
   */
  listAttempts(projectId = 'default', limit = 50) {
    const rawDb = this.getDb();
    if (!rawDb) return [];
    return rawDb.prepare(
      'SELECT * FROM delivery_attempts WHERE project_id = ? ORDER BY sent_at DESC LIMIT ?'
    ).all(projectId, limit) || [];
  }
}

module.exports = {
  ConversationRouter,
};
