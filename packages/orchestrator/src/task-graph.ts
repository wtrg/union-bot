/**
 * @file task-graph.ts
 * @description Multi-Agent Task Graph & Consensus Engine for Union Bot (Phase P8).
 * Enforces:
 * - Directed Acyclic Graph (DAG) task orchestration with cycle detection (ERR_CYCLE_DETECTED)
 * - 5-Stage Lifecycle: Plan -> Implement -> Review -> Fix -> Verify
 * - Dynamic Role Assignment & Provider Routing (Architect, Implementer, Reviewer, Tester)
 * - Stale Review Invalidation when implementation files or outputs mutate
 * - Multi-Agent Consensus Protocol & Threshold Voting (unanimous, majority, threshold)
 * - Strict Canonical Workspace Boundary & Zero-Cost Security Inheritance (P5-P7 guarantees)
 * - Durable Event Sourcing & SQLite State Persistence
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

import {
  type Role,
  type ProviderKind,
  type StageType,
  type TaskGraphStatus,
  type NodeExecutionStatus,
  type ConsensusDecision,
  type ConsensusVote,
  type ConsensusPolicy,
  type AuthorizedReviewer,
  type TaskNodeDefinition,
  type TaskGraphDefinition,
  TaskGraphDefinitionSchema,
} from '../../protocol/src/index.ts';

import {
  StorageEngine,
  EventStore,
  UnionBotError,
} from '../../storage/src/index.ts';

import { CostGuard } from '../../cost-guard/src/index.ts';
import { AdmissionPolicyGate } from './admission-gate.ts';

export interface TaskNodeState {
  id: string;
  name: string;
  stage: StageType;
  assignedRole: Role;
  assignedProvider?: ProviderKind;
  dependencies: string[];
  status: NodeExecutionStatus;
  attempt: number;
  actionPayload?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  inputDigest?: string;
  outputDigest?: string;
  targetDigest?: string;
  modifiedFiles?: string[];
  votes: ConsensusVote[];
  staleReason?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface TaskGraphHistoryEntry {
  event: string;
  timestamp: number;
  nodeId?: string;
  details?: Record<string, unknown>;
}

export interface TaskGraphState {
  id: string;
  name: string;
  workspaceRoot: string;
  status: TaskGraphStatus;
  nodes: Map<string, TaskNodeState>;
  consensusPolicy: ConsensusPolicy;
  maxFixAttempts: number;
  currentFixAttempt: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
  history: TaskGraphHistoryEntry[];
}

export interface ConsensusEvaluationResult {
  consensusReached: boolean;
  decision: ConsensusDecision;
  action: 'PROCEED' | 'TRIGGER_FIX' | 'ABORT';
  approvedCount: number;
  rejectedCount: number;
  abstainCount: number;
  totalVotes: number;
  reasons: string[];
}

export interface TaskExecutionContext {
  graph: TaskGraphState;
  workspaceRoot: string;
  costGuard: CostGuard;
  admissionGate: AdmissionPolicyGate;
  sessionRegistry?: any;
  emitEvent: (eventType: string, payload: Record<string, unknown>) => void;
}

export type TaskNodeHandler = (
  node: TaskNodeState,
  context: TaskExecutionContext
) => Promise<{
  result?: unknown;
  status?: NodeExecutionStatus;
  role?: string;
  modifiedFiles?: string[];
  outputDigest?: string;
  votes?: ConsensusVote[];
  error?: string;
  sessionId?: string;
  providerId?: string;
  provenance?: string;
  verificationEvidence?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
}>;

export interface TaskGraphEngineOptions {
  storage?: StorageEngine;
  eventStore?: EventStore;
  costGuard?: CostGuard;
  paidApiEnabled?: boolean;
  sessionRegistry?: any;
}

/**
 * Multi-Agent Task Graph & Consensus Engine
 */
export class TaskGraphEngine extends EventEmitter {
  private readonly graphs = new Map<string, TaskGraphState>();
  public readonly storage?: StorageEngine;
  public readonly eventStore?: EventStore;
  public readonly costGuard: CostGuard;
  public readonly admissionGate: AdmissionPolicyGate;
  public sessionRegistry?: any;
  private providerHandlers: Map<string, TaskNodeHandler> = new Map();

  constructor(options: TaskGraphEngineOptions = {}) {
    super();
    this.storage = options.storage;
    this.eventStore = options.eventStore ?? (this.storage ? new EventStore(this.storage) : undefined);
    this.costGuard = options.costGuard ?? new CostGuard();
    this.sessionRegistry = options.sessionRegistry;
    this.admissionGate = new AdmissionPolicyGate({
      costGuard: this.costGuard,
      paidApiEnabled: options.paidApiEnabled ?? false,
    });
  }

  public setSessionRegistry(registry: any): void {
    this.sessionRegistry = registry;
  }

  public registerProviderHandler(providerIdOrNodeId: string, handler: TaskNodeHandler): void {
    this.providerHandlers.set(providerIdOrNodeId, handler);
  }

  public hasProviderHandler(providerIdOrNodeId: string): boolean {
    return this.providerHandlers.has(providerIdOrNodeId);
  }

  // =========================================================================
  // 1. Filesystem & Security Boundary Defense (Inherited from P5-P7)
  // =========================================================================

