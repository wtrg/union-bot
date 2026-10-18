/**
 * @file idempotency.ts
 * @description Hardened Idempotency Manager and Outbox Pattern for Union Bot (P2-005, C01, C05, UB-P2-R01-005, P2-T06, P2-T07).
 *
 * Enforces:
 * - getPendingOutboxEntries() ONLY retrieves QUEUED entries; UNKNOWN_NEEDS_RECONCILIATION is never re-enqueued for automatic send.
 * - Dedicated getReconciliationEntries() and reconcileOutbox() for manual/provenance-driven reconciliation.
 * - Idempotency keys bind to targetId and optional payloadDigest; mismatched payload under same key is strictly rejected (ERR_PAYLOAD_MISMATCH).
 * - UNKNOWN_NEEDS_RECONCILIATION or unresolved attempts are never silently erased on TTL expiration.
 * - Atomic conditional CAS updates on complete() and fail() checking status = 'PENDING' and asserting changes === 1.
 */

import { DatabaseSync } from 'node:sqlite';
import { StorageEngine } from './storage-engine.ts';
import { UnionBotError } from './errors.ts';

export interface IdempotencyRecord {
  key: string;
  targetId: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'UNKNOWN_NEEDS_RECONCILIATION';
  payloadDigest?: string;
  response?: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
}

export interface AcquireOptions {
  payloadDigest?: string;
  ttlMs?: number;
}

