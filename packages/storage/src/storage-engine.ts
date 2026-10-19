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
    this.ensureP3Schema();
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

  public ensureP3Schema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_projects_archived ON projects (archived);

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        room_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
      CREATE INDEX IF NOT EXISTS idx_tasks_room ON tasks (room_id);
    `);

    // Ensure default project exists
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT OR IGNORE INTO projects (id, name, description, created_at, updated_at, archived)
      VALUES ('default', 'General Project', 'Default local workspace project', ?, ?, 0)
    `).run(now, now);

    // Add project_id column to rooms if not present
    const roomCols = this.db.prepare('PRAGMA table_info(rooms)').all() as any[];
    if (!roomCols.some((c) => c.name === 'project_id')) {
      this.db.exec("ALTER TABLE rooms ADD COLUMN project_id TEXT DEFAULT 'default';");
    }
  }

  // --- Project Operations ---
  public getProjects(includeArchived = false): Array<{ id: string; name: string; description?: string; createdAt: string; updatedAt: string; archived: number }> {
    const query = includeArchived
      ? 'SELECT id, name, description, created_at, updated_at, archived FROM projects ORDER BY created_at ASC'
      : 'SELECT id, name, description, created_at, updated_at, archived FROM projects WHERE archived = 0 ORDER BY created_at ASC';
    const rows = this.db.prepare(query).all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      archived: r.archived,
    }));
  }

  public createProject(id: string, name: string, description?: string): { id: string; name: string; description?: string; createdAt: string; updatedAt: string; archived: number } {
    if (!id || !name) {
      throw new UnionBotError({ code: 'ERR_SCHEMA_VALIDATION_FAILED', message: 'Project ID and name are required' });
    }
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO projects (id, name, description, created_at, updated_at, archived)
      VALUES (?, ?, ?, ?, ?, 0)
    `).run(id, name, description || null, now, now);
    return { id, name, description, createdAt: now, updatedAt: now, archived: 0 };
  }

  public renameProject(id: string, newName: string): boolean {
    if (!id || !newName) {
      throw new UnionBotError({ code: 'ERR_SCHEMA_VALIDATION_FAILED', message: 'Project ID and new name are required' });
    }
    const now = new Date().toISOString();
    const res = this.db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(newName, now, id);
    return res.changes > 0;
  }

  public archiveProject(id: string): boolean {
    if (id === 'default') {
      throw new UnionBotError({ code: 'ERR_UNTRUSTED_ACTION', message: 'Cannot archive default project' });
    }
    const now = new Date().toISOString();
    const res = this.db.prepare('UPDATE projects SET archived = 1, updated_at = ? WHERE id = ?').run(now, id);
    return res.changes > 0;
  }

  public deleteProject(id: string): boolean {
    if (id === 'default') {
      throw new UnionBotError({ code: 'ERR_UNTRUSTED_ACTION', message: 'Cannot delete default project' });
    }
    this.db.prepare("UPDATE rooms SET project_id = 'default' WHERE project_id = ?").run(id);
    const res = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return res.changes > 0;
  }

  // --- Room Operations ---
  public ensureRoom(roomId: string, name?: string, projectId = 'default'): void {
    const existing = this.db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId);
    if (!existing) {
      const now = new Date().toISOString();
      this.db
        .prepare('INSERT INTO rooms (id, name, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(roomId, name || roomId, projectId, now, now);
    }
  }

  public createRoom(id: string, name: string, projectId = 'default'): { id: string; name: string; projectId: string; createdAt: string; updatedAt: string } {
    const now = new Date().toISOString();
    this.db
      .prepare('INSERT OR REPLACE INTO rooms (id, name, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, projectId, now, now);
    return { id, name, projectId, createdAt: now, updatedAt: now };
  }

  public getRooms(projectId?: string): Array<{ id: string; name: string; projectId: string; createdAt: string; updatedAt: string }> {
    const query = projectId
      ? 'SELECT id, name, project_id, created_at, updated_at FROM rooms WHERE project_id = ? ORDER BY rowid ASC'
      : 'SELECT id, name, project_id, created_at, updated_at FROM rooms ORDER BY rowid ASC';
    const rows = (projectId ? this.db.prepare(query).all(projectId) : this.db.prepare(query).all()) as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      projectId: r.project_id || 'default',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  // --- Task Operations ---
  public listTasks(options: { status?: string; roomId?: string; limit?: number } = {}): Array<{ id: string; title: string; status: string; progress: number; roomId?: string; createdAt: string; updatedAt: string; metadata?: any }> {
    const limit = options.limit || 50;
    let query = 'SELECT * FROM tasks WHERE 1=1';
    const params: any[] = [];
    if (options.status) {
      query += ' AND status = ?';
      params.push(options.status);
    }
    if (options.roomId) {
      query += ' AND room_id = ?';
      params.push(options.roomId);
    }
    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      progress: r.progress,
      roomId: r.room_id || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      metadata: r.metadata_json ? JSON.parse(r.metadata_json) : undefined,
    }));
  }

  public createTask(task: { id?: string; title: string; status?: string; progress?: number; roomId?: string; metadata?: any }): any {
    const id = task.id || `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const status = task.status || 'pending';
    const progress = typeof task.progress === 'number' ? task.progress : 0;
    const metadataJson = task.metadata ? JSON.stringify(task.metadata) : null;
    this.db.prepare(`
      INSERT INTO tasks (id, title, status, progress, room_id, created_at, updated_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, task.title, status, progress, task.roomId || null, now, now, metadataJson);
    return { id, title: task.title, status, progress, roomId: task.roomId, createdAt: now, updatedAt: now, metadata: task.metadata };
  }

  public updateTask(taskId: string, updates: { status?: string; progress?: number; metadata?: any }): boolean {
    const now = new Date().toISOString();
    const existing = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
    if (!existing) return false;
    const newStatus = updates.status !== undefined ? updates.status : existing.status;
    const newProgress = updates.progress !== undefined ? updates.progress : existing.progress;
    const newMetadata = updates.metadata !== undefined ? JSON.stringify(updates.metadata) : existing.metadata_json;
    const res = this.db.prepare(`
      UPDATE tasks
      SET status = ?, progress = ?, metadata_json = ?, updated_at = ?
      WHERE id = ?
    `).run(newStatus, newProgress, newMetadata, now, taskId);
    return res.changes > 0;
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

  public getIdempotencyRecord(key: string): any {
    const row = this.db
      .prepare('SELECT key, target_id, status, payload_digest, response_json, dispatch_prepared, created_at, expires_at FROM idempotency_keys WHERE key = ?')
      .get(key) as any;
    if (!row) return null;
    return {
      key: row.key,
      targetId: row.target_id,
      status: row.status,
      payloadDigest: row.payload_digest,
      responseJson: row.response_json,
      dispatchPrepared: row.dispatch_prepared,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
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
