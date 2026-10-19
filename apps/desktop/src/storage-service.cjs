/**
 * @file storage-service.cjs
 * @description Persistent SQLite Storage client for Electron Desktop Main Process (UB-P2-R01-003, UB-P2-R02-001, UB-P2-R02-004, UB-P2-R04-01, UB-P2-R04-02).
 * Connects to SQLite either in-process (if node:sqlite is present) or via dedicated storage-worker (Node 24).
 * Enforces Fail-Closed durability: no silent in-memory fallback in production mode.
 */

const cp = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { computeEnvelopeDigest } = require('./canonical-json.cjs');
const { runSchemaMigrations } = require('./schema-definition.cjs');

function findSystemNode() {
  if (process.env.SYSTEM_NODE_PATH) {
    return process.env.SYSTEM_NODE_PATH;
  }
  const defaultWindowsNode = 'C:\\Program Files\\nodejs\\node.exe';
  if (fs.existsSync(defaultWindowsNode)) {
    return defaultWindowsNode;
  }
  const pathEnv = process.env.PATH || '';
  const delimiter = process.platform === 'win32' ? ';' : ':';
  const binName = process.platform === 'win32' ? 'node.exe' : 'node';
  for (const p of pathEnv.split(delimiter)) {
    const candidate = path.join(p, binName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return 'node';
}

class StorageServiceClient extends EventEmitter {
  constructor(dbPath, options = {}) {
    super();
    this.dbPath = dbPath;
    this.allowNonDurableDemo = options.allowNonDurableDemo === true;
    this.forceWorker = options.forceWorker === true;
    this.nodeExecPath = options.nodeExecPath;
    this.worker = null;
    this.requestId = 0;
    this.pending = new Map();
    this.isNative = false;
    this.nativeDb = null;
    this.fallbackEnvelopes = new Map();
    this.fallbackRooms = new Map([
      ['orchestration', { id: 'orchestration', name: 'orchestration' }],
      ['agent-dev', { id: 'agent-dev', name: 'agent-dev' }],
      ['qa-audit', { id: 'qa-audit', name: 'qa-audit' }],
      ['review-briefing', { id: 'review-briefing', name: 'review-briefing' }],
    ]);
    this.fallbackApprovals = new Map();

    this.ready = this.init();
  }

  async init() {
    // 1. Check if native node:sqlite is available in current process (unless forceWorker is requested)
    if (!this.forceWorker) {
      try {
        const { DatabaseSync } = require('node:sqlite');
        if (typeof DatabaseSync === 'function') {
          this.isNative = true;
          this.initNative(DatabaseSync);
          return { success: true, mode: 'native', dbPath: this.dbPath };
        }
      } catch {
        // Native not available in current environment; proceed to dedicated worker
      }
    }

    // 2. Spawn dedicated storage worker with Node 24
    const workerScript = path.resolve(__dirname, 'storage-worker.cjs');
    const nodeExec = this.nodeExecPath || findSystemNode();

    return new Promise((resolve, reject) => {
      let initCompleted = false;
      const initTimer = setTimeout(() => {
        if (!initCompleted) {
          initCompleted = true;
          if (this.worker) {
            try { this.worker.kill(); } catch {}
            this.worker = null;
          }
          if (this.allowNonDurableDemo) {
            console.warn('[StorageService] Worker init timed out. Falling back to NON_DURABLE_DEMO.');
            resolve({ success: true, mode: 'demo-fallback', dbPath: this.dbPath });
          } else {
            reject(new Error('ERR_STORAGE_UNAVAILABLE: Storage worker initialization timed out (UB-P2-R02-001)'));
          }
        }
      }, 5000);

      try {
        this.worker = cp.fork(workerScript, [], {
          execPath: nodeExec,
          stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
          env: { ...process.env },
        });

        if (this.worker.stderr) {
          this.worker.stderr.on('data', (d) => {
            console.error('[StorageWorker Stderr]:', d.toString());
          });
        }

        this.worker.on('message', (msg) => {
          const { id, result, error } = msg;
          if (id === 0 && !initCompleted) {
            initCompleted = true;
            clearTimeout(initTimer);
            if (error) {
              if (this.allowNonDurableDemo) {
                console.warn('[StorageService] Worker init error. Falling back to NON_DURABLE_DEMO.');
                resolve({ success: true, mode: 'demo-fallback', dbPath: this.dbPath });
              } else {
                reject(new Error(`ERR_STORAGE_UNAVAILABLE: Storage worker init error: ${error}`));
              }
            } else {
              resolve(result);
            }
            return;
          }

          if (this.pending.has(id)) {
            const { resolve: reqResolve, reject: reqReject, timer } = this.pending.get(id);
            this.pending.delete(id);
            if (timer) clearTimeout(timer);
            if (error) {
              reqReject(new Error(error));
            } else {
              reqResolve(result);
            }
          }
        });

        this.worker.on('error', (err) => {
          console.error('[StorageWorker] Process error:', err.message);
          this.rejectAllPending(new Error(`ERR_STORAGE_UNAVAILABLE: Storage worker process error: ${err.message}`));
          this.emit('worker-error', err);
          if (!initCompleted) {
            initCompleted = true;
            clearTimeout(initTimer);
            if (this.allowNonDurableDemo) {
              resolve({ success: true, mode: 'demo-fallback', dbPath: this.dbPath });
            } else {
              reject(new Error(`ERR_STORAGE_UNAVAILABLE: Failed to start worker: ${err.message}`));
            }
          }
        });

        this.worker.on('exit', (code, signal) => {
          if (code !== 0 && code !== null) {
            console.warn(`[StorageWorker] Exited with code ${code} / signal ${signal}`);
          }
          this.worker = null;
          this.emit('worker-exit', { code, signal });
          this.rejectAllPending(new Error(`ERR_STORAGE_UNAVAILABLE: Storage worker exited with code ${code} (UB-P2-R02-001, R04-C03)`));
          if (!initCompleted) {
            initCompleted = true;
            clearTimeout(initTimer);
            if (this.allowNonDurableDemo) {
              resolve({ success: true, mode: 'demo-fallback', dbPath: this.dbPath });
            } else {
              reject(new Error(`ERR_STORAGE_UNAVAILABLE: Worker exited before init completed with code ${code}`));
            }
          }
        });

        this.worker.on('disconnect', () => {
          this.rejectAllPending(new Error('ERR_STORAGE_UNAVAILABLE: Storage worker channel disconnected'));
        });

        // Send init message with ID 0
        this.worker.send({ id: 0, method: 'init', args: { dbPath: this.dbPath } });
      } catch (spawnErr) {
        clearTimeout(initTimer);
        this.worker = null;
        if (this.allowNonDurableDemo) {
          console.warn('[StorageService] Could not fork storage worker, using NON_DURABLE_DEMO store:', spawnErr.message);
          resolve({ success: true, mode: 'demo-fallback', dbPath: this.dbPath });
        } else {
          reject(new Error(`ERR_STORAGE_UNAVAILABLE: Could not fork storage worker: ${spawnErr.message}`));
        }
      }
    });
  }

  rejectAllPending(error) {
    for (const [id, item] of this.pending.entries()) {
      if (item.timer) clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
  }

  initNative(DatabaseSync) {
    const dir = path.dirname(this.dbPath);
    if (dir && dir !== '.' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.nativeDb = new DatabaseSync(this.dbPath);
    if (this.dbPath !== ':memory:') {
      this.nativeDb.exec('PRAGMA journal_mode = WAL;');
    }
    this.nativeDb.exec('PRAGMA foreign_keys = ON;');
    this.nativeDb.exec('PRAGMA busy_timeout = 5000;');

    // Run authoritative schema migrations with checksum & parity verification (UB-P2-R04-01, R05-H01..H03)
    runSchemaMigrations(this.nativeDb);

    const defaultRooms = ['orchestration', 'agent-dev', 'qa-audit', 'review-briefing'];
    const now = new Date().toISOString();
    const insertRoom = this.nativeDb.prepare('INSERT OR IGNORE INTO rooms (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)');
    for (const r of defaultRooms) {
      insertRoom.run(r, r, now, now);
    }
  }

  handleFallback(method, args = {}) {
    if (!this.allowNonDurableDemo) {
      return Promise.reject(new Error(`ERR_STORAGE_UNAVAILABLE: In-memory fallback forbidden in production mode for '${method}' (UB-P2-R02-001)`));
    }
    console.warn(`[StorageService] [NON_DURABLE_DEMO] Executing '${method}' in in-memory demo store.`);
    switch (method) {
      case 'init':
        return Promise.resolve({ success: true, dbPath: this.dbPath, mode: 'NON_DURABLE_DEMO' });
      case 'ensureRoom': {
        const roomId = args.roomId;
        if (!this.fallbackRooms.has(roomId)) {
          this.fallbackRooms.set(roomId, { id: roomId, name: args.name || roomId });
        }
        return Promise.resolve(true);
      }
      case 'getRooms':
        return Promise.resolve(Array.from(this.fallbackRooms.values()));
      case 'getIdempotencyRecord': {
        return Promise.resolve(null);
      }
      case 'insertEnvelope': {
        const envelope = args.envelope;
        const list = this.fallbackEnvelopes.get(envelope.roomId) || [];
        list.push(envelope);
        this.fallbackEnvelopes.set(envelope.roomId, list);
        return Promise.resolve({ success: true, envelopeId: envelope.id, nonDurableDemo: true });
      }
      case 'getRoomEnvelopes': {
        const list = this.fallbackEnvelopes.get(args.roomId) || [];
        return Promise.resolve(list.slice(0, args.limit || 100));
      }
      case 'createApprovalToken': {
        const token = args.token;
        this.fallbackApprovals.set(token.tokenId, token);
        return Promise.resolve({ ...token, status: 'PENDING' });
      }
      case 'getApprovalToken': {
        return Promise.resolve(this.fallbackApprovals.get(args.tokenId) || null);
      }
      case 'approveToken': {
        const t = this.fallbackApprovals.get(args.tokenId);
        if (!t) return Promise.reject(new Error(`ERR_UNTRUSTED_ACTION: Approval token not found: ${args.tokenId}`));
        t.status = 'APPROVED';
        return Promise.resolve({ success: true, tokenId: args.tokenId });
      }
      case 'validateAndConsumeApproval': {
        const t = this.fallbackApprovals.get(args.tokenId);
        if (!t) return Promise.reject(new Error(`ERR_UNTRUSTED_ACTION: Approval token not found: ${args.tokenId}`));
        if (t.status !== 'APPROVED') return Promise.reject(new Error(`ERR_APPROVAL_NOT_APPROVED: Token status: ${t.status}`));
        t.status = 'CONSUMED';
        return Promise.resolve({ success: true, tokenId: args.tokenId });
      }
      case 'close':
        return Promise.resolve(true);
      default:
        return Promise.reject(new Error(`Fallback unhandled method ${method}`));
    }
  }

  sendRequest(method, args = {}, timeoutMs = 5000) {
    if (this.isNative && this.nativeDb) {
      try {
        switch (method) {
          case 'ensureRoom': {
            const now = new Date().toISOString();
            this.nativeDb.prepare('INSERT OR IGNORE INTO rooms (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
              .run(args.roomId, args.name || args.roomId, now, now);
            return Promise.resolve(true);
          }
          case 'getRooms': {
            const rows = this.nativeDb.prepare('SELECT id, name, created_at, updated_at FROM rooms').all();
            return Promise.resolve(rows);
          }
          case 'getIdempotencyRecord': {
            const row = this.nativeDb.prepare('SELECT key, target_id, status, payload_digest, response_json, dispatch_prepared, created_at, expires_at FROM idempotency_keys WHERE key = ?').get(args.key);
            return Promise.resolve(row ? {
              key: row.key,
              targetId: row.target_id,
              status: row.status,
              payloadDigest: row.payload_digest,
              responseJson: row.response_json,
              dispatchPrepared: row.dispatch_prepared,
              createdAt: row.created_at,
              expiresAt: row.expires_at,
            } : null);
          }
          case 'insertEnvelope': {
            const envelope = args.envelope;
            const approvalReq = args.approval;
            const now = new Date().toISOString();
            const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
            const outboxId = `out_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

            this.nativeDb.exec('BEGIN IMMEDIATE;');
            try {
              // 1. Idempotency deduplication in transaction (UB-P2-R03-03, R04-G04, R05-H05, R05-H06)
              const envelopeDigest = computeEnvelopeDigest(envelope);
              if (envelope.id) {
                const existing = this.nativeDb.prepare('SELECT status, response_json, payload_digest FROM idempotency_keys WHERE key = ?').get(envelope.id);
                if (existing) {
                  if (!existing.payload_digest || existing.payload_digest !== envelopeDigest) {
                    throw new Error(`ERR_PAYLOAD_MISMATCH: Idempotency key '${envelope.id}' reused with mismatched payload. Replay with different content is forbidden.`);
                  }
                  if (existing.status === 'COMPLETED') {
                    this.nativeDb.exec('COMMIT;');
                    return Promise.resolve({ success: true, envelopeId: envelope.id, deduplicated: true });
                  }
                  if (existing.status === 'UNKNOWN_NEEDS_RECONCILIATION') {
                    throw new Error(`ERR_RECONCILIATION_REQUIRED: Key ${envelope.id} requires external reconciliation`);
                  }
                  if (existing.status === 'PENDING') {
                    throw new Error(`ERR_IDEMPOTENCY_CONFLICT: Key ${envelope.id} is already PENDING`);
                  }
                } else {
                  const existingEnv = this.nativeDb.prepare('SELECT id, raw_json FROM envelopes WHERE id = ?').get(envelope.id);
                  if (existingEnv) {
                    const parsedPayload = JSON.parse(existingEnv.raw_json);
                    const legacyDigest = computeEnvelopeDigest(parsedPayload);
                    if (legacyDigest !== envelopeDigest) {
                      throw new Error(`ERR_PAYLOAD_MISMATCH: Envelope '${envelope.id}' already exists with different payload digest.`);
                    }
                    this.nativeDb.prepare(`
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
                    this.nativeDb.exec('COMMIT;');
                    return Promise.resolve({ success: true, envelopeId: envelope.id, deduplicated: true });
                  }

                  this.nativeDb.prepare(`
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

              // 2. Atomic Approval Token Consumption in same transaction (UB-P2-R04-02, R05-H04)
              if (approvalReq && approvalReq.tokenId) {
                const { tokenId, actionType, payloadDigest, scope = {} } = approvalReq;
                if (!payloadDigest || typeof payloadDigest !== 'string' || !/^[0-9a-fA-F]{64}$/.test(payloadDigest)) {
                  throw new Error('ERR_APPROVAL_HASH_MISMATCH: Non-empty 64-char hex payload digest is required (UB-P2-R03-01)');
                }
                const tokenRow = this.nativeDb.prepare('SELECT * FROM approvals WHERE token_id = ?').get(tokenId);
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
                  this.nativeDb.prepare("UPDATE approvals SET status = 'EXPIRED' WHERE token_id = ?").run(tokenId);
                  throw new Error(`ERR_APPROVAL_EXPIRED: Token ${tokenId} has expired`);
                }
                if (tokenRow.status === 'CONSUMED') {
                  throw new Error(`ERR_APPROVAL_ALREADY_CONSUMED: Token ${tokenId} already consumed`);
                }
                if (tokenRow.status !== 'APPROVED') {
                  throw new Error(`ERR_APPROVAL_NOT_APPROVED: Token ${tokenId} is still in ${tokenRow.status} status. Explicit human approval required.`);
                }

                const consumeRes = this.nativeDb.prepare(`
                  UPDATE approvals
                  SET status = 'CONSUMED', consumed_at = ?
                  WHERE token_id = ? AND status = 'APPROVED' AND payload_digest = ? AND expires_at > ?
                `).run(now, tokenId, payloadDigest, now);

                if (consumeRes.changes !== 1) {
                  throw new Error(`ERR_APPROVAL_ALREADY_CONSUMED: Failed to atomically consume token ${tokenId}`);
                }
              }

              // 3. Ensure room exists
              this.nativeDb.prepare('INSERT OR IGNORE INTO rooms (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
                .run(envelope.roomId, envelope.roomId, now, now);

              // 4. Insert envelope
              this.nativeDb.prepare(`
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

              // 5. Append to event journal
              this.nativeDb.prepare(`
                INSERT INTO events (event_id, stream_id, event_type, payload_json, metadata_json, occurred_at)
                VALUES (?, ?, 'ENVELOPE_RECORDED', ?, NULL, ?)
              `).run(eventId, `room:${envelope.roomId}`, JSON.stringify(envelope), now);

              // 6. Insert into outbox
              this.nativeDb.prepare(`
                INSERT INTO outbox (id, stream_id, event_id, payload_json, status, retry_count, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'QUEUED', 0, ?, ?)
              `).run(outboxId, `room:${envelope.roomId}`, eventId, JSON.stringify(envelope), now, now);

              this.nativeDb.exec('COMMIT;');
              return Promise.resolve({ success: true, envelopeId: envelope.id });
            } catch (err) {
              try { this.nativeDb.exec('ROLLBACK;'); } catch {}
              return Promise.reject(err);
            }
          }
          case 'getRoomEnvelopes': {
            const { roomId, limit = 100 } = args;
            const rows = this.nativeDb.prepare('SELECT raw_json FROM envelopes WHERE room_id = ? ORDER BY rowid ASC LIMIT ?')
              .all(roomId, limit);
            const envelopes = rows.map((r) => JSON.parse(r.raw_json));
            return Promise.resolve(envelopes);
          }
          case 'createApprovalToken': {
            const token = args.token;
            const now = new Date().toISOString();
            const expiresAt = token.expiresAt || new Date(Date.now() + 3600000).toISOString();
            this.nativeDb.prepare(`
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
            return Promise.resolve({ ...token, status: 'PENDING', createdAt: now, expiresAt });
          }
          case 'getApprovalToken': {
            const row = this.nativeDb.prepare('SELECT * FROM approvals WHERE token_id = ?').get(args.tokenId);
            return Promise.resolve(row || null);
          }
          case 'approveToken': {
            const { tokenId, approver } = args;
            if (!approver || !approver.id) {
              return Promise.reject(new Error('ERR_UNTRUSTED_SENDER: Approver identity is required (UB-P2-R03-02)'));
            }
            if (approver.isTrustedContext !== true) {
              return Promise.reject(new Error('ERR_UNTRUSTED_SENDER: Approver context must be verified trusted context (UB-P2-R03-02)'));
            }
            const allowedRoles = ['LEADER', 'USER', 'ADMIN', 'OPERATOR'];
            if (!approver.role || !allowedRoles.includes(approver.role)) {
              return Promise.reject(new Error(`ERR_UNTRUSTED_SENDER: Role '${approver.role}' is not authorized to approve tokens (UB-P2-R03-02)`));
            }
            const row = this.nativeDb.prepare('SELECT status, expires_at FROM approvals WHERE token_id = ?').get(tokenId);
            if (!row) {
              return Promise.reject(new Error(`ERR_UNTRUSTED_ACTION: Approval token not found: ${tokenId}`));
            }
            if (new Date(row.expires_at).getTime() < Date.now()) {
              this.nativeDb.prepare("UPDATE approvals SET status = 'EXPIRED' WHERE token_id = ?").run(tokenId);
              return Promise.reject(new Error(`ERR_APPROVAL_EXPIRED: Token ${tokenId} has expired`));
            }
            if (row.status === 'CONSUMED') {
              return Promise.reject(new Error(`ERR_APPROVAL_ALREADY_CONSUMED: Token ${tokenId} is already consumed`));
            }
            if (row.status === 'REJECTED') {
              return Promise.reject(new Error(`ERR_UNTRUSTED_ACTION: Token ${tokenId} was rejected`));
            }
            const nowIso = new Date().toISOString();
            const res = this.nativeDb.prepare(`
              UPDATE approvals
              SET status = 'APPROVED', approver_id = ?, approved_at = ?
              WHERE token_id = ? AND status = 'PENDING' AND expires_at > ?
            `).run(approver.id, nowIso, tokenId, nowIso);
            if (res.changes === 0) {
              return Promise.reject(new Error(`ERR_UNTRUSTED_ACTION: Token ${tokenId} is no longer PENDING or has expired`));
            }
            return Promise.resolve({ success: true, tokenId, approvedAt: nowIso });
          }
          case 'validateAndConsumeApproval': {
            const { tokenId, actionType, payloadDigest, options = {} } = args;
            if (!payloadDigest || typeof payloadDigest !== 'string' || !/^[0-9a-fA-F]{64}$/.test(payloadDigest)) {
              return Promise.reject(new Error('ERR_APPROVAL_HASH_MISMATCH: Non-empty 64-char hex payload digest is required (UB-P2-R03-01)'));
            }
            const row = this.nativeDb.prepare('SELECT * FROM approvals WHERE token_id = ?').get(tokenId);
            if (!row) {
              return Promise.reject(new Error(`ERR_UNTRUSTED_ACTION: Approval token not found: ${tokenId}`));
            }
            if (row.workspace_id) {
              if (!options.workspaceId) {
                return Promise.reject(new Error(`ERR_UNTRUSTED_ACTION: Token requires workspace scope '${row.workspace_id}'`));
              }
              if (options.workspaceId !== row.workspace_id) {
                return Promise.reject(new Error(`ERR_UNTRUSTED_ACTION: Token workspace scope mismatch: '${row.workspace_id}' vs '${options.workspaceId}'`));
              }
            }
            if (row.room_id) {
              if (!options.roomId) {
                return Promise.reject(new Error(`ERR_UNTRUSTED_ACTION: Token requires room scope '${row.room_id}'`));
              }
              if (options.roomId !== row.room_id) {
                return Promise.reject(new Error(`ERR_UNTRUSTED_ACTION: Token room scope mismatch: '${row.room_id}' vs '${options.roomId}'`));
              }
            }
            if (row.actor_id) {
              if (!options.actorId) {
                return Promise.reject(new Error(`ERR_UNTRUSTED_ACTION: Token requires actor scope '${row.actor_id}'`));
              }
              if (options.actorId !== row.actor_id) {
                return Promise.reject(new Error(`ERR_UNTRUSTED_ACTION: Token actor scope mismatch: '${row.actor_id}' vs '${options.actorId}'`));
              }
            }
            if (row.recipient) {
              if (!options.recipient) {
                return Promise.reject(new Error(`ERR_UNTRUSTED_ACTION: Token requires recipient scope '${row.recipient}'`));
              }
              if (options.recipient !== row.recipient) {
                return Promise.reject(new Error(`ERR_UNTRUSTED_ACTION: Token recipient scope mismatch: '${row.recipient}' vs '${options.recipient}'`));
              }
            }
            if (row.action_type !== actionType) {
              return Promise.reject(new Error(`ERR_APPROVAL_HASH_MISMATCH: Action type mismatch: expected ${row.action_type}, received ${actionType}`));
            }
            if (row.payload_digest !== payloadDigest) {
              return Promise.reject(new Error(`ERR_APPROVAL_HASH_MISMATCH: Payload digest mismatch for token ${tokenId}`));
            }
            if (new Date(row.expires_at).getTime() < Date.now()) {
              this.nativeDb.prepare("UPDATE approvals SET status = 'EXPIRED' WHERE token_id = ?").run(tokenId);
              return Promise.reject(new Error(`ERR_APPROVAL_EXPIRED: Token ${tokenId} has expired`));
            }
            if (row.status === 'PENDING') {
              return Promise.reject(new Error(`ERR_APPROVAL_NOT_APPROVED: Token ${tokenId} is still PENDING. Human/PO approval required.`));
            }
            if (row.status === 'CONSUMED') {
              return Promise.reject(new Error(`ERR_APPROVAL_ALREADY_CONSUMED: Token ${tokenId} already consumed`));
            }
            if (row.status !== 'APPROVED') {
              return Promise.reject(new Error(`ERR_UNTRUSTED_ACTION: Token ${tokenId} status is ${row.status}`));
            }
            const nowIso = new Date().toISOString();
            const res = this.nativeDb.prepare(`
              UPDATE approvals
              SET status = 'CONSUMED', consumed_at = ?
              WHERE token_id = ? AND status = 'APPROVED' AND payload_digest = ? AND expires_at > ?
            `).run(nowIso, tokenId, payloadDigest, nowIso);
            if (res.changes === 0) {
              return Promise.reject(new Error(`ERR_APPROVAL_ALREADY_CONSUMED: Token ${tokenId} was consumed concurrently or payload digest mismatch`));
            }
            return Promise.resolve({ success: true, tokenId, consumedAt: nowIso });
          }
          case 'close': {
            this.nativeDb.close();
            this.nativeDb = null;
            return Promise.resolve(true);
          }
          default:
            return Promise.reject(new Error(`Unknown method ${method}`));
        }
      } catch (e) {
        return Promise.reject(e);
      }
    }

    if (!this.worker) {
      return this.handleFallback(method, args);
    }

    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`ERR_STORAGE_UNAVAILABLE: Request ${method} timed out after ${timeoutMs}ms (UB-P2-R02-001)`));
        }
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      try {
        this.worker.send({ id, method, args });
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        if (this.allowNonDurableDemo) {
          this.handleFallback(method, args).then(resolve, reject);
        } else {
          reject(new Error(`ERR_STORAGE_UNAVAILABLE: Failed to send ${method} to storage worker: ${err.message}`));
        }
      }
    });
  }

  async insertEnvelope(envelope, options = {}) {
    return this.sendRequest('insertEnvelope', {
      envelope,
      approval: options.approval,
      injectFaultAt: options.injectFaultAt,
      faultAction: options.faultAction,
    });
  }

  async getIdempotencyRecord(key) {
    return this.sendRequest('getIdempotencyRecord', { key });
  }

  async getRoomEnvelopes(roomId, limit = 100) {
    return this.sendRequest('getRoomEnvelopes', { roomId, limit });
  }

  async getRooms() {
    return this.sendRequest('getRooms');
  }

  async ensureRoom(roomId, name) {
    return this.sendRequest('ensureRoom', { roomId, name });
  }

  async createApprovalToken(token) {
    return this.sendRequest('createApprovalToken', { token });
  }

  async getApprovalToken(tokenId) {
    return this.sendRequest('getApprovalToken', { tokenId });
  }

  async approveToken(tokenId, approver, decisionContext) {
    return this.sendRequest('approveToken', { tokenId, approver, decisionContext });
  }

  async validateAndConsumeApproval(tokenId, actionType, payloadDigest, options) {
    return this.sendRequest('validateAndConsumeApproval', { tokenId, actionType, payloadDigest, options });
  }

  async closeAsync() {
    if (this.nativeDb) {
      try {
        this.nativeDb.close();
      } catch {}
      this.nativeDb = null;
    }
    if (this.worker) {
      try {
        await this.sendRequest('close', {}, 1000);
      } catch {}
      try {
        this.worker.kill();
      } catch {}
      this.worker = null;
    }
    this.rejectAllPending(new Error('ERR_STORAGE_UNAVAILABLE: Storage service closed'));
  }

  close() {
    if (this.nativeDb) {
      try {
        this.nativeDb.close();
      } catch {}
      this.nativeDb = null;
    }
    if (this.worker) {
      try {
        this.worker.kill();
      } catch {}
      this.worker = null;
    }
    this.rejectAllPending(new Error('ERR_STORAGE_UNAVAILABLE: Storage service closed'));
  }
}

module.exports = { StorageServiceClient, findSystemNode };
