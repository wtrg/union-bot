/**
 * @file storage-service.cjs
 * @description Persistent SQLite Storage client for Electron Desktop Main Process (UB-P2-R01-003, P2-T04).
 * Connects to SQLite either in-process (if node:sqlite is present) or via dedicated storage-worker (Node 24).
 */

const cp = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

function findSystemNode() {
  if (process.env.SYSTEM_NODE_PATH && fs.existsSync(process.env.SYSTEM_NODE_PATH)) {
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

class StorageServiceClient {
  constructor(dbPath) {
    this.dbPath = dbPath;
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
    this.init();
  }

  init() {
    // Check if node:sqlite is available in current process
    try {
      const { DatabaseSync } = require('node:sqlite');
      if (typeof DatabaseSync === 'function') {
        this.isNative = true;
        this.initNative(DatabaseSync);
        return;
      }
    } catch {
      // Not in current process, fallback to worker
    }

    // Spawn storage worker using system Node (Node 24)
    const workerScript = path.resolve(__dirname, 'storage-worker.cjs');
    const nodeExec = findSystemNode();

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
        if (this.pending.has(id)) {
          const { resolve, reject } = this.pending.get(id);
          this.pending.delete(id);
          if (error) {
            reject(new Error(error));
          } else {
            resolve(result);
          }
        }
      });

      this.worker.on('error', (err) => {
        console.error('[StorageWorker] Error:', err);
      });

      this.worker.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          console.warn(`[StorageWorker] Exited with code ${code}`);
        }
        this.worker = null;
      });

      // Initialize DB on worker
      this.sendRequest('init', { dbPath: this.dbPath }).catch((err) => {
        console.error('[StorageService] Failed to init DB on worker:', err.message);
      });
    } catch (spawnErr) {
      console.warn('[StorageService] Could not fork storage worker, using in-memory store:', spawnErr.message);
      this.worker = null;
    }
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

    // Initial schema
    this.nativeDb.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
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
      CREATE TABLE IF NOT EXISTS events (
        sequence_id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT UNIQUE NOT NULL,
        stream_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        metadata_json TEXT,
        occurred_at TEXT NOT NULL
      );
    `);
  }

  handleFallback(method, args = {}) {
    switch (method) {
      case 'init':
        return Promise.resolve({ success: true, dbPath: this.dbPath });
      case 'ensureRoom': {
        const roomId = args.roomId;
        if (!this.fallbackRooms.has(roomId)) {
          this.fallbackRooms.set(roomId, { id: roomId, name: args.name || roomId });
        }
        return Promise.resolve(true);
      }
      case 'getRooms':
        return Promise.resolve(Array.from(this.fallbackRooms.values()));
      case 'insertEnvelope': {
        const envelope = args.envelope;
        const list = this.fallbackEnvelopes.get(envelope.roomId) || [];
        list.push(envelope);
        this.fallbackEnvelopes.set(envelope.roomId, list);
        return Promise.resolve({ success: true, envelopeId: envelope.id });
      }
      case 'getRoomEnvelopes': {
        const { roomId, limit = 100 } = args;
        const list = this.fallbackEnvelopes.get(roomId) || [];
        return Promise.resolve(list.slice(-limit));
      }
      case 'close':
        return Promise.resolve(true);
      default:
        return Promise.reject(new Error(`Unknown method ${method}`));
    }
  }

  sendRequest(method, args = {}) {
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
          case 'insertEnvelope': {
            const envelope = args.envelope;
            const now = new Date().toISOString();
            this.nativeDb.prepare('INSERT OR IGNORE INTO rooms (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
              .run(envelope.roomId, envelope.roomId, now, now);

            this.nativeDb.exec('BEGIN TRANSACTION;');
            try {
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

              const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
              this.nativeDb.prepare(`
                INSERT INTO events (event_id, stream_id, event_type, payload_json, metadata_json, occurred_at)
                VALUES (?, ?, 'ENVELOPE_RECORDED', ?, NULL, ?)
              `).run(eventId, `room:${envelope.roomId}`, JSON.stringify(envelope), now);

              this.nativeDb.exec('COMMIT;');
              return Promise.resolve({ success: true, envelopeId: envelope.id });
            } catch (err) {
              this.nativeDb.exec('ROLLBACK;');
              return Promise.reject(err);
            }
          }
          case 'getRoomEnvelopes': {
            const { roomId, limit = 100 } = args;
            const rows = this.nativeDb
              .prepare('SELECT raw_json FROM envelopes WHERE room_id = ? ORDER BY rowid ASC LIMIT ?')
              .all(roomId, limit);
            const envelopes = rows.map((r) => JSON.parse(r.raw_json));
            return Promise.resolve(envelopes);
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
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.send({ id, method, args });
      } catch (err) {
        this.pending.delete(id);
        this.handleFallback(method, args).then(resolve, reject);
      }
    });
  }

  async insertEnvelope(envelope) {
    return this.sendRequest('insertEnvelope', { envelope });
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

  close() {
    if (this.worker) {
      try {
        this.worker.kill();
      } catch {}
      this.worker = null;
    }
    if (this.nativeDb) {
      try {
        this.nativeDb.close();
      } catch {}
      this.nativeDb = null;
    }
  }
}

module.exports = {
  StorageServiceClient,
};
