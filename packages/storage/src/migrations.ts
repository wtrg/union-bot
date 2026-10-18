/**
 * @file migrations.ts
 * @description SQLite schema migrations engine for Union Bot (P2-003).
 */

import { DatabaseSync } from 'node:sqlite';
import { UnionBotError } from './errors.ts';

export interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseSync) => void;
  down: (db: DatabaseSync) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: '001_initial_p2_schema',
    up: (db: DatabaseSync) => {
      // 1. Schema migrations tracker
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
      `);

      // 2. Chat & Collaboration Rooms
      db.exec(`
        CREATE TABLE IF NOT EXISTS rooms (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // 3. Append-only Event Journal (P2-004)
      db.exec(`
        CREATE TABLE IF NOT EXISTS events (
          sequence_id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id TEXT UNIQUE NOT NULL,
          stream_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          metadata_json TEXT,
          occurred_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_events_stream_seq ON events (stream_id, sequence_id);
        CREATE INDEX IF NOT EXISTS idx_events_occurred_at ON events (occurred_at);
        CREATE INDEX IF NOT EXISTS idx_events_type ON events (event_type);
      `);

      // 4. Canonical Envelopes Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS envelopes (
          id TEXT PRIMARY KEY,
          trace_id TEXT NOT NULL,
          correlation_id TEXT,
          room_id TEXT NOT NULL,
          sender_kind TEXT NOT NULL,
          sender_id TEXT NOT NULL,
          sender_role TEXT,
          raw_json TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_envelopes_room ON envelopes (room_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_envelopes_trace ON envelopes (trace_id);
      `);

      // 5. Idempotency Keys (P2-005 & C05)
      db.exec(`
        CREATE TABLE IF NOT EXISTS idempotency_keys (
          key TEXT PRIMARY KEY,
          target_id TEXT NOT NULL,
          status TEXT NOT NULL,
          response_json TEXT,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
      `);

      // 6. Outbox for Guaranteed Delivery & Recovery (P2-005)
      db.exec(`
        CREATE TABLE IF NOT EXISTS outbox (
          id TEXT PRIMARY KEY,
          stream_id TEXT NOT NULL,
          event_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          status TEXT NOT NULL,
          retry_count INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox (status);
      `);

      // 7. Approval Tokens for Actions (P2-006 & C02)
      db.exec(`
        CREATE TABLE IF NOT EXISTS approvals (
          token_id TEXT PRIMARY KEY,
          action_type TEXT NOT NULL,
          payload_digest TEXT NOT NULL,
          origin TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          consumed_at TEXT
        );
      `);

      // 8. DAG Task Graph Nodes (P2 Task Graph Foundation)
      db.exec(`
        CREATE TABLE IF NOT EXISTS dag_nodes (
          task_id TEXT NOT NULL,
          node_id TEXT NOT NULL,
          name TEXT NOT NULL,
          dependencies_json TEXT NOT NULL,
          assigned_role TEXT NOT NULL,
          assigned_provider TEXT,
          revision INTEGER DEFAULT 1,
          attempt INTEGER DEFAULT 1,
          correlation_id TEXT NOT NULL,
          recovery_state TEXT NOT NULL,
          raw_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (task_id, node_id)
        );
        CREATE INDEX IF NOT EXISTS idx_dag_recovery ON dag_nodes (recovery_state);
      `);

      // 9. Snapshots for Event Sourcing Projection Rebuild (P2-004)
      db.exec(`
        CREATE TABLE IF NOT EXISTS snapshots (
          stream_id TEXT PRIMARY KEY,
          last_sequence_id INTEGER NOT NULL,
          state_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);

      // 10. Audit Ledger
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_ledger (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          summary TEXT NOT NULL,
          details_json TEXT,
          created_at TEXT NOT NULL
        );
      `);
    },
    down: (db: DatabaseSync) => {
      db.exec(`
        DROP TABLE IF EXISTS audit_ledger;
        DROP TABLE IF EXISTS snapshots;
        DROP TABLE IF EXISTS dag_nodes;
        DROP TABLE IF EXISTS approvals;
        DROP TABLE IF EXISTS outbox;
        DROP TABLE IF EXISTS idempotency_keys;
        DROP TABLE IF EXISTS envelopes;
        DROP TABLE IF EXISTS events;
        DROP TABLE IF EXISTS rooms;
      `);
    },
  },
];

/**
 * Runs pending migrations on SQLite database.
 */
export function runMigrations(db: DatabaseSync): { appliedCount: number; currentVersion: number } {
  // Ensure schema_migrations table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare('SELECT version FROM schema_migrations ORDER BY version ASC').all() as Array<{ version: number }>;
  const appliedSet = new Set(appliedRows.map((r) => r.version));

  let appliedCount = 0;
  for (const m of MIGRATIONS) {
    if (!appliedSet.has(m.version)) {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        new Date().toISOString()
      );
      appliedCount++;
    }
  }

  const latestRow = db.prepare('SELECT MAX(version) as v FROM schema_migrations').get() as { v: number | null };
  return {
    appliedCount,
    currentVersion: latestRow?.v ?? 0,
  };
}

/**
 * Rolls back the latest applied migration.
 */
export function rollbackMigration(db: DatabaseSync): { rolledBackVersion: number | null } {
  const latestRow = db.prepare('SELECT MAX(version) as v FROM schema_migrations').get() as { v: number | null };
  if (!latestRow || latestRow.v === null) {
    return { rolledBackVersion: null };
  }

  const version = latestRow.v;
  const migration = MIGRATIONS.find((m) => m.version === version);
  if (!migration) {
    throw new UnionBotError({
      code: 'ERR_STORAGE_CORRUPTION',
      message: `Cannot rollback migration version ${version}: definition not found`,
    });
  }

  migration.down(db);
  db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(version);
  return { rolledBackVersion: version };
}
