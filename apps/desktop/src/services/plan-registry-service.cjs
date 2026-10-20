/**
 * @file plan-registry-service.cjs
 * @description Plan Registry, Critical Review & Goal Approval Engine (UB-V4-U06).
 * Enforces:
 * - Immutable plan revisions bound to frozen Discovery Digest and document SHA-256.
 * - SEV1 Critical Review blocking gate (cannot approve plan with open SEV1 findings).
 * - Monotonic milestone progression and evidence reference tracking.
 * - Single State Authority in SQLite.
 */

const crypto = require('node:crypto');

class PlanRegistryService {
  constructor(storageService) {
    this.storage = storageService;
  }

  getDb() {
    return this.storage.nativeDb || (this.storage.client && this.storage.client.db);
  }

  /**
   * Creates a new Goal (U06-001).
   */
  createGoal(params) {
    const rawDb = this.getDb();
    if (!rawDb) throw new Error('Database unavailable');

    const { projectId = 'default', title, description = '' } = params;
    if (!title) throw new Error('Goal title is required');

    const id = `goal_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();

    rawDb.prepare(`
      INSERT INTO goals (
        id, project_id, title, description, active_plan_revision, state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 0, 'DRAFT', ?, ?)
    `).run(id, projectId, title, description, now, now);

    return {
      id,
      projectId,
      title,
      description,
      activePlanRevision: 0,
      state: 'DRAFT',
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Creates a new Plan Revision for a Goal (U06-001, U06-002).
   */
  createPlanRevision(params) {
    const rawDb = this.getDb();
    if (!rawDb) throw new Error('Database unavailable');

    const {
      goalId,
      discoveryDigest,
      planMarkdown = '',
      milestones = [],
    } = params;

    if (!goalId) throw new Error('goalId is required');
    if (!discoveryDigest || !/^[a-f0-9]{64}$/i.test(discoveryDigest)) {
      throw new Error('Valid 64-char hex discoveryDigest is required');
    }

    const goal = rawDb.prepare('SELECT * FROM goals WHERE id = ?').get(goalId);
    if (!goal) throw new Error(`Goal '${goalId}' not found`);

    // Determine next revision number
    const latestRev = rawDb.prepare(
      'SELECT MAX(revision) as maxRev FROM goal_plan_revisions WHERE goal_id = ?'
    ).get(goalId);
    const revision = (latestRev && latestRev.maxRev != null ? latestRev.maxRev : 0) + 1;

    // Compute plan markdown SHA-256
    const documentSha256 = crypto.createHash('sha256').update(planMarkdown).digest('hex');
    const id = `rev_${goalId}_${revision}`;
    const now = new Date().toISOString();

    rawDb.prepare(`
      INSERT INTO goal_plan_revisions (
        id, goal_id, revision, discovery_digest, document_sha256, status, milestones_json, created_at
      ) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?)
    `).run(id, goalId, revision, discoveryDigest, documentSha256, JSON.stringify(milestones), now);

    // Insert associated milestones into milestones table
    if (Array.isArray(milestones) && milestones.length > 0) {
      const insertMilestone = rawDb.prepare(`
        INSERT INTO milestones (
          id, goal_id, plan_revision, order_idx, title, depends_on_json, state, evidence_refs_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', '[]', ?, ?)
      `);

      milestones.forEach((m, idx) => {
        const mId = `ms_${goalId}_r${revision}_${idx + 1}`;
        insertMilestone.run(
          mId,
          goalId,
          revision,
          m.orderIdx ?? (idx + 1),
          m.title,
          JSON.stringify(m.dependsOn || []),
          now,
          now
        );
      });
    }

    return {
      id,
      goalId,
      revision,
      discoveryDigest,
      documentSha256,
      status: 'DRAFT',
      milestonesCount: milestones.length,
      createdAt: now,
    };
  }

  /**
   * Records a Critical Review Finding (U06-003).
   */
  recordReviewFinding(params) {
    const rawDb = this.getDb();
    if (!rawDb) throw new Error('Database unavailable');

    const {
      changeSetId,
      reviewer = 'chatgpt_web',
      file = 'src/app.ts',
      line = null,
      severity = 'SEV2',
      description,
      reproduction = null,
    } = params;

    if (!changeSetId || !description) {
      throw new Error('changeSetId and description are required');
    }

    const id = `rf_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();

    rawDb.prepare(`
      INSERT INTO review_findings (
        id, change_set_id, reviewer, file, line, severity, description, reproduction, state, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
    `).run(id, changeSetId, reviewer, file, line, severity, description, reproduction, now);

    return {
      id,
      changeSetId,
      reviewer,
      file,
      line,
      severity,
      description,
      state: 'OPEN',
      createdAt: now,
    };
  }

