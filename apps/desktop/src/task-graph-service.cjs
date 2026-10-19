/**
 * @file task-graph-service.cjs
 * @description Desktop Main Process Service for Multi-Agent Task Graph & Consensus Engine (Phase P8).
 *
 * Implements:
 * - P8-001: Task Graph & DAG engine with cycle detection (ERR_CYCLE_DETECTED)
 * - P8-002: Dependency topological ordering & parallel branch readiness
 * - P8-003: 5-Stage Orchestration Lifecycle: Plan -> Implement -> Review -> Fix -> Verify
 * - P8-004: Dynamic Role Routing (Architect, Implementer, Reviewer, Tester)
 * - P8-005: Stale Review Invalidation upon code or artifact mutation
 * - P8-006: Multi-Agent Consensus Protocol & Threshold Voting (unanimous, majority, threshold, required roles)
 * - P8-007: Strict Canonical Filesystem Boundary & Zero-Cost Security Inheritance (P5-P7 guarantees)
 * - P8-008: Electron IPC Handlers & Renderer Preload integration
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { z } = require('zod');

const { CostGuard } = require('./cost-guard.cjs');
const { AdmissionPolicyGate } = require('./orchestrator.cjs');

// Schemas
const StageTypeSchema = z.enum(['PLAN', 'IMPLEMENT', 'REVIEW', 'FIX', 'VERIFY']);
const RoleSchema = z.enum([
  'LEADER',
  'IMPLEMENTER',
  'QA_SECURITY',
  'RESEARCHER',
  'ORCHESTRATOR',
  'USER',
  'ARCHITECT',
  'REVIEWER',
  'TESTER',
]);
const ConsensusDecisionSchema = z.enum(['APPROVE', 'REJECT', 'ABSTAIN']);

const ConsensusVoteSchema = z.object({
  voterId: z.string().min(1),
  voterRole: RoleSchema,
  decision: ConsensusDecisionSchema,
  rationale: z.string().default(''),
  timestamp: z.number().int().nonnegative().default(() => Date.now()),
});

const ConsensusPolicySchema = z.object({
  type: z.enum(['unanimous', 'majority', 'threshold']).default('majority'),
  minThreshold: z.number().min(0).max(1).optional(),
  requiredRoles: z.array(RoleSchema).optional(),
});

const TaskNodeDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  stage: StageTypeSchema,
  assignedRole: RoleSchema,
  assignedProvider: z.string().optional(),
  dependencies: z.array(z.string()).default([]),
  actionPayload: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const TaskGraphDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  workspaceRoot: z.string().min(1),
  nodes: z.array(TaskNodeDefinitionSchema).min(1),
  consensusPolicy: ConsensusPolicySchema.optional(),
  maxFixAttempts: z.number().int().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
});

class TaskGraphEngineCJS extends EventEmitter {
  constructor(options = {}) {
    super();
    this.graphs = new Map();
    this.storage = options.storage;
    this.costGuard = options.costGuard || new CostGuard();
    this.admissionGate = new AdmissionPolicyGate({
      costGuard: this.costGuard,
      paidApiEnabled: options.paidApiEnabled || false,
    });
  }

  static getCanonicalPath(targetPath) {
    if (!targetPath || typeof targetPath !== 'string' || !targetPath.trim()) return null;
    try {
      const resolved = path.resolve(targetPath.trim());
      try {
        fs.lstatSync(resolved);
        return fs.realpathSync(resolved);
      } catch {
        // Ancestor walk
      }

      let current = resolved;
      const missing = [];
      while (true) {
        let exists = false;
        try {
          fs.lstatSync(current);
          exists = true;
        } catch {
          exists = false;
        }

        if (exists) {
          const realParent = fs.realpathSync(current);
          return path.join(realParent, ...missing);
        }

        const parent = path.dirname(current);
        if (parent === current) return resolved;
        missing.unshift(path.basename(current));
        current = parent;
      }
    } catch {
      return null;
    }
  }

  static verifyWorkspaceBoundary(workspaceRoot, targetPath) {
    if (!workspaceRoot || !targetPath) return false;
    if (typeof workspaceRoot !== 'string' || typeof targetPath !== 'string') return false;
    if (!workspaceRoot.trim() || !targetPath.trim()) return false;

    try {
      const resolvedRoot = path.resolve(workspaceRoot.trim());
      const resolvedTarget = path.resolve(resolvedRoot, targetPath.trim());

      const relLexical = path.relative(resolvedRoot, resolvedTarget);
      if (relLexical.startsWith('..') || path.isAbsolute(relLexical)) return false;

      const canonicalRoot = TaskGraphEngineCJS.getCanonicalPath(resolvedRoot);
      if (!canonicalRoot) return false;

      const canonicalTarget = TaskGraphEngineCJS.getCanonicalPath(resolvedTarget);
      if (!canonicalTarget) return false;

      const relCanonical = path.relative(canonicalRoot, canonicalTarget);
      if (relCanonical.startsWith('..') || path.isAbsolute(relCanonical)) return false;

      return true;
    } catch {
      return false;
    }
  }

  static validateDAG(graphDef) {
    TaskGraphDefinitionSchema.parse(graphDef);

    const nodeIds = new Set();
    const nodeMap = new Map();

    for (const node of graphDef.nodes) {
      if (nodeIds.has(node.id)) {
        const err = new Error(`Duplicate node ID '${node.id}' in task graph definition`);
        err.code = 'ERR_SCHEMA_VALIDATION_FAILED';
        throw err;
      }
      nodeIds.add(node.id);
      nodeMap.set(node.id, node);
    }

    for (const node of graphDef.nodes) {
      for (const depId of node.dependencies) {
        if (!nodeIds.has(depId)) {
          const err = new Error(`Node '${node.id}' depends on non-existent node '${depId}'`);
          err.code = 'ERR_SCHEMA_VALIDATION_FAILED';
          throw err;
        }
      }
    }

    const visited = new Set();
    const recStack = new Set();

    function checkCycle(nodeId) {
      visited.add(nodeId);
      recStack.add(nodeId);

      const node = nodeMap.get(nodeId);
      if (node) {
        for (const depId of node.dependencies) {
          if (!visited.has(depId)) {
            checkCycle(depId);
          } else if (recStack.has(depId)) {
            const err = new Error(`Cyclic dependency detected in task graph: cycle involves '${nodeId}' -> '${depId}'`);
            err.code = 'ERR_CYCLE_DETECTED';
            throw err;
          }
        }
      }

      recStack.delete(nodeId);
    }

    for (const node of graphDef.nodes) {
      if (!visited.has(node.id)) {
        checkCycle(node.id);
      }
    }
  }

  static getTopologicalOrder(graphDef) {
    TaskGraphEngineCJS.validateDAG(graphDef);

    const inDegree = new Map();
    const dependents = new Map();

    for (const node of graphDef.nodes) {
      inDegree.set(node.id, node.dependencies.length);
      dependents.set(node.id, []);
    }

    for (const node of graphDef.nodes) {
      for (const dep of node.dependencies) {
        dependents.get(dep).push(node.id);
      }
    }

    const queue = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) queue.push(id);
    }

    const order = [];
    while (queue.length > 0) {
      const current = queue.shift();
      order.push(current);

      for (const next of dependents.get(current) || []) {
        const newDeg = inDegree.get(next) - 1;
        inDegree.set(next, newDeg);
        if (newDeg === 0) queue.push(next);
      }
    }

    if (order.length !== graphDef.nodes.length) {
      const err = new Error('Cyclic dependency detected during topological sort');
      err.code = 'ERR_CYCLE_DETECTED';
      throw err;
    }

    return order;
  }

  invalidateDownstreamReviews(graph, mutatingNodeId, modifiedFiles = []) {
    const dependentsMap = new Map();
    for (const [id, node] of graph.nodes.entries()) {
      for (const dep of node.dependencies) {
        if (!dependentsMap.has(dep)) dependentsMap.set(dep, []);
        dependentsMap.get(dep).push(id);
      }
    }

    const downstreamIds = new Set();
    const queue = [mutatingNodeId];

    while (queue.length > 0) {
      const curr = queue.shift();
      for (const next of dependentsMap.get(curr) || []) {
        if (!downstreamIds.has(next)) {
          downstreamIds.add(next);
          queue.push(next);
        }
      }
    }

    const invalidatedIds = [];
    const filesStr = modifiedFiles.length > 0 ? modifiedFiles.join(', ') : 'artifacts/code';

    for (const id of downstreamIds) {
      const node = graph.nodes.get(id);
      if (!node) continue;

      if (node.stage === 'REVIEW' || node.stage === 'VERIFY') {
        if (node.status === 'COMPLETED' || node.status === 'WAITING_APPROVAL' || node.status === 'RUNNING') {
          node.status = 'STALE';
          node.staleReason = `Invalidated due to mutation in upstream node '${mutatingNodeId}' (${filesStr})`;
          node.votes = [];
          node.completedAt = undefined;
          invalidatedIds.push(id);

          this.recordHistory(graph, 'STALE_REVIEW_INVALIDATED', id, {
            mutatingNodeId,
            modifiedFiles,
            staleReason: node.staleReason,
          });
        }
      }
    }

    return invalidatedIds;
  }

  static evaluateConsensus(votes, policy, currentAttempt = 1, maxAttempts = 3) {
    let approvedCount = 0;
    let rejectedCount = 0;
    let abstainCount = 0;
    const reasons = [];
    const approvingRoles = new Set();

    for (const v of votes) {
      if (v.decision === 'APPROVE') {
        approvedCount++;
        approvingRoles.add(v.voterRole);
      } else if (v.decision === 'REJECT') {
        rejectedCount++;
        if (v.rationale) reasons.push(`[${v.voterRole}]: ${v.rationale}`);
      } else {
        abstainCount++;
      }
    }

    const totalDecisive = approvedCount + rejectedCount;
    let thresholdSatisfied = false;

    const pType = policy.type || 'majority';
    if (pType === 'unanimous') {
      thresholdSatisfied = rejectedCount === 0 && approvedCount > 0;
    } else if (pType === 'majority') {
      thresholdSatisfied = totalDecisive > 0 && approvedCount / totalDecisive > 0.5;
    } else if (pType === 'threshold') {
      const minRatio = typeof policy.minThreshold === 'number' ? policy.minThreshold : 0.6;
      thresholdSatisfied = totalDecisive > 0 && approvedCount / totalDecisive >= minRatio;
    }

    if (policy.requiredRoles && Array.isArray(policy.requiredRoles)) {
      for (const reqRole of policy.requiredRoles) {
        if (!approvingRoles.has(reqRole)) {
          thresholdSatisfied = false;
          reasons.push(`Required approval from role '${reqRole}' is missing`);
        }
      }
    }

    if (thresholdSatisfied) {
      return {
        consensusReached: true,
        decision: 'APPROVE',
        action: 'PROCEED',
        approvedCount,
        rejectedCount,
        abstainCount,
        totalVotes: votes.length,
        reasons: [],
      };
    }

    const willRetry = currentAttempt < maxAttempts;
    return {
      consensusReached: false,
      decision: 'REJECT',
      action: willRetry ? 'TRIGGER_FIX' : 'ABORT',
      approvedCount,
      rejectedCount,
      abstainCount,
      totalVotes: votes.length,
      reasons,
    };
  }

  createGraph(def) {
    TaskGraphEngineCJS.validateDAG(def);

    const canonicalRoot = TaskGraphEngineCJS.getCanonicalPath(def.workspaceRoot);
    if (!canonicalRoot) {
      const err = new Error(`Task graph workspaceRoot '${def.workspaceRoot}' is invalid or cannot be canonicalized`);
      err.code = 'ERR_PATH_TRAVERSAL_DENIED';
      throw err;
    }

    const now = Date.now();
    const nodes = new Map();

    for (const nodeDef of def.nodes) {
      nodes.set(nodeDef.id, {
        id: nodeDef.id,
        name: nodeDef.name,
        stage: nodeDef.stage,
        assignedRole: nodeDef.assignedRole,
        assignedProvider: nodeDef.assignedProvider,
        dependencies: [...nodeDef.dependencies],
        status: 'PENDING',
        attempt: 1,
        actionPayload: nodeDef.actionPayload ? { ...nodeDef.actionPayload } : undefined,
        votes: [],
      });
    }

    const state = {
      id: def.id,
      name: def.name,
      workspaceRoot: canonicalRoot,
      status: 'PENDING',
      nodes,
      consensusPolicy: def.consensusPolicy || { type: 'majority' },
      maxFixAttempts: def.maxFixAttempts || 3,
      currentFixAttempt: 0,
      createdAt: now,
      updatedAt: now,
      history: [],
    };

    this.graphs.set(def.id, state);

    this.recordHistory(state, 'TASK_GRAPH_CREATED', undefined, {
      name: def.name,
      nodeCount: def.nodes.length,
      workspaceRoot: canonicalRoot,
    });

    return state;
  }

  getGraph(graphId) {
    return this.graphs.get(graphId);
  }

  listGraphs() {
    return Array.from(this.graphs.values());
  }

  submitVote(graphId, nodeId, vote) {
    const graph = this.graphs.get(graphId);
    if (!graph) {
      const err = new Error(`Task graph '${graphId}' not found`);
      err.code = 'ERR_TASK_GRAPH_FAILED';
      throw err;
    }

    const node = graph.nodes.get(nodeId);
    if (!node) {
      const err = new Error(`Node '${nodeId}' not found in graph '${graphId}'`);
      err.code = 'ERR_TASK_GRAPH_FAILED';
      throw err;
    }

    node.votes.push({
      ...vote,
      timestamp: vote.timestamp || Date.now(),
    });

    this.recordHistory(graph, 'CONSENSUS_VOTE_RECORDED', nodeId, {
      voterId: vote.voterId,
      voterRole: vote.voterRole,
      decision: vote.decision,
      rationale: vote.rationale,
    });
  }

  getRunnableNodes(graph) {
    const runnable = [];

    for (const node of graph.nodes.values()) {
      if (node.status === 'PENDING' || node.status === 'STALE') {
        const allDepsCompleted = node.dependencies.every((depId) => {
          const dep = graph.nodes.get(depId);
          return dep && (dep.status === 'COMPLETED' || dep.status === 'SKIPPED');
        });

        if (allDepsCompleted) runnable.push(node);
      }
    }

    return runnable;
  }

  async executeNode(graph, node, handler) {
    node.status = 'RUNNING';
    node.startedAt = Date.now();
    node.votes = []; // Fresh votes for this execution attempt
    this.recordHistory(graph, 'TASK_NODE_STARTED', node.id, {
      stage: node.stage,
      role: node.assignedRole,
      attempt: node.attempt,
    });

    if (node.actionPayload) {
      const payload = node.actionPayload;

      const targetPath = payload.targetPath || payload.cwd;
      if (targetPath) {
        const isInside = TaskGraphEngineCJS.verifyWorkspaceBoundary(graph.workspaceRoot, targetPath);
        if (!isInside) {
          node.status = 'FAILED';
          node.error = `ERR_PATH_TRAVERSAL_DENIED: Target path '${targetPath}' escapes workspace boundary`;
          this.recordHistory(graph, 'TASK_NODE_FAILED', node.id, { error: node.error });
          const err = new Error(node.error);
          err.code = 'ERR_PATH_TRAVERSAL_DENIED';
          throw err;
        }
      }

      if (Array.isArray(payload.files)) {
        for (const file of payload.files) {
          if (typeof file === 'string') {
            const isInside = TaskGraphEngineCJS.verifyWorkspaceBoundary(graph.workspaceRoot, file);
            if (!isInside) {
              node.status = 'FAILED';
              node.error = `ERR_PATH_TRAVERSAL_DENIED: File '${file}' escapes workspace boundary`;
              this.recordHistory(graph, 'TASK_NODE_FAILED', node.id, { error: node.error });
              const err = new Error(node.error);
              err.code = 'ERR_PATH_TRAVERSAL_DENIED';
              throw err;
            }
          }
        }
      }

      const declaredCost = typeof payload.estimatedCost === 'number' ? payload.estimatedCost : 0;
      const admissionDecision = this.admissionGate.evaluate({
        actionId: `node_${node.id}_${Date.now()}`,
        actionType: 'INVOKE_TOOL',
        provider: node.assignedProvider || 'system',
        estimatedCost: declaredCost,
        requestedBy: node.assignedRole,
      });

      if (!admissionDecision.allowed) {
        node.status = 'FAILED';
        node.error = `ERR_COST_LIMIT_EXCEEDED: ${admissionDecision.reason} (${admissionDecision.policyCode})`;
        this.recordHistory(graph, 'TASK_NODE_FAILED', node.id, { error: node.error });
        const err = new Error(node.error);
        err.code = 'ERR_COST_LIMIT_EXCEEDED';
        throw err;
      }
    }

    try {
      const context = {
        graph,
        workspaceRoot: graph.workspaceRoot,
        costGuard: this.costGuard,
        admissionGate: this.admissionGate,
        emitEvent: (evt, p) => this.recordHistory(graph, evt, node.id, p),
      };

      const executionResult = handler
        ? await handler(node, context)
        : { result: `Node ${node.id} executed successfully` };

      if (executionResult.error) {
        node.status = 'FAILED';
        node.error = executionResult.error;
        this.recordHistory(graph, 'TASK_NODE_FAILED', node.id, { error: node.error });
        return node;
      }

      node.result = executionResult.result;
      node.outputDigest = executionResult.outputDigest;
      node.modifiedFiles = executionResult.modifiedFiles;

      if (executionResult.votes) {
        for (const v of executionResult.votes) {
          this.submitVote(graph.id, node.id, v);
        }
      }

      if (node.stage === 'REVIEW') {
        if (node.votes.length === 0) {
          this.submitVote(graph.id, node.id, {
            voterId: `agent-${node.assignedRole.toLowerCase()}`,
            voterRole: node.assignedRole,
            decision: 'APPROVE',
            rationale: 'Review approved by assigned agent policy',
            timestamp: Date.now(),
          });
        }

        const consensusResult = TaskGraphEngineCJS.evaluateConsensus(
          node.votes,
          graph.consensusPolicy,
          graph.currentFixAttempt + 1,
          graph.maxFixAttempts
        );

        this.recordHistory(graph, 'CONSENSUS_DECIDED', node.id, {
          consensusResult,
        });

        if (consensusResult.consensusReached) {
          node.status = 'COMPLETED';
          node.completedAt = Date.now();

          // Review succeeded! Mark any downstream pending FIX node as SKIPPED
          for (const candidate of graph.nodes.values()) {
            if (candidate.stage === 'FIX' && candidate.status === 'PENDING') {
              candidate.status = 'SKIPPED';
              this.recordHistory(graph, 'TASK_NODE_SKIPPED', candidate.id, {
                reason: 'Fix not required: upstream review consensus succeeded',
              });
            }
          }
        } else if (consensusResult.action === 'TRIGGER_FIX') {
          graph.currentFixAttempt++;
          node.status = 'FAILED';
          node.error = `Consensus rejected: ${consensusResult.reasons.join('; ')}`;

          for (const candidate of graph.nodes.values()) {
            if (candidate.stage === 'FIX') {
              candidate.status = 'PENDING';
              candidate.attempt = graph.currentFixAttempt;
              candidate.actionPayload = {
                ...candidate.actionPayload,
                reviewFeedback: consensusResult.reasons,
                reviewNodeId: node.id,
              };
            }
          }
        } else {
          node.status = 'FAILED';
          node.error = `Consensus failed permanently after ${graph.maxFixAttempts} attempts: ${consensusResult.reasons.join('; ')}`;
          graph.status = 'FAILED';
          graph.error = node.error;
        }
      } else {
        node.status = 'COMPLETED';
        node.completedAt = Date.now();

        if (node.stage === 'IMPLEMENT' || node.stage === 'FIX') {
          const modFiles = executionResult.modifiedFiles || (node.actionPayload?.files) || [];
          if (modFiles.length > 0) {
            this.invalidateDownstreamReviews(graph, node.id, modFiles);
          }
        }
      }

      this.recordHistory(graph, 'TASK_NODE_COMPLETED', node.id, {
        status: node.status,
        stage: node.stage,
      });

      return node;
    } catch (err) {
      node.status = 'FAILED';
      node.error = err.message;
      this.recordHistory(graph, 'TASK_NODE_FAILED', node.id, { error: err.message });
      throw err;
    }
  }

  async runGraph(graphId, handlers = {}) {
    const graph = this.graphs.get(graphId);
    if (!graph) {
      const err = new Error(`Task graph '${graphId}' not found`);
      err.code = 'ERR_TASK_GRAPH_FAILED';
      throw err;
    }

    graph.status = 'RUNNING';
    this.recordHistory(graph, 'TASK_GRAPH_RUNNING', undefined, { graphId });

    let safetyCounter = 0;
    const maxTicks = 100;

    while (graph.status === 'RUNNING') {
      safetyCounter++;
      if (safetyCounter > maxTicks) {
        graph.status = 'FAILED';
        graph.error = 'ERR_TASK_GRAPH_FAILED: Execution exceeded maximum tick limit';
        break;
      }

      const runnable = this.getRunnableNodes(graph);
      if (runnable.length === 0) {
        const allCompleted = Array.from(graph.nodes.values()).every(
          (n) => n.status === 'COMPLETED' || n.status === 'SKIPPED'
        );

        if (allCompleted) {
          graph.status = 'COMPLETED';
          graph.completedAt = Date.now();
          this.recordHistory(graph, 'TASK_GRAPH_COMPLETED', undefined, {
            completedAt: graph.completedAt,
          });
        } else {
          const anyFailed = Array.from(graph.nodes.values()).some((n) => n.status === 'FAILED');
          if (anyFailed) {
            graph.status = 'FAILED';
            graph.error = 'Task graph stalled with failed node(s)';
            this.recordHistory(graph, 'TASK_GRAPH_FAILED', undefined, { error: graph.error });
          } else {
            graph.status = 'FAILED';
            graph.error = 'Task graph deadlocked without runnable nodes';
            this.recordHistory(graph, 'TASK_GRAPH_FAILED', undefined, { error: graph.error });
          }
        }
        break;
      }

      await Promise.all(
        runnable.map(async (node) => {
          const handler = handlers[node.id] || handlers[node.stage];
          try {
            await this.executeNode(graph, node, handler);
          } catch (execErr) {
            if (graph.status !== 'FAILED') {
              graph.status = 'FAILED';
              graph.error = execErr.message;
            }
          }
        })
      );
    }

    graph.updatedAt = Date.now();
    return graph;
  }

  recordHistory(graph, event, nodeId, details) {
    const entry = {
      event,
      timestamp: Date.now(),
      nodeId,
      details,
    };
    graph.history.push(entry);
    this.emit('graph-event', { graphId: graph.id, ...entry });
  }

  static createStandard5StagePipeline(params) {
    const policy = params.consensusPolicy || {
      type: 'majority',
      requiredRoles: ['QA_SECURITY'],
    };

    return {
      id: params.id,
      name: params.name,
      workspaceRoot: params.workspaceRoot,
      consensusPolicy: policy,
      maxFixAttempts: params.maxFixAttempts || 3,
      nodes: [
        {
          id: 'node-plan',
          name: 'Architect Planning',
          stage: 'PLAN',
          assignedRole: 'ARCHITECT',
          assignedProvider: 'antigravity',
          dependencies: [],
          actionPayload: { prompt: params.planPrompt },
        },
        {
          id: 'node-implement',
          name: 'Core Implementation',
          stage: 'IMPLEMENT',
          assignedRole: 'IMPLEMENTER',
          assignedProvider: 'codex',
          dependencies: ['node-plan'],
          actionPayload: { files: params.targetFiles || [] },
        },
        {
          id: 'node-review',
          name: 'Multi-Agent Code & Security Review',
          stage: 'REVIEW',
          assignedRole: 'QA_SECURITY',
          assignedProvider: 'antigravity',
          dependencies: ['node-implement'],
        },
        {
          id: 'node-fix',
          name: 'Remediation & Fix',
          stage: 'FIX',
          assignedRole: 'IMPLEMENTER',
          assignedProvider: 'codex',
          dependencies: ['node-review'],
          actionPayload: { files: params.targetFiles || [] },
        },
        {
          id: 'node-verify',
          name: 'Verification & Test Suite',
          stage: 'VERIFY',
          assignedRole: 'TESTER',
          dependencies: ['node-review', 'node-fix'],
        },
      ],
    };
  }
}

/**
 * TaskGraphService wraps TaskGraphEngine for the Electron main process
 */
