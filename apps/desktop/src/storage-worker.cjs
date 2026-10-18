/**
 * @file storage-worker.cjs
 * @description Dedicated Node 24 SQLite storage worker process for Union Bot Electron desktop.
 * Runs with system Node (v24+) to execute native node:sqlite DatabaseSync and SQLite WAL storage.
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

let db = null;
let currentDbPath = ':memory:';

function initDb(dbPath) {
  currentDbPath = dbPath;
  const dir = path.dirname(dbPath);
  if (dir && dir !== '.' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  // Run schema migration v1
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

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

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      target_id TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_digest TEXT,
      response_json TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

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

    CREATE TABLE IF NOT EXISTS approvals (
      token_id TEXT PRIMARY KEY,
      action_type TEXT NOT NULL,
      payload_digest TEXT NOT NULL,
      canonicalization_version INTEGER DEFAULT 1,
      origin TEXT NOT NULL,
      workspace_id TEXT,
      room_id TEXT,
      actor_id TEXT,
      recipient TEXT,
      policy_version TEXT DEFAULT '1.0.0',
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      approver_id TEXT,
      approved_at TEXT,
      rejected_at TEXT,
      rejection_reason TEXT,
      consumed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      details_json TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // Ensure default rooms
  const now = new Date().toISOString();
  const defaultRooms = ['orchestration', 'agent-dev', 'qa-audit', 'review-briefing'];
  const insertRoom = db.prepare('INSERT OR IGNORE INTO rooms (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)');
  for (const r of defaultRooms) {
    insertRoom.run(r, r, now, now);
  }

  return { success: true, dbPath };
}

function handleRequest(msg) {
  const { id, method, args } = msg;
  try {
    switch (method) {
      case 'init': {
        const res = initDb(args.dbPath);
        process.send({ id, result: res });
        break;
      }
      case 'ensureRoom': {
        const now = new Date().toISOString();
        db.prepare('INSERT OR IGNORE INTO rooms (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
          .run(args.roomId, args.name || args.roomId, now, now);
        process.send({ id, result: true });
        break;
      }
      case 'getRooms': {
        const rows = db.prepare('SELECT id, name, created_at, updated_at FROM rooms').all();
        process.send({ id, result: rows });
        break;
      }
      case 'insertEnvelope': {
        const envelope = args.envelope;
        // ensure room exists
        const now = new Date().toISOString();
        db.prepare('INSERT OR IGNORE INTO rooms (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
          .run(envelope.roomId, envelope.roomId, now, now);

        db.exec('BEGIN TRANSACTION;');
        try {
          db.prepare(`
            INSERT INTO envelopes (
              id, trace_id, correlation_id, room_id, sender_kind, sender_id, sender_role, raw_json, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            envelope.id,
            envelope.traceId,
            envelope.correlationId || null,
            envelope.roomId,
            envelope.sender.kind,
            envelope.sender.id,
            envelope.sender.role || null,
            JSON.stringify(envelope),
            envelope.status || 'acknowledged',
            new Date(envelope.timestamp || Date.now()).toISOString()
          );

          // Append to event journal
          const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          db.prepare(`
            INSERT INTO events (event_id, stream_id, event_type, payload_json, metadata_json, occurred_at)
            VALUES (?, ?, 'ENVELOPE_RECORDED', ?, NULL, ?)
          `).run(eventId, `room:${envelope.roomId}`, JSON.stringify(envelope), now);

          db.exec('COMMIT;');
          process.send({ id, result: { success: true, envelopeId: envelope.id } });
        } catch (txErr) {
          db.exec('ROLLBACK;');
          throw txErr;
        }
        break;
      }
      case 'getRoomEnvelopes': {
        const { roomId, limit = 100 } = args;
        const rows = db.prepare('SELECT raw_json FROM envelopes WHERE room_id = ? ORDER BY rowid ASC LIMIT ?')
          .all(roomId, limit);
        const envelopes = rows.map((r) => JSON.parse(r.raw_json));
        process.send({ id, result: envelopes });
        break;
      }
      case 'close': {
        if (db) {
          db.close();
          db = null;
        }
        process.send({ id, result: true });
        break;
      }
      default:
        process.send({ id, error: `Unknown method: ${method}` });
    }
  } catch (err) {
    process.send({ id, error: err.message, stack: err.stack });
  }
}

process.on('message', handleRequest);
process.on('disconnect', () => {
  if (db) {
    try { db.close(); } catch {}
  }
  process.exit(0);
});
