/**
 * @file event-store.ts
 * @description Append-only Event Journal, Snapshot, and Projection Rebuild for Union Bot (P2-004, P2-012).
 */

import { DatabaseSync } from 'node:sqlite';
import { StorageEngine } from './storage-engine.ts';
import { type Envelope } from '../../protocol/src/index.ts';

export interface StoredEvent {
  sequenceId: number;
  eventId: string;
  streamId: string;
  eventType: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  occurredAt: string;
}

export interface PaginationOptions {
  limit?: number;
  cursor?: number; // sequence_id
  direction?: 'forward' | 'backward';
}

export interface PaginatedEvents {
  events: StoredEvent[];
  nextCursor: number | null;
  hasMore: boolean;
}

export class EventStore {
  private db: DatabaseSync;

  private storage: StorageEngine;

  constructor(storage: StorageEngine) {
    this.storage = storage;
    this.db = storage.getRawDatabase();
  }

  /**
   * Appends an event to the append-only journal atomically.
   */
  public appendEvent(
    streamId: string,
    eventType: string,
    payload: Record<string, unknown>,
    metadata?: Record<string, unknown>
  ): StoredEvent {
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const occurredAt = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO events (event_id, stream_id, event_type, payload_json, metadata_json, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      eventId,
      streamId,
      eventType,
      JSON.stringify(payload),
      metadata ? JSON.stringify(metadata) : null,
      occurredAt
    );

    const row = this.db
      .prepare('SELECT sequence_id FROM events WHERE event_id = ?')
      .get(eventId) as { sequence_id: number };

    return {
      sequenceId: row.sequence_id,
      eventId,
      streamId,
      eventType,
      payload,
      metadata,
      occurredAt,
    };
  }

  /**
   * P2-012: Fast seek-based cursor pagination over indexed sequence_id.
   */
  public getEvents(streamId: string, options: PaginationOptions = {}): PaginatedEvents {
    const limit = options.limit || 50;
    const cursor = options.cursor ?? 0;
    const direction = options.direction || 'forward';

    let query: string;
    let params: any[];

    if (direction === 'forward') {
      query = `
        SELECT sequence_id, event_id, stream_id, event_type, payload_json, metadata_json, occurred_at
        FROM events
        WHERE stream_id = ? AND sequence_id > ?
        ORDER BY sequence_id ASC
        LIMIT ?
      `;
      params = [streamId, cursor, limit + 1];
    } else {
      query = `
        SELECT sequence_id, event_id, stream_id, event_type, payload_json, metadata_json, occurred_at
        FROM events
        WHERE stream_id = ? AND sequence_id < ?
        ORDER BY sequence_id DESC
        LIMIT ?
      `;
      params = [streamId, cursor > 0 ? cursor : Number.MAX_SAFE_INTEGER, limit + 1];
    }

    const rows = this.db.prepare(query).all(...params) as any[];
    const hasMore = rows.length > limit;
    const resultRows = hasMore ? rows.slice(0, limit) : rows;

    const events: StoredEvent[] = resultRows.map((r) => ({
      sequenceId: r.sequence_id,
      eventId: r.event_id,
      streamId: r.stream_id,
      eventType: r.event_type,
      payload: JSON.parse(r.payload_json),
      metadata: r.metadata_json ? JSON.parse(r.metadata_json) : undefined,
      occurredAt: r.occurred_at,
    }));

    const nextCursor = hasMore && events.length > 0 ? events[events.length - 1].sequenceId : null;

    return {
      events,
      nextCursor,
      hasMore,
    };
  }

  /**
   * P2-004: Projection rebuild from event log.
   * Replays events from sequence_id 0 up to latest to reconstruct room message history.
   */
  public rebuildRoomProjection(roomId: string): Envelope[] {
    const streamId = `room:${roomId}`;
    const rows = this.db
      .prepare(`
        SELECT event_type, payload_json
        FROM events
        WHERE stream_id = ?
        ORDER BY sequence_id ASC
      `)
      .all(streamId) as Array<{ event_type: string; payload_json: string }>;

    const envelopes: Envelope[] = [];
    const seenIds = new Set<string>();

    for (const r of rows) {
      if (r.event_type === 'ENVELOPE_RECORDED') {
        const env = JSON.parse(r.payload_json) as Envelope;
        if (!seenIds.has(env.id)) {
          seenIds.add(env.id);
          envelopes.push(env);
        }
      }
    }

    // Save snapshot
    const lastRow = this.db
      .prepare('SELECT MAX(sequence_id) as seq FROM events WHERE stream_id = ?')
      .get(streamId) as { seq: number | null };

    const lastSeq = lastRow?.seq ?? 0;
    this.db
      .prepare(`
        INSERT INTO snapshots (stream_id, last_sequence_id, state_json, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(stream_id) DO UPDATE SET
          last_sequence_id = excluded.last_sequence_id,
          state_json = excluded.state_json,
          created_at = excluded.created_at
      `)
      .run(streamId, lastSeq, JSON.stringify(envelopes), new Date().toISOString());

    return envelopes;
  }
}