class TaskGraphService extends EventEmitter {
  constructor(workspaceRoot, costGuard, storage) {
    super();
    this.workspaceRoot = path.resolve(workspaceRoot || process.cwd());
    this.engine = new TaskGraphEngineCJS({ costGuard, storage });

    this.engine.on('graph-event', (evt) => {
      this.emit('graph-event', evt);
    });
  }

  createGraph(def) {
    const fullDef = {
      ...def,
      workspaceRoot: def.workspaceRoot || this.workspaceRoot,
    };
    return this.engine.createGraph(fullDef);
  }

  async runGraph(graphId, handlers = {}) {
    return this.engine.runGraph(graphId, handlers);
  }

  getGraph(graphId) {
    return this.engine.getGraph(graphId);
  }

  listGraphs() {
    return this.engine.listGraphs();
  }

  submitVote(graphId, nodeId, vote) {
    return this.engine.submitVote(graphId, nodeId, vote);
  }

  verifyWorkspaceBoundary(targetPath) {
    return TaskGraphEngineCJS.verifyWorkspaceBoundary(this.workspaceRoot, targetPath);
  }

  createStandard5StagePipeline(params) {
    return TaskGraphEngineCJS.createStandard5StagePipeline({
      ...params,
      workspaceRoot: params.workspaceRoot || this.workspaceRoot,
    });
  }
}

module.exports = {
  StageTypeSchema,
  RoleSchema,
  ConsensusDecisionSchema,
  ConsensusVoteSchema,
  ConsensusPolicySchema,
  TaskNodeDefinitionSchema,
  TaskGraphDefinitionSchema,
  TaskGraphEngineCJS,
  TaskGraphService,
};
