/**
 * @file storage-engine.ts
 * @description Main SQLite Storage Engine for Union Bot (P2-003, P2-004, P2-012).
 */

import { DatabaseSync } from 'node:sqlite';
import { runMigrations, rollbackMigration } from './migrations.ts';
import {
  type Envelope,
  EnvelopeSchema,
  type ActivityEvent,
  ActivityEventSchema,
  type DeliveryAttempt,
  DeliveryAttemptSchema,
  type RequirementFact,
  RequirementFactSchema,
  type OpenQuestion,
  OpenQuestionSchema,
  type Goal,
  GoalSchema,
  type PlanRevision,
  PlanRevisionSchema,
  type Milestone,
  MilestoneSchema,
  type ArtifactHandoff,
  ArtifactHandoffSchema,
  type PermissionGrant,
  PermissionGrantSchema,
} from '../../protocol/src/index.ts';
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

    // Auto-run migrations (Migration 1: P2 Core, Migration 2: P3 Workspace & ActionIntent)
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

  public ensureP3Schema(): void {
    // Phase P3 schema is formally handled by Migration 002_p3_desktop_workspace (UB-P3-R02-003)
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
    const limit = typeof options.limit === 'number' ? options.limit : 50;
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


  // --- V4 Activity Events & Audit ---
  public recordActivityEvent(event: ActivityEvent): void {
    const parsed = ActivityEventSchema.parse(event);
    this.db.prepare(`
      INSERT INTO activity_events (
        id, project_id, goal_id, kind, summary, actor_json, source_json, references_json, receipt_state, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      parsed.id,
      parsed.projectId,
      parsed.goalId || null,
      parsed.kind,
      parsed.summary,
      JSON.stringify(parsed.actor),
      parsed.source ? JSON.stringify(parsed.source) : null,
      JSON.stringify(parsed.references || []),
      parsed.receiptState,
      new Date(parsed.createdAt).toISOString()
    );
  }

  public getActivityEvents(projectId: string, goalId?: string, limit = 100): ActivityEvent[] {
    const query = goalId
      ? 'SELECT * FROM activity_events WHERE project_id = ? AND goal_id = ? ORDER BY rowid DESC LIMIT ?'
      : 'SELECT * FROM activity_events WHERE project_id = ? ORDER BY rowid DESC LIMIT ?';
    const params = goalId ? [projectId, goalId, limit] : [projectId, limit];
    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      goalId: r.goal_id || undefined,
      kind: r.kind,
      summary: r.summary,
      actor: JSON.parse(r.actor_json),
      source: r.source_json ? JSON.parse(r.source_json) : undefined,
      references: JSON.parse(r.references_json || '[]'),
      receiptState: r.receipt_state,
      createdAt: new Date(r.created_at).getTime(),
    }));
  }

  // --- V4 Delivery Attempts ---
  public recordDeliveryAttempt(attempt: DeliveryAttempt): void {
    const parsed = DeliveryAttemptSchema.parse(attempt);
    this.db.prepare(`
      INSERT INTO delivery_attempts (
        id, message_id, project_id, target_provider, correlation_id, state, sent_at, ack_at, response_ref
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      parsed.id,
      parsed.messageId,
      parsed.projectId,
      parsed.targetProvider,
      parsed.correlationId,
      parsed.state,
      new Date(parsed.sentAt).toISOString(),
      parsed.ackAt ? new Date(parsed.ackAt).toISOString() : null,
      parsed.responseRef || null
    );
  }

  public updateDeliveryAttempt(id: string, state: string, ackAt?: number, responseRef?: string): boolean {
    const res = this.db.prepare(`
      UPDATE delivery_attempts
      SET state = ?, ack_at = ?, response_ref = ?
      WHERE id = ?
    `).run(
      state,
      ackAt ? new Date(ackAt).toISOString() : null,
      responseRef || null,
      id
    );
    return res.changes > 0;
  }

  // --- V4 Discovery Facts & Questions ---
  public saveRequirementFact(fact: RequirementFact): void {
    const parsed = RequirementFactSchema.parse(fact);
    this.db.prepare(`
      INSERT OR REPLACE INTO requirement_facts (
        id, discovery_id, project_id, key, value, source_turn_ref, confidence, state, confirmed_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      parsed.id,
      parsed.discoveryId,
      parsed.projectId,
      parsed.key,
      parsed.value,
      parsed.sourceTurnRef,
      parsed.confidence,
      parsed.state,
      parsed.confirmedBy || null,
      new Date(parsed.createdAt).toISOString(),
      new Date(parsed.updatedAt).toISOString()
    );
  }

  public getRequirementFacts(discoveryId: string): RequirementFact[] {
    const rows = this.db.prepare('SELECT * FROM requirement_facts WHERE discovery_id = ? ORDER BY key ASC').all(discoveryId) as any[];
    return rows.map((r) => ({
      id: r.id,
      discoveryId: r.discovery_id,
      projectId: r.project_id,
      key: r.key,
      value: r.value,
      sourceTurnRef: r.source_turn_ref,
      confidence: r.confidence,
      state: r.state,
      confirmedBy: r.confirmed_by || undefined,
      createdAt: new Date(r.created_at).getTime(),
      updatedAt: new Date(r.updated_at).getTime(),
    }));
  }

  public saveOpenQuestion(q: OpenQuestion): void {
    const parsed = OpenQuestionSchema.parse(q);
    this.db.prepare(`
      INSERT OR REPLACE INTO open_questions (
        id, discovery_id, requirement_key, question, priority, blocking, resolved, resolution, asked_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      parsed.id,
      parsed.discoveryId,
      parsed.requirementKey,
      parsed.question,
      parsed.priority,
      parsed.blocking ? 1 : 0,
      parsed.resolved ? 1 : 0,
      parsed.resolution || null,
      new Date(parsed.askedAt).toISOString(),
      parsed.resolvedAt ? new Date(parsed.resolvedAt).toISOString() : null
    );
  }

  public getOpenQuestions(discoveryId: string): OpenQuestion[] {
    const rows = this.db.prepare('SELECT * FROM open_questions WHERE discovery_id = ? ORDER BY blocking DESC, asked_at ASC').all(discoveryId) as any[];
    return rows.map((r) => ({
      id: r.id,
      discoveryId: r.discovery_id,
      requirementKey: r.requirement_key,
      question: r.question,
      priority: r.priority,
      blocking: Boolean(r.blocking),
      resolved: Boolean(r.resolved),
      resolution: r.resolution || undefined,
      askedAt: new Date(r.asked_at).getTime(),
      resolvedAt: r.resolved_at ? new Date(r.resolved_at).getTime() : undefined,
    }));
  }

  // --- V4 Goals & Milestones ---
  public saveGoal(goal: Goal): void {
    const parsed = GoalSchema.parse(goal);
    this.db.prepare(`
      INSERT OR REPLACE INTO goals (
        id, project_id, title, description, active_plan_revision, state, owner_approval_ref, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      parsed.id,
      parsed.projectId,
      parsed.title,
      parsed.description,
      parsed.activePlanRevision,
      parsed.state,
      parsed.ownerApprovalRef || null,
      new Date(parsed.createdAt).toISOString(),
      new Date(parsed.updatedAt).toISOString()
    );
  }

  public getGoals(projectId: string): Goal[] {
    const rows = this.db.prepare('SELECT * FROM goals WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as any[];
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      title: r.title,
      description: r.description || '',
      activePlanRevision: r.active_plan_revision,
      state: r.state,
      ownerApprovalRef: r.owner_approval_ref || undefined,
      createdAt: new Date(r.created_at).getTime(),
      updatedAt: new Date(r.updated_at).getTime(),
    }));
  }

  public savePlanRevision(rev: PlanRevision): void {
    const parsed = PlanRevisionSchema.parse(rev);
    this.db.prepare(`
      INSERT OR REPLACE INTO goal_plan_revisions (
        id, goal_id, revision, discovery_digest, document_sha256, status, milestones_json, created_at, approved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      parsed.id,
      parsed.goalId,
      parsed.revision,
      parsed.discoveryDigest,
      parsed.documentSha256,
      parsed.status,
      parsed.milestonesJson,
      new Date(parsed.createdAt).toISOString(),
      parsed.approvedAt ? new Date(parsed.approvedAt).toISOString() : null
    );
  }

  public getPlanRevisions(goalId: string): PlanRevision[] {
    const rows = this.db.prepare('SELECT * FROM goal_plan_revisions WHERE goal_id = ? ORDER BY revision ASC').all(goalId) as any[];
    return rows.map((r) => ({
      id: r.id,
      goalId: r.goal_id,
      revision: r.revision,
      discoveryDigest: r.discovery_digest,
      documentSha256: r.document_sha256,
      status: r.status,
      milestonesJson: r.milestones_json,
      createdAt: new Date(r.created_at).getTime(),
      approvedAt: r.approved_at ? new Date(r.approved_at).getTime() : undefined,
    }));
  }

  public saveMilestones(milestones: Milestone[]): void {
    this.transaction(() => {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO milestones (
          id, goal_id, plan_revision, order_idx, title, depends_on_json, state, evidence_refs_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const m of milestones) {
        const parsed = MilestoneSchema.parse(m);
        stmt.run(
          parsed.id,
          parsed.goalId,
          parsed.planRevision,
          parsed.order,
          parsed.title,
          JSON.stringify(parsed.dependsOn || []),
          parsed.state,
          JSON.stringify(parsed.evidenceRefs || []),
          new Date(parsed.createdAt).toISOString(),
          new Date(parsed.updatedAt).toISOString()
        );
      }
    });
  }

  public getMilestones(goalId: string): Milestone[] {
    const rows = this.db.prepare('SELECT * FROM milestones WHERE goal_id = ? ORDER BY order_idx ASC').all(goalId) as any[];
    return rows.map((r) => ({
      id: r.id,
      goalId: r.goal_id,
      planRevision: r.plan_revision,
      order: r.order_idx,
      title: r.title,
      dependsOn: JSON.parse(r.depends_on_json || '[]'),
      state: r.state,
      evidenceRefs: JSON.parse(r.evidence_refs_json || '[]'),
      createdAt: new Date(r.created_at).getTime(),
      updatedAt: new Date(r.updated_at).getTime(),
    }));
  }

  // --- V4 Permissions & Handoff ---
  public savePermissionGrant(grant: PermissionGrant): void {
    const parsed = PermissionGrantSchema.parse(grant);
    this.db.prepare(`
      INSERT OR REPLACE INTO permission_grants (
        id, actor, action, repo, branch, payload_digest, single_use, used, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      parsed.id,
      parsed.actor,
      parsed.action,
      parsed.repo || null,
      parsed.branch || null,
      parsed.payloadDigest,
      parsed.singleUse ? 1 : 0,
      parsed.used ? 1 : 0,
      new Date(parsed.expiresAt).toISOString(),
      new Date(parsed.createdAt).toISOString()
    );
  }

  public consumePermissionGrant(id: string, payloadDigest: string): boolean {
    const grant = this.db.prepare('SELECT * FROM permission_grants WHERE id = ?').get(id) as any;
    if (!grant) return false;
    if (grant.used === 1) return false;
    if (grant.payload_digest.toLowerCase() !== payloadDigest.toLowerCase()) return false;
    if (new Date(grant.expires_at).getTime() < Date.now()) return false;

    const res = this.db.prepare('UPDATE permission_grants SET used = 1 WHERE id = ? AND used = 0').run(id);
    return res.changes > 0;
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
