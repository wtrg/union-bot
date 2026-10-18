/**
 * @file storage-engine.ts
 * @description Main SQLite Storage Engine for Union Bot (P2-003, P2-004, P2-012).
 */

import { DatabaseSync } from 'node:sqlite';
import { runMigrations, rollbackMigration } from './migrations.ts';
import { type Envelope, EnvelopeSchema } from '../../protocol/src/index.ts';
import { UnionBotError } from './errors.ts';

export interface StorageEngineOptions {
  filename?: string; // ':memory:' or file path
  wal?: boolean;
}

export class StorageEngine {
  private db: DatabaseSync;
  public readonly filename: string;

  constructor(options: StorageEngineOptions = {}) {
    this.filename = options.filename || ':memory:';
    this.db = new DatabaseSync(this.filename);

    // Initialize PRAGMAs
    if (this.filename !== ':memory:' && options.wal !== false) {
      this.db.exec('PRAGMA journal_mode = WAL;');
    }
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');

    // Auto-run migrations
    runMigrations(this.db);
  }

  public getRawDatabase(): DatabaseSync {
    return this.db;
  }

  public close(): void {
    this.db.close();
  }

  public rollbackLatestMigration(): { rolledBackVersion: number | null } {
    return rollbackMigration(this.db);
  }

  // --- Room Operations ---
  public ensureRoom(roomId: string, name?: string): void {
    const existing = this.db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId);
    if (!existing) {
      const now = new Date().toISOString();
      this.db
        .prepare('INSERT INTO rooms (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(roomId, name || roomId, now, now);
    }
  }

  public getRooms(): Array<{ id: string; name: string; createdAt: string; updatedAt: string }> {
    const rows = this.db.prepare('SELECT id, name, created_at, updated_at FROM rooms').all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  // --- Envelope Operations ---
  public insertEnvelope(envelope: Envelope): void {
    // Validate schema
    const parsed = EnvelopeSchema.parse(envelope);
    this.ensureRoom(parsed.roomId);

    this.db
      .prepare(`
        INSERT INTO envelopes (
          id, trace_id, correlation_id, room_id, sender_kind, sender_id, sender_role, raw_json, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        parsed.id,
        parsed.traceId,
        parsed.correlationId || null,
        parsed.roomId,
        parsed.sender.kind,
        parsed.sender.id,
        parsed.sender.role || null,
        JSON.stringify(parsed),
        parsed.status || 'acknowledged',
        new Date(parsed.timestamp).toISOString()
      );
  }

  public getEnvelope(id: string): Envelope | null {
    const row = this.db.prepare('SELECT raw_json FROM envelopes WHERE id = ?').get(id) as { raw_json: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.raw_json) as Envelope;
  }

  public getRoomEnvelopes(roomId: string, limit = 100): Envelope[] {
    const rows = this.db
      .prepare('SELECT raw_json FROM envelopes WHERE room_id = ? ORDER BY rowid ASC LIMIT ?')
      .all(roomId, limit) as Array<{ raw_json: string }>;
    return rows.map((r) => JSON.parse(r.raw_json) as Envelope);
  }

  // --- Transaction Support ---
  public transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN TRANSACTION;');
    try {
      const result = fn();
      this.db.exec('COMMIT;');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }
}
