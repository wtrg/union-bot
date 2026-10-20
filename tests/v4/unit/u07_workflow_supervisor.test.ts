import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
// @ts-ignore
import { WorkflowSupervisor } from '../../../apps/desktop/src/services/workflow-supervisor.cjs';
// @ts-ignore
import { PlanRegistryService } from '../../../apps/desktop/src/services/plan-registry-service.cjs';
import { runMigrations } from '../../../packages/storage/src/migrations.ts';

describe('UB-V4-U07: WorkflowSupervisor: Continuous Durable Orchestration', () => {
  function setupTestDb() {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);
    return { nativeDb: db };
  }

  const VALID_DIGEST = 'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e';

  it('U07-001: manages execution leases and prevents split-brain concurrency', () => {
    const storage = setupTestDb();
    const supervisor = new WorkflowSupervisor({ storage, leaseDurationMs: 10000 });

    const l1 = supervisor.acquireLease('goal_001', 'worker_a');
    assert.equal(l1.success, true);
    assert.ok(l1.leaseToken);

    // Worker B tries to acquire lease on same goal -> rejected
    const l2 = supervisor.acquireLease('goal_001', 'worker_b');
    assert.equal(l2.success, false);
    assert.equal(l2.code, 'ERR_LEASE_CONFLICT');

    // Worker A renews lease -> succeeds
    const renew = supervisor.renewLease('goal_001', l1.leaseToken);
    assert.equal(renew.success, true);

    // Release lease
    const released = supervisor.releaseLease('goal_001', l1.leaseToken);
    assert.equal(released, true);

    // Worker B can now acquire lease
    const l3 = supervisor.acquireLease('goal_001', 'worker_b');
    assert.equal(l3.success, true);
  });

  it('U07-002 & U07-003: progresses milestones sequentially and marks goal COMPLETED when done', () => {
    const storage = setupTestDb();
    const planRegistry = new PlanRegistryService(storage);
    const supervisor = new WorkflowSupervisor({ storage, planRegistry });

    // Setup Goal and approved plan revision
    const goal = planRegistry.createGoal({
      projectId: 'proj_orchestrate',
      title: 'Autonomous Milestone Pipeline',
    });

    planRegistry.createPlanRevision({
      goalId: goal.id,
      discoveryDigest: VALID_DIGEST,
      milestones: [
        { title: 'Step 1: Setup', orderIdx: 1 },
        { title: 'Step 2: Build', orderIdx: 2 },
      ],
    });

    // Approve plan revision so goal becomes ACTIVE
    planRegistry.approvePlanRevision(goal.id, 1, 'po_approved');

    // Pick up first milestone
    const p1 = supervisor.progressNextMilestone(goal.id, 'worker_auto');
    assert.equal(p1.success, true);
    assert.equal(p1.goalCompleted, false);
    assert.ok(p1.milestone);
    assert.equal(p1.milestone.title, 'Step 1: Setup');
    assert.equal(p1.milestone.state, 'IN_PROGRESS');

    // Complete first milestone with evidence
    const c1 = supervisor.completeMilestone(goal.id, p1.milestone.id, 'commit_setup_123');
    assert.equal(c1.success, true);
    assert.equal(c1.state, 'COMPLETED');

    // Pick up second milestone
    const p2 = supervisor.progressNextMilestone(goal.id, 'worker_auto');
    assert.equal(p2.success, true);
    assert.ok(p2.milestone);
    assert.equal(p2.milestone.title, 'Step 2: Build');

    // Complete second milestone
    const c2 = supervisor.completeMilestone(goal.id, p2.milestone.id, 'commit_build_456');
    assert.equal(c2.success, true);

    // Next progression detects all milestones complete -> Goal COMPLETED!
    const p3 = supervisor.progressNextMilestone(goal.id, 'worker_auto');
    assert.equal(p3.success, true);
    assert.equal(p3.goalCompleted, true);

    const updatedGoal = storage.nativeDb.prepare('SELECT * FROM goals WHERE id = ?').get(goal.id) as any;
    assert.equal(updatedGoal.state, 'COMPLETED');
  });

  it('U07-004: supports /pause and /resume workflow controls', () => {
    const storage = setupTestDb();
    const supervisor = new WorkflowSupervisor({ storage });

    supervisor.pauseWorkflow();
    assert.equal(supervisor.getWorkflowStatus().state, 'PAUSED');

    const leaseRes = supervisor.acquireLease('goal_paused', 'worker_x');
    assert.equal(leaseRes.success, false);
    assert.equal(leaseRes.code, 'ERR_WORKFLOW_HALTED');

    supervisor.resumeWorkflow();
    assert.equal(supervisor.getWorkflowStatus().state, 'RUNNING');

    const leaseRes2 = supervisor.acquireLease('goal_resumed', 'worker_x');
    assert.equal(leaseRes2.success, true);
  });

  it('U07-005: recovers dangling goals with crashed/stuck in-progress milestones', () => {
    const storage = setupTestDb();
    const planRegistry = new PlanRegistryService(storage);
    const supervisor = new WorkflowSupervisor({ storage, planRegistry });

    const goal = planRegistry.createGoal({
      projectId: 'proj_crash',
      title: 'Crash Recovery Test',
    });

    planRegistry.createPlanRevision({
      goalId: goal.id,
      discoveryDigest: VALID_DIGEST,
      milestones: [{ title: 'Crashy Task', orderIdx: 1 }],
    });

    planRegistry.approvePlanRevision(goal.id, 1);

    // Simulate crash: milestone was set to IN_PROGRESS directly in DB without active lease
    const ms = planRegistry.listMilestones(goal.id)[0];
    storage.nativeDb.prepare("UPDATE milestones SET state = 'IN_PROGRESS' WHERE id = ?").run(ms.id);

    // Run recovery
    const recovery = supervisor.recoverDanglingGoals('proj_crash');
    assert.equal(recovery.recoveredCount, 1);

    // Milestone should be reset to PENDING so runner can retry safely
    const recoveredMs = planRegistry.listMilestones(goal.id)[0];
    assert.equal(recoveredMs.state, 'PENDING');
  });
});
