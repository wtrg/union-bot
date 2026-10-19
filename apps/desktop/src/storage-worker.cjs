/**
 * @file storage-worker.cjs
 * @description Dedicated Node 24 SQLite storage worker process for Union Bot Electron desktop.
 * Runs with system Node (v24+) to execute native node:sqlite DatabaseSync and SQLite WAL storage.
 * Implements atomic transaction combining idempotency_keys, envelopes, events, outbox, and approval consumption (UB-P2-R02-004, UB-P2-R04-02),
 * and provides persistent approval token management (UB-P2-R02-003, UB-P2-R04-01).
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { computeEnvelopeDigest } = require('./canonical-json.cjs');
const { runSchemaMigrations } = require('./schema-definition.cjs');

function maybeInjectFault(checkpoint, args) {
  if (process.env.UNION_BOT_TEST_FAULT_INJECTION !== '1') {
    return;
  }
  if (args && args.injectFaultAt === checkpoint) {
    if (args.faultAction === 'kill') {
      process.exit(42);
    }
    throw new Error(`ERR_TEST_INJECTED_FAULT: Injected fault at ${checkpoint}`);
  }
}

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

  // Run authoritative schema migrations with checksum & parity verification (UB-P2-R04-01, R05-H01..H03)
  runSchemaMigrations(db);

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
      case 'createRoom': {
        const now = new Date().toISOString();
        db.prepare('INSERT OR REPLACE INTO rooms (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
          .run(args.id, args.name, now, now);
        process.send({ id, result: { id: args.id, name: args.name, created_at: now, updated_at: now } });
        break;
      }
      case 'listApprovals': {
        const limit = args.limit || 50;
        const rows = db.prepare('SELECT * FROM approvals ORDER BY created_at DESC LIMIT ?').all(limit);
        process.send({ id, result: rows });
        break;
      }
      case 'rejectToken': {
        const { tokenId, reason } = args;
        const nowIso = new Date().toISOString();
        const res = db.prepare(`
          UPDATE approvals
          SET status = 'REJECTED', rejected_at = ?, rejection_reason = ?
          WHERE token_id = ? AND status = 'PENDING'
        `).run(nowIso, reason || 'User rejected', tokenId);
        process.send({ id, result: { success: res.changes > 0, tokenId, rejectedAt: nowIso } });
        break;
      }
      case 'getIdempotencyRecord': {
        const row = db.prepare('SELECT key, target_id, status, payload_digest, response_json, dispatch_prepared, created_at, expires_at FROM idempotency_keys WHERE key = ?').get(args.key);
        process.send({
          id,
          result: row ? {
            key: row.key,
            targetId: row.target_id,
            status: row.status,
            payloadDigest: row.payload_digest,
            responseJson: row.response_json,
            dispatchPrepared: row.dispatch_prepared,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
          } : null,
        });
        break;
      }
      case 'insertEnvelope': {
        const envelope = args.envelope;
        const approvalReq = args.approval;
        const now = new Date().toISOString();
        const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const outboxId = `out_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

        db.exec('BEGIN IMMEDIATE;');
        try {
          // 1. Idempotency deduplication check in transaction (UB-P2-R03-03, R04-G04, R05-H05, R05-H06)
          const envelopeDigest = computeEnvelopeDigest(envelope);
          if (envelope.id) {
            const existing = db.prepare('SELECT status, response_json, payload_digest FROM idempotency_keys WHERE key = ?').get(envelope.id);
            if (existing) {
              // UB-P2-R06-002: Replay of COMPLETED records requires valid non-null digest equality
              const hasValidStoredDigest =
                typeof existing.payload_digest === 'string' &&
                /^[a-f0-9]{64}$/i.test(existing.payload_digest);

              if (existing.status === 'COMPLETED') {
                if (!hasValidStoredDigest) {
                  throw new Error(`ERR_IDEMPOTENCY_UNVERIFIED: Existing idempotency record has null or malformed payload digest; cannot verify replay authenticity without external reconciliation (UB-P2-R06-002)`);
                }
                if (existing.payload_digest !== envelopeDigest) {
                  throw new Error(`ERR_PAYLOAD_MISMATCH: Idempotency key '${envelope.id}' reused with mismatched payload. Replay with different content is forbidden.`);
                }
                db.exec('COMMIT;');
                process.send({ id, result: { success: true, envelopeId: envelope.id, deduplicated: true } });
                break;
              }

              if (existing.payload_digest && existing.payload_digest !== envelopeDigest) {
                throw new Error(`ERR_PAYLOAD_MISMATCH: Idempotency key '${envelope.id}' reused with mismatched payload. Replay with different content is forbidden.`);
              }
              if (existing.status === 'UNKNOWN_NEEDS_RECONCILIATION') {
                throw new Error(`ERR_RECONCILIATION_REQUIRED: Key ${envelope.id} requires external reconciliation`);
              }
              if (existing.status === 'PENDING') {
                throw new Error(`ERR_IDEMPOTENCY_CONFLICT: Key ${envelope.id} is already PENDING`);
              }
            } else {
              const existingEnv = db.prepare('SELECT id, raw_json FROM envelopes WHERE id = ?').get(envelope.id);
              if (existingEnv) {
                const parsedPayload = JSON.parse(existingEnv.raw_json);
                const legacyDigest = computeEnvelopeDigest(parsedPayload);
                if (legacyDigest !== envelopeDigest) {
                  throw new Error(`ERR_PAYLOAD_MISMATCH: Envelope '${envelope.id}' already exists with different payload digest.`);
                }
                db.prepare(`
                  INSERT OR REPLACE INTO idempotency_keys (key, target_id, status, payload_digest, response_json, dispatch_prepared, created_at, expires_at)
                  VALUES (?, ?, 'COMPLETED', ?, ?, 0, ?, ?)
                `).run(
                  envelope.id,
                  envelope.roomId,
                  legacyDigest,
                  JSON.stringify({ success: true, envelopeId: envelope.id }),
                  now,
                  new Date(Date.now() + 86400000).toISOString()
                );
                db.exec('COMMIT;');
                process.send({ id, result: { success: true, envelopeId: envelope.id, deduplicated: true } });
                break;
              }

              db.prepare(`
                INSERT INTO idempotency_keys (key, target_id, status, payload_digest, response_json, dispatch_prepared, created_at, expires_at)
                VALUES (?, ?, 'COMPLETED', ?, ?, 0, ?, ?)
              `).run(
                envelope.id,
                envelope.roomId,
                envelopeDigest,
                JSON.stringify({ success: true, envelopeId: envelope.id }),
                now,
                new Date(Date.now() + 86400000).toISOString()
              );
            }
          }

          maybeInjectFault('after_idempotency', args);

          // 2. Atomic Approval Token Consumption in same transaction (UB-P2-R04-02, R05-H04)
          if (approvalReq && approvalReq.tokenId) {
            const { tokenId, actionType, payloadDigest, scope = {} } = approvalReq;
            if (!payloadDigest || typeof payloadDigest !== 'string' || !/^[0-9a-fA-F]{64}$/.test(payloadDigest)) {
              throw new Error('ERR_APPROVAL_HASH_MISMATCH: Non-empty 64-char hex payload digest is required (UB-P2-R03-01)');
            }
            const tokenRow = db.prepare('SELECT * FROM approvals WHERE token_id = ?').get(tokenId);
            if (!tokenRow) {
              throw new Error(`ERR_UNTRUSTED_ACTION: Approval token not found: ${tokenId}`);
            }
            if (tokenRow.workspace_id && (!scope.workspaceId || scope.workspaceId !== tokenRow.workspace_id)) {
              throw new Error(`ERR_UNTRUSTED_ACTION: Token workspace scope mismatch: '${tokenRow.workspace_id}' vs '${scope.workspaceId}'`);
            }
            if (tokenRow.room_id && (!scope.roomId || scope.roomId !== tokenRow.room_id)) {
              throw new Error(`ERR_UNTRUSTED_ACTION: Token room scope mismatch: '${tokenRow.room_id}' vs '${scope.roomId}'`);
            }
            if (tokenRow.actor_id && (!scope.actorId || scope.actorId !== tokenRow.actor_id)) {
              throw new Error(`ERR_UNTRUSTED_ACTION: Token actor scope mismatch: '${tokenRow.actor_id}' vs '${scope.actorId}'`);
            }
            if (tokenRow.recipient && (!scope.recipient || scope.recipient !== tokenRow.recipient)) {
              throw new Error(`ERR_UNTRUSTED_ACTION: Token recipient scope mismatch: '${tokenRow.recipient}' vs '${scope.recipient}'`);
            }
            if (tokenRow.action_type !== actionType) {
              throw new Error(`ERR_APPROVAL_HASH_MISMATCH: Action type mismatch: expected ${tokenRow.action_type}, received ${actionType}`);
            }
            if (tokenRow.payload_digest !== payloadDigest) {
              throw new Error(`ERR_APPROVAL_HASH_MISMATCH: Payload digest mismatch for token ${tokenId}`);
            }
            if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
              db.prepare("UPDATE approvals SET status = 'EXPIRED' WHERE token_id = ?").run(tokenId);
              throw new Error(`ERR_APPROVAL_EXPIRED: Token ${tokenId} has expired`);
            }
            if (tokenRow.status === 'CONSUMED') {
              throw new Error(`ERR_APPROVAL_ALREADY_CONSUMED: Token ${tokenId} already consumed`);
            }
            if (tokenRow.status !== 'APPROVED') {
              throw new Error(`ERR_APPROVAL_NOT_APPROVED: Token ${tokenId} is still in ${tokenRow.status} status. Explicit human approval required.`);
            }

            const consumeRes = db.prepare(`
              UPDATE approvals
              SET status = 'CONSUMED', consumed_at = ?
              WHERE token_id = ? AND status = 'APPROVED' AND payload_digest = ? AND expires_at > ?
            `).run(now, tokenId, payloadDigest, now);

            if (consumeRes.changes !== 1) {
              throw new Error(`ERR_APPROVAL_ALREADY_CONSUMED: Failed to atomically consume token ${tokenId}`);
            }

            maybeInjectFault('after_approval_consume', args);
          }

          // 3. Ensure room exists
          db.prepare('INSERT OR IGNORE INTO rooms (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
            .run(envelope.roomId, envelope.roomId, now, now);

          maybeInjectFault('before_envelope_insert', args);

          // 4. Insert envelope
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

          maybeInjectFault('after_envelope', args);

          // 5. Append to event journal
          db.prepare(`
            INSERT INTO events (event_id, stream_id, event_type, payload_json, metadata_json, occurred_at)
            VALUES (?, ?, 'ENVELOPE_RECORDED', ?, NULL, ?)
          `).run(eventId, `room:${envelope.roomId}`, JSON.stringify(envelope), now);

          maybeInjectFault('after_event', args);

          // 6. Insert into outbox
          db.prepare(`
            INSERT INTO outbox (id, stream_id, event_id, payload_json, status, retry_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'QUEUED', 0, ?, ?)
          `).run(outboxId, `room:${envelope.roomId}`, eventId, JSON.stringify(envelope), now, now);

          maybeInjectFault('after_outbox', args);
          maybeInjectFault('before_commit', args);

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
          throw new Error('ERR_UNTRUSTED_SENDER: Approver identity is required (UB-P2-R03-02)');
        }
        if (approver.isTrustedContext !== true) {
          throw new Error('ERR_UNTRUSTED_SENDER: Approver context must be verified trusted context (UB-P2-R03-02)');
        }
        const allowedRoles = ['LEADER', 'USER', 'ADMIN', 'OPERATOR'];
        if (!approver.role || !allowedRoles.includes(approver.role)) {
          throw new Error(`ERR_UNTRUSTED_SENDER: Role '${approver.role}' is not authorized to approve tokens (UB-P2-R03-02)`);
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
        if (!payloadDigest || typeof payloadDigest !== 'string' || !/^[0-9a-fA-F]{64}$/.test(payloadDigest)) {
          throw new Error('ERR_APPROVAL_HASH_MISMATCH: Non-empty 64-char hex payload digest is required (UB-P2-R03-01)');
        }
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
        if (row.payload_digest !== payloadDigest) {
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
          WHERE token_id = ? AND status = 'APPROVED' AND payload_digest = ? AND expires_at > ?
        `).run(nowIso, tokenId, payloadDigest, nowIso);
        if (res.changes === 0) {
          throw new Error(`ERR_APPROVAL_ALREADY_CONSUMED: Token ${tokenId} was consumed concurrently or payload digest mismatch`);
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