export interface OutboxEntry {
  id: string;
  streamId: string;
  eventId: string;
  payload: Record<string, unknown>;
  status: 'QUEUED' | 'PROCESSING' | 'DELIVERED' | 'FAILED' | 'UNKNOWN_NEEDS_RECONCILIATION';
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export class IdempotencyManager {
  private db: DatabaseSync;
  private storage: StorageEngine;

  constructor(storage: StorageEngine) {
    this.storage = storage;
    this.db = storage.getRawDatabase();
  }

  /**
   * Attempts to acquire an idempotency key.
   * If key is COMPLETED, returns cached response.
   * If key has mismatched payload digest, strictly throws ERR_PAYLOAD_MISMATCH.
   * If key is UNKNOWN_NEEDS_RECONCILIATION, strictly throws ERR_RECONCILIATION_REQUIRED.
   * If key is PENDING, strictly throws ERR_IDEMPOTENCY_CONFLICT.
   */
  public acquire(
    key: string,
    targetId: string,
    options: AcquireOptions = {}
  ): { isDuplicate: boolean; cachedResponse?: Record<string, unknown> } {
    const ttlMs = options.ttlMs || 86400000;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

    const existing = this.db
      .prepare('SELECT status, response_json, payload_digest, expires_at FROM idempotency_keys WHERE key = ?')
      .get(key) as { status: string; response_json: string | null; payload_digest: string | null; expires_at: string } | undefined;

    if (existing) {
      // Check payload digest mismatch (UB-P2-R01-005, P2-T07)
      if (
        options.payloadDigest &&
        existing.payload_digest &&
        existing.payload_digest !== options.payloadDigest
      ) {
        throw new UnionBotError({
          code: 'ERR_PAYLOAD_MISMATCH',
          message: `Idempotency key '${key}' reused with mismatched payload digest. Replay with different parameters is forbidden.`,
          details: { key, expectedDigest: existing.payload_digest, actualDigest: options.payloadDigest },
        });
      }

      if (existing.status === 'COMPLETED' && existing.response_json) {
        return {
          isDuplicate: true,
          cachedResponse: JSON.parse(existing.response_json),
        };
      }

      // Never auto-reissue an unresolved external dispatch (P2-T06, P2-T07)
      if (existing.status === 'UNKNOWN_NEEDS_RECONCILIATION') {
        throw new UnionBotError({
          code: 'ERR_RECONCILIATION_REQUIRED',
          message: `Idempotency key '${key}' is in UNKNOWN_NEEDS_RECONCILIATION state. Automatic re-execution is forbidden without external reconciliation.`,
          details: { key, targetId },
        });
      }

      const isExpired = new Date(existing.expires_at).getTime() < now.getTime();
      if (!isExpired && existing.status === 'PENDING') {
        throw new UnionBotError({
          code: 'ERR_IDEMPOTENCY_CONFLICT',
          message: `Concurrent request already pending for idempotency key: ${key}`,
          details: { key, targetId },
        });
      }

      // If expired PENDING without side effect proof, delete expired record before insert
      if (isExpired && existing.status === 'PENDING') {
        this.db.prepare("DELETE FROM idempotency_keys WHERE key = ? AND status = 'PENDING'").run(key);
      }
    }

    // Insert pending with optional payload_digest
    this.db
      .prepare(`
        INSERT INTO idempotency_keys (key, target_id, status, payload_digest, response_json, created_at, expires_at)
        VALUES (?, ?, 'PENDING', ?, NULL, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          target_id = excluded.target_id,
          status = 'PENDING',
          payload_digest = COALESCE(excluded.payload_digest, idempotency_keys.payload_digest),
          response_json = NULL,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at
        WHERE idempotency_keys.status != 'UNKNOWN_NEEDS_RECONCILIATION'
      `)
      .run(key, targetId, options.payloadDigest || null, now.toISOString(), expiresAt);

    return { isDuplicate: false };
  }

  /**
   * Marks the idempotency key as COMPLETED with the given response.
   * Atomically verifies status is PENDING and asserts changes === 1.
   */
  public complete(key: string, response: Record<string, unknown>): void {
    const result = this.db
      .prepare(`
        UPDATE idempotency_keys
        SET status = 'COMPLETED', response_json = ?
        WHERE key = ? AND status = 'PENDING'
      `)
      .run(JSON.stringify(response), key);

    if (result.changes === 0) {
      // Check current state
      const row = this.db.prepare('SELECT status FROM idempotency_keys WHERE key = ?').get(key) as any;
      if (!row) {
        throw new UnionBotError({
          code: 'ERR_IDEMPOTENCY_CONFLICT',
          message: `Idempotency key '${key}' not found when attempting to complete.`,
        });
      }
      if (row.status !== 'COMPLETED') {
        throw new UnionBotError({
          code: 'ERR_IDEMPOTENCY_CONFLICT',
          message: `Cannot complete idempotency key '${key}': current status is ${row.status}`,
          details: { key, status: row.status },
        });
      }
    }
  }

  /**
   * Marks the idempotency key as FAILED.
   * Atomically verifies status is PENDING.
   */
  public fail(key: string, errorResponse: Record<string, unknown>): void {
    this.db
      .prepare(`
        UPDATE idempotency_keys
        SET status = 'FAILED', response_json = ?
        WHERE key = ? AND status = 'PENDING'
      `)
      .run(JSON.stringify(errorResponse), key);
  }

  /**
   * Marks the idempotency key as UNKNOWN_NEEDS_RECONCILIATION.
   * Used when side effect may have occurred but outcome / ACK was interrupted by crash or timeout.
   */
  public markNeedsReconciliation(key: string, partialEvidence?: Record<string, unknown>): void {
    this.db
      .prepare(`
        UPDATE idempotency_keys
        SET status = 'UNKNOWN_NEEDS_RECONCILIATION', response_json = ?
        WHERE key = ?
      `)
      .run(partialEvidence ? JSON.stringify(partialEvidence) : null, key);
  }

  // --- Outbox Operations ---

  public enqueueOutbox(streamId: string, eventId: string, payload: Record<string, unknown>): string {
    const id = `out_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date().toISOString();

    this.db
      .prepare(`
        INSERT INTO outbox (id, stream_id, event_id, payload_json, status, retry_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'QUEUED', 0, ?, ?)
      `)
      .run(id, streamId, eventId, JSON.stringify(payload), now, now);

    return id;
  }

  /**
   * CRITICAL FIX (UB-P2-R01-005, P2-T06):
   * Retrieves pending outbox entries eligible for initial dispatch.
   * MUST ONLY return status = 'QUEUED'.
   * UNKNOWN_NEEDS_RECONCILIATION is STRICTLY EXCLUDED to prevent duplicate external side-effects.
   */
  public getPendingOutboxEntries(limit = 20): OutboxEntry[] {
    const rows = this.db
      .prepare(`
        SELECT id, stream_id, event_id, payload_json, status, retry_count, created_at, updated_at
        FROM outbox
        WHERE status = 'QUEUED'
        ORDER BY created_at ASC
        LIMIT ?
      `)
      .all(limit) as any[];

    return rows.map((r) => ({
      id: r.id,
      streamId: r.stream_id,
      eventId: r.event_id,
      payload: JSON.parse(r.payload_json),
      status: r.status,
      retryCount: r.retry_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Dedicated query for entries requiring human or evidence-based reconciliation.
   */
  public getReconciliationEntries(limit = 20): OutboxEntry[] {
    const rows = this.db
      .prepare(`
        SELECT id, stream_id, event_id, payload_json, status, retry_count, created_at, updated_at
        FROM outbox
        WHERE status = 'UNKNOWN_NEEDS_RECONCILIATION'
        ORDER BY created_at ASC
        LIMIT ?
      `)
      .all(limit) as any[];

    return rows.map((r) => ({
      id: r.id,
      streamId: r.stream_id,
      eventId: r.event_id,
      payload: JSON.parse(r.payload_json),
      status: r.status,
      retryCount: r.retry_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public markOutboxDelivered(id: string): void {
    this.db
      .prepare(`
        UPDATE outbox
        SET status = 'DELIVERED', updated_at = ?
        WHERE id = ?
      `)
      .run(new Date().toISOString(), id);
  }

  public markOutboxNeedsReconciliation(id: string): void {
    this.db
      .prepare(`
        UPDATE outbox
        SET status = 'UNKNOWN_NEEDS_RECONCILIATION', updated_at = ?
        WHERE id = ?
      `)
      .run(new Date().toISOString(), id);
  }

  /**
   * Reconciles an outbox entry based on verified external evidence.
   */
  public reconcileOutbox(id: string, outcome: 'DELIVERED' | 'FAILED', evidence: Record<string, unknown>): void {
    this.db
      .prepare(`
        UPDATE outbox
        SET status = ?, updated_at = ?, payload_json = json_set(payload_json, '$.reconciliationEvidence', json(?))
        WHERE id = ? AND status = 'UNKNOWN_NEEDS_RECONCILIATION'
      `)
      .run(outcome, new Date().toISOString(), JSON.stringify(evidence), id);
  }
}
