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
const { computeEnvelopeDigest, canonicalizeJson, computeCanonicalDigest } = require('./canonical-json.cjs');
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

  // Run authoritative schema migrations with checksum & parity verification (UB-P2-R04-01, R05-H01..H03, UB-P3-R02-003)
  runSchemaMigrations(db);
  ensureP3Schema(db);

  // Ensure default rooms
  const now = new Date().toISOString();
  const defaultRooms = ['orchestration', 'agent-dev', 'qa-audit', 'review-briefing'];
  const insertRoom = db.prepare('INSERT OR IGNORE INTO rooms (id, name, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
  for (const r of defaultRooms) {
    insertRoom.run(r, r, 'default', now, now);
  }

  return { success: true, dbPath };
}

function ensureP3Schema(db) {
  // Phase P3 schema is formally handled by Migration 002_p3_desktop_workspace (UB-P3-R02-003)
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
      case 'getProjects': {
        const includeArchived = args && args.includeArchived === true;
        const q = includeArchived
          ? 'SELECT id, name, description, created_at, updated_at, archived FROM projects ORDER BY created_at ASC'
          : 'SELECT id, name, description, created_at, updated_at, archived FROM projects WHERE archived = 0 ORDER BY created_at ASC';
        const rows = db.prepare(q).all();
        process.send({ id, result: rows });
        break;
      }
      case 'createProject': {
        const now = new Date().toISOString();
        db.prepare(`
          INSERT INTO projects (id, name, description, created_at, updated_at, archived)
          VALUES (?, ?, ?, ?, ?, 0)
        `).run(args.id, args.name, args.description || null, now, now);
        process.send({ id, result: { id: args.id, name: args.name, description: args.description, created_at: now, updated_at: now, archived: 0 } });
        break;
      }
      case 'renameProject': {
        const now = new Date().toISOString();
        const res = db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(args.newName, now, args.id);
        process.send({ id, result: { success: res.changes > 0, id: args.id, name: args.newName } });
        break;
      }
      case 'archiveProject': {
        if (args.id === 'default') {
          throw new Error('Cannot archive default project');
        }
        const now = new Date().toISOString();
        const res = db.prepare('UPDATE projects SET archived = 1, updated_at = ? WHERE id = ?').run(now, args.id);
        process.send({ id, result: { success: res.changes > 0, id: args.id } });
        break;
      }
      case 'deleteProject': {
        if (args.id === 'default') {
          throw new Error('Cannot delete default project');
        }
        db.prepare("UPDATE rooms SET project_id = 'default' WHERE project_id = ?").run(args.id);
        const res = db.prepare('DELETE FROM projects WHERE id = ?').run(args.id);
        process.send({ id, result: { success: res.changes > 0, id: args.id } });
        break;
      }
      case 'ensureRoom': {
        const now = new Date().toISOString();
        db.prepare('INSERT OR IGNORE INTO rooms (id, name, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(args.roomId, args.name || args.roomId, args.projectId || 'default', now, now);
        process.send({ id, result: true });
        break;
      }
      case 'getRooms': {
        const q = args && args.projectId
          ? 'SELECT id, name, project_id, created_at, updated_at FROM rooms WHERE project_id = ? ORDER BY rowid ASC'
          : 'SELECT id, name, project_id, created_at, updated_at FROM rooms ORDER BY rowid ASC';
        const rows = args && args.projectId ? db.prepare(q).all(args.projectId) : db.prepare(q).all();
        process.send({ id, result: rows });
        break;
      }
      case 'createRoom': {
        const now = new Date().toISOString();
        db.prepare('INSERT OR REPLACE INTO rooms (id, name, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(args.id, args.name, args.projectId || 'default', now, now);
        process.send({ id, result: { id: args.id, name: args.name, project_id: args.projectId || 'default', created_at: now, updated_at: now } });
        break;
      }
      case 'listTasks': {
        const limit = typeof (args && args.limit) === 'number' ? args.limit : 50;
        let query = 'SELECT * FROM tasks WHERE 1=1';
        const params = [];
        if (args && args.status) {
          query += ' AND status = ?';
          params.push(args.status);
        }
        if (args && args.roomId) {
          query += ' AND room_id = ?';
          params.push(args.roomId);
        }
        if (args && args.taskId) {
          query += ' AND id = ?';
          params.push(args.taskId);
        }
        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);
        const rows = db.prepare(query).all(...params);
        process.send({
          id,
          result: rows.map(r => ({
            id: r.id,
            title: r.title,
            status: r.status,
            progress: r.progress,
            roomId: r.room_id || undefined,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            metadata: r.metadata_json ? JSON.parse(r.metadata_json) : undefined
          }))
        });
        break;
      }
      case 'createTask': {
        const idVal = (args && args.id) || `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const now = new Date().toISOString();
        const title = (args && (args.title || args.name)) || 'Untitled Task';
        const status = (args && args.status) || 'pending';
        const progress = typeof (args && args.progress) === 'number' ? args.progress : 0;
        const roomId = (args && (args.roomId || args.room_id)) || null;
        const metadataJson = (args && args.metadata) ? JSON.stringify(args.metadata) : null;
        db.prepare(`
          INSERT INTO tasks (id, title, status, progress, room_id, created_at, updated_at, metadata_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(idVal, title, status, progress, roomId, now, now, metadataJson);
        process.send({ id, result: { id: idVal, title, status, progress, roomId, createdAt: now, updatedAt: now, metadata: args ? args.metadata : undefined } });
        break;
      }
      case 'updateTask': {
        const now = new Date().toISOString();
        const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(args.taskId);
        if (!existing) {
          process.send({ id, result: { success: false, error: 'Task not found' } });
          break;
        }
        const newStatus = args.updates && args.updates.status !== undefined ? args.updates.status : existing.status;
        const newProgress = args.updates && args.updates.progress !== undefined ? args.updates.progress : existing.progress;
        const newMetadata = args.updates && args.updates.metadata !== undefined ? JSON.stringify(args.updates.metadata) : existing.metadata_json;
        const res = db.prepare(`
          UPDATE tasks
          SET status = ?, progress = ?, metadata_json = ?, updated_at = ?
          WHERE id = ?
        `).run(newStatus, newProgress, newMetadata, now, args.taskId);
        process.send({ id, result: { success: res.changes > 0, taskId: args.taskId } });
        break;
      }
      case 'getStorageDiagnostics': {
        let dbSize = 0;
        try {
          const fsMod = require('node:fs');
          if (dbPath !== ':memory:' && fsMod.existsSync(dbPath)) {
            dbSize = fsMod.statSync(dbPath).size;
          }
        } catch {}
        const projectCount = db.prepare('SELECT COUNT(*) as c FROM projects').get()?.c || 0;
        const roomCount = db.prepare('SELECT COUNT(*) as c FROM rooms').get()?.c || 0;
        const envelopeCount = db.prepare('SELECT COUNT(*) as c FROM envelopes').get()?.c || 0;
        const taskCount = db.prepare('SELECT COUNT(*) as c FROM tasks').get()?.c || 0;
        const pendingApprovals = db.prepare("SELECT COUNT(*) as c FROM approvals WHERE status = 'PENDING'").get()?.c || 0;
        process.send({
          id,
          result: {
            mode: 'DEDICATED_WORKER',
            dbPath,
            dbSizeBytes: dbSize,
            walMode: true,
            projectCount,
            roomCount,
            envelopeCount,
            taskCount,
            approvalCount: pendingApprovals
          }
        });
        break;
      }
      case 'listApprovals': {
        const limit = typeof args.limit === 'number' ? args.limit : 50;
        const rows = db.prepare('SELECT * FROM approvals ORDER BY created_at DESC LIMIT ?').all(limit);
        process.send({ id, result: rows.map(r => ({
          ...r,
          payload: r.payload_json ? JSON.parse(r.payload_json) : null,
        })) });
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
        const queryLimit = typeof limit === 'number' ? limit : 100;
        const rows = db.prepare('SELECT raw_json FROM envelopes WHERE room_id = ? ORDER BY rowid ASC LIMIT ?')
          .all(roomId, queryLimit);
        const envelopes = rows.map((r) => JSON.parse(r.raw_json));
        process.send({ id, result: envelopes });
        break;
      }
      case 'createApprovalToken': {
        const token = args.token;
        const now = new Date().toISOString();
        const expiresAt = token.expiresAt || new Date(Date.now() + 3600000).toISOString();
        let payloadObj = token.payload;
        let payloadJson = token.payloadJson || token.payload_json || null;

        // UB-P3-R04-G01: Missing or unreadable ActionIntent payload is strictly rejected
        if ((payloadObj === undefined || payloadObj === null) && (!payloadJson || typeof payloadJson !== 'string' || payloadJson.trim() === '')) {
          throw new Error('ERR_PAYLOAD_MISMATCH: ActionIntent payload or payload_json is required to create an approval token (UB-P3-R04-G01)');
        }

        // P3-R04-F01: Backend rejects token creation when payload does not match supplied digest
        if (payloadObj !== undefined && payloadObj !== null) {
          const computedDigest = computeCanonicalDigest(payloadObj, token.canonicalizationVersion || 1);
          const suppliedDigest = token.payloadDigest || token.payload_digest;
          if (suppliedDigest && suppliedDigest !== computedDigest) {
            throw new Error(`ERR_PAYLOAD_MISMATCH: Payload does not match supplied payloadDigest: computed ${computedDigest} vs supplied ${suppliedDigest} (P3-R04-F01)`);
          }
          if (!token.payloadDigest) token.payloadDigest = computedDigest;
          if (!payloadJson) payloadJson = canonicalizeJson(payloadObj);
        } else if (payloadJson) {
          try {
            const parsed = JSON.parse(payloadJson);
            const computedDigest = computeCanonicalDigest(parsed, token.canonicalizationVersion || 1);
            const suppliedDigest = token.payloadDigest || token.payload_digest;
            if (suppliedDigest && suppliedDigest !== computedDigest) {
              throw new Error(`ERR_PAYLOAD_MISMATCH: Payload does not match supplied payloadDigest: computed ${computedDigest} vs supplied ${suppliedDigest} (P3-R04-F01)`);
            }
            if (!token.payloadDigest) token.payloadDigest = computedDigest;
            payloadObj = parsed;
          } catch (err) {
            if (err.message && err.message.includes('ERR_PAYLOAD_MISMATCH')) throw err;
            throw new Error(`ERR_PAYLOAD_MISMATCH: Failed to parse provided payload_json: ${err.message} (UB-P3-R04-G01)`);
          }
        }

        db.prepare(`
          INSERT INTO approvals (
            token_id, action_type, payload_digest, canonicalization_version, origin,
            workspace_id, room_id, actor_id, recipient, policy_version,
            status, created_at, expires_at, payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
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
          expiresAt,
          payloadJson
        );
        process.send({ id, result: {
          ...token,
          status: 'PENDING',
          createdAt: now,
          expiresAt,
          payload_json: payloadJson,
          payload: payloadObj || (payloadJson ? JSON.parse(payloadJson) : null),
        } });
        break;
      }
      case 'getApprovalToken': {
        const row = db.prepare('SELECT * FROM approvals WHERE token_id = ?').get(args.tokenId);
        if (row) {
          row.payload = row.payload_json ? JSON.parse(row.payload_json) : null;
        }
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
        const row = db.prepare('SELECT status, expires_at, payload_json, payload_digest, canonicalization_version FROM approvals WHERE token_id = ?').get(tokenId);
        if (!row) {
          throw new Error(`ERR_UNTRUSTED_ACTION: Approval token not found: ${tokenId}`);
        }
        // UB-P3-R04-G01: ActionIntent payload is strictly required for approval. Missing or unreadable payload is rejected fail-closed.
        if (!row.payload_json || typeof row.payload_json !== 'string' || row.payload_json.trim() === '') {
          throw new Error(`ERR_PAYLOAD_MISMATCH: Stored approval token ${tokenId} lacks payload_json. ActionIntent payload is strictly required for approval (UB-P3-R04-G01)`);
        }

        try {
          const parsed = JSON.parse(row.payload_json);
          const computed = computeCanonicalDigest(parsed, row.canonicalization_version || 1);
          if (!row.payload_digest || computed !== row.payload_digest) {
            throw new Error(`ERR_PAYLOAD_MISMATCH: Stored payload_json does not match stored payload_digest for token ${tokenId} (P3-R04-F02)`);
          }
        } catch (parseErr) {
          if (parseErr.message && parseErr.message.includes('ERR_PAYLOAD_MISMATCH')) throw parseErr;
          throw new Error(`ERR_PAYLOAD_MISMATCH: Failed to parse stored payload_json: ${parseErr.message} (UB-P3-R04-G01)`);
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
      case 'testTamperApprovalPayload': {
        const tamperedJson = typeof args.tamperedPayload === 'string'
          ? args.tamperedPayload
          : JSON.stringify(args.tamperedPayload);
        db.prepare('UPDATE approvals SET payload_json = ? WHERE token_id = ?')
          .run(tamperedJson, args.tokenId);
        process.send({ id, result: { success: true } });
        break;
      }
      case 'close': {
        if (db) {
          try { db.close(); } catch {}
          db = null;
        }
        if (process.send) {
          try { process.send({ id, result: true }); } catch {}
        }
        process.exit(0);
        break;
      }
      default:
        process.send({ id, error: `Unknown method: ${method}` });
    }
  } catch (err) {
    process.send({ id, error: err.message, stack: err.stack });
  }
}

// Parent process liveness watchdog: terminate worker immediately if parent dies
if (process.ppid) {
  const ppidCheck = setInterval(() => {
    try {
      process.kill(process.ppid, 0);
    } catch {
      clearInterval(ppidCheck);
      if (db) {
        try { db.close(); } catch {}
      }
      process.exit(0);
    }
  }, 500);
  ppidCheck.unref();
}

process.on('message', handleRequest);
process.on('disconnect', () => {
  if (db) {
    try { db.close(); } catch {}
  }
  process.exit(0);
});
