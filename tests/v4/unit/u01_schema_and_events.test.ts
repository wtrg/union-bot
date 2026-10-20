import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StorageEngine } from '../../../packages/storage/src/storage-engine.ts';
import {
  GoalSchema,
  PlanRevisionSchema,
  RequirementFactSchema,
  OpenQuestionSchema,
  ActivityEventSchema,
  DeliveryAttemptSchema,
  PermissionGrantSchema,
} from '../../../packages/protocol/src/index.ts';

describe('UB-V4-U01: Core Schemas, Event Authority & Database Operations', () => {
  it('validates GoalSchema and rejects invalid state or missing title', () => {
    assert.throws(() => {
      GoalSchema.parse({
        id: 'goal-1',
        projectId: 'p-1',
        title: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const validGoal = GoalSchema.parse({
      id: 'goal-1',
      projectId: 'p-1',
      title: 'Build Autonomous Video Operating System',
      description: 'Goal-driven workflow execution',
      activePlanRevision: 1,
      state: 'DRAFT',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    assert.equal(validGoal.title, 'Build Autonomous Video Operating System');
  });

  it('validates PlanRevisionSchema with strict SHA256 digests', () => {
    assert.throws(() => {
      PlanRevisionSchema.parse({
        id: 'rev-1',
        goalId: 'goal-1',
        revision: 1,
        discoveryDigest: 'not-a-sha256',
        documentSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        createdAt: Date.now(),
      });
    });

    const validRev = PlanRevisionSchema.parse({
      id: 'rev-1',
      goalId: 'goal-1',
      revision: 1,
      discoveryDigest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      documentSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      status: 'APPROVED',
      milestonesJson: JSON.stringify([{ id: 'm-1', title: 'Phase 1' }]),
      createdAt: Date.now(),
      approvedAt: Date.now(),
    });
    assert.equal(validRev.status, 'APPROVED');
  });

  it('stores and retrieves requirement facts with confirmation history', () => {
    const storage = new StorageEngine();
    storage.createProject('proj-alpha', 'Project Alpha');

    const now = Date.now();
    storage.saveRequirementFact({
      id: 'fact-1',
      discoveryId: 'disc-1',
      projectId: 'proj-alpha',
      key: 'budget',
      value: '0 VND strict',
      sourceTurnRef: 'turn-user-1',
      confidence: 1.0,
      state: 'CONFIRMED',
      confirmedBy: 'user-po',
      createdAt: now,
      updatedAt: now,
    });

    const facts = storage.getRequirementFacts('disc-1');
    assert.equal(facts.length, 1);
    assert.equal(facts[0].key, 'budget');
    assert.equal(facts[0].value, '0 VND strict');
    assert.equal(facts[0].state, 'CONFIRMED');
    assert.equal(facts[0].confirmedBy, 'user-po');
  });

  it('stores open questions and resolves them', () => {
    const storage = new StorageEngine();
    const now = Date.now();

    storage.saveOpenQuestion({
      id: 'q-1',
      discoveryId: 'disc-1',
      requirementKey: 'targetPlatform',
      question: 'Which Windows versions are supported?',
      priority: 'CRITICAL',
      blocking: true,
      resolved: false,
      askedAt: now,
    });

    let questions = storage.getOpenQuestions('disc-1');
    assert.equal(questions.length, 1);
    assert.equal(questions[0].resolved, false);
    assert.equal(questions[0].blocking, true);

    storage.saveOpenQuestion({
      ...questions[0],
      resolved: true,
      resolution: 'Windows 10 and 11 x64',
      resolvedAt: now + 1000,
    });

    questions = storage.getOpenQuestions('disc-1');
    assert.equal(questions.length, 1);
    assert.equal(questions[0].resolved, true);
    assert.equal(questions[0].resolution, 'Windows 10 and 11 x64');
  });

  it('records immutable ActivityEvent stream and queries by project and goal', () => {
    const storage = new StorageEngine();
    const now = Date.now();

    storage.recordActivityEvent({
      id: 'act-1',
      projectId: 'proj-alpha',
      goalId: 'goal-1',
      kind: 'PLAN_APPROVED',
      summary: 'PO has approved Plan Revision 1',
      actor: { provider: 'chatgpt', role: 'ARCHITECT' },
      source: { eventId: 'evt-101', commitSHA: 'd4c87ea7705cf7276628f214297952b724b49686' },
      references: ['milestone-1', 'milestone-2'],
      receiptState: 'VERIFIED',
      createdAt: now,
    });

    const events = storage.getActivityEvents('proj-alpha', 'goal-1');
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'PLAN_APPROVED');
    assert.equal(events[0].summary, 'PO has approved Plan Revision 1');
    assert.equal(events[0].actor.provider, 'chatgpt');
    assert.equal(events[0].references.length, 2);
  });

  it('enforces single-use permission grants bound to payload digest', () => {
    const storage = new StorageEngine();
    const now = Date.now();
    const digest = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    storage.savePermissionGrant({
      id: 'grant-push-1',
      actor: 'antigravity',
      action: 'GIT_PUSH',
      repo: 'wtrg/union-bot',
      branch: 'feature/union-bot-v4-autonomous',
      payloadDigest: digest,
      singleUse: true,
      used: false,
      expiresAt: now + 3600000,
      createdAt: now,
    });

    // Mismatched digest cannot consume grant
    const badConsume = storage.consumePermissionGrant('grant-push-1', '0000000000000000000000000000000000000000000000000000000000000000');
    assert.equal(badConsume, false);

    // Matching digest consumes grant
    const firstConsume = storage.consumePermissionGrant('grant-push-1', digest);
    assert.equal(firstConsume, true);

    // Replay attack: cannot consume again
    const replayConsume = storage.consumePermissionGrant('grant-push-1', digest);
    assert.equal(replayConsume, false);
  });
});