  /**
   * Resolves canonical realpath on filesystem, handling non-existent targets
   * via recursive ancestor directory walk (P7-R01 requirement).
   */
  public static getCanonicalPath(targetPath: string): string | null {
    if (!targetPath || typeof targetPath !== 'string' || !targetPath.trim()) {
      return null;
    }
    try {
      const resolved = path.resolve(targetPath.trim());
      try {
        fs.lstatSync(resolved);
        return fs.realpathSync(resolved);
      } catch {
        // target does not exist directly, walk ancestors
      }

      let current = resolved;
      const missing: string[] = [];
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
        if (parent === current) {
          return resolved;
        }
        missing.unshift(path.basename(current));
        current = parent;
      }
    } catch {
      return null;
    }
  }

  /**
   * Canonical Workspace Boundary Defense (Ticket P8-007, P7-R01).
   * Verifies that targetPath is strictly inside workspaceRoot using both
   * lexical containment and realpath filesystem canonicalization.
   */
  public static verifyWorkspaceBoundary(workspaceRoot: string, targetPath: string): boolean {
    if (!workspaceRoot || !targetPath) return false;
    if (typeof workspaceRoot !== 'string' || typeof targetPath !== 'string') return false;
    if (!workspaceRoot.trim() || !targetPath.trim()) return false;

    try {
      // 1. Initial lexical path resolution and containment check (fast-fail)
      const resolvedRoot = path.resolve(workspaceRoot.trim());
      const resolvedTarget = path.resolve(resolvedRoot, targetPath.trim());

      const relLexical = path.relative(resolvedRoot, resolvedTarget);
      if (relLexical.startsWith('..') || path.isAbsolute(relLexical)) {
        return false;
      }

      // 2. Realpath filesystem canonicalization for workspaceRoot
      const canonicalRoot = TaskGraphEngine.getCanonicalPath(resolvedRoot);
      if (!canonicalRoot) {
        return false;
      }

      // 3. Realpath filesystem canonicalization for targetPath
      const canonicalTarget = TaskGraphEngine.getCanonicalPath(resolvedTarget);
      if (!canonicalTarget) {
        return false;
      }

      // 4. Canonical containment verification
      const relCanonical = path.relative(canonicalRoot, canonicalTarget);
      if (relCanonical.startsWith('..') || path.isAbsolute(relCanonical)) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  // =========================================================================
  // 2. DAG Validation & Cycle Detection
  // =========================================================================

  /**
   * Validates DAG definition:
   * - Schema compliance
   * - Unique node IDs
   * - Existing dependency IDs
   * - Cycle detection via DFS (fail-closed with ERR_CYCLE_DETECTED)
   */
  public static validateDAG(graphDef: TaskGraphDefinition): void {
    TaskGraphDefinitionSchema.parse(graphDef);

    const nodeIds = new Set<string>();
    const nodeMap = new Map<string, TaskNodeDefinition>();

    for (const node of graphDef.nodes) {
      if (nodeIds.has(node.id)) {
        throw new UnionBotError({
          code: 'ERR_SCHEMA_VALIDATION_FAILED',
          message: `Duplicate node ID '${node.id}' in task graph definition`,
        });
      }
      nodeIds.add(node.id);
      nodeMap.set(node.id, node);
    }

    // Check all dependency references exist
    for (const node of graphDef.nodes) {
      for (const depId of node.dependencies) {
        if (!nodeIds.has(depId)) {
          throw new UnionBotError({
            code: 'ERR_SCHEMA_VALIDATION_FAILED',
            message: `Node '${node.id}' depends on non-existent node '${depId}'`,
          });
        }
      }
    }

    // Cycle detection via DFS
    const visited = new Set<string>();
    const recStack = new Set<string>();

    function checkCycle(nodeId: string): void {
      visited.add(nodeId);
      recStack.add(nodeId);

      const node = nodeMap.get(nodeId);
      if (node) {
        for (const depId of node.dependencies) {
          if (!visited.has(depId)) {
            checkCycle(depId);
          } else if (recStack.has(depId)) {
            throw new UnionBotError({
              code: 'ERR_CYCLE_DETECTED',
              message: `Cyclic dependency detected in task graph: cycle involves '${nodeId}' -> '${depId}'`,
            });
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

  /**
   * Returns topological order of nodes using Kahn's algorithm (or throws ERR_CYCLE_DETECTED).
   */
  public static getTopologicalOrder(graphDef: TaskGraphDefinition): string[] {
    TaskGraphEngine.validateDAG(graphDef);

    // Build in-degree and adjacency (edge from dependency -> dependent)
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    for (const node of graphDef.nodes) {
      inDegree.set(node.id, node.dependencies.length);
      dependents.set(node.id, []);
    }

    for (const node of graphDef.nodes) {
      for (const dep of node.dependencies) {
        dependents.get(dep)!.push(node.id);
      }
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) queue.push(id);
    }

    const order: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      order.push(current);

      for (const next of dependents.get(current) || []) {
        const newDeg = inDegree.get(next)! - 1;
        inDegree.set(next, newDeg);
        if (newDeg === 0) {
          queue.push(next);
        }
      }
    }

    if (order.length !== graphDef.nodes.length) {
      throw new UnionBotError({
        code: 'ERR_CYCLE_DETECTED',
        message: 'Cyclic dependency detected during topological sort',
      });
    }

    return order;
  }

  // =========================================================================
  // 3. Stale Review Invalidation (Ticket P8-005)
  // =========================================================================

  /**
   * Invalidates downstream REVIEW and VERIFY nodes when an implementation or
   * fix node mutates files or code.
   */
  public invalidateDownstreamReviews(
    graph: TaskGraphState,
    mutatingNodeId: string,
    modifiedFiles: string[] = []
  ): string[] {
    // Find all transitive downstream nodes
    const dependentsMap = new Map<string, string[]>();
    for (const [id, node] of graph.nodes.entries()) {
      for (const dep of node.dependencies) {
        if (!dependentsMap.has(dep)) dependentsMap.set(dep, []);
        dependentsMap.get(dep)!.push(id);
      }
    }

    const downstreamIds = new Set<string>();
    const queue = [mutatingNodeId];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const next of dependentsMap.get(curr) || []) {
        if (!downstreamIds.has(next)) {
          downstreamIds.add(next);
          queue.push(next);
        }
      }
    }

    const invalidatedIds: string[] = [];
    const filesStr = modifiedFiles.length > 0 ? modifiedFiles.join(', ') : 'artifacts/code';

    for (const id of downstreamIds) {
      const node = graph.nodes.get(id);
      if (!node) continue;

      if (node.stage === 'REVIEW' || node.stage === 'VERIFY') {
        if (node.status === 'COMPLETED' || node.status === 'WAITING_APPROVAL' || node.status === 'RUNNING') {
          node.status = 'STALE';
          node.staleReason = `Invalidated due to mutation in upstream node '${mutatingNodeId}' (${filesStr})`;
          node.votes = []; // Clear outdated consensus votes
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

  // =========================================================================
  // 4. Multi-Agent Consensus Protocol & Threshold Voting (Ticket P8-006)
  // =========================================================================

  /**
   * Evaluates consensus votes according to policy and attempt limits.
   */
  public static evaluateConsensus(
    votes: ConsensusVote[],
    policy: ConsensusPolicy,
    currentAttempt: number = 1,
    maxAttempts: number = 3
  ): ConsensusEvaluationResult {
    // Fail-closed if no votes recorded (P8-R01-001)
    if (!votes || votes.length === 0) {
      const willRetry = currentAttempt < maxAttempts;
      return {
        consensusReached: false,
        decision: 'REJECT',
        action: willRetry ? 'TRIGGER_FIX' : 'ABORT',
        approvedCount: 0,
        rejectedCount: 0,
        abstainCount: 0,
        totalVotes: 0,
        reasons: ['No consensus votes recorded for review node (fail-closed)'],
      };
    }

    let approvedCount = 0;
    let rejectedCount = 0;
    let abstainCount = 0;
    const reasons: string[] = [];

    const approvingRoles = new Set<Role>();

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

    if (policy.type === 'unanimous') {
      thresholdSatisfied = rejectedCount === 0 && approvedCount > 0;
    } else if (policy.type === 'majority') {
      thresholdSatisfied = totalDecisive > 0 && approvedCount / totalDecisive > 0.5;
    } else if (policy.type === 'threshold') {
      const minRatio = policy.minThreshold ?? 0.6;
      thresholdSatisfied = totalDecisive > 0 && approvedCount / totalDecisive >= minRatio;
    }

    // Check required roles
    if (policy.requiredRoles && policy.requiredRoles.length > 0) {
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

    // Consensus failed
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

  // =========================================================================
  // 5. Graph Creation & Management
  // =========================================================================

  /**
   * Creates a new managed task graph from a definition.
   */
  public createGraph(def: TaskGraphDefinition): TaskGraphState {
    TaskGraphEngine.validateDAG(def);

    // Verify workspaceRoot canonical existence
    const canonicalRoot = TaskGraphEngine.getCanonicalPath(def.workspaceRoot);
    if (!canonicalRoot) {
      throw new UnionBotError({
        code: 'ERR_PATH_TRAVERSAL_DENIED',
        message: `Task graph workspaceRoot '${def.workspaceRoot}' is invalid or cannot be canonicalized`,
      });
    }

    const now = Date.now();
    const nodes = new Map<string, TaskNodeState>();

    for (const nodeDef of def.nodes) {
      nodes.set(nodeDef.id, {
        id: nodeDef.id,
        name: nodeDef.name,
        stage: nodeDef.stage,
        assignedRole: nodeDef.assignedRole,
        assignedProvider: nodeDef.assignedProvider,
        dependencies: [...nodeDef.dependencies],
        targetDigest: nodeDef.targetDigest,
        status: 'PENDING',
        attempt: 1,
        actionPayload: nodeDef.actionPayload ? { ...nodeDef.actionPayload } : undefined,
        votes: [],
      });
    }

    const state: TaskGraphState = {
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

    if (this.storage) {
      this.storage.createTask({
        id: def.id,
        title: def.name,
        status: 'pending',
        progress: 0,
        metadata: {
          workspaceRoot: canonicalRoot,
          nodeCount: def.nodes.length,
          consensusPolicy: def.consensusPolicy,
        },
      });
    }

    return state;
  }

  /**
   * Retrieves a graph state by ID.
   */
  public getGraph(graphId: string): TaskGraphState | undefined {
    return this.graphs.get(graphId);
  }

  /**
   * Lists all managed task graphs.
   */
  public listGraphs(): TaskGraphState[] {
    return Array.from(this.graphs.values());
  }

  /**
   * Registers an authorized reviewer in the graph consensus policy (Ticket P8-R01-003).
   */
  public registerReviewer(graphId: string, reviewer: AuthorizedReviewer): void {
    const graph = this.graphs.get(graphId);
    if (!graph) {
      throw new UnionBotError({
        code: 'ERR_TASK_GRAPH_FAILED',
        message: `Task graph '${graphId}' not found`,
      });
    }

    if (!graph.consensusPolicy.authorizedReviewers) {
      graph.consensusPolicy.authorizedReviewers = [];
    }

    const existingIdx = graph.consensusPolicy.authorizedReviewers.findIndex(
      (r) => r.voterId === reviewer.voterId
    );
    if (existingIdx >= 0) {
      graph.consensusPolicy.authorizedReviewers[existingIdx] = { ...reviewer };
    } else {
      graph.consensusPolicy.authorizedReviewers.push({ ...reviewer });
    }

    this.recordHistory(graph, 'AUTHORIZED_REVIEWER_REGISTERED', undefined, {
      voterId: reviewer.voterId,
      role: reviewer.role,
    });
  }

  /**
   * Submits a consensus vote for a node in a graph.
   * Enforces:
   * - Node must be in REVIEW stage (ERR_INVALID_STAGE_TRANSITION)
   * - Authorized voter registry verification (ERR_UNAUTHORIZED_VOTER)
   * - Role binding authentication (ERR_ROLE_MISMATCH)
   * - Reviewed code digest verification against active targetDigest (ERR_STALE_VOTE_DIGEST)
   * - Idempotent voter replacement (one active vote per voter per target version)
   */
  public submitVote(graphId: string, nodeId: string, vote: ConsensusVote): void {
    const graph = this.graphs.get(graphId);
    if (!graph) {
      throw new UnionBotError({
        code: 'ERR_TASK_GRAPH_FAILED',
        message: `Task graph '${graphId}' not found`,
      });
    }

    const node = graph.nodes.get(nodeId);
    if (!node) {
      throw new UnionBotError({
        code: 'ERR_TASK_GRAPH_FAILED',
        message: `Node '${nodeId}' not found in graph '${graphId}'`,
      });
    }

    if (node.stage !== 'REVIEW') {
      throw new UnionBotError({
        code: 'ERR_INVALID_STAGE_TRANSITION',
        message: `Cannot submit consensus vote on node '${nodeId}' in stage '${node.stage}'. Votes can only be submitted on REVIEW nodes.`,
      });
    }

    // 1. Authorized voter & role derivation (fail-closed, P8-R02-002)
    if (!graph.consensusPolicy.authorizedReviewers || graph.consensusPolicy.authorizedReviewers.length === 0) {
      throw new UnionBotError({
        code: 'ERR_UNAUTHORIZED_VOTER',
        message: `No authorized reviewers registered for graph '${graphId}'. Voting is fail-closed.`,
      });
    }

    const authorized = graph.consensusPolicy.authorizedReviewers.find(
      (r) => r.voterId === vote.voterId
    );
    if (!authorized) {
      throw new UnionBotError({
        code: 'ERR_UNAUTHORIZED_VOTER',
        message: `Voter '${vote.voterId}' is not an authorized reviewer for graph '${graphId}'`,
      });
    }

    // Backend authoritative provider session identity check (P9-R01-001)
    const isProviderBound = Boolean(authorized.providerId || (typeof vote.voterId === 'string' && vote.voterId.startsWith('wps_')));
    if (this.sessionRegistry && isProviderBound) {
      const session = this.sessionRegistry.getSessionById
        ? this.sessionRegistry.getSessionById(vote.voterId)
        : null;
      if (!session) {
        throw new UnionBotError({
          code: 'ERR_PROVIDER_SESSION_NOT_FOUND',
          message: `ERR_PROVIDER_SESSION_NOT_FOUND: Voter '${vote.voterId}' does not correspond to an active authenticated backend provider session`,
        });
      }
      if (vote.voterRole && vote.voterRole !== session.assignedRole) {
        throw new UnionBotError({
          code: 'ERR_ROLE_MISMATCH',
          message: `ERR_ROLE_MISMATCH: Voter session '${vote.voterId}' has authoritative role '${session.assignedRole}', cannot claim role '${vote.voterRole}'`,
        });
      }
      if (authorized.providerId && authorized.providerId !== session.providerId) {
        throw new UnionBotError({
          code: 'ERR_UNAUTHORIZED_ACTION',
          message: `ERR_UNAUTHORIZED_ACTION: Session provider '${session.providerId}' does not match authorized reviewer provider '${authorized.providerId}'`,
        });
      }
    }

    if (vote.voterRole && vote.voterRole !== authorized.role) {
      throw new UnionBotError({
        code: 'ERR_ROLE_MISMATCH',
        message: `Voter '${vote.voterId}' claimed role '${vote.voterRole}', but is registered as '${authorized.role}'`,
      });
    }

    // Backend authoritative role enforcement: caller cannot self-grant or spoof role
    vote.voterRole = authorized.role;

    // 2. Digest check: targetDigest must be locked by upstream implementation before voting (P8-R02-001)
    if (!node.targetDigest) {
      for (const depId of node.dependencies) {
        const dep = graph.nodes.get(depId);
        if (dep && (dep.stage === 'IMPLEMENT' || dep.stage === 'FIX') && dep.outputDigest) {
          node.targetDigest = dep.outputDigest;
          break;
        }
      }
    }

    if (!node.targetDigest) {
      throw new UnionBotError({
        code: 'ERR_REVIEW_TARGET_NOT_READY',
        message: `Cannot submit vote on review node '${nodeId}': target code digest is not yet ready or locked by upstream implementation`,
      });
    }

    if (!vote.reviewedDigest || vote.reviewedDigest !== node.targetDigest) {
      throw new UnionBotError({
        code: 'ERR_STALE_VOTE_DIGEST',
        message: `Vote reviewedDigest '${vote.reviewedDigest}' does not match active review targetDigest '${node.targetDigest}'`,
      });
    }

    // 3. Deduplication / Deterministic single-vote replacement per voter (P8-R01-003)
    const existingIdx = node.votes.findIndex((v) => v.voterId === vote.voterId);
    const voteEntry: ConsensusVote = {
      ...vote,
      timestamp: vote.timestamp || Date.now(),
    };

    if (existingIdx >= 0) {
      node.votes[existingIdx] = voteEntry;
    } else {
      node.votes.push(voteEntry);
    }

    this.recordHistory(graph, 'CONSENSUS_VOTE_RECORDED', nodeId, {
      voterId: vote.voterId,
      voterRole: vote.voterRole,
      decision: vote.decision,
      reviewedDigest: vote.reviewedDigest,
      rationale: vote.rationale,
      isReplacement: existingIdx >= 0,
    });
  }

  /**
   * Finds runnable nodes (status is PENDING or STALE, and all dependencies are satisfied).
   * Supports:
   * - Standard sequential/parallel branches
   * - Remediation loop: FIX node is runnable when upstream REVIEW is REMEDIATING or FAILED
   * - Verification node: runnable when upstream REVIEW is COMPLETED and FIX is COMPLETED or SKIPPED
   */
  public getRunnableNodes(graph: TaskGraphState): TaskNodeState[] {
    const runnable: TaskNodeState[] = [];

    for (const node of graph.nodes.values()) {
      if (node.status === 'PENDING' || node.status === 'STALE') {
        const allDepsSatisfied = node.dependencies.every((depId) => {
          const dep = graph.nodes.get(depId);
          if (!dep) return false;

          // If this is a FIX node, its upstream REVIEW dependency is satisfied when REVIEW is REMEDIATING or FAILED
          if (node.stage === 'FIX' && dep.stage === 'REVIEW') {
            return dep.status === 'REMEDIATING' || dep.status === 'FAILED';
          }

          // If this is a VERIFY node:
          // If upstream FIX was SKIPPED, satisfied
          // If upstream FIX ran, FIX must be COMPLETED and REVIEW must be COMPLETED
          return dep.status === 'COMPLETED' || dep.status === 'SKIPPED';
        });

        if (allDepsSatisfied) {
          runnable.push(node);
        }
      }
    }

    return runnable;
  }

  // =========================================================================
  // 6. Execution Loop & Handler Dispatch
  // =========================================================================

  /**
   * Executes a single node with boundary and zero-cost checks.
   */
  public async executeNode(
    graph: TaskGraphState,
    node: TaskNodeState,
    handler?: TaskNodeHandler
  ): Promise<TaskNodeState> {
    node.status = 'RUNNING';
    node.startedAt = Date.now();
    this.recordHistory(graph, 'TASK_NODE_STARTED', node.id, {
      stage: node.stage,
      role: node.assignedRole,
      attempt: node.attempt,
    });

    // 1. Strict Canonical Workspace Boundary Check on actionPayload (Ticket P8-007)
    if (node.actionPayload) {
      const payload = node.actionPayload;

      // Check targetPath or cwd
      const targetPath = (payload.targetPath as string) || (payload.cwd as string);
      if (targetPath) {
        const isInside = TaskGraphEngine.verifyWorkspaceBoundary(graph.workspaceRoot, targetPath);
        if (!isInside) {
          node.status = 'FAILED';
          node.error = `ERR_PATH_TRAVERSAL_DENIED: Target path '${targetPath}' escapes workspace boundary`;
          this.recordHistory(graph, 'TASK_NODE_FAILED', node.id, { error: node.error });
          throw new UnionBotError({
            code: 'ERR_PATH_TRAVERSAL_DENIED',
            message: node.error,
          });
        }
      }

      // Check modified/target files array
      if (Array.isArray(payload.files)) {
        for (const file of payload.files) {
          if (typeof file === 'string') {
            const isInside = TaskGraphEngine.verifyWorkspaceBoundary(graph.workspaceRoot, file);
            if (!isInside) {
              node.status = 'FAILED';
              node.error = `ERR_PATH_TRAVERSAL_DENIED: File '${file}' escapes workspace boundary`;
              this.recordHistory(graph, 'TASK_NODE_FAILED', node.id, { error: node.error });
              throw new UnionBotError({
                code: 'ERR_PATH_TRAVERSAL_DENIED',
                message: node.error,
              });
            }
          }
        }
      }

      // Zero-Cost & Policy Gate Check
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
        throw new UnionBotError({
          code: 'ERR_COST_LIMIT_EXCEEDED',
          message: node.error,
        });
      }
    }

    const activeHandler = handler || this.providerHandlers.get(node.id) || (node.assignedProvider ? this.providerHandlers.get(node.assignedProvider) : undefined);

    // For provider-assigned nodes, fail-closed if no handler or session transport is available (P9-R01-002)
    if (node.assignedProvider && !activeHandler) {
      node.status = 'FAILED';
      node.error = `ERR_PROVIDER_HANDLER_UNAVAILABLE: No execution handler or session transport registered for provider '${node.assignedProvider}' on node '${node.id}'`;
      this.recordHistory(graph, 'TASK_NODE_FAILED', node.id, { error: node.error });
      throw new UnionBotError({
        code: 'ERR_PROVIDER_HANDLER_UNAVAILABLE',
        message: node.error,
      });
    }

    // 2. Execute Handler
    try {
      const context: TaskExecutionContext = {
        graph,
        workspaceRoot: graph.workspaceRoot,
        costGuard: this.costGuard,
        admissionGate: this.admissionGate,
        sessionRegistry: this.sessionRegistry,
        emitEvent: (evt, p) => this.recordHistory(graph, evt, node.id, p),
      };

      const executionResult = activeHandler
        ? await activeHandler(node, context)
        : { result: `Node ${node.id} executed successfully` };

      // Phase P9: When handler transitions to WAITING_INPUT (e.g. web provider awaiting user input/turn response)
      if (executionResult.status === 'WAITING_INPUT') {
        node.status = 'WAITING_INPUT';
        node.error = executionResult.error;
        if (node.assignedProvider) {
          const session = this.sessionRegistry?.getSessionByProvider?.(node.assignedProvider);
          node.result = {
            ...(typeof executionResult.result === 'object' && executionResult.result !== null ? executionResult.result : { output: executionResult.result }),
            sessionId: executionResult.sessionId || session?.sessionId,
            providerId: node.assignedProvider,
            role: node.assignedRole,
            provenance: executionResult.provenance || 'UNVERIFIED',
          };
        }
        this.recordHistory(graph, 'TASK_NODE_WAITING_INPUT', node.id, {
          providerId: node.assignedProvider,
          reason: node.error,
        });
        return node;
      }

      if (executionResult.error) {
        node.status = 'FAILED';
        node.error = executionResult.error;
        this.recordHistory(graph, 'TASK_NODE_FAILED', node.id, { error: node.error });
        return node;
      }

      if (node.assignedProvider) {
        const session = this.sessionRegistry?.getSessionByProvider?.(node.assignedProvider);
        node.result = {
          ...(typeof executionResult.result === 'object' && executionResult.result !== null ? executionResult.result : { output: executionResult.result }),
          sessionId: executionResult.sessionId || session?.sessionId,
          providerId: node.assignedProvider,
          role: node.assignedRole,
          provenance: executionResult.provenance || (node.assignedProvider === 'codex' || node.assignedProvider === 'antigravity' ? 'LOCAL_AGENT' : 'LIVE_WEB'),
        };
      } else {
        node.result = executionResult.result;
      }

      node.outputDigest = executionResult.outputDigest;
      node.modifiedFiles = executionResult.modifiedFiles;

      if (executionResult.votes) {
        for (const v of executionResult.votes) {
          this.submitVote(graph.id, node.id, v);
        }
      }

      // 3. Stage-Specific Logic
      if (node.stage === 'REVIEW') {
        // Resolve active targetDigest from dependencies if not explicitly set
        if (!node.targetDigest) {
          for (const depId of node.dependencies) {
            const dep = graph.nodes.get(depId);
            if (dep?.outputDigest) {
              node.targetDigest = dep.outputDigest;
              break;
            }
          }
        }

        // NO synthetic approvals (Ticket P8-R01-001): evaluate consensus strictly on authentic recorded votes
        const consensusResult = TaskGraphEngine.evaluateConsensus(
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
          // Trigger Fix stage with explicit REMEDIATING state (P8-R01-002)
          graph.currentFixAttempt++;
          node.status = 'REMEDIATING';
          node.error = `Consensus rejected: ${consensusResult.reasons.join('; ')}`;

          // Find downstream FIX node and pass feedback
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
          // Max attempts reached without consensus -> Graph Fails
          node.status = 'FAILED';
          node.error = `Consensus failed permanently after ${graph.maxFixAttempts} attempts: ${consensusResult.reasons.join('; ')}`;
          graph.status = 'FAILED';
          graph.error = node.error;
        }
      } else if (node.stage === 'IMPLEMENT') {
        node.status = 'COMPLETED';
        node.completedAt = Date.now();
        // Authentic output digest required (P9-R01-002)
        if (!executionResult.outputDigest) {
          node.status = 'FAILED';
          node.error = `ERR_MISSING_OUTPUT_DIGEST: IMPLEMENT node must produce an authentic output digest from actual artifact execution`;
          this.recordHistory(graph, 'TASK_NODE_FAILED', node.id, { error: node.error });
          throw new UnionBotError({
            code: 'ERR_TASK_GRAPH_FAILED',
            message: node.error,
          });
        }
        node.outputDigest = executionResult.outputDigest;

        // Propagate outputDigest to downstream REVIEW nodes as their targetDigest (P8-R02-001)
        for (const candidate of graph.nodes.values()) {
          if (candidate.stage === 'REVIEW' && (candidate.dependencies.includes(node.id) || candidate.dependencies.length === 0)) {
            if (candidate.targetDigest !== node.outputDigest) {
              candidate.targetDigest = node.outputDigest;
              candidate.votes = []; // Invalidate stale votes if digest changed
            }
          }
        }

        const modFiles = executionResult.modifiedFiles || (node.actionPayload?.files as string[]) || [];
        if (modFiles.length > 0) {
          this.invalidateDownstreamReviews(graph, node.id, modFiles);
        }
      } else if (node.stage === 'FIX') {
        node.status = 'COMPLETED';
        node.completedAt = Date.now();
        node.outputDigest = executionResult.outputDigest || crypto.createHash('sha256').update(JSON.stringify(node.result || `${node.id}-fix-${node.attempt}`)).digest('hex');

        // Automatic Remediation Loop (P8-R01-002): Reset upstream review node for re-review!
        const reviewNodeId = (node.actionPayload?.reviewNodeId as string) ||
          Array.from(graph.nodes.values()).find((n) => n.stage === 'REVIEW')?.id;
        if (reviewNodeId) {
          const revNode = graph.nodes.get(reviewNodeId);
          if (revNode) {
            revNode.status = 'PENDING';
            revNode.attempt++;
            revNode.votes = [];
            revNode.targetDigest = node.outputDigest;
            revNode.error = undefined;
            this.recordHistory(graph, 'TASK_NODE_RESET_FOR_REREVIEW', revNode.id, {
              fixNodeId: node.id,
              attempt: revNode.attempt,
              newTargetDigest: revNode.targetDigest,
            });
          }
        }

        const modFiles = executionResult.modifiedFiles || (node.actionPayload?.files as string[]) || [];
        if (modFiles.length > 0) {
          this.invalidateDownstreamReviews(graph, node.id, modFiles);
        }
      } else if (node.stage === 'VERIFY') {
        node.status = 'COMPLETED';
        node.completedAt = Date.now();
        if (node.assignedProvider && !executionResult.verificationEvidence && !executionResult.evidence) {
          node.status = 'FAILED';
          node.error = `ERR_MISSING_VERIFY_EVIDENCE: VERIFY node executed by provider '${node.assignedProvider}' must produce authentic verification evidence`;
          this.recordHistory(graph, 'TASK_NODE_FAILED', node.id, { error: node.error });
          throw new UnionBotError({
            code: 'ERR_TASK_GRAPH_FAILED',
            message: node.error,
          });
        }
        node.result = {
          ...(typeof node.result === 'object' && node.result !== null ? node.result : {}),
          verified: true,
          verificationEvidence: executionResult.verificationEvidence || executionResult.evidence,
        };
      } else {
        node.status = 'COMPLETED';
        node.completedAt = Date.now();
      }

      this.recordHistory(graph, 'TASK_NODE_COMPLETED', node.id, {
        status: node.status,
        stage: node.stage,
      });

      return node;
    } catch (err: any) {
      node.status = 'FAILED';
      node.error = err.message;
      this.recordHistory(graph, 'TASK_NODE_FAILED', node.id, { error: err.message });
      throw err;
    }
  }

  /**
   * Runs the task graph to completion or until failure.
   */
  public async runGraph(
    graphId: string,
    handlers: Record<string, TaskNodeHandler> = {}
  ): Promise<TaskGraphState> {
    const graph = this.graphs.get(graphId);
    if (!graph) {
      throw new UnionBotError({
        code: 'ERR_TASK_GRAPH_FAILED',
        message: `Task graph '${graphId}' not found`,
      });
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
        // Check if all nodes are completed
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
          // Check if any node is awaiting input
          const anyWaitingInput = Array.from(graph.nodes.values()).some((n) => n.status === 'WAITING_INPUT');
          if (anyWaitingInput) {
            graph.status = 'WAITING_INPUT';
            const waitingNode = Array.from(graph.nodes.values()).find((n) => n.status === 'WAITING_INPUT');
            graph.error = waitingNode?.error || 'Task graph awaiting provider response or authentication';
            this.recordHistory(graph, 'TASK_GRAPH_WAITING_INPUT', waitingNode?.id, { error: graph.error });
          } else {
            // Any failed nodes?
            const anyFailed = Array.from(graph.nodes.values()).some((n) => n.status === 'FAILED');
            if (anyFailed) {
              graph.status = 'FAILED';
              if (!graph.error) {
                const failedNode = Array.from(graph.nodes.values()).find((n) => n.status === 'FAILED' && n.error);
                graph.error = failedNode?.error || 'Task graph stalled with failed node(s)';
              }
              this.recordHistory(graph, 'TASK_GRAPH_FAILED', undefined, { error: graph.error });
            } else {
              // Stalled without runnable nodes
              graph.status = 'FAILED';
              graph.error = 'Task graph deadlocked without runnable nodes';
              this.recordHistory(graph, 'TASK_GRAPH_FAILED', undefined, { error: graph.error });
            }
          }
        }
        break;
      }

      // Execute runnable nodes in parallel (or serial if desired)
      await Promise.all(
        runnable.map(async (node) => {
          const handler = handlers[node.id] || (node.assignedProvider ? handlers[node.assignedProvider] : undefined) || handlers[node.stage];
          try {
            await this.executeNode(graph, node, handler);
          } catch (execErr: any) {
            // Node failed
            if (graph.status !== 'FAILED') {
              graph.status = 'FAILED';
              graph.error = execErr.message;
            }
          }
        })
      );
    }

    graph.updatedAt = Date.now();

    if (this.storage) {
      this.storage.updateTask(graph.id, {
        status: graph.status.toLowerCase(),
        progress: graph.status === 'COMPLETED' ? 100 : 50,
        metadata: {
          error: graph.error,
          historyCount: graph.history.length,
        },
      });
    }

    return graph;
  }

  /**
   * Records a history entry and optionally emits to eventStore.
   */
  private recordHistory(
    graph: TaskGraphState,
    event: string,
    nodeId?: string,
    details?: Record<string, unknown>
  ): void {
    const entry: TaskGraphHistoryEntry = {
      event,
      timestamp: Date.now(),
      nodeId,
      details,
    };
    graph.history.push(entry);
    this.emit('graph-event', { graphId: graph.id, ...entry });

    if (this.eventStore) {
      try {
        this.eventStore.appendEvent(`task-graph:${graph.id}`, event, {
          graphId: graph.id,
          nodeId,
          ...details,
        });
      } catch {}
    }
  }

  // =========================================================================
  // 7. Standard 5-Stage Pipeline Factory
  // =========================================================================

  /**
   * Creates a standard 5-stage task graph definition:
   * Plan -> Implement -> Review -> Fix -> Verify
   */
  public static createStandard5StagePipeline(params: {
    id: string;
    name: string;
    workspaceRoot: string;
    planPrompt: string;
    targetFiles?: string[];
    consensusPolicy?: ConsensusPolicy;
    maxFixAttempts?: number;
  }): TaskGraphDefinition {
    const defaultAuthorizedReviewers: AuthorizedReviewer[] = [
      { voterId: 'reviewer-security-1', role: 'QA_SECURITY' },
      { voterId: 'reviewer-arch-1', role: 'ARCHITECT' },
      { voterId: 'reviewer-qa-1', role: 'REVIEWER' },
      { voterId: 'qa-sec-auditor', role: 'QA_SECURITY' },
      { voterId: 'agent-implementer', role: 'IMPLEMENTER' },
    ];

    const policy: ConsensusPolicy = {
      type: params.consensusPolicy?.type || 'majority',
      minThreshold: params.consensusPolicy?.minThreshold,
      requiredRoles: params.consensusPolicy?.requiredRoles || ['QA_SECURITY'],
      authorizedReviewers: params.consensusPolicy?.authorizedReviewers !== undefined
        ? params.consensusPolicy.authorizedReviewers
        : defaultAuthorizedReviewers,
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
          actionPayload: {
            prompt: params.planPrompt,
          },
        },
        {
          id: 'node-implement',
          name: 'Core Implementation',
          stage: 'IMPLEMENT',
          assignedRole: 'IMPLEMENTER',
          assignedProvider: 'codex',
          dependencies: ['node-plan'],
          actionPayload: {
            files: params.targetFiles || [],
          },
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
          actionPayload: {
            files: params.targetFiles || [],
          },
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

  /**
   * Phase P9: Creates standard 6-AI Collaborative Workflow Pipeline
   * ChatGPT (LEADER) -> Gemini (RESEARCHER) -> Claude (ARCHITECT) -> Antigravity (IMPLEMENTER) -> DeepSeek (REVIEWER) -> Codex (QA_SECURITY/VERIFY)
   */
  public static create6AIPipeline(params: {
    id: string;
    name: string;
    workspaceRoot: string;
    taskPrompt: string;
    targetFiles?: string[];
    consensusPolicy?: ConsensusPolicy;
    maxFixAttempts?: number;
    sessionRegistry?: { getSessionByProvider: (providerId: string) => { sessionId: string; assignedRole?: string; providerId: string } | null };
    sessions?: Array<{ sessionId: string; assignedRole: string; providerId: string }>;
  }): TaskGraphDefinition {
    let authorizedReviewers: AuthorizedReviewer[] = [];

    if (params.sessionRegistry) {
      const chatgpt = params.sessionRegistry.getSessionByProvider('chatgpt');
      const claude = params.sessionRegistry.getSessionByProvider('claude');
      const deepseek = params.sessionRegistry.getSessionByProvider('deepseek');
      const codex = params.sessionRegistry.getSessionByProvider('codex');

      if (chatgpt) authorizedReviewers.push({ voterId: chatgpt.sessionId, role: (chatgpt.assignedRole as Role) || 'LEADER', providerId: 'chatgpt' });
      if (claude) authorizedReviewers.push({ voterId: claude.sessionId, role: (claude.assignedRole as Role) || 'ARCHITECT', providerId: 'claude' });
      if (deepseek) authorizedReviewers.push({ voterId: deepseek.sessionId, role: (deepseek.assignedRole as Role) || 'REVIEWER', providerId: 'deepseek' });
      if (codex) authorizedReviewers.push({ voterId: codex.sessionId, role: (codex.assignedRole as Role) || 'QA_SECURITY', providerId: 'codex' });
    } else if (params.sessions && params.sessions.length > 0) {
      authorizedReviewers = params.sessions.map((s) => ({
        voterId: s.sessionId,
        role: s.assignedRole as Role,
        providerId: s.providerId,
      }));
    } else if (params.consensusPolicy?.authorizedReviewers && params.consensusPolicy.authorizedReviewers.length > 0) {
      authorizedReviewers = params.consensusPolicy.authorizedReviewers;
    }

    const policy: ConsensusPolicy = {
      type: params.consensusPolicy?.type || 'majority',
      minThreshold: params.consensusPolicy?.minThreshold,
      requiredRoles: params.consensusPolicy?.requiredRoles || ['REVIEWER', 'QA_SECURITY'],
      authorizedReviewers,
    };

    return {
      id: params.id,
      name: params.name,
      workspaceRoot: params.workspaceRoot,
      consensusPolicy: policy,
      maxFixAttempts: params.maxFixAttempts || 3,
      nodes: [
        {
          id: 'node-scope',
          name: 'ChatGPT Product & Scope Alignment',
          stage: 'PLAN',
          assignedRole: 'LEADER',
          assignedProvider: 'chatgpt',
          dependencies: [],
          actionPayload: { prompt: params.taskPrompt },
        },
        {
          id: 'node-research',
          name: 'Gemini Multimodal Research & Context Exploration',
          stage: 'PLAN',
          assignedRole: 'RESEARCHER',
          assignedProvider: 'gemini',
          dependencies: ['node-scope'],
        },
        {
          id: 'node-arch',
          name: 'Claude System Architecture & Threat Model',
          stage: 'PLAN',
          assignedRole: 'ARCHITECT',
          assignedProvider: 'claude',
          dependencies: ['node-research'],
        },
        {
          id: 'node-implement',
          name: 'Antigravity Local Implementation & Workspace Builder',
          stage: 'IMPLEMENT',
          assignedRole: 'IMPLEMENTER',
          assignedProvider: 'antigravity',
          dependencies: ['node-arch'],
          actionPayload: { files: params.targetFiles || [] },
        },
        {
          id: 'node-algo-review',
          name: 'DeepSeek Code & Algorithm Efficiency Review',
          stage: 'REVIEW',
          assignedRole: 'REVIEWER',
          assignedProvider: 'deepseek',
          dependencies: ['node-implement'],
        },
        {
          id: 'node-qa-verify',
          name: 'Codex Static & Runtime Verification Audit',
          stage: 'VERIFY',
          assignedRole: 'QA_SECURITY',
          assignedProvider: 'codex',
          dependencies: ['node-algo-review'],
        },
      ],
    };
  }
}
