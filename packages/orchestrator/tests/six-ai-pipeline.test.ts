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
      sessions: [
        { sessionId: 'wps_deepseek_9999', assignedRole: 'REVIEWER', providerId: 'deepseek' },
      ],
    });

    const engine = new TaskGraphEngine();
    const graph = engine.createGraph(pipeline);

    // Attempt to vote on node-algo-review before node-implement has run and produced outputDigest
    assert.throws(
      () => {
        engine.submitVote(graph.id, 'node-algo-review', {
          voterId: 'wps_deepseek_9999',
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
    const mockSessions = [
      { sessionId: 'wps_chatgpt_001', assignedRole: 'LEADER', providerId: 'chatgpt' },
      { sessionId: 'wps_claude_002', assignedRole: 'ARCHITECT', providerId: 'claude' },
      { sessionId: 'wps_deepseek_003', assignedRole: 'REVIEWER', providerId: 'deepseek' },
      { sessionId: 'wps_codex_004', assignedRole: 'QA_SECURITY', providerId: 'codex' },
    ];

    const pipeline = TaskGraphEngine.create6AIPipeline({
      id: 'pipeline-run-6ai',
      name: 'Full 6-AI Run',
      workspaceRoot: process.cwd(),
      taskPrompt: 'Full collaboration test',
      sessions: mockSessions,
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
            voterId: 'wps_deepseek_003',
            voterRole: 'REVIEWER' as const,
            decision: 'APPROVE' as const,
            rationale: 'Algorithmic efficiency verified',
            reviewedDigest: targetDigest,
            timestamp: Date.now(),
          },
          {
            voterId: 'wps_codex_004',
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
        verificationEvidence: {
          testCoverage: 100,
          zeroCostVerified: true,
          securityAuditPass: true,
        },
      }),
    };

    const completedGraph = await engine.runGraph(graph.id, mockHandlers);
    assert.equal(completedGraph.status, 'COMPLETED');

    for (const node of completedGraph.nodes.values()) {
      assert.equal(node.status, 'COMPLETED');
    }
  });

  it('P9-6AI-05: Missing provider handler fails closed with ERR_PROVIDER_HANDLER_UNAVAILABLE', async () => {
    const pipeline = TaskGraphEngine.create6AIPipeline({
      id: 'pipeline-fail-closed',
      name: 'Fail Closed Provider Handler Test',
      workspaceRoot: process.cwd(),
      taskPrompt: 'Fail closed test',
    });

    const engine = new TaskGraphEngine();
    const graph = engine.createGraph(pipeline);
    const nodeScope = graph.nodes.get('node-scope')!;

    // 1. Calling executeNode directly rejects fail-closed
    await assert.rejects(
      async () => {
        await engine.executeNode(graph, nodeScope);
      },
      (err: any) => {
        return err.code === 'ERR_PROVIDER_HANDLER_UNAVAILABLE';
      }
    );

    // 2. Calling runGraph captures failure and sets graph.status = 'FAILED'
    const resultGraph = await engine.runGraph(graph.id, {});
    assert.equal(resultGraph.status, 'FAILED');
    assert.match(resultGraph.error || '', /ERR_PROVIDER_HANDLER_UNAVAILABLE/);
  });

  it('P9-6AI-06: IMPLEMENT stage missing outputDigest fails closed', async () => {
    const pipeline = TaskGraphEngine.create6AIPipeline({
      id: 'pipeline-missing-digest',
      name: 'Missing Digest Test',
      workspaceRoot: process.cwd(),
      taskPrompt: 'Missing digest test',
    });

    const engine = new TaskGraphEngine();
    const graph = engine.createGraph(pipeline);
    const nodeImplement = graph.nodes.get('node-implement')!;

    // 1. Calling executeNode directly rejects fail-closed
    await assert.rejects(
      async () => {
        await engine.executeNode(graph, nodeImplement, async () => ({
          result: { code: 'done' }, // No outputDigest!
        }));
      },
      (err: any) => {
        return err.message && err.message.includes('must produce an authentic output digest');
      }
    );

    // 2. Calling runGraph with an implementer lacking outputDigest sets graph.status = 'FAILED'
    const handlers = {
      'node-scope': async () => ({ result: {} }),
      'node-research': async () => ({ result: {} }),
      'node-arch': async () => ({ result: {} }),
      'node-implement': async () => ({ result: { code: 'done' } }), // No outputDigest!
    };
    const resultGraph = await engine.runGraph(graph.id, handlers);
    assert.equal(resultGraph.status, 'FAILED');
    assert.match(resultGraph.error || '', /must produce an authentic output digest/);
  });

  it('P9-6AI-07: Dynamic session verification strictly enforces live session registry and roles', () => {
    const mockSessionMap = new Map<string, any>([
      ['wps_deepseek_live', { sessionId: 'wps_deepseek_live', providerId: 'deepseek', assignedRole: 'REVIEWER' }],
      ['wps_codex_live', { sessionId: 'wps_codex_live', providerId: 'codex', assignedRole: 'QA_SECURITY' }],
    ]);

    const mockRegistry = {
      getSessionById: (id: string) => mockSessionMap.get(id) || null,
      getSessionByProvider: (provider: string) => {
        for (const s of mockSessionMap.values()) {
          if (s.providerId === provider) return s;
        }
        return null;
      },
    };

    const pipeline = TaskGraphEngine.create6AIPipeline({
      id: 'pipeline-session-enforcement',
      name: 'Session Enforcement Test',
      workspaceRoot: process.cwd(),
      taskPrompt: 'Session enforcement test',
      sessionRegistry: mockRegistry,
    });

    const engine = new TaskGraphEngine({ sessionRegistry: mockRegistry });
    const graph = engine.createGraph(pipeline);

    // Set target digest on review node to bypass pre-approval check
    const reviewNode = graph.nodes.get('node-algo-review')!;
    reviewNode.targetDigest = 'a'.repeat(64);

    // 1. Static fake voter ID must be denied fail-closed
    assert.throws(
      () => {
        engine.submitVote(graph.id, 'node-algo-review', {
          voterId: 'session_deepseek_fake',
          voterRole: 'REVIEWER',
          decision: 'APPROVE',
          rationale: 'Fake voter',
          reviewedDigest: 'a'.repeat(64),
          timestamp: Date.now(),
        });
      },
      (err: any) => err.code === 'ERR_UNAUTHORIZED_VOTER'
    );

    // 2. Mismatched role must be denied fail-closed
    assert.throws(
      () => {
        engine.submitVote(graph.id, 'node-algo-review', {
          voterId: 'wps_deepseek_live',
          voterRole: 'QA_SECURITY' as any, // Trying to vote as QA_SECURITY
          decision: 'APPROVE',
          rationale: 'Role spoof',
          reviewedDigest: 'a'.repeat(64),
          timestamp: Date.now(),
        });
      },
      (err: any) => err.code === 'ERR_ROLE_MISMATCH'
    );

    // 3. Removed session must be denied fail-closed
    mockSessionMap.delete('wps_deepseek_live');
    assert.throws(
      () => {
        engine.submitVote(graph.id, 'node-algo-review', {
          voterId: 'wps_deepseek_live',
          voterRole: 'REVIEWER',
          decision: 'APPROVE',
          rationale: 'Vote after removal',
          reviewedDigest: 'a'.repeat(64),
          timestamp: Date.now(),
        });
      },
      (err: any) => err.code === 'ERR_PROVIDER_SESSION_NOT_FOUND'
    );

    // 4. Authentic active session is accepted
    engine.submitVote(graph.id, 'node-algo-review', {
      voterId: 'wps_codex_live',
      voterRole: 'QA_SECURITY',
      decision: 'APPROVE',
      rationale: 'Authentic QA verification',
      reviewedDigest: 'a'.repeat(64),
      timestamp: Date.now(),
    });

    assert.equal(reviewNode.votes.length, 1);
    assert.equal(reviewNode.votes[0].voterId, 'wps_codex_live');
  });

  it('P9-6AI-08 & P9-R04-001: WAITING_INPUT node preserves state, transitions graph to WAITING_INPUT, and blocks downstream execution', async () => {
    const pipeline = TaskGraphEngine.create6AIPipeline({
      id: 'pipeline-waiting-input',
      name: 'Waiting Input Test',
      workspaceRoot: process.cwd(),
      taskPrompt: 'Waiting input test',
    });

    const engine = new TaskGraphEngine();
    const graph = engine.createGraph(pipeline);

    // Register scope node handler returning WAITING_INPUT
    const handlers = {
      'node-scope': async () => ({
        status: 'WAITING_INPUT' as const,
        error: 'ERR_PROVIDER_AWAITING_RESPONSE: No authentic live response',
        provenance: 'UNVERIFIED' as const,
        result: { awaitingInput: true },
      }),
      'node-research': async () => ({ result: { research: 'should not run' } }),
    };

    const resultGraph = await engine.runGraph(graph.id, handlers);

    // 1. Scope node preserved as WAITING_INPUT (not FAILED or COMPLETED)
    const scopeNode = resultGraph.nodes.get('node-scope')!;
    assert.equal(scopeNode.status, 'WAITING_INPUT');
    assert.match(scopeNode.error || '', /ERR_PROVIDER_AWAITING_RESPONSE/);
    assert.equal((scopeNode.result as any)?.provenance, 'UNVERIFIED');

    // 2. Downstream research node is blocked from running (still PENDING)
    const researchNode = resultGraph.nodes.get('node-research')!;
    assert.equal(researchNode.status, 'PENDING');

    // 3. Graph status is WAITING_INPUT (not FAILED with deadlock)
    assert.equal(resultGraph.status, 'WAITING_INPUT');
    assert.match(resultGraph.error || '', /ERR_PROVIDER_AWAITING_RESPONSE/);
  });
});
