/**
 * @file idempotency.ts
 * @description Idempotency Manager and Outbox Pattern for Union Bot (P2-005, C01, C05).
 */

import { DatabaseSync } from 'node:sqlite';
import { StorageEngine } from './storage-engine.ts';
import { UnionBotError } from './errors.ts';

export interface IdempotencyRecord {
  key: string;
  targetId: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  response?: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
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
   * If the key already exists and is COMPLETED, returns the cached response.
   * If it exists and is PENDING, raises ERR_IDEMPOTENCY_CONFLICT.
   * If it does not exist, registers key as PENDING and returns null.
   */
  public acquire(key: string, targetId: string, ttlMs = 86400000): { isDuplicate: boolean; cachedResponse?: Record<string, unknown> } {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

    const existing = this.db
      .prepare('SELECT status, response_json, expires_at FROM idempotency_keys WHERE key = ?')
      .get(key) as { status: string; response_json: string | null; expires_at: string } | undefined;

    if (existing) {
      if (new Date(existing.expires_at).getTime() < now.getTime()) {
        // Expired key, delete and re-register
        this.db.prepare('DELETE FROM idempotency_keys WHERE key = ?').run(key);
      } else if (existing.status === 'COMPLETED' && existing.response_json) {
        return {
          isDuplicate: true,
          cachedResponse: JSON.parse(existing.response_json),
        };
      } else if (existing.status === 'PENDING') {
        throw new UnionBotError({
          code: 'ERR_IDEMPOTENCY_CONFLICT',
          message: `Concurrent request already pending for idempotency key: ${key}`,
          details: { key, targetId },
        });
      }
    }

    // Insert pending
    this.db
      .prepare(`
        INSERT INTO idempotency_keys (key, target_id, status, response_json, created_at, expires_at)
        VALUES (?, ?, 'PENDING', NULL, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          target_id = excluded.target_id,
          status = 'PENDING',
          response_json = NULL,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at
      `)
      .run(key, targetId, now.toISOString(), expiresAt);

    return { isDuplicate: false };
  }

  /**
   * Marks the idempotency key as COMPLETED with the given response.
   */
  public complete(key: string, response: Record<string, unknown>): void {
    this.db
      .prepare(`
        UPDATE idempotency_keys
        SET status = 'COMPLETED', response_json = ?
        WHERE key = ?
      `)
      .run(JSON.stringify(response), key);
  }

  /**
   * Marks the idempotency key as FAILED.
   */
  public fail(key: string, errorResponse: Record<string, unknown>): void {
    this.db
      .prepare(`
        UPDATE idempotency_keys
        SET status = 'FAILED', response_json = ?
        WHERE key = ?
      `)
      .run(JSON.stringify(errorResponse), key);
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

  public getPendingOutboxEntries(limit = 20): OutboxEntry[] {
    const rows = this.db
      .prepare(`
        SELECT id, stream_id, event_id, payload_json, status, retry_count, created_at, updated_at
        FROM outbox
        WHERE status IN ('QUEUED', 'UNKNOWN_NEEDS_RECONCILIATION')
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
}
