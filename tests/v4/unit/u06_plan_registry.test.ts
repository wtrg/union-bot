import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
// @ts-ignore
import { PlanRegistryService } from '../../../apps/desktop/src/services/plan-registry-service.cjs';
import { runMigrations } from '../../../packages/storage/src/migrations.ts';

describe('UB-V4-U06: /work: Plan Registry, Critical Review & Goal Approval', () => {
  function setupTestDb() {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);
    return { nativeDb: db };
  }

  const VALID_DIGEST = 'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e';

  it('U06-001: creates a Goal and initializes plan revisions with frozen discovery digest', () => {
    const storage = setupTestDb();
    const service = new PlanRegistryService(storage);

    const goal = service.createGoal({
      projectId: 'proj_plan',
      title: 'Automated Test Runner Architecture',
      description: 'Implement distributed runner for Union Bot',
    });

    assert.ok(goal.id);
    assert.equal(goal.state, 'DRAFT');
    assert.equal(goal.activePlanRevision, 0);

    const planRev = service.createPlanRevision({
      goalId: goal.id,
      discoveryDigest: VALID_DIGEST,
      planMarkdown: '# Implementation Plan v1\nStep 1: Core setup\nStep 2: Execution',
      milestones: [
        { title: 'Setup Core', orderIdx: 1, dependsOn: [] },
        { title: 'Execution Engine', orderIdx: 2, dependsOn: ['Setup Core'] },
      ],
    });

    assert.equal(planRev.revision, 1);
    assert.equal(planRev.discoveryDigest, VALID_DIGEST);
    assert.equal(planRev.status, 'DRAFT');
    assert.ok(planRev.documentSha256);

    const milestones = service.listMilestones(goal.id, 1);
    assert.equal(milestones.length, 2);
    assert.equal(milestones[0].title, 'Setup Core');
    assert.equal(milestones[0].state, 'PENDING');
  });

  it('U06-002: auto-increments revision numbers for subsequent revisions', () => {
    const storage = setupTestDb();
    const service = new PlanRegistryService(storage);

    const goal = service.createGoal({
      projectId: 'proj_plan_revs',
      title: 'Multi-revision Goal',
    });

    const rev1 = service.createPlanRevision({
      goalId: goal.id,
      discoveryDigest: VALID_DIGEST,
      planMarkdown: 'Plan Rev 1',
    });
    assert.equal(rev1.revision, 1);

    const rev2 = service.createPlanRevision({
      goalId: goal.id,
      discoveryDigest: VALID_DIGEST,
      planMarkdown: 'Plan Rev 2 with improvements',
    });
    assert.equal(rev2.revision, 2);
  });

  it('U06-003 & U06-004: blocks plan approval if open SEV1 critical findings exist', () => {
    const storage = setupTestDb();
    const service = new PlanRegistryService(storage);

    const goal = service.createGoal({
      projectId: 'proj_review_block',
      title: 'Production Migration',
    });

    const rev = service.createPlanRevision({
      goalId: goal.id,
      discoveryDigest: VALID_DIGEST,
      planMarkdown: '# Production Migration Plan',
    });

    // Record an open SEV1 Critical Finding (e.g. data loss risk)
    const finding = service.recordReviewFinding({
      changeSetId: goal.id,
      reviewer: 'chatgpt_web',
      severity: 'SEV1',
      description: 'Data loss risk: database migration lacks backward compatibility fallback',
    });
    assert.ok(finding.id);
    assert.equal(finding.severity, 'SEV1');

    // Attempting to approve plan MUST fail closed
    const approveAttempt = service.approvePlanRevision(goal.id, rev.revision);
    assert.equal(approveAttempt.success, false);
    assert.equal(approveAttempt.code, 'ERR_SEV1_BLOCKING');
    assert.ok(approveAttempt.error?.includes('open SEV1 critical findings'));

    // Resolve the SEV1 finding
    const resolveRes = service.resolveReviewFinding(finding.id);
    assert.equal(resolveRes, true);

    // Now approval SUCCEEDS!
    const approveSuccess = service.approvePlanRevision(goal.id, rev.revision, 'po_signed_off');
    assert.equal(approveSuccess.success, true);
    assert.equal(approveSuccess.status, 'APPROVED');

    // Goal is now ACTIVE with activePlanRevision = 1
    const rawDb = storage.nativeDb;
    const updatedGoal = rawDb.prepare('SELECT * FROM goals WHERE id = ?').get(goal.id) as any;
    assert.ok(updatedGoal);
    assert.equal(updatedGoal.state, 'ACTIVE');
    assert.equal(updatedGoal.active_plan_revision, 1);
    assert.equal(updatedGoal.owner_approval_ref, 'po_signed_off');
  });

  it('U06-005: updates milestone state and appends evidence references', () => {
    const storage = setupTestDb();
    const service = new PlanRegistryService(storage);

    const goal = service.createGoal({
      projectId: 'proj_milestone',
      title: 'Milestone Execution Goal',
    });

    service.createPlanRevision({
      goalId: goal.id,
      discoveryDigest: VALID_DIGEST,
      milestones: [{ title: 'Implement Auth', orderIdx: 1 }],
    });

    const milestones = service.listMilestones(goal.id);
    assert.equal(milestones.length, 1);
    const mId = milestones[0].id;

    // Transition to IN_PROGRESS
    service.updateMilestoneState(mId, 'IN_PROGRESS', 'pr_123');
    let updated = service.listMilestones(goal.id)[0];
    assert.equal(updated.state, 'IN_PROGRESS');
    assert.deepEqual(updated.evidenceRefs, ['pr_123']);

    // Transition to COMPLETED with additional evidence
    service.updateMilestoneState(mId, 'COMPLETED', 'commit_abc');
    updated = service.listMilestones(goal.id)[0];
    assert.equal(updated.state, 'COMPLETED');
    assert.deepEqual(updated.evidenceRefs, ['pr_123', 'commit_abc']);
  });
});
