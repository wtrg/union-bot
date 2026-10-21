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
const { computeEnvelopeDigest, canonicalizeJson, computeCanonicalDigest } = require('./canonical-json.cjs');
const { runSchemaMigrations } = require('./schema-definition.cjs');

function findSystemNode() {
  if (process.env.SYSTEM_NODE_PATH && fs.existsSync(process.env.SYSTEM_NODE_PATH)) {
    return process.env.SYSTEM_NODE_PATH;
  }
  const portableCandidates = [
    path.resolve(__dirname, '../../../runtime/node.exe'),
    path.resolve(__dirname, '../../runtime/node.exe'),
    path.resolve(__dirname, '../runtime/node.exe'),
    path.resolve(process.resourcesPath || '', '../runtime/node.exe'),
    path.resolve(process.resourcesPath || '', 'runtime/node.exe'),
  ];
  for (const c of portableCandidates) {
    if (c && fs.existsSync(c)) {
      return c;
    }
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
    this.fallbackProjects = new Map([
      ['default', { id: 'default', name: 'General Project', description: 'Default local workspace project', archived: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
    ]);
    this.fallbackRooms = new Map([
      ['orchestration', { id: 'orchestration', name: 'orchestration', project_id: 'default' }],
      ['agent-dev', { id: 'agent-dev', name: 'agent-dev', project_id: 'default' }],
      ['qa-audit', { id: 'qa-audit', name: 'qa-audit', project_id: 'default' }],
      ['review-briefing', { id: 'review-briefing', name: 'review-briefing', project_id: 'default' }],
    ]);
    this.fallbackApprovals = new Map();
    this.fallbackTasks = new Map();

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
          if (this.isClosing) return;
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
    this.ensureP3Schema(this.nativeDb);

    const defaultRooms = ['orchestration', 'agent-dev', 'qa-audit', 'review-briefing'];
    const now = new Date().toISOString();
    const insertRoom = this.nativeDb.prepare('INSERT OR IGNORE INTO rooms (id, name, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    for (const r of defaultRooms) {
      insertRoom.run(r, r, 'default', now, now);
    }
  }

  ensureP3Schema(db) {
    // Phase P3 schema is formally handled by Migration 002_p3_desktop_workspace (UB-P3-R02-003)
  }

  handleFallback(method, args = {}) {
    if (!this.allowNonDurableDemo) {
      return Promise.reject(new Error(`ERR_STORAGE_UNAVAILABLE: In-memory fallback forbidden in production mode for '${method}' (UB-P2-R02-001)`));
    }
    console.warn(`[StorageService] [NON_DURABLE_DEMO] Executing '${method}' in in-memory demo store.`);
    switch (method) {
      case 'init':
        return Promise.resolve({ success: true, dbPath: this.dbPath, mode: 'NON_DURABLE_DEMO' });
      case 'getProjects': {
        const includeArchived = args && args.includeArchived === true;
        const list = Array.from(this.fallbackProjects.values()).filter(p => includeArchived || !p.archived);
        return Promise.resolve(list);
      }
      case 'createProject': {
        const now = new Date().toISOString();
        const workspaceRoot = args.workspaceRoot || args.workspace_root || null;
        const proj = {
          id: args.id,
          name: args.name,
          description: args.description || '',
          workspaceRoot,
          workspace_root: workspaceRoot,
          created_at: now,
          updated_at: now,
          archived: 0
        };
        this.fallbackProjects.set(args.id, proj);
        return Promise.resolve(proj);
      }
      case 'renameProject': {
        const proj = this.fallbackProjects.get(args.id);
        if (proj) {
          proj.name = args.newName;
          proj.updated_at = new Date().toISOString();
          return Promise.resolve({ success: true, project: proj });
        }
        return Promise.resolve({ success: false, error: 'Project not found' });
      }
      case 'archiveProject': {
        if (args.id === 'default') {
          return Promise.reject(new Error('Cannot archive default project'));
        }
        const proj = this.fallbackProjects.get(args.id);
        if (proj) {
          proj.archived = 1;
          proj.updated_at = new Date().toISOString();
          return Promise.resolve({ success: true, project: proj });
        }
        return Promise.resolve({ success: false, error: 'Project not found' });
      }
      case 'deleteProject': {
        if (args.id === 'default') {
          return Promise.reject(new Error('Cannot delete default project'));
        }
        for (const r of this.fallbackRooms.values()) {
          if (r.project_id === args.id) r.project_id = 'default';
        }
        const deleted = this.fallbackProjects.delete(args.id);
        return Promise.resolve({ success: deleted });
      }
      case 'ensureRoom': {
        const roomId = args.roomId;
        if (!this.fallbackRooms.has(roomId)) {
          this.fallbackRooms.set(roomId, { id: roomId, name: args.name || roomId, project_id: args.projectId || 'default' });
        }
        return Promise.resolve(true);
      }
      case 'getRooms': {
        const projectId = args && args.projectId;
        const rooms = Array.from(this.fallbackRooms.values()).filter(r => !projectId || r.project_id === projectId);
        return Promise.resolve(rooms);
      }
      case 'createRoom': {
        const now = new Date().toISOString();
        const record = { id: args.id, name: args.name, project_id: args.projectId || 'default', created_at: now, updated_at: now };
        this.fallbackRooms.set(args.id, record);
        return Promise.resolve(record);
      }
      case 'listTasks': {
        const limit = (args && args.limit) || 50;
        const status = args && args.status;
        const roomId = args && (args.roomId || args.room_id);
        const taskId = args && (args.taskId || args.id);
        const projectId = args && args.projectId;
        let tasks = Array.from(this.fallbackTasks.values()).reverse();
        if (taskId) tasks = tasks.filter(t => t.id === taskId);
        if (status) tasks = tasks.filter(t => t.status === status);
        if (roomId) tasks = tasks.filter(t => (t.room_id === roomId || t.roomId === roomId));
        if (projectId) {
          const projectRoomIds = new Set(
            Array.from(this.fallbackRooms?.values() || [])
              .filter(r => r.project_id === projectId || r.projectId === projectId)
              .map(r => r.id)
          );
          tasks = tasks.filter(t => {
            const rId = t.room_id || t.roomId;
            if (rId) return projectRoomIds.has(rId);
            return t.metadata?.projectId === projectId;
          });
        }
        return Promise.resolve(tasks.slice(0, limit).map(t => ({
          ...t,
          roomId: t.room_id || t.roomId,
          room_id: t.room_id || t.roomId,
        })));
      }
      case 'createTask': {
        const now = new Date().toISOString();
        const id = (args && args.id) || `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const title = (args && (args.title || args.name)) || 'Untitled Task';
        const task = {
          id,
          title,
          status: (args && args.status) || 'pending',
          progress: typeof (args && args.progress) === 'number' ? args.progress : 0,
          room_id: (args && (args.roomId || args.room_id)) || null,
          metadata_json: (args && args.metadata) ? JSON.stringify(args.metadata) : null,
          metadata: args ? args.metadata : undefined,
          created_at: now,
          updated_at: now
        };
        this.fallbackTasks.set(id, task);
        return Promise.resolve(task);
      }
      case 'updateTask': {
        const task = this.fallbackTasks.get(args.taskId);
        if (task) {
          if (args.updates.status !== undefined) task.status = args.updates.status;
          if (args.updates.progress !== undefined) task.progress = args.updates.progress;
          if (args.updates.metadata !== undefined) {
            task.metadata = args.updates.metadata;
            task.metadata_json = JSON.stringify(args.updates.metadata);
          }
          task.updated_at = new Date().toISOString();
          return Promise.resolve({ success: true, task });
        }
        return Promise.resolve({ success: false, error: 'Task not found' });
      }
      case 'getStorageDiagnostics': {
        return Promise.resolve({
          mode: 'NON_DURABLE_DEMO',
          dbPath: this.dbPath,
          dbSizeBytes: 0,
          walMode: false,
          projectCount: this.fallbackProjects.size,
          roomCount: this.fallbackRooms.size,
          envelopeCount: this.fallbackEnvelopes.size,
          taskCount: this.fallbackTasks.size,
          approvalCount: Array.from(this.fallbackApprovals.values()).filter(a => a.status === 'PENDING').length
        });
      }
      case 'listApprovals': {
        const rows = Array.from(this.fallbackApprovals.values()).reverse();
        return Promise.resolve(rows.map(r => ({
          ...r,
          payload: r.payload || (r.payload_json ? JSON.parse(r.payload_json) : null),
        })));
      }
      case 'rejectToken': {
        const token = this.fallbackApprovals.get(args.tokenId);
        if (token && token.status === 'PENDING') {
          token.status = 'REJECTED';
          token.rejectedAt = new Date().toISOString();
          token.rejectionReason = args.reason || 'User rejected';
          return Promise.resolve({ success: true, tokenId: args.tokenId });
        }
        return Promise.resolve({ success: false, tokenId: args.tokenId });
      }
      case 'testTamperApprovalPayload': {
        const token = this.fallbackApprovals.get(args.tokenId);
        if (token) {
          token.payload = args.tamperedPayload;
          token.payload_json = JSON.stringify(args.tamperedPayload);
        }
        return Promise.resolve({ success: true });
      }
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
        const queryLimit = typeof args.limit === 'number' ? args.limit : 100;
        return Promise.resolve(queryLimit === -1 ? list : list.slice(0, queryLimit));
      }
      case 'createApprovalToken': {
        const token = args.token;
        let payloadObj = token.payload;
        let payloadJson = token.payloadJson || token.payload_json || null;
        if (payloadObj !== undefined && payloadObj !== null) {
          const computedDigest = computeCanonicalDigest(payloadObj, token.canonicalizationVersion || 1);
          const suppliedDigest = token.payloadDigest || token.payload_digest;
          if (suppliedDigest && suppliedDigest !== computedDigest) {
            return Promise.reject(new Error(`ERR_PAYLOAD_MISMATCH: Payload does not match supplied payloadDigest (P3-R04-F01)`));
          }
          if (!token.payloadDigest) token.payloadDigest = computedDigest;
          if (!payloadJson) payloadJson = canonicalizeJson(payloadObj);
        } else if (payloadJson) {
          try {
            const parsed = JSON.parse(payloadJson);
            const computedDigest = computeCanonicalDigest(parsed, token.canonicalizationVersion || 1);
            const suppliedDigest = token.payloadDigest || token.payload_digest;
            if (suppliedDigest && suppliedDigest !== computedDigest) {
              return Promise.reject(new Error(`ERR_PAYLOAD_MISMATCH: Payload does not match supplied payloadDigest (P3-R04-F01)`));
            }
            if (!token.payloadDigest) token.payloadDigest = computedDigest;
            payloadObj = parsed;
          } catch (err) {
            if (err.message && err.message.includes('ERR_PAYLOAD_MISMATCH')) return Promise.reject(err);
          }
        }
        const record = {
          ...token,
          status: 'PENDING',
          payload_json: payloadJson,
          payload: payloadObj || (payloadJson ? JSON.parse(payloadJson) : null),
        };
        this.fallbackApprovals.set(token.tokenId, record);
        return Promise.resolve(record);
      }
      case 'getApprovalToken': {
        const row = this.fallbackApprovals.get(args.tokenId) || null;
        if (row) {
          row.payload = row.payload || (row.payload_json ? JSON.parse(row.payload_json) : null);
        }
        return Promise.resolve(row);
      }
      case 'approveToken': {
        const t = this.fallbackApprovals.get(args.tokenId);
        if (!t) return Promise.reject(new Error(`ERR_UNTRUSTED_ACTION: Approval token not found: ${args.tokenId}`));
        if (t.payload_json) {
          try {
            const parsed = JSON.parse(t.payload_json);
            const computed = computeCanonicalDigest(parsed, t.canonicalizationVersion || 1);
            const stored = t.payloadDigest || t.payload_digest;
            if (stored && computed !== stored) {
              return Promise.reject(new Error(`ERR_PAYLOAD_MISMATCH: Stored payload_json does not match stored payload_digest (P3-R04-F02)`));
            }
          } catch (err) {
            if (err.message && err.message.includes('ERR_PAYLOAD_MISMATCH')) return Promise.reject(err);
          }
        }
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
          case 'getProjects': {
            try {
              const prjCols = this.nativeDb.prepare('PRAGMA table_info(projects)').all();
              if (!prjCols.some((c) => c.name === 'workspace_root')) {
                this.nativeDb.exec('ALTER TABLE projects ADD COLUMN workspace_root TEXT;');
              }
            } catch {}
            const includeArchived = args && args.includeArchived === true;
            const q = includeArchived
              ? 'SELECT id, name, description, workspace_root, created_at, updated_at, archived FROM projects ORDER BY created_at ASC'
              : 'SELECT id, name, description, workspace_root, created_at, updated_at, archived FROM projects WHERE archived = 0 ORDER BY created_at ASC';
            const rows = this.nativeDb.prepare(q).all();
            const mapped = rows.map((r) => ({ ...r, workspaceRoot: r.workspace_root || r.workspaceRoot }));
            return Promise.resolve(mapped);
          }
          case 'createProject': {
            const now = new Date().toISOString();
            try {
              const prjCols = this.nativeDb.prepare('PRAGMA table_info(projects)').all();
              if (!prjCols.some((c) => c.name === 'workspace_root')) {
                this.nativeDb.exec('ALTER TABLE projects ADD COLUMN workspace_root TEXT;');
              }
            } catch {}
            const workspaceRoot = args.workspaceRoot || args.workspace_root || null;
            this.nativeDb.prepare(`
              INSERT INTO projects (id, name, description, workspace_root, created_at, updated_at, archived)
              VALUES (?, ?, ?, ?, ?, ?, 0)
            `).run(args.id, args.name, args.description || null, workspaceRoot, now, now);
            return Promise.resolve({
              id: args.id,
              name: args.name,
              description: args.description,
              workspaceRoot,
              workspace_root: workspaceRoot,
              created_at: now,
              updated_at: now,
              archived: 0
            });
          }
          case 'renameProject': {
            const now = new Date().toISOString();
            const res = this.nativeDb.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(args.newName, now, args.id);
            return Promise.resolve({ success: res.changes > 0, id: args.id, name: args.newName });
          }
          case 'archiveProject': {
            if (args.id === 'default') {
              throw new Error('Cannot archive default project');
            }
            const now = new Date().toISOString();
            const res = this.nativeDb.prepare('UPDATE projects SET archived = 1, updated_at = ? WHERE id = ?').run(now, args.id);
            return Promise.resolve({ success: res.changes > 0, id: args.id });
          }
          case 'deleteProject': {
            if (args.id === 'default') {
              throw new Error('Cannot delete default project');
            }
            this.nativeDb.prepare("UPDATE rooms SET project_id = 'default' WHERE project_id = ?").run(args.id);
            const res = this.nativeDb.prepare('DELETE FROM projects WHERE id = ?').run(args.id);
            return Promise.resolve({ success: res.changes > 0, id: args.id });
          }
          case 'ensureRoom': {
            const now = new Date().toISOString();
            this.nativeDb.prepare('INSERT OR IGNORE INTO rooms (id, name, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
              .run(args.roomId, args.name || args.roomId, args.projectId || 'default', now, now);
            return Promise.resolve(true);
          }
          case 'getRooms': {
            const q = args && args.projectId
              ? 'SELECT id, name, project_id, created_at, updated_at FROM rooms WHERE project_id = ? ORDER BY rowid ASC'
              : 'SELECT id, name, project_id, created_at, updated_at FROM rooms ORDER BY rowid ASC';
            const rows = args && args.projectId ? this.nativeDb.prepare(q).all(args.projectId) : this.nativeDb.prepare(q).all();
            return Promise.resolve(rows);
          }
          case 'createRoom': {
            const now = new Date().toISOString();
            this.nativeDb.prepare('INSERT OR REPLACE INTO rooms (id, name, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
              .run(args.id, args.name, args.projectId || 'default', now, now);
            return Promise.resolve({ id: args.id, name: args.name, project_id: args.projectId || 'default', created_at: now, updated_at: now });
          }
          case 'listTasks': {
            const limit = typeof (args && args.limit) === 'number' ? args.limit : 50;
            let query = 'SELECT * FROM tasks WHERE 1=1';
            const params = [];
            if (args && args.status) {
              query += ' AND status = ?';
              params.push(args.status);
            }
            if (args && (args.roomId || args.room_id)) {
              query += ' AND room_id = ?';
              params.push(args.roomId || args.room_id);
            }
            if (args && (args.taskId || args.id)) {
              query += ' AND id = ?';
              params.push(args.taskId || args.id);
            }
            if (args && args.projectId) {
              query += " AND (room_id IN (SELECT id FROM rooms WHERE project_id = ?) OR (room_id IS NULL AND json_extract(metadata_json, '$.projectId') = ?))";
              params.push(args.projectId, args.projectId);
            }
            query += ' ORDER BY created_at DESC LIMIT ?';
            params.push(limit);
            const rows = this.nativeDb.prepare(query).all(...params);
            return Promise.resolve(rows.map(r => ({
              id: r.id,
              title: r.title,
              status: r.status,
              progress: r.progress,
              roomId: r.room_id || undefined,
              room_id: r.room_id || undefined,
              createdAt: r.created_at,
              created_at: r.created_at,
              updatedAt: r.updated_at,
              updated_at: r.updated_at,
              metadata: r.metadata_json ? JSON.parse(r.metadata_json) : undefined
            })));
          }
          case 'createTask': {
            const id = (args && args.id) || `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const now = new Date().toISOString();
            const title = (args && (args.title || args.name)) || 'Untitled Task';
            const status = (args && args.status) || 'pending';
            const progress = typeof (args && args.progress) === 'number' ? args.progress : 0;
            const roomId = (args && (args.roomId || args.room_id)) || null;
            const metadataJson = (args && args.metadata) ? JSON.stringify(args.metadata) : null;
            this.nativeDb.prepare(`
              INSERT INTO tasks (id, title, status, progress, room_id, created_at, updated_at, metadata_json)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(id, title, status, progress, roomId, now, now, metadataJson);
            return Promise.resolve({ id, title, status, progress, roomId, createdAt: now, updatedAt: now, metadata: args ? args.metadata : undefined });
          }
          case 'updateTask': {
            const now = new Date().toISOString();
            const existing = this.nativeDb.prepare('SELECT * FROM tasks WHERE id = ?').get(args.taskId);
            if (!existing) return Promise.resolve({ success: false, error: 'Task not found' });
            const newStatus = args.updates && args.updates.status !== undefined ? args.updates.status : existing.status;
            const newProgress = args.updates && args.updates.progress !== undefined ? args.updates.progress : existing.progress;
            const newMetadata = args.updates && args.updates.metadata !== undefined ? JSON.stringify(args.updates.metadata) : existing.metadata_json;
            const res = this.nativeDb.prepare(`
              UPDATE tasks
              SET status = ?, progress = ?, metadata_json = ?, updated_at = ?
              WHERE id = ?
            `).run(newStatus, newProgress, newMetadata, now, args.taskId);
            return Promise.resolve({ success: res.changes > 0, taskId: args.taskId });
          }
          case 'getStorageDiagnostics': {
            let dbSize = 0;
            try {
              if (this.dbPath !== ':memory:' && fs.existsSync(this.dbPath)) {
                dbSize = fs.statSync(this.dbPath).size;
              }
            } catch {}
            const projectCount = this.nativeDb.prepare('SELECT COUNT(*) as c FROM projects').get()?.c || 0;
            const roomCount = this.nativeDb.prepare('SELECT COUNT(*) as c FROM rooms').get()?.c || 0;
            const envelopeCount = this.nativeDb.prepare('SELECT COUNT(*) as c FROM envelopes').get()?.c || 0;
            const taskCount = this.nativeDb.prepare('SELECT COUNT(*) as c FROM tasks').get()?.c || 0;
            const pendingApprovals = this.nativeDb.prepare("SELECT COUNT(*) as c FROM approvals WHERE status = 'PENDING'").get()?.c || 0;
            return Promise.resolve({
              mode: 'NATIVE_SQLITE',
              dbPath: this.dbPath,
              dbSizeBytes: dbSize,
              walMode: true,
              projectCount,
              roomCount,
              envelopeCount,
              taskCount,
              approvalCount: pendingApprovals
            });
          }
          case 'listApprovals': {
            const limit = typeof args.limit === 'number' ? args.limit : 50;
            const rows = this.nativeDb.prepare('SELECT * FROM approvals ORDER BY created_at DESC LIMIT ?').all(limit);
            return Promise.resolve(rows.map(r => ({
              ...r,
              payload: r.payload_json ? JSON.parse(r.payload_json) : null,
            })));
          }
          case 'rejectToken': {
            const { tokenId, reason } = args;
            const nowIso = new Date().toISOString();
            const res = this.nativeDb.prepare(`
              UPDATE approvals
              SET status = 'REJECTED', rejected_at = ?, rejection_reason = ?
              WHERE token_id = ? AND status = 'PENDING'
            `).run(nowIso, reason || 'User rejected', tokenId);
            return Promise.resolve({ success: res.changes > 0, tokenId, rejectedAt: nowIso });
          }
          case 'testTamperApprovalPayload': {
            const tamperedJson = typeof args.tamperedPayload === 'string'
              ? args.tamperedPayload
              : JSON.stringify(args.tamperedPayload);
            this.nativeDb.prepare('UPDATE approvals SET payload_json = ? WHERE token_id = ?')
              .run(tamperedJson, args.tokenId);
            return Promise.resolve({ success: true });
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
                    this.nativeDb.exec('COMMIT;');
                    return Promise.resolve({ success: true, envelopeId: envelope.id, deduplicated: true });
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
            const queryLimit = typeof limit === 'number' ? limit : 100;
            const rows = this.nativeDb.prepare('SELECT raw_json FROM envelopes WHERE room_id = ? ORDER BY rowid ASC LIMIT ?')
              .all(roomId, queryLimit);
            const envelopes = rows.map((r) => JSON.parse(r.raw_json));
            return Promise.resolve(envelopes);
          }
          case 'createApprovalToken': {
            const token = args.token;
            const now = new Date().toISOString();
            const expiresAt = token.expiresAt || new Date(Date.now() + 3600000).toISOString();
            let payloadObj = token.payload;
            let payloadJson = token.payloadJson || token.payload_json || null;

            // UB-P3-R04-G01: Missing or unreadable ActionIntent payload is strictly rejected
            if ((payloadObj === undefined || payloadObj === null) && (!payloadJson || typeof payloadJson !== 'string' || payloadJson.trim() === '')) {
              return Promise.reject(new Error('ERR_PAYLOAD_MISMATCH: ActionIntent payload or payload_json is required to create an approval token (UB-P3-R04-G01)'));
            }

            // P3-R04-F01: Backend rejects token creation when payload does not match supplied digest
            if (payloadObj !== undefined && payloadObj !== null) {
              const computedDigest = computeCanonicalDigest(payloadObj, token.canonicalizationVersion || 1);
              const suppliedDigest = token.payloadDigest || token.payload_digest;
              if (suppliedDigest && suppliedDigest !== computedDigest) {
                return Promise.reject(new Error(`ERR_PAYLOAD_MISMATCH: Payload does not match supplied payloadDigest: computed ${computedDigest} vs supplied ${suppliedDigest} (P3-R04-F01)`));
              }
              if (!token.payloadDigest) token.payloadDigest = computedDigest;
              if (!payloadJson) payloadJson = canonicalizeJson(payloadObj);
            } else if (payloadJson) {
              try {
                const parsed = JSON.parse(payloadJson);
                const computedDigest = computeCanonicalDigest(parsed, token.canonicalizationVersion || 1);
                const suppliedDigest = token.payloadDigest || token.payload_digest;
                if (suppliedDigest && suppliedDigest !== computedDigest) {
                  return Promise.reject(new Error(`ERR_PAYLOAD_MISMATCH: Payload does not match supplied payloadDigest: computed ${computedDigest} vs supplied ${suppliedDigest} (P3-R04-F01)`));
                }
                if (!token.payloadDigest) token.payloadDigest = computedDigest;
                payloadObj = parsed;
              } catch (err) {
                if (err.message && err.message.includes('ERR_PAYLOAD_MISMATCH')) return Promise.reject(err);
                return Promise.reject(new Error(`ERR_PAYLOAD_MISMATCH: Failed to parse provided payload_json: ${err.message} (UB-P3-R04-G01)`));
              }
            }

            this.nativeDb.prepare(`
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
            return Promise.resolve({
              ...token,
              status: 'PENDING',
              createdAt: now,
              expiresAt,
              payload_json: payloadJson,
              payload: payloadObj || (payloadJson ? JSON.parse(payloadJson) : null),
            });
          }
          case 'getApprovalToken': {
            const row = this.nativeDb.prepare('SELECT * FROM approvals WHERE token_id = ?').get(args.tokenId);
            if (row) {
              row.payload = row.payload_json ? JSON.parse(row.payload_json) : null;
            }
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
            const row = this.nativeDb.prepare('SELECT status, expires_at, payload_json, payload_digest, canonicalization_version FROM approvals WHERE token_id = ?').get(tokenId);
            if (!row) {
              return Promise.reject(new Error(`ERR_UNTRUSTED_ACTION: Approval token not found: ${tokenId}`));
            }
            // UB-P3-R04-G01: ActionIntent payload is strictly required for approval. Missing or unreadable payload is rejected fail-closed.
            if (!row.payload_json || typeof row.payload_json !== 'string' || row.payload_json.trim() === '') {
              return Promise.reject(new Error(`ERR_PAYLOAD_MISMATCH: Stored approval token ${tokenId} lacks payload_json. ActionIntent payload is strictly required for approval (UB-P3-R04-G01)`));
            }

            try {
              const parsed = JSON.parse(row.payload_json);
              const computed = computeCanonicalDigest(parsed, row.canonicalization_version || 1);
              if (!row.payload_digest || computed !== row.payload_digest) {
                return Promise.reject(new Error(`ERR_PAYLOAD_MISMATCH: Stored payload_json does not match stored payload_digest for token ${tokenId} (P3-R04-F02)`));
              }
            } catch (parseErr) {
              if (parseErr.message && parseErr.message.includes('ERR_PAYLOAD_MISMATCH')) return Promise.reject(parseErr);
              return Promise.reject(new Error(`ERR_PAYLOAD_MISMATCH: Failed to parse stored payload_json: ${parseErr.message} (UB-P3-R04-G01)`));
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
      if (!this.allowNonDurableDemo) {
        return Promise.reject(new Error('ERR_STORAGE_UNAVAILABLE: Storage worker process is not running (UB-P2-R02-001, U08-R09-03)'));
      }
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

  async getProjects(includeArchived = false) {
    return this.sendRequest('getProjects', { includeArchived });
  }

  async createProject(id, name, description, workspaceRoot) {
    return this.sendRequest('createProject', { id, name, description, workspaceRoot });
  }

  async renameProject(id, newName) {
    return this.sendRequest('renameProject', { id, newName });
  }

  async archiveProject(id) {
    return this.sendRequest('archiveProject', { id });
  }

  async deleteProject(id) {
    return this.sendRequest('deleteProject', { id });
  }

  async getRooms(projectId) {
    return this.sendRequest('getRooms', { projectId });
  }

  async ensureRoom(roomId, name, projectId = 'default') {
    return this.sendRequest('ensureRoom', { roomId, name, projectId });
  }

  async createRoom(id, name, projectId = 'default') {
    return this.sendRequest('createRoom', { id, name, projectId });
  }

  async listTasks(options = {}) {
    return this.sendRequest('listTasks', options);
  }

  async getTask(taskId) {
    if (!taskId) return null;
    const list = await this.listTasks({ taskId, limit: 1 });
    return list && list.length > 0 ? list[0] : null;
  }

  async createTask(taskOrTitle, options = {}) {
    const payload = typeof taskOrTitle === 'string'
      ? { title: taskOrTitle, ...options }
      : (taskOrTitle || {});
    return this.sendRequest('createTask', payload);
  }

  async updateTask(taskId, updates) {
    return this.sendRequest('updateTask', { taskId, updates });
  }

  async getStorageDiagnostics() {
    return this.sendRequest('getStorageDiagnostics');
  }

  async listApprovals(limit = 50) {
    return this.sendRequest('listApprovals', { limit });
  }

  async rejectToken(tokenId, reason) {
    return this.sendRequest('rejectToken', { tokenId, reason });
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

  async testTamperApprovalPayload(tokenId, tamperedPayload) {
    return this.sendRequest('testTamperApprovalPayload', { tokenId, tamperedPayload });
  }

  // --- Phase V4 Review Findings Persistence & Worker Parity (UB-V4-U08, U08-R07-03) ---
  saveReviewFinding(finding) {
    if (this.isNative && this.nativeDb) {
      this.nativeDb.prepare(`
        INSERT OR REPLACE INTO review_findings (
          id, change_set_id, reviewer, file, line, severity, description, reproduction, state, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        finding.id,
        finding.changeSetId,
        finding.reviewer,
        finding.file,
        finding.line !== undefined && finding.line !== null ? Number(finding.line) : null,
        finding.severity,
        finding.description,
        finding.reproduction || null,
        finding.state,
        new Date(finding.createdAt || Date.now()).toISOString()
      );
      return;
    }
    if (this.allowNonDurableDemo) {
      if (!this.fallbackReviewFindings) this.fallbackReviewFindings = new Map();
      this.fallbackReviewFindings.set(finding.id, { ...finding });
      return;
    }
    throw new Error('ERR_STORAGE_UNAVAILABLE: Review findings require durable SQLite storage. In-memory Map fallback is strictly prohibited (U08-R07-03).');
  }

  async saveReviewFindingAsync(finding) {
    if (this.isNative && this.nativeDb) {
      return this.saveReviewFinding(finding);
    }
    return this.sendRequest('saveReviewFinding', { finding });
  }

  getReviewFindings(changeSetId, state) {
    if (this.isNative && this.nativeDb) {
      let query = 'SELECT * FROM review_findings WHERE 1=1';
      const params = [];
      if (changeSetId) {
        query += ' AND change_set_id = ?';
        params.push(changeSetId);
      }
      if (state) {
        query += ' AND state = ?';
        params.push(state);
      }
      query += ' ORDER BY created_at ASC, id ASC';
      const rows = this.nativeDb.prepare(query).all(...params);
      return rows.map((r) => ({
        id: r.id,
        changeSetId: r.change_set_id,
        reviewer: r.reviewer,
        file: r.file,
        line: r.line !== null ? Number(r.line) : undefined,
        severity: r.severity,
        description: r.description,
        reproduction: r.reproduction || undefined,
        state: r.state,
        createdAt: new Date(r.created_at).getTime(),
      }));
    }
    if (this.allowNonDurableDemo) {
      if (!this.fallbackReviewFindings) this.fallbackReviewFindings = new Map();
      let findings = Array.from(this.fallbackReviewFindings.values());
      if (changeSetId) findings = findings.filter((f) => f.changeSetId === changeSetId);
      if (state) findings = findings.filter((f) => f.state === state);
      return findings;
    }
    throw new Error('ERR_STORAGE_UNAVAILABLE: Review findings require durable SQLite storage. In-memory Map fallback is strictly prohibited (U08-R07-03).');
  }

  async getReviewFindingsAsync(changeSetId, state) {
    if (this.isNative && this.nativeDb) {
      return this.getReviewFindings(changeSetId, state);
    }
    return this.sendRequest('getReviewFindings', { changeSetId, state });
  }

  updateReviewFindingState(id, state) {
    if (this.isNative && this.nativeDb) {
      const res = this.nativeDb.prepare('UPDATE review_findings SET state = ? WHERE id = ?').run(state, id);
      return res.changes > 0;
    }
    if (this.allowNonDurableDemo) {
      if (!this.fallbackReviewFindings) return false;
      const existing = this.fallbackReviewFindings.get(id);
      if (!existing) return false;
      existing.state = state;
      return true;
    }
    throw new Error('ERR_STORAGE_UNAVAILABLE: Review findings require durable SQLite storage. In-memory Map fallback is strictly prohibited (U08-R07-03).');
  }

  async updateReviewFindingStateAsync(id, state) {
    if (this.isNative && this.nativeDb) {
      return this.updateReviewFindingState(id, state);
    }
    return this.sendRequest('updateReviewFindingState', { id, state });
  }

  ingestReviewFindingsBatch(changeSetId, reviewer, rawFindings) {
    if (this.isNative && this.nativeDb) {
      this.nativeDb.exec('BEGIN IMMEDIATE TRANSACTION;');
      try {
        const existingRows = this.nativeDb
          .prepare('SELECT file, line, severity, description FROM review_findings WHERE change_set_id = ?')
          .all(changeSetId);
        const existingKeySet = new Set(
          existingRows.map((r) => `${r.file || ''}#${r.line || ''}#${r.severity}#${(r.description || '').trim()}`)
        );

        let inserted = 0;
        let duplicates = 0;
        const insertedFindings = [];
        const insertStmt = this.nativeDb.prepare(`
          INSERT INTO review_findings (id, change_set_id, reviewer, file, line, severity, description, reproduction, state, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const raw of rawFindings) {
          const key = `${raw.file || ''}#${raw.line || ''}#${raw.severity}#${(raw.description || '').trim()}`;
          if (existingKeySet.has(key)) {
            duplicates++;
            continue;
          }

          const findingId = `rf_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          const nowIso = new Date().toISOString();
          insertStmt.run(
            findingId,
            changeSetId,
            reviewer,
            raw.file || '',
            raw.line !== undefined && raw.line !== null ? Number(raw.line) : null,
            raw.severity || 'SEV2',
            raw.description || '',
            raw.reproduction || null,
            'OPEN',
            nowIso
          );
          existingKeySet.add(key);
          insertedFindings.push({
            id: findingId,
            changeSetId,
            reviewer,
            file: raw.file,
            line: raw.line,
            severity: raw.severity,
            description: raw.description,
            reproduction: raw.reproduction,
            state: 'OPEN',
            createdAt: new Date(nowIso).getTime(),
          });
          inserted++;
        }

        this.nativeDb.exec('COMMIT;');
        return { inserted, duplicates, findings: insertedFindings };
      } catch (err) {
        try { this.nativeDb.exec('ROLLBACK;'); } catch {}
        throw err;
      }
    }
    if (this.allowNonDurableDemo) {
      const existing = this.getReviewFindings(changeSetId);
      const existingKeySet = new Set(
        existing.map((f) => `${f.file || ''}#${f.line || ''}#${f.severity}#${(f.description || '').trim()}`)
      );

      let inserted = 0;
      let duplicates = 0;
      const insertedFindings = [];

      for (const raw of rawFindings) {
        const key = `${raw.file || ''}#${raw.line || ''}#${raw.severity}#${(raw.description || '').trim()}`;
        if (existingKeySet.has(key)) {
          duplicates++;
          continue;
        }

        const findingId = `rf_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const finding = {
          id: findingId,
          changeSetId,
          reviewer,
          file: raw.file,
          line: raw.line,
          severity: raw.severity,
          description: raw.description,
          reproduction: raw.reproduction,
          state: 'OPEN',
          createdAt: Date.now(),
        };

        this.saveReviewFinding(finding);
        existingKeySet.add(key);
        insertedFindings.push(finding);
        inserted++;
      }

      return { inserted, duplicates, findings: insertedFindings };
    }
    throw new Error('ERR_STORAGE_UNAVAILABLE: Review findings require durable SQLite storage. In-memory Map fallback is strictly prohibited (U08-R07-03).');
  }

  async ingestReviewFindingsBatchAsync(changeSetId, reviewer, rawFindings) {
    if (this.isNative && this.nativeDb) {
      return this.ingestReviewFindingsBatch(changeSetId, reviewer, rawFindings);
    }
    return this.sendRequest('ingestReviewFindingsBatch', { changeSetId, reviewer, rawFindings });
  }

  async closeAsync() {
    this.isClosing = true;
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
    this.isClosing = true;
    if (this.nativeDb) {
      try {
        this.nativeDb.close();
      } catch {}
      this.nativeDb = null;
    }
    if (this.worker) {
      try {
        if (this.worker.connected) {
          try { this.worker.send({ method: 'close' }); } catch {}
          try { this.worker.disconnect(); } catch {}
        }
        this.worker.kill('SIGTERM');
      } catch {}
      this.worker = null;
    }
    this.rejectAllPending(new Error('ERR_STORAGE_UNAVAILABLE: Storage service closed'));
  }
}

module.exports = { StorageServiceClient, findSystemNode };