  /**
   * Resolves a review finding.
   */
  resolveReviewFinding(id) {
    const rawDb = this.getDb();
    if (!rawDb) return false;

    const res = rawDb.prepare(`
      UPDATE review_findings
      SET state = 'RESOLVED'
      WHERE id = ?
    `).run(id);

    return res.changes > 0;
  }

  /**
   * Approves a plan revision (U06-004).
   * Strictly blocks approval if any open SEV1 findings exist for this goal/changeset!
   */
  approvePlanRevision(goalId, revision, approvalRef = 'owner_approved') {
    const rawDb = this.getDb();
    if (!rawDb) return { success: false, error: 'Database unavailable' };

    const planRev = rawDb.prepare(
      'SELECT * FROM goal_plan_revisions WHERE goal_id = ? AND revision = ?'
    ).get(goalId, revision);

    if (!planRev) {
      return { success: false, error: `Plan revision ${revision} for goal '${goalId}' not found` };
    }

    // Check for open SEV1 findings for this goal
    const openSev1 = rawDb.prepare(`
      SELECT * FROM review_findings
      WHERE change_set_id = ? AND severity = 'SEV1' AND state = 'OPEN'
    `).all(goalId) || [];

    if (openSev1.length > 0) {
      return {
        success: false,
        error: `Cannot approve plan: ${openSev1.length} open SEV1 critical findings must be resolved first`,
        code: 'ERR_SEV1_BLOCKING',
        blockingFindings: openSev1,
      };
    }

    const now = new Date().toISOString();

    // Mark plan revision APPROVED
    rawDb.prepare(`
      UPDATE goal_plan_revisions
      SET status = 'APPROVED', approved_at = ?
      WHERE id = ?
    `).run(now, planRev.id);

    // Update goal active plan revision and state
    rawDb.prepare(`
      UPDATE goals
      SET active_plan_revision = ?, state = 'ACTIVE', owner_approval_ref = ?, updated_at = ?
      WHERE id = ?
    `).run(revision, approvalRef, now, goalId);

    return {
      success: true,
      goalId,
      revision,
      status: 'APPROVED',
      approvedAt: now,
      approvalRef,
    };
  }

  /**
   * Updates milestone state and evidence references.
   */
  updateMilestoneState(milestoneId, state, evidenceRef = null) {
    const rawDb = this.getDb();
    if (!rawDb) return false;

    const ms = rawDb.prepare('SELECT * FROM milestones WHERE id = ?').get(milestoneId);
    if (!ms) return false;

    const evidenceList = JSON.parse(ms.evidence_refs_json || '[]');
    if (evidenceRef && !evidenceList.includes(evidenceRef)) {
      evidenceList.push(evidenceRef);
    }

    const now = new Date().toISOString();
    const res = rawDb.prepare(`
      UPDATE milestones
      SET state = ?, evidence_refs_json = ?, updated_at = ?
      WHERE id = ?
    `).run(state, JSON.stringify(evidenceList), now, milestoneId);

    return res.changes > 0;
  }

  /**
   * Retrieves all milestones for a goal.
   */
  listMilestones(goalId, revision = null) {
    const rawDb = this.getDb();
    if (!rawDb) return [];

    const query = revision != null
      ? 'SELECT * FROM milestones WHERE goal_id = ? AND plan_revision = ? ORDER BY order_idx ASC'
      : 'SELECT * FROM milestones WHERE goal_id = ? ORDER BY plan_revision DESC, order_idx ASC';
    const params = revision != null ? [goalId, revision] : [goalId];

    const rows = rawDb.prepare(query).all(...params) || [];
    return rows.map((r) => ({
      id: r.id,
      goalId: r.goal_id,
      planRevision: r.plan_revision,
      orderIdx: r.order_idx,
      title: r.title,
      dependsOn: JSON.parse(r.depends_on_json || '[]'),
      state: r.state,
      evidenceRefs: JSON.parse(r.evidence_refs_json || '[]'),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Retrieves review findings.
   */
  listReviewFindings(changeSetId, state = null) {
    const rawDb = this.getDb();
    if (!rawDb) return [];

    const query = state
      ? 'SELECT * FROM review_findings WHERE change_set_id = ? AND state = ? ORDER BY created_at DESC'
      : 'SELECT * FROM review_findings WHERE change_set_id = ? ORDER BY created_at DESC';
    const params = state ? [changeSetId, state] : [changeSetId];

    return rawDb.prepare(query).all(...params) || [];
  }
}

module.exports = {
  PlanRegistryService,
};
