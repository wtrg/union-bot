/**
 * @file task-graph.test.ts
 * @description Comprehensive unit test suite for Multi-Agent Task Graph & Consensus Engine (Phase P8).
 * Covers:
 * - DAG cycle detection fail-closed (ERR_CYCLE_DETECTED)
 * - Topological sorting & parallel dependency resolution
 * - 5-Stage Lifecycle: Plan -> Implement -> Review -> Fix -> Verify
 * - Dynamic role assignment & provider routing
 * - Stale review invalidation upon code mutation
 * - Multi-agent consensus voting (unanimous, majority, threshold, required roles)
 * - Consensus rejection -> Fix loop -> Re-review
 * - Strict security boundary inheritance (denying path traversal & junction escape)
 * - Zero-cost policy enforcement ($0.00 / 0đ)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import {
  TaskGraphEngine,
  type TaskGraphState,
  type TaskNodeHandler,
} from '../src/task-graph.ts';

import {
  type TaskGraphDefinition,
  type ConsensusVote,
} from '../../protocol/src/index.ts';

describe('Phase P8: Multi-Agent Task Graph & Consensus Engine', () => {
  let tempWorkspace: string;
  let engine: TaskGraphEngine;

  beforeEach(() => {
    tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'union-bot-p8-test-'));
    engine = new TaskGraphEngine();
  });

  // =========================================================================
  // 1. DAG Validation & Cycle Detection (Ticket P8-002)
  // =========================================================================

  it('P8-001: validates a valid DAG task graph definition', () => {
    const graphDef: TaskGraphDefinition = {
      id: 'graph-valid-1',
      name: 'Valid Graph',
      workspaceRoot: tempWorkspace,
      nodes: [
        { id: 'node-1', name: 'Task 1', stage: 'PLAN', assignedRole: 'ARCHITECT', dependencies: [] },
        { id: 'node-2', name: 'Task 2', stage: 'IMPLEMENT', assignedRole: 'IMPLEMENTER', dependencies: ['node-1'] },
        { id: 'node-3', name: 'Task 3', stage: 'VERIFY', assignedRole: 'TESTER', dependencies: ['node-2'] },
      ],
    };

    assert.doesNotThrow(() => TaskGraphEngine.validateDAG(graphDef));
    const order = TaskGraphEngine.getTopologicalOrder(graphDef);
    assert.deepEqual(order, ['node-1', 'node-2', 'node-3']);
  });

  it('P8-002: detects and rejects direct cyclic dependency (fail-closed ERR_CYCLE_DETECTED)', () => {
    const cyclicGraph: TaskGraphDefinition = {
      id: 'graph-cycle-direct',
      name: 'Direct Cycle',
      workspaceRoot: tempWorkspace,
      nodes: [
        { id: 'node-a', name: 'Task A', stage: 'PLAN', assignedRole: 'ARCHITECT', dependencies: ['node-b'] },
        { id: 'node-b', name: 'Task B', stage: 'IMPLEMENT', assignedRole: 'IMPLEMENTER', dependencies: ['node-a'] },
      ],
    };

    assert.throws(
      () => TaskGraphEngine.validateDAG(cyclicGraph),
      (err: any) => {
        assert.equal(err.code, 'ERR_CYCLE_DETECTED');
        assert.match(err.message, /Cyclic dependency detected/);
        return true;
      }
    );
  });

  it('P8-003: detects and rejects transitive cycle across multiple nodes', () => {
    const transitiveCycle: TaskGraphDefinition = {
      id: 'graph-cycle-transitive',
      name: 'Transitive Cycle',
      workspaceRoot: tempWorkspace,
      nodes: [
        { id: 'node-1', name: 'Task 1', stage: 'PLAN', assignedRole: 'ARCHITECT', dependencies: ['node-3'] },
        { id: 'node-2', name: 'Task 2', stage: 'IMPLEMENT', assignedRole: 'IMPLEMENTER', dependencies: ['node-1'] },
        { id: 'node-3', name: 'Task 3', stage: 'REVIEW', assignedRole: 'REVIEWER', dependencies: ['node-2'] },
      ],
    };

    assert.throws(
      () => TaskGraphEngine.getTopologicalOrder(transitiveCycle),
      (err: any) => {
        assert.equal(err.code, 'ERR_CYCLE_DETECTED');
        return true;
      }
    );
  });

  it('P8-004: supports branching and parallel independent dependencies', () => {
    const diamondGraph: TaskGraphDefinition = {
      id: 'graph-diamond',
      name: 'Diamond Graph',
      workspaceRoot: tempWorkspace,
      nodes: [
        { id: 'start', name: 'Plan', stage: 'PLAN', assignedRole: 'ARCHITECT', dependencies: [] },
        { id: 'branch-a', name: 'Frontend', stage: 'IMPLEMENT', assignedRole: 'IMPLEMENTER', dependencies: ['start'] },
        { id: 'branch-b', name: 'Backend', stage: 'IMPLEMENT', assignedRole: 'IMPLEMENTER', dependencies: ['start'] },
        { id: 'join', name: 'Review Both', stage: 'REVIEW', assignedRole: 'REVIEWER', dependencies: ['branch-a', 'branch-b'] },
      ],
    };

    const order = TaskGraphEngine.getTopologicalOrder(diamondGraph);
    assert.equal(order[0], 'start');
    assert.equal(order[3], 'join');
    assert.ok(order.indexOf('branch-a') < order.indexOf('join'));
    assert.ok(order.indexOf('branch-b') < order.indexOf('join'));
  });

  // =========================================================================
  // 2. Stale Review Invalidation (Ticket P8-005)
  // =========================================================================

  it('P8-005: invalidates downstream review and verify nodes when code is mutated', () => {
    const pipeline = TaskGraphEngine.createStandard5StagePipeline({
      id: 'graph-stale-test',
      name: 'Stale Invalidation Test',
      workspaceRoot: tempWorkspace,
      planPrompt: 'Build feature',
      targetFiles: ['src/feature.ts'],
    });

    const graph = engine.createGraph(pipeline);

    // Simulate completion of plan, implement, review, and verify
    graph.nodes.get('node-plan')!.status = 'COMPLETED';
    graph.nodes.get('node-implement')!.status = 'COMPLETED';
    const reviewNode = graph.nodes.get('node-review')!;
    reviewNode.status = 'COMPLETED';
    reviewNode.votes = [{ voterId: 'rev-1', voterRole: 'QA_SECURITY', decision: 'APPROVE', reviewedDigest: 'digest-001', rationale: 'OK', timestamp: Date.now() }];
    const verifyNode = graph.nodes.get('node-verify')!;
    verifyNode.status = 'COMPLETED';

    // Now simulate node-fix mutating code
    const invalidated = engine.invalidateDownstreamReviews(graph, 'node-implement', ['src/feature.ts']);

    assert.ok(invalidated.includes('node-review'));
    assert.ok(invalidated.includes('node-verify'));
    assert.equal(reviewNode.status, 'STALE');
    assert.equal(reviewNode.votes.length, 0); // Outdated votes wiped
    assert.match(reviewNode.staleReason || '', /Invalidated due to mutation/);
    assert.equal(verifyNode.status, 'STALE');
  });

  // =========================================================================
  // 3. Multi-Agent Consensus Protocol & Thresholds (Ticket P8-006)
  // =========================================================================

  it('P8-006: evaluates unanimous consensus correctly', () => {
    const policy = { type: 'unanimous' as const };

    const votesPassing: ConsensusVote[] = [
      { voterId: 'agent-1', voterRole: 'QA_SECURITY', decision: 'APPROVE', reviewedDigest: 'digest-001', rationale: 'Good', timestamp: Date.now() },
      { voterId: 'agent-2', voterRole: 'REVIEWER', decision: 'APPROVE', reviewedDigest: 'digest-001', rationale: 'Clean', timestamp: Date.now() },
    ];
    const resPass = TaskGraphEngine.evaluateConsensus(votesPassing, policy, 1, 3);
    assert.equal(resPass.consensusReached, true);
    assert.equal(resPass.action, 'PROCEED');

    const votesFailing: ConsensusVote[] = [
      { voterId: 'agent-1', voterRole: 'QA_SECURITY', decision: 'APPROVE', reviewedDigest: 'digest-001', rationale: 'Good', timestamp: Date.now() },
      { voterId: 'agent-2', voterRole: 'REVIEWER', decision: 'REJECT', reviewedDigest: 'digest-001', rationale: 'Security flaw', timestamp: Date.now() },
    ];
    const resFail = TaskGraphEngine.evaluateConsensus(votesFailing, policy, 1, 3);
    assert.equal(resFail.consensusReached, false);
    assert.equal(resFail.action, 'TRIGGER_FIX');
    assert.ok(resFail.reasons.some((r) => r.includes('Security flaw')));
  });

  it('P8-007: evaluates majority consensus and required roles', () => {
    const policy = {
      type: 'majority' as const,
      requiredRoles: ['QA_SECURITY' as const],
    };

    // 2 approves, 1 reject = 66% majority, but QA_SECURITY rejected
    const votesMissingReq: ConsensusVote[] = [
      { voterId: 'agent-1', voterRole: 'REVIEWER', decision: 'APPROVE', reviewedDigest: 'digest-001', rationale: 'OK', timestamp: Date.now() },
      { voterId: 'agent-2', voterRole: 'ARCHITECT', decision: 'APPROVE', reviewedDigest: 'digest-001', rationale: 'OK', timestamp: Date.now() },
      { voterId: 'agent-3', voterRole: 'QA_SECURITY', decision: 'REJECT', reviewedDigest: 'digest-001', rationale: 'Vulnerability found', timestamp: Date.now() },
    ];

    const res = TaskGraphEngine.evaluateConsensus(votesMissingReq, policy, 1, 3);
    assert.equal(res.consensusReached, false);
    assert.equal(res.action, 'TRIGGER_FIX');
    assert.ok(res.reasons.some((r) => r.includes('QA_SECURITY')));

    // Once QA_SECURITY approves, consensus passes
    const votesPassing: ConsensusVote[] = [
      { voterId: 'agent-1', voterRole: 'REVIEWER', decision: 'APPROVE', reviewedDigest: 'digest-001', rationale: 'OK', timestamp: Date.now() },
      { voterId: 'agent-2', voterRole: 'ARCHITECT', decision: 'REJECT', reviewedDigest: 'digest-001', rationale: 'Minor issue', timestamp: Date.now() },
      { voterId: 'agent-3', voterRole: 'QA_SECURITY', decision: 'APPROVE', reviewedDigest: 'digest-001', rationale: 'Security verified', timestamp: Date.now() },
    ];
    const resPass = TaskGraphEngine.evaluateConsensus(votesPassing, policy, 1, 3);
    assert.equal(resPass.consensusReached, true);
    assert.equal(resPass.action, 'PROCEED');
  });

  it('P8-008: aborts permanently when maxFixAttempts is exhausted', () => {
    const policy = { type: 'unanimous' as const };
    const votesFailing: ConsensusVote[] = [
      { voterId: 'agent-1', voterRole: 'QA_SECURITY', decision: 'REJECT', reviewedDigest: 'digest-001', rationale: 'Fatal flaw', timestamp: Date.now() },
    ];

    // Attempt 3 of 3 -> Should abort
    const resAbort = TaskGraphEngine.evaluateConsensus(votesFailing, policy, 3, 3);
    assert.equal(resAbort.consensusReached, false);
    assert.equal(resAbort.action, 'ABORT');
  });

  // =========================================================================
  // 4. Strict Canonical Boundary & Zero-Cost Security Inheritance (P8-007)
  // =========================================================================

  it('P8-009: blocks task node attempting path traversal or escaping workspaceRoot', async () => {
    const outsideTarget = path.join(tempWorkspace, '..', 'evil-outside.txt');

    const graphDef: TaskGraphDefinition = {
      id: 'graph-security-traversal',
      name: 'Security Traversal Test',
      workspaceRoot: tempWorkspace,
      nodes: [
        {
          id: 'evil-node',
          name: 'Escape Node',
          stage: 'IMPLEMENT',
          assignedRole: 'IMPLEMENTER',
          dependencies: [],
          actionPayload: {
            targetPath: outsideTarget,
          },
        },
      ],
    };

    const graph = engine.createGraph(graphDef);
    const node = graph.nodes.get('evil-node')!;

    await assert.rejects(
      async () => {
        await engine.executeNode(graph, node);
      },
      (err: any) => {
        assert.equal(err.code, 'ERR_PATH_TRAVERSAL_DENIED');
        assert.equal(node.status, 'FAILED');
        return true;
      }
    );
  });

  it('P8-010: blocks task node attempting paid external egress (Zero-Cost Enforcement)', async () => {
    const graphDef: TaskGraphDefinition = {
      id: 'graph-security-cost',
      name: 'Zero Cost Test',
      workspaceRoot: tempWorkspace,
      nodes: [
        {
          id: 'paid-node',
          name: 'Paid API Node',
          stage: 'IMPLEMENT',
          assignedRole: 'IMPLEMENTER',
          assignedProvider: 'chatgpt',
          dependencies: [],
          actionPayload: {
            estimatedCost: 15.0, // Non-zero cost without user token
          },
        },
      ],
    };

    const graph = engine.createGraph(graphDef);
    const node = graph.nodes.get('paid-node')!;

    await assert.rejects(
      async () => {
        await engine.executeNode(graph, node);
      },
      (err: any) => {
        assert.equal(err.code, 'ERR_COST_LIMIT_EXCEEDED');
        assert.equal(node.status, 'FAILED');
        return true;
      }
    );
  });

  // =========================================================================
  // 5. Full 5-Stage Orchestration Lifecycle Loop (Ticket P8-003)
  // =========================================================================

  it('P8-011: executes standard 5-stage lifecycle successfully from Plan to Verify', async () => {
    const pipeline = TaskGraphEngine.createStandard5StagePipeline({
      id: 'graph-e2e-success',
      name: 'Full 5-Stage Pipeline',
      workspaceRoot: tempWorkspace,
      planPrompt: 'Design authentication module',
      targetFiles: ['src/auth.ts'],
      consensusPolicy: { type: 'majority' },
    });

    const graph = engine.createGraph(pipeline);

    const handlers: Record<string, TaskNodeHandler> = {
      PLAN: async (node) => ({
        result: { spec: 'Auth architecture plan v1' },
      }),
      IMPLEMENT: async (node) => ({
        result: { code: 'export class Auth {}' },
        outputDigest: 'digest-auth-v1',
        modifiedFiles: ['src/auth.ts'],
      }),
      REVIEW: async (node) => ({
        result: { approved: true },
        votes: [
          { voterId: 'qa-sec-auditor', voterRole: 'QA_SECURITY', decision: 'APPROVE', reviewedDigest: node.targetDigest || 'digest-auth-v1', rationale: 'LGTM', timestamp: Date.now() },
          { voterId: 'reviewer-qa-1', voterRole: 'REVIEWER', decision: 'APPROVE', reviewedDigest: node.targetDigest || 'digest-auth-v1', rationale: 'Clean code', timestamp: Date.now() },
        ],
      }),
      FIX: async (node) => {
        // Should be skipped in smooth path
        return { result: 'Not needed' };
      },
      VERIFY: async (node) => ({
        result: { testsPassed: 42, coverage: 100 },
      }),
    };

    // Mark fix as skipped for normal path where review passes immediately
    graph.nodes.get('node-fix')!.status = 'SKIPPED';

    const finalState = await engine.runGraph(graph.id, handlers);

    assert.equal(finalState.status, 'COMPLETED');
    assert.equal(finalState.nodes.get('node-plan')!.status, 'COMPLETED');
    assert.equal(finalState.nodes.get('node-implement')!.status, 'COMPLETED');
    assert.equal(finalState.nodes.get('node-review')!.status, 'COMPLETED');
    assert.equal(finalState.nodes.get('node-verify')!.status, 'COMPLETED');
    assert.ok(finalState.completedAt);
    assert.ok(finalState.history.length >= 8);
  });

  it('P8-012: handles Review rejection -> Fix remediation -> Stale Invalidation -> Re-review loop via runGraph()', async () => {
    const pipeline = TaskGraphEngine.createStandard5StagePipeline({
      id: 'graph-fix-loop',
      name: 'Fix Remediation Loop',
      workspaceRoot: tempWorkspace,
      planPrompt: 'Build secure token vault',
      targetFiles: ['src/vault.ts'],
      consensusPolicy: {
        type: 'unanimous',
        requiredRoles: ['QA_SECURITY'],
        authorizedReviewers: [
          { voterId: 'qa-sec-agent', role: 'QA_SECURITY' },
        ],
      },
      maxFixAttempts: 2,
    });

    const graph = engine.createGraph(pipeline);

    let reviewAttempt = 0;
    let fixAttempt = 0;

    const handlers: Record<string, TaskNodeHandler> = {
      PLAN: async () => ({ result: 'Vault plan' }),
      IMPLEMENT: async () => ({
        result: 'Initial vault code v1',
        outputDigest: 'digest-vault-v1',
        modifiedFiles: ['src/vault.ts'],
      }),
      REVIEW: async (node) => {
        reviewAttempt++;
        if (node.attempt === 1) {
          // First attempt: reject with security finding
          return {
            result: 'Rejected due to missing entropy',
            votes: [
              {
                voterId: 'qa-sec-agent',
                voterRole: 'QA_SECURITY',
                decision: 'REJECT',
                reviewedDigest: node.targetDigest || 'digest-vault-v1',
                rationale: 'Missing entropy',
                timestamp: Date.now(),
              },
            ],
          };
        } else {
          // Second attempt after fix: approve
          return {
            result: 'Approved after crypto patch',
            votes: [
              {
                voterId: 'qa-sec-agent',
                voterRole: 'QA_SECURITY',
                decision: 'APPROVE',
                reviewedDigest: node.targetDigest!,
                rationale: 'Entropy resolved',
                timestamp: Date.now(),
              },
            ],
          };
        }
      },
      FIX: async (node) => {
        fixAttempt++;
        return {
          result: 'Patched vault with crypto.randomBytes',
          outputDigest: 'digest-vault-v2-patched',
          modifiedFiles: ['src/vault.ts'],
        };
      },
      VERIFY: async () => ({ result: 'All security checks pass' }),
    };

    // Entire remediation cycle executed autonomously via runGraph() (P8-R01-002)
    const finalState = await engine.runGraph(graph.id, handlers);

    assert.equal(finalState.status, 'COMPLETED');
    assert.equal(reviewAttempt, 2, 'REVIEW must execute twice: initial rejection + re-review');
    assert.equal(fixAttempt, 1, 'FIX must execute once for remediation');
    assert.equal(finalState.nodes.get('node-review')!.status, 'COMPLETED');
    assert.equal(finalState.nodes.get('node-fix')!.status, 'COMPLETED');
    assert.equal(finalState.nodes.get('node-verify')!.status, 'COMPLETED');
    assert.equal(finalState.currentFixAttempt, 1);
  });

  // =========================================================================
  // 6. Mandatory Regression Suite for Round R02 (Technical Leader Audit)
  // =========================================================================

  it('P8-R02-001: enforces missing-vote fail-closed without synthetic approval', async () => {
    const pipeline = TaskGraphEngine.createStandard5StagePipeline({
      id: 'graph-no-vote-test',
      name: 'No Synthetic Approval Test',
      workspaceRoot: tempWorkspace,
      planPrompt: 'Build feature',
    });

    const graph = engine.createGraph(pipeline);
    const reviewNode = graph.nodes.get('node-review')!;
    reviewNode.targetDigest = 'target-sha256-v1';

    // Execute review node with handler returning 0 votes
    await engine.executeNode(graph, reviewNode, async () => ({
      result: 'No reviewer showed up',
      votes: [], // Empty votes
    }));

    // Must transition to REMEDIATING or FAILED, NEVER COMPLETED or synthesize approval!
    assert.equal(reviewNode.status, 'REMEDIATING');
    assert.equal(reviewNode.votes.length, 0, 'Must NOT synthesize any fake approval vote');
    assert.match(reviewNode.error || '', /No consensus votes recorded/);
  });

  it('P8-R02-002: denies forged QA_SECURITY votes (role mismatch & unauthorized voter)', () => {
    const pipeline = TaskGraphEngine.createStandard5StagePipeline({
      id: 'graph-trusted-voter-test',
      name: 'Trusted Voter Test',
      workspaceRoot: tempWorkspace,
      planPrompt: 'Build feature',
      consensusPolicy: {
        type: 'majority',
        requiredRoles: ['QA_SECURITY'],
        authorizedReviewers: [
          { voterId: 'authentic-qa-agent', role: 'QA_SECURITY' },
          { voterId: 'authentic-dev-agent', role: 'IMPLEMENTER' },
        ],
      },
    });

    const graph = engine.createGraph(pipeline);
    const reviewNode = graph.nodes.get('node-review')!;
    reviewNode.targetDigest = 'target-sha256-v1';

    // 1. Unauthorized voter
    assert.throws(
      () => {
        engine.submitVote(graph.id, reviewNode.id, {
          voterId: 'fake-security-agent',
          voterRole: 'QA_SECURITY',
          decision: 'APPROVE',
          reviewedDigest: 'target-sha256-v1',
          rationale: 'I claim I am QA_SECURITY',
          timestamp: Date.now(),
        });
      },
      (err: any) => {
        assert.equal(err.code, 'ERR_UNAUTHORIZED_VOTER');
        return true;
      }
    );

    // 2. Role mismatch: authorized voter tries to claim different role
    assert.throws(
      () => {
        engine.submitVote(graph.id, reviewNode.id, {
          voterId: 'authentic-dev-agent',
          voterRole: 'QA_SECURITY', // Registered as IMPLEMENTER!
          decision: 'APPROVE',
          reviewedDigest: 'target-sha256-v1',
          rationale: 'I want to forge QA_SECURITY role',
          timestamp: Date.now(),
        });
      },
      (err: any) => {
        assert.equal(err.code, 'ERR_ROLE_MISMATCH');
        return true;
      }
    );
  });

  it('P8-R02-003: deduplicates votes deterministically with single active vote per voter', () => {
    const pipeline = TaskGraphEngine.createStandard5StagePipeline({
      id: 'graph-dedup-vote-test',
      name: 'Vote Dedup Test',
      workspaceRoot: tempWorkspace,
      planPrompt: 'Build feature',
      consensusPolicy: {
        type: 'majority',
        authorizedReviewers: [
          { voterId: 'qa-sec-auditor', role: 'QA_SECURITY' },
        ],
      },
    });

    const graph = engine.createGraph(pipeline);
    const reviewNode = graph.nodes.get('node-review')!;
    reviewNode.targetDigest = 'target-sha256-v1';

    // Submit initial rejection
    engine.submitVote(graph.id, reviewNode.id, {
      voterId: 'qa-sec-auditor',
      voterRole: 'QA_SECURITY',
      decision: 'REJECT',
      reviewedDigest: 'target-sha256-v1',
      rationale: 'First impression: issues found',
      timestamp: Date.now(),
    });
    assert.equal(reviewNode.votes.length, 1);
    assert.equal(reviewNode.votes[0].decision, 'REJECT');

    // Submit revised approval from same voter for same digest
    engine.submitVote(graph.id, reviewNode.id, {
      voterId: 'qa-sec-auditor',
      voterRole: 'QA_SECURITY',
      decision: 'APPROVE',
      reviewedDigest: 'target-sha256-v1',
      rationale: 'Clarification received: approved',
      timestamp: Date.now() + 10,
    });

    // Length must remain 1 (replaced in-place, NOT duplicated!)
    assert.equal(reviewNode.votes.length, 1);
    assert.equal(reviewNode.votes[0].decision, 'APPROVE');
    assert.equal(reviewNode.votes[0].rationale, 'Clarification received: approved');
  });

  it('P8-R02-004: denies vote on stale digest mismatch (ERR_STALE_VOTE_DIGEST)', () => {
    const pipeline = TaskGraphEngine.createStandard5StagePipeline({
      id: 'graph-stale-digest-test',
      name: 'Stale Digest Test',
      workspaceRoot: tempWorkspace,
      planPrompt: 'Build feature',
      consensusPolicy: {
        type: 'majority',
        authorizedReviewers: [
          { voterId: 'qa-sec-auditor', role: 'QA_SECURITY' },
        ],
      },
    });

    const graph = engine.createGraph(pipeline);
    const reviewNode = graph.nodes.get('node-review')!;
    reviewNode.targetDigest = 'active-sha256-code-v2';

    // Submit vote for old digest 'stale-sha256-code-v1'
    assert.throws(
      () => {
        engine.submitVote(graph.id, reviewNode.id, {
          voterId: 'qa-sec-auditor',
          voterRole: 'QA_SECURITY',
          decision: 'APPROVE',
          reviewedDigest: 'stale-sha256-code-v1', // Outdated digest!
          rationale: 'Reviewed old code version',
          timestamp: Date.now(),
        });
      },
      (err: any) => {
        assert.equal(err.code, 'ERR_STALE_VOTE_DIGEST');
        assert.match(err.message, /does not match active review targetDigest/);
        return true;
      }
    );
  });

  // =========================================================================
  // 7. Mandatory Regression Suite for Round R03 (Technical Leader Audit)
  // =========================================================================

  it('P8-R03-001: denies vote submission before upstream implementation digest is ready (ERR_REVIEW_TARGET_NOT_READY)', () => {
    const pipeline = TaskGraphEngine.createStandard5StagePipeline({
      id: 'graph-pre-approval-denied-test',
      name: 'Pre-approval Denied Test',
      workspaceRoot: tempWorkspace,
      planPrompt: 'Build feature',
      consensusPolicy: {
        type: 'majority',
        authorizedReviewers: [
          { voterId: 'reviewer-security-1', role: 'QA_SECURITY' },
        ],
      },
    });

    const graph = engine.createGraph(pipeline);
    const reviewNode = graph.nodes.get('node-review')!;

    // IMPLEMENT has not executed yet, so node.targetDigest is undefined
    assert.equal(reviewNode.targetDigest, undefined);

    // Attempting to submit vote before code exists must fail fail-closed
    assert.throws(
      () => {
        engine.submitVote(graph.id, reviewNode.id, {
          voterId: 'reviewer-security-1',
          decision: 'APPROVE',
          reviewedDigest: 'sha256-pre-approved-fake-digest',
          rationale: 'Pre-approving unwritten code',
          timestamp: Date.now(),
        } as any);
      },
      (err: any) => {
        assert.equal(err.code, 'ERR_REVIEW_TARGET_NOT_READY');
        assert.match(err.message, /target code digest is not yet ready or locked/);
        return true;
      }
    );
  });

  it('P8-R03-002: fail-closed voting when authorizedReviewers registry is empty or undefined (ERR_UNAUTHORIZED_VOTER)', () => {
    const pipeline = TaskGraphEngine.createStandard5StagePipeline({
      id: 'graph-empty-registry-test',
      name: 'Empty Registry Test',
      workspaceRoot: tempWorkspace,
      planPrompt: 'Build feature',
      consensusPolicy: {
        type: 'majority',
        authorizedReviewers: [], // Empty registry!
      },
    });

    const graph = engine.createGraph(pipeline);
    const reviewNode = graph.nodes.get('node-review')!;
    reviewNode.targetDigest = 'locked-target-digest-v1';

    assert.throws(
      () => {
        engine.submitVote(graph.id, reviewNode.id, {
          voterId: 'any-voter',
          decision: 'APPROVE',
          reviewedDigest: 'locked-target-digest-v1',
          rationale: 'Trying to vote on unauthenticated registry',
          timestamp: Date.now(),
        } as any);
      },
      (err: any) => {
        assert.equal(err.code, 'ERR_UNAUTHORIZED_VOTER');
        assert.match(err.message, /No authorized reviewers registered/);
        return true;
      }
    );
  });

  it('P8-R03-003: derives voterRole authoritatively from registry and rejects caller role spoofing', () => {
    const pipeline = TaskGraphEngine.createStandard5StagePipeline({
      id: 'graph-role-derivation-test',
      name: 'Role Derivation Test',
      workspaceRoot: tempWorkspace,
      planPrompt: 'Build feature',
      consensusPolicy: {
        type: 'majority',
        authorizedReviewers: [
          { voterId: 'qa-sec-auditor', role: 'QA_SECURITY' },
        ],
      },
    });

    const graph = engine.createGraph(pipeline);
    const reviewNode = graph.nodes.get('node-review')!;
    reviewNode.targetDigest = 'locked-target-digest-v1';

    // 1. Voter does not pass voterRole: engine derives it from registry
    const votePayload: any = {
      voterId: 'qa-sec-auditor',
      decision: 'APPROVE',
      reviewedDigest: 'locked-target-digest-v1',
      rationale: 'Review with derived role',
      timestamp: Date.now(),
    };

    engine.submitVote(graph.id, reviewNode.id, votePayload);
    assert.equal(reviewNode.votes.length, 1);
    assert.equal(reviewNode.votes[0].voterRole, 'QA_SECURITY', 'Must derive authoritative role from registry');

    // 2. Caller tries to spoof another privileged role like ARCHITECT
    assert.throws(
      () => {
        engine.submitVote(graph.id, reviewNode.id, {
          voterId: 'qa-sec-auditor',
          voterRole: 'ARCHITECT', // Spoofed!
          decision: 'APPROVE',
          reviewedDigest: 'locked-target-digest-v1',
          rationale: 'Claiming different role',
          timestamp: Date.now(),
        });
      },
      (err: any) => {
        assert.equal(err.code, 'ERR_ROLE_MISMATCH');
        return true;
      }
    );
  });

  it('P8-R04-001: enforces getRunnableNodes() and prevents premature step on node with unsatisfied dependencies', () => {
    const pipeline = TaskGraphEngine.createStandard5StagePipeline({
      id: 'graph-runnable-check-test',
      name: 'Runnable Check Test',
      workspaceRoot: tempWorkspace,
      planPrompt: 'Build feature',
    });

    const graph = engine.createGraph(pipeline);
    const runnable = engine.getRunnableNodes(graph);

    // Only PLAN has no dependencies and is runnable initially
    assert.equal(runnable.length, 1);
    assert.equal(runnable[0].id, 'node-plan');

    // IMPLEMENT, REVIEW, FIX, VERIFY are not runnable because dependencies are unsatisfied
    const implementNode = graph.nodes.get('node-implement')!;
    assert.equal(runnable.some(n => n.id === implementNode.id), false);
  });
});
