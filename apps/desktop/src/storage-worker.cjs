/**
 * @file storage-worker.cjs
 * @description Dedicated Node 24 SQLite storage worker process for Union Bot Electron desktop.
 * Runs with system Node (v24+) to execute native node:sqlite DatabaseSync and SQLite WAL storage.
 * Implements atomic transaction combining idempotency_keys, envelopes, events, and outbox (UB-P2-R02-004),
 * and provides persistent approval token management (UB-P2-R02-003).
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
        const now = new Date().toISOString();
        const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const outboxId = `out_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

        db.exec('BEGIN IMMEDIATE;');
        try {
          // 1. Idempotency deduplication check in transaction
          if (envelope.id) {
            const existing = db.prepare('SELECT status, response_json FROM idempotency_keys WHERE key = ?').get(envelope.id);
            if (existing) {
              if (existing.status === 'COMPLETED') {
                db.exec('COMMIT;');
                process.send({ id, result: { success: true, envelopeId: envelope.id, deduplicated: true } });
                break;
              }
              if (existing.status === 'UNKNOWN_NEEDS_RECONCILIATION') {
                throw new Error(`ERR_RECONCILIATION_REQUIRED: Key ${envelope.id} requires external reconciliation`);
              }
              if (existing.status === 'PENDING') {
                throw new Error(`ERR_IDEMPOTENCY_CONFLICT: Key ${envelope.id} is already PENDING`);
              }
            } else {
              db.prepare(`
                INSERT INTO idempotency_keys (key, target_id, status, payload_digest, response_json, created_at, expires_at)
                VALUES (?, ?, 'COMPLETED', ?, ?, ?, ?)
              `).run(
                envelope.id,
                envelope.roomId,
                null,
                JSON.stringify({ success: true, envelopeId: envelope.id }),
                now,
                new Date(Date.now() + 86400000).toISOString()
              );
            }
          }

          // 2. Ensure room exists
          db.prepare('INSERT OR IGNORE INTO rooms (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
            .run(envelope.roomId, envelope.roomId, now, now);

          // 3. Insert envelope
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

          // 4. Append to event journal
          db.prepare(`
            INSERT INTO events (event_id, stream_id, event_type, payload_json, metadata_json, occurred_at)
            VALUES (?, ?, 'ENVELOPE_RECORDED', ?, NULL, ?)
          `).run(eventId, `room:${envelope.roomId}`, JSON.stringify(envelope), now);

          // 5. Insert into outbox
          db.prepare(`
            INSERT INTO outbox (id, stream_id, event_id, payload_json, status, retry_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'QUEUED', 0, ?, ?)
          `).run(outboxId, `room:${envelope.roomId}`, eventId, JSON.stringify(envelope), now, now);

          db.exec('COMMIT;');
          process.send({ id, result: { success: true, envelopeId: envelope.id } });
        } catch (txErr) {
          try { db.exec('ROLLBACK;'); } catch {}
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
      case 'createApprovalToken': {
        const token = args.token;
        const now = new Date().toISOString();
        const expiresAt = token.expiresAt || new Date(Date.now() + 3600000).toISOString();
        db.prepare(`
          INSERT INTO approvals (
            token_id, action_type, payload_digest, canonicalization_version, origin,
            workspace_id, room_id, actor_id, recipient, policy_version,
            status, created_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
        `).run(
          token.tokenId,
          token.actionType,
          token.payloadDigest,
          token.canonicalizationVersion || 1,
          token.origin,
          token.workspaceId || null,
          token.roomId || null,
          token.actorId || null,
          token.recipient || null,
          token.policyVersion || '1.0.0',
          token.createdAt || now,
          expiresAt
        );
        process.send({ id, result: { ...token, status: 'PENDING', createdAt: now, expiresAt } });
        break;
      }
      case 'getApprovalToken': {
        const row = db.prepare('SELECT * FROM approvals WHERE token_id = ?').get(args.tokenId);
        process.send({ id, result: row || null });
        break;
      }
      case 'approveToken': {
        const { tokenId, approver } = args;
        if (!approver || !approver.id) {
          throw new Error('ERR_UNTRUSTED_SENDER: Approver identity is required');
        }
        if (approver.isTrustedContext === false) {
          throw new Error('ERR_UNTRUSTED_SENDER: Approver context is untrusted');
        }
        const allowedRoles = ['LEADER', 'USER', 'ADMIN', 'OPERATOR'];
        if (approver.role && !allowedRoles.includes(approver.role)) {
          throw new Error(`ERR_UNTRUSTED_SENDER: Role '${approver.role}' is not authorized to approve tokens`);
        }
        const row = db.prepare('SELECT status, expires_at FROM approvals WHERE token_id = ?').get(tokenId);
        if (!row) {
          throw new Error(`ERR_UNTRUSTED_ACTION: Approval token not found: ${tokenId}`);
        }
        if (new Date(row.expires_at).getTime() < Date.now()) {
          db.prepare("UPDATE approvals SET status = 'EXPIRED' WHERE token_id = ?").run(tokenId);
          throw new Error(`ERR_APPROVAL_EXPIRED: Token ${tokenId} has expired`);
        }
        if (row.status === 'CONSUMED') {
          throw new Error(`ERR_APPROVAL_ALREADY_CONSUMED: Token ${tokenId} is already consumed`);
        }
        if (row.status === 'REJECTED') {
          throw new Error(`ERR_UNTRUSTED_ACTION: Token ${tokenId} was rejected`);
        }
        const nowIso = new Date().toISOString();
        const res = db.prepare(`
          UPDATE approvals
          SET status = 'APPROVED', approver_id = ?, approved_at = ?
          WHERE token_id = ? AND status = 'PENDING' AND expires_at > ?
        `).run(approver.id, nowIso, tokenId, nowIso);
        if (res.changes === 0) {
          throw new Error(`ERR_UNTRUSTED_ACTION: Token ${tokenId} is no longer PENDING or has expired`);
        }
        process.send({ id, result: { success: true, tokenId, approvedAt: nowIso } });
        break;
      }
      case 'validateAndConsumeApproval': {
        const { tokenId, actionType, payloadDigest, options = {} } = args;
        const row = db.prepare('SELECT * FROM approvals WHERE token_id = ?').get(tokenId);
        if (!row) {
          throw new Error(`ERR_UNTRUSTED_ACTION: Approval token not found: ${tokenId}`);
        }
        if (row.workspace_id) {
          if (!options.workspaceId) {
            throw new Error(`ERR_UNTRUSTED_ACTION: Token requires workspace scope '${row.workspace_id}'`);
          }
          if (options.workspaceId !== row.workspace_id) {
            throw new Error(`ERR_UNTRUSTED_ACTION: Token workspace scope mismatch: '${row.workspace_id}' vs '${options.workspaceId}'`);
          }
        }
        if (row.room_id) {
          if (!options.roomId) {
            throw new Error(`ERR_UNTRUSTED_ACTION: Token requires room scope '${row.room_id}'`);
          }
          if (options.roomId !== row.room_id) {
            throw new Error(`ERR_UNTRUSTED_ACTION: Token room scope mismatch: '${row.room_id}' vs '${options.roomId}'`);
          }
        }
        if (row.actor_id) {
          if (!options.actorId) {
            throw new Error(`ERR_UNTRUSTED_ACTION: Token requires actor scope '${row.actor_id}'`);
          }
          if (options.actorId !== row.actor_id) {
            throw new Error(`ERR_UNTRUSTED_ACTION: Token actor scope mismatch: '${row.actor_id}' vs '${options.actorId}'`);
          }
        }
        if (row.recipient) {
          if (!options.recipient) {
            throw new Error(`ERR_UNTRUSTED_ACTION: Token requires recipient scope '${row.recipient}'`);
          }
          if (options.recipient !== row.recipient) {
            throw new Error(`ERR_UNTRUSTED_ACTION: Token recipient scope mismatch: '${row.recipient}' vs '${options.recipient}'`);
          }
        }
        if (row.action_type !== actionType) {
          throw new Error(`ERR_APPROVAL_HASH_MISMATCH: Action type mismatch: expected ${row.action_type}, received ${actionType}`);
        }
        if (payloadDigest && row.payload_digest !== payloadDigest) {
          throw new Error(`ERR_APPROVAL_HASH_MISMATCH: Payload digest mismatch for token ${tokenId}`);
        }
        if (new Date(row.expires_at).getTime() < Date.now()) {
          db.prepare("UPDATE approvals SET status = 'EXPIRED' WHERE token_id = ?").run(tokenId);
          throw new Error(`ERR_APPROVAL_EXPIRED: Token ${tokenId} has expired`);
        }
        if (row.status === 'PENDING') {
          throw new Error(`ERR_APPROVAL_NOT_APPROVED: Token ${tokenId} is still PENDING. Human/PO approval required.`);
        }
        if (row.status === 'CONSUMED') {
          throw new Error(`ERR_APPROVAL_ALREADY_CONSUMED: Token ${tokenId} already consumed`);
        }
        if (row.status !== 'APPROVED') {
          throw new Error(`ERR_UNTRUSTED_ACTION: Token ${tokenId} status is ${row.status}`);
        }
        const nowIso = new Date().toISOString();
        const res = db.prepare(`
          UPDATE approvals
          SET status = 'CONSUMED', consumed_at = ?
          WHERE token_id = ? AND status = 'APPROVED' AND expires_at > ?
        `).run(nowIso, tokenId, nowIso);
        if (res.changes === 0) {
          throw new Error(`ERR_APPROVAL_ALREADY_CONSUMED: Token ${tokenId} was consumed concurrently`);
        }
        process.send({ id, result: { success: true, tokenId, consumedAt: nowIso } });
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
