import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TaskGraphEngine } from '../src/index.ts';

describe('Phase P9: 6-AI Collaborative Workflow Engine Tests', () => {
  it('P9-6AI-01: Creates 6-AI Pipeline with all 6 collaborative actors and stages', () => {
    const pipeline = TaskGraphEngine.create6AIPipeline({
      id: 'pipeline-6ai-test',
      name: '6-AI Full Collaborative Pipeline',
      workspaceRoot: process.cwd(),
      taskPrompt: 'Build production-ready secure zero-cost desktop workspace',
      targetFiles: ['src/core.ts'],
    });

    assert.equal(pipeline.nodes.length, 6);

    const [scope, research, arch, implement, review, verify] = pipeline.nodes;

    // 1. ChatGPT
    assert.equal(scope.id, 'node-scope');
    assert.equal(scope.assignedProvider, 'chatgpt');
    assert.equal(scope.assignedRole, 'LEADER');
    assert.equal(scope.stage, 'PLAN');
    assert.deepEqual(scope.dependencies, []);

    // 2. Gemini
    assert.equal(research.id, 'node-research');
    assert.equal(research.assignedProvider, 'gemini');
    assert.equal(research.assignedRole, 'RESEARCHER');
    assert.equal(research.stage, 'PLAN');
    assert.deepEqual(research.dependencies, ['node-scope']);

    // 3. Claude
    assert.equal(arch.id, 'node-arch');
    assert.equal(arch.assignedProvider, 'claude');
    assert.equal(arch.assignedRole, 'ARCHITECT');
    assert.equal(arch.stage, 'PLAN');
    assert.deepEqual(arch.dependencies, ['node-research']);

    // 4. Antigravity
    assert.equal(implement.id, 'node-implement');
    assert.equal(implement.assignedProvider, 'antigravity');
    assert.equal(implement.assignedRole, 'IMPLEMENTER');
    assert.equal(implement.stage, 'IMPLEMENT');
    assert.deepEqual(implement.dependencies, ['node-arch']);

    // 5. DeepSeek
    assert.equal(review.id, 'node-algo-review');
    assert.equal(review.assignedProvider, 'deepseek');
    assert.equal(review.assignedRole, 'REVIEWER');
    assert.equal(review.stage, 'REVIEW');
    assert.deepEqual(review.dependencies, ['node-implement']);

    // 6. Codex
    assert.equal(verify.id, 'node-qa-verify');
    assert.equal(verify.assignedProvider, 'codex');
    assert.equal(verify.assignedRole, 'QA_SECURITY');
    assert.equal(verify.stage, 'VERIFY');
    assert.deepEqual(verify.dependencies, ['node-algo-review']);
  });

  it('P9-6AI-02: Topological sort validates correct dependency sequence without cycles', () => {
    const pipeline = TaskGraphEngine.create6AIPipeline({
      id: 'pipeline-topo',
      name: 'Topo Sort Test',
      workspaceRoot: process.cwd(),
      taskPrompt: 'Test task',
    });

    const order = TaskGraphEngine.getTopologicalOrder(pipeline);
    assert.deepEqual(order, [
      'node-scope',
      'node-research',
      'node-arch',
      'node-implement',
      'node-algo-review',
      'node-qa-verify',
    ]);
  });

  it('P9-6AI-03: Anti-pre-approval digest lock strictly enforced for 6-AI review stage', () => {
    const pipeline = TaskGraphEngine.create6AIPipeline({
      id: 'pipeline-pre-approval',
      name: 'Anti Pre-Approval Test',
      workspaceRoot: process.cwd(),
      taskPrompt: 'Test task',
    });

    const engine = new TaskGraphEngine();
    const graph = engine.createGraph(pipeline);

    // Attempt to vote on node-algo-review before node-implement has run and produced outputDigest
    assert.throws(
      () => {
        engine.submitVote(graph.id, 'node-algo-review', {
          voterId: 'session_deepseek_reviewer',
          voterRole: 'REVIEWER',
          decision: 'APPROVE',
          rationale: 'Premature approval attempt',
          reviewedDigest: 'd'.repeat(64),
          timestamp: Date.now(),
        });
      },
      (err: any) => {
        return err.code === 'ERR_REVIEW_TARGET_NOT_READY';
      }
    );
  });

  it('P9-6AI-04: Full 6-AI collaboration runs to COMPLETED when consensus is reached', async () => {
    const pipeline = TaskGraphEngine.create6AIPipeline({
      id: 'pipeline-run-6ai',
      name: 'Full 6-AI Run',
      workspaceRoot: process.cwd(),
      taskPrompt: 'Full collaboration test',
    });

    const engine = new TaskGraphEngine();
    const graph = engine.createGraph(pipeline);

    const targetDigest = 'e'.repeat(64);

    const mockHandlers = {
      'node-scope': async () => ({
        result: { scope: 'Complete 6-AI scope defined' },
      }),
      'node-research': async () => ({
        result: { research: 'Multimodal research synthesized' },
      }),
      'node-arch': async () => ({
        result: { architecture: 'Zero-cost decoupled architecture' },
      }),
      'node-implement': async () => ({
        result: { code: 'Implementation complete' },
        outputDigest: targetDigest,
        modifiedFiles: ['src/core.ts'],
      }),
      'node-algo-review': async () => ({
        result: { review: 'Algorithms optimal, no leaks' },
        votes: [
          {
            voterId: 'session_deepseek_reviewer',
            voterRole: 'REVIEWER' as const,
            decision: 'APPROVE' as const,
            rationale: 'Algorithmic efficiency verified',
            reviewedDigest: targetDigest,
            timestamp: Date.now(),
          },
          {
            voterId: 'session_codex_qa',
            voterRole: 'QA_SECURITY' as const,
            decision: 'APPROVE' as const,
            rationale: 'Security and edge case verification pass',
            reviewedDigest: targetDigest,
            timestamp: Date.now(),
          },
        ],
      }),
      'node-qa-verify': async () => ({
        result: { verification: '100% tests passing' },
      }),
    };

    const completedGraph = await engine.runGraph(graph.id, mockHandlers);
    assert.equal(completedGraph.status, 'COMPLETED');

    for (const node of completedGraph.nodes.values()) {
      assert.equal(node.status, 'COMPLETED');
    }
  });
});
