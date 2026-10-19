/**
 * @file orchestrator.cjs
 * @description Electron main process Orchestrator & AdmissionPolicyGate integration.
 * Enforces:
 * - Strict Envelope schema validation before room dispatch
 * - Sender identity verification & anti-spoofing (renderer cannot forge system/orchestrator roles)
 * - Zero-Cost (0đ) AdmissionPolicyGate (DENY_UNKNOWN_COST on missing/undefined cost)
 * - Room history isolation, idempotency deduplication, and outbox/audit tracking
 * - 100% schema and behavior parity with canonical TypeScript packages (@union-bot/protocol)
 */

const crypto = require('node:crypto');
const { z } = require('zod');
const { CostGuard } = require('./cost-guard.cjs');
const { computeCanonicalDigest, computeEnvelopeDigest, extractActionSemanticInput } = require('./canonical-json.cjs');

const SCHEMA_VERSION = '1.0.0';

// 1. Protocol Schemas
const RoleSchema = z.enum([
  'LEADER',
  'IMPLEMENTER',
  'QA_SECURITY',
  'RESEARCHER',
  'ORCHESTRATOR',
  'USER',
]);

const ProviderKindSchema = z.enum([
  'chatgpt',
  'gemini',
  'claude',
  'deepseek',
  'codex',
  'antigravity',
  'system',
]);

const FidelityLevelSchema = z.enum([
  'L0_RAW_TEXT',
  'L1_FORMATTED_MARKDOWN',
  'L2_STANDALONE_ARTIFACT',
  'L3_INTERACTIVE_CANVAS',
]);

const SemanticPreservationLabelSchema = z.enum([
  'original_bytes',
  'structured_copy',
  'rendered_preview',
  'screenshot_only',
  'external_reference',
  'unavailable',
]);

const ContentFidelitySchema = z.enum([
  'original_bytes',
  'structured_copy',
  'rendered_preview',
  'screenshot_only',
  'external_reference',
  'unavailable',
  // Backward compatibility legacy labels
  'RAW_BINARY',
  'SEMANTIC_INTERACTIVE',
  'STRUCTURED_DOC',
  'VECTOR_EMBEDDING',
  'LOSSLESS_EXPORT',
  'LOSSLESS_PREVIEW',
]);

const SenderKindSchema = z.enum(['agent', 'human', 'user', 'system']);
const RecipientKindSchema = z.enum(['agent', 'room', 'system', 'broadcast']);

const AuthStatusSchema = z.enum([
  'UNKNOWN',
  'NOT_VERIFIED',
  'AUTHENTICATED',
  'ANONYMOUS',
  'EXPIRED',
  'CHALLENGE_REQUIRED',
]);

const EvidenceProvenanceSchema = z.enum([
  'UNVERIFIED',
  'LIVE_WEB',
  'LOCAL_RPC',
  'CLI_HEADLESS',
  'USER_MANUAL',
  'RECONSTRUCTED',
]);

const TransferStatusSchema = z.enum([
  'VERIFIED_TRANSFERRED',
  'PARTIAL_DEGRADED',
  'NATIVE_ONLY',
]);

const ProviderIdentitySchema = z.object({
  provider: ProviderKindSchema,
  profileId: z.string().min(1),
  profileName: z.string().optional(),
  sessionId: z.string().optional(),
  partitionKey: z.string().optional(),
  capabilityVersion: z.string().default('1.0.0'),
  authStatus: AuthStatusSchema.default('NOT_VERIFIED'),
  evidenceProvenance: EvidenceProvenanceSchema.default('UNVERIFIED'),
});

const TextMessagePartSchema = z.object({
  kind: z.literal('text'),
  text: z.string(),
});

const CodeMessagePartSchema = z.object({
  kind: z.literal('code'),
  language: z.string(),
  content: z.string(),
  filename: z.string().optional(),
});

const ArtifactMessagePartSchema = z.object({
  kind: z.literal('artifact'),
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/, 'Invalid SHA256 hex string'),
  mimeType: z.string(),
  filename: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  previewUrl: z.string().optional(),
  contentFidelity: ContentFidelitySchema.default('RAW_BINARY'),
});

const ActionMessagePartSchema = z.object({
  kind: z.literal('action'),
  tool: z.string(),
  callId: z.string(),
  status: z.enum(['requested', 'executing', 'completed', 'failed']),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  isUntrustedRendererInput: z.boolean().optional(),
  approvalTokenId: z.string().optional(),
  payloadDigest: z.string().optional(),
});

const StatusMessagePartSchema = z.object({
  kind: z.literal('status'),
  code: z.string(),
  message: z.string(),
  level: z.enum(['info', 'warning', 'error']),
});

const MessagePartSchema = z.discriminatedUnion('kind', [
  TextMessagePartSchema,
  CodeMessagePartSchema,
  ArtifactMessagePartSchema,
  ActionMessagePartSchema,
  StatusMessagePartSchema,
]);

const SenderSchema = z.object({
  kind: SenderKindSchema,
  id: z.string().min(1),
  name: z.string().min(1),
  role: RoleSchema.optional(),
  provider: ProviderKindSchema.optional(),
  providerIdentity: ProviderIdentitySchema.optional(),
});

const RecipientSchema = z.object({
  kind: RecipientKindSchema,
  id: z.string().min(1),
});

const EnvelopeStatusSchema = z.enum([
  'pending',
  'acknowledged',
  'dispatched',
  'delivered',
  'failed',
]);

const EnvelopeSchema = z.object({
  schemaVersion: z
    .string()
    .refine(
      (v) => v === SCHEMA_VERSION,
      (v) => ({ message: `Unsupported or future schemaVersion '${v}'. Current supported version is '${SCHEMA_VERSION}'` })
    )
    .default(SCHEMA_VERSION),
  id: z.string().min(1),
  traceId: z.string().min(1),
  correlationId: z.string().optional(),
  parentEnvelopeId: z.string().optional(),
  timestamp: z.number().int().nonnegative(),
  sender: SenderSchema,
  recipient: RecipientSchema,
  roomId: z.string().min(1),
  workspaceId: z.string().optional(),
  policyVersion: z.string().optional(),
  parts: z.array(MessagePartSchema).min(1),
  fidelity: FidelityLevelSchema,
  status: EnvelopeStatusSchema.default('pending'),
  metadata: z.record(z.unknown()).optional(),
});

const ApprovalStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CONSUMED',
  'EXPIRED',
]);

const ApprovalTokenSchema = z.object({
  tokenId: z.string().min(1),
  actionType: z.string().min(1),
  payloadDigest: z.string().regex(/^[0-9a-fA-F]{64}$/, 'Payload digest must be valid SHA256 hex'),
  canonicalizationVersion: z.number().int().positive().default(1),
  origin: z.string().min(1),
  workspaceId: z.string().optional(),
  roomId: z.string().optional(),
  actorId: z.string().optional(),
  recipient: z.string().optional(),
  policyVersion: z.string().default('1.0.0'),
  status: ApprovalStatusSchema.default('PENDING'),
  createdAt: z.string(),
  expiresAt: z.string(),
  approverId: z.string().optional(),
  approvedAt: z.string().optional(),
  rejectedAt: z.string().optional(),
  rejectionReason: z.string().optional(),
  consumedAt: z.string().optional(),
});

const RecoveryStateSchema = z.enum([
  'PENDING',
  'RUNNING',
  'WAITING_APPROVAL',
  'COMPLETED',
  'FAILED',
  'UNKNOWN_NEEDS_RECONCILIATION',
]);

const TaskNodeSchema = z.object({
  taskId: z.string().min(1),
  nodeId: z.string().min(1),
  name: z.string().min(1),
  dependencies: z.array(z.string()).default([]),
  assignedRole: RoleSchema.default('IMPLEMENTER'),
  assignedProvider: ProviderKindSchema.optional(),
  revision: z.number().int().nonnegative().default(1),
  attempt: z.number().int().nonnegative().default(1),
  correlationId: z.string().min(1),
  recoveryState: RecoveryStateSchema.default('PENDING'),
  inputDigest: z.string().optional(),
  outputDigest: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const CostClassificationSchema = z.enum([
  'FREE_DOM',
  'ZERO_COST_LOCAL',
  'PAID_API_BLOCKED',
  'UNKNOWN_COST_DENIED',
  'APPROVED_BY_USER',
]);

const UnionBotErrorCodeSchema = z.enum([
  'ERR_COST_LIMIT_EXCEEDED',
  'ERR_UNKNOWN_COST_DENIED',
  'ERR_UNTRUSTED_SENDER',
  'ERR_UNTRUSTED_ACTION',
  'ERR_APPROVAL_EXPIRED',
  'ERR_APPROVAL_NOT_APPROVED',
  'ERR_APPROVAL_ALREADY_CONSUMED',
  'ERR_APPROVAL_HASH_MISMATCH',
  'ERR_CANONICALIZATION_FAILED',
  'ERR_PAYLOAD_MISMATCH',
  'ERR_UNSUPPORTED_SCHEMA_VERSION',
  'ERR_PATH_TRAVERSAL_DENIED',
  'ERR_SCHEMA_VALIDATION_FAILED',
  'ERR_STORAGE_CORRUPTION',
  'ERR_MIGRATION_FAILED',
  'ERR_MIGRATION_TAMPERED',
  'ERR_IDEMPOTENCY_CONFLICT',
  'ERR_RECONCILIATION_REQUIRED',
  'ERR_NETWORK_DISCONNECTED',
  'ERR_TIMEOUT',
]);

const AdmissionActionTypeSchema = z.enum([
  'SEND_PROMPT',
  'READ_WEB_DOM',
  'EXTRACT_ARTIFACT',
  'INVOKE_TOOL',
  'EXEC_CLI',
  'UNKNOWN_ACTION',
]);

const AdmissionActionSchema = z.object({
  actionId: z.string().min(1),
  actionType: AdmissionActionTypeSchema,
  provider: ProviderKindSchema,
  estimatedCost: z.number().nonnegative(),
  requestedBy: z.string().min(1),
  targetUrl: z.string().optional(),
  payloadDigest: z.string().optional(),
  approvalTokenId: z.string().optional(),
  isUntrustedRendererInput: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const AdmissionDecisionSchema = z.object({
  actionId: z.string().min(1),
  allowed: z.boolean(),
  reason: z.string(),
  policyCode: z.string(),
  policyVersion: z.string().default('1.0.0'),
  costClassification: CostClassificationSchema.default('ZERO_COST_LOCAL'),
  timestamp: z.number().int(),
});

// 2. AdmissionPolicyGate
class AdmissionPolicyGate {
  constructor(options = {}) {
    this.paidApiEnabled = options.paidApiEnabled ?? false;
    this.costGuard = options.costGuard ?? new CostGuard();
    this.auditLog = [];
  }

  evaluate(rawAction) {
    const timestamp = Date.now();

    // 1. Strict zero-cost check: reject unknown or unspecified cost
    const rawCost = rawAction?.estimatedCost;
    if (rawCost === undefined || rawCost === null || typeof rawCost !== 'number' || Number.isNaN(rawCost)) {
      const decision = {
        actionId: rawAction?.actionId || 'unknown_action',
        allowed: false,
        reason: 'Zero-Cost violation: estimatedCost is undefined, missing, or unknown. Unspecified cost is strictly DENIED.',
        policyCode: 'DENY_UNKNOWN_COST',
        policyVersion: SCHEMA_VERSION,
        costClassification: 'UNKNOWN_COST_DENIED',
        timestamp,
      };
      this.auditLog.push(decision);
      return decision;
    }

    // 2. Validate structure with Zod schema
    const parseResult = AdmissionActionSchema.safeParse(rawAction);
    if (!parseResult.success) {
      const decision = {
        actionId: rawAction?.actionId || 'unknown_action',
        allowed: false,
        reason: `Schema validation failed: ${parseResult.error.issues.map((i) => i.message).join('; ')}`,
        policyCode: 'DENY_SCHEMA_INVALID',
        policyVersion: SCHEMA_VERSION,
        costClassification: 'UNKNOWN_COST_DENIED',
        timestamp,
      };
      this.auditLog.push(decision);
      return decision;
    }

    const action = parseResult.data;

    // 3. Reject UNKNOWN_ACTION
    if (action.actionType === 'UNKNOWN_ACTION') {
      const decision = {
        actionId: action.actionId,
        allowed: false,
        reason: `Rejected unknown action type: ${action.actionType}`,
        policyCode: 'DENY_UNKNOWN_ACTION',
        policyVersion: SCHEMA_VERSION,
        costClassification: 'ZERO_COST_LOCAL',
        timestamp,
      };
      this.auditLog.push(decision);
      return decision;
    }

    // 4. Reject any paid cost if paid_api_enabled is false
    if (action.estimatedCost > 0 && !this.paidApiEnabled) {
      const decision = {
        actionId: action.actionId,
        allowed: false,
        reason: `Zero-Cost (0đ) violation: Action requires estimated cost ${action.estimatedCost}, but paid APIs are strictly disabled`,
        policyCode: 'DENY_PAID_API_DISABLED',
        policyVersion: SCHEMA_VERSION,
        costClassification: 'PAID_API_BLOCKED',
        timestamp,
      };
      this.auditLog.push(decision);
      return decision;
    }

    // 5. If action targets an external URL, verify through CostGuard egress boundaries
    if (action.targetUrl) {
      if (!this.costGuard.isUrlAllowed(action.targetUrl)) {
        const decision = {
          actionId: action.actionId,
          allowed: false,
          reason: `Egress boundary violation: Target URL '${action.targetUrl}' is forbidden under Zero-Cost policy`,
          policyCode: 'DENY_EGRESS_BLOCKED',
          policyVersion: SCHEMA_VERSION,
          costClassification: 'PAID_API_BLOCKED',
          timestamp,
        };
        this.auditLog.push(decision);
        return decision;
      }
    }

    // 6. Approved zero-cost action
    const decision = {
      actionId: action.actionId,
      allowed: true,
      reason: `Action '${action.actionType}' on provider '${action.provider}' permitted under Zero-Cost policy`,
      policyCode: 'ALLOW_ZERO_COST',
      policyVersion: SCHEMA_VERSION,
      costClassification: action.actionType === 'READ_WEB_DOM' ? 'FREE_DOM' : 'ZERO_COST_LOCAL',
      timestamp,
    };
    this.auditLog.push(decision);
    return decision;
  }

  getAuditLog() {
    return [...this.auditLog];
  }
}

// 3. Orchestrator
class Orchestrator {
  constructor(options = {}) {
    this.costGuard = options.costGuard ?? new CostGuard();
    this.artifactStore = options.artifactStore;
    this.storage = options.storage;
    this.admissionGate = new AdmissionPolicyGate({
      costGuard: this.costGuard,
      paidApiEnabled: options.paidApiEnabled ?? false,
    });
    this.roomHistories = new Map();
    this.seenEnvelopeIds = new Set();
    this.inMemoryDigests = new Map();
    this.approvalTokens = new Map();

    // Initialize default rooms
    const initialRooms = ['orchestration', 'agent-dev', 'qa-audit', 'review-briefing'];
    for (const r of initialRooms) {
      this.roomHistories.set(r, []);
    }

    // Preload persisted history from storage if available
    if (this.storage && typeof this.storage.getRoomEnvelopes === 'function') {
      for (const r of initialRooms) {
        this.storage.getRoomEnvelopes(r).then((envs) => {
          if (Array.isArray(envs)) {
            this.roomHistories.set(r, envs);
            for (const e of envs) {
              if (e.id) this.seenEnvelopeIds.add(e.id);
            }
          }
        }).catch(() => {});
      }
    }
  }

  /**
   * Dispatches an envelope into the designated room history.
   * @param {unknown} rawEnvelope The envelope payload to validate and dispatch.
   * @param {object} [context] Dispatch context, e.g. { fromRenderer: true }.
   */
  async dispatchEnvelope(rawEnvelope, context = {}) {
    // 1. Strict schema parse
    const parseResult = EnvelopeSchema.safeParse(rawEnvelope);
    if (!parseResult.success) {
      return {
        success: false,
        envelopeId: rawEnvelope?.id || 'unknown',
        roomId: rawEnvelope?.roomId || 'unknown',
        error: `Envelope schema validation error: ${parseResult.error.issues.map((i) => i.message).join('; ')}`,
      };
    }

    const envelope = parseResult.data;

    // 2. Anti-spoofing check for renderer submissions (C03)
    if (context && context.fromRenderer) {
      const isUserKind = envelope.sender.kind === 'user' || envelope.sender.kind === 'human';
      const isUserRole = !envelope.sender.role || envelope.sender.role === 'USER';
      if (!isUserKind || !isUserRole) {
        return {
          success: false,
          envelopeId: envelope.id,
          roomId: envelope.roomId,
          error: 'Security violation: renderer can only dispatch as sender.kind === "user" and role === "USER"',
        };
      }
    }

    // 3. Durable Idempotency Check BEFORE Approval Token consumption (UB-P2-R04-03, R05-H05, R05-H06)
    const incomingDigest = computeEnvelopeDigest(envelope);

    if (this.storage && typeof this.storage.getIdempotencyRecord === 'function') {
      try {
        const existingRecord = await this.storage.getIdempotencyRecord(envelope.id);
        if (existingRecord) {
          if (existingRecord.payloadDigest && existingRecord.payloadDigest !== incomingDigest) {
            return {
              success: false,
              envelopeId: envelope.id,
              roomId: envelope.roomId,
              error: `ERR_PAYLOAD_MISMATCH: Idempotency key '${envelope.id}' reused with mismatched payload. Replay with different content is forbidden.`,
            };
          }
          if (existingRecord.status === 'COMPLETED') {
            return {
              success: true,
              envelopeId: envelope.id,
              roomId: envelope.roomId,
              deduplicated: true,
            };
          }
          if (existingRecord.status === 'UNKNOWN_NEEDS_RECONCILIATION') {
            return {
              success: false,
              envelopeId: envelope.id,
              roomId: envelope.roomId,
              error: `ERR_RECONCILIATION_REQUIRED: Key ${envelope.id} requires external reconciliation`,
            };
          }
          if (existingRecord.status === 'PENDING') {
            return {
              success: false,
              envelopeId: envelope.id,
              roomId: envelope.roomId,
              error: `ERR_IDEMPOTENCY_CONFLICT: Key ${envelope.id} is already PENDING`,
            };
          }
        }
      } catch (idempErr) {
        if (idempErr.message && idempErr.message.includes('ERR_PAYLOAD_MISMATCH')) {
          return {
            success: false,
            envelopeId: envelope.id,
            roomId: envelope.roomId,
            error: idempErr.message,
          };
        }
      }
    }

    if (this.seenEnvelopeIds.has(envelope.id)) {
      const storedDigest = this.inMemoryDigests.get(envelope.id);
      if (storedDigest && storedDigest !== incomingDigest) {
        return {
          success: false,
          envelopeId: envelope.id,
          roomId: envelope.roomId,
          error: `ERR_PAYLOAD_MISMATCH: Idempotency key '${envelope.id}' reused with mismatched payload. Replay with different content is forbidden.`,
        };
      }
      return {
        success: true,
        envelopeId: envelope.id,
        roomId: envelope.roomId,
        deduplicated: true,
      };
    }

    // 4. Action parts evaluation & CostGuard admission policy (UB-P2-R03-01, R04-G12, C02, P2-006)
    let approvalRequirement = null;

    for (const part of envelope.parts) {
      if (part.kind === 'action') {
        const declaredCost = (part.input && typeof part.input.estimatedCost === 'number')
          ? part.input.estimatedCost
          : (typeof part.estimatedCost === 'number' ? part.estimatedCost : undefined);

        // 4a. Renderer actions require approvalTokenId before admission evaluation (C02, P2-006)
        let approvalTokenId = null;
        if (context && context.fromRenderer) {
          approvalTokenId = part.input?.approvalTokenId || part.approvalTokenId;
          if (!approvalTokenId) {
            return {
              success: false,
              envelopeId: envelope.id,
              roomId: envelope.roomId,
              error: 'Security violation: Untrusted action payload from renderer requires valid approval token (C02)',
            };
          }
        }

        // 4b. Evaluate AdmissionPolicyGate BEFORE consuming token (Zero-Cost Policy, R04-G12)
        const actionDecision = this.admissionGate.evaluate({
          actionId: part.callId,
          actionType: part.tool === 'read_web' ? 'READ_WEB_DOM' : 'INVOKE_TOOL',
          provider: envelope.sender.provider || (envelope.sender.kind === 'user' ? 'chatgpt' : 'system'),
          estimatedCost: declaredCost,
          requestedBy: envelope.sender.id,
          metadata: { tool: part.tool, input: part.input },
        });

        if (!actionDecision.allowed) {
          return {
            success: false,
            envelopeId: envelope.id,
            roomId: envelope.roomId,
            error: `Action admission denied: ${actionDecision.reason} (${actionDecision.policyCode})`,
          };
        }

        // 4c. Prepare canonical semantic digest (R04-C02, R05-H07)
        if (context && context.fromRenderer) {
          if (part.input === null || part.input === undefined || part.input === '') {
            return {
              success: false,
              envelopeId: envelope.id,
              roomId: envelope.roomId,
              error: 'Security violation: Action input payload is required for approval verification (UB-P2-R03-01)',
            };
          }

          const semanticInput = extractActionSemanticInput(part.input);
          const payloadDigest = computeCanonicalDigest(semanticInput, 1);

          approvalRequirement = {
            tokenId: approvalTokenId,
            actionType: part.tool,
            payloadDigest,
            scope: {
              workspaceId: envelope.workspaceId,
              roomId: envelope.roomId,
              actorId: envelope.sender.id,
              recipient: envelope.recipient ? envelope.recipient.id : undefined,
            },
          };

          // If no persistent storage, fallback to in-memory tokens
          if (!this.storage) {
            const token = this.approvalTokens.get(approvalTokenId);
            if (!token || token.status !== 'APPROVED') {
              return {
                success: false,
                envelopeId: envelope.id,
                roomId: envelope.roomId,
                error: 'Security violation: Action approval token is invalid, expired, or not approved (C02)',
              };
            }
            if (token.payloadDigest && token.payloadDigest !== payloadDigest) {
              return {
                success: false,
                envelopeId: envelope.id,
                roomId: envelope.roomId,
                error: 'Security violation: Payload digest mismatch for approval token (UB-P2-R03-01)',
              };
            }
            token.status = 'CONSUMED';
          }
        }
      }
    }

    // 5. Atomic Storage Commit: Approval Token CAS + Envelope + Event + Outbox (UB-P2-R04-02)
    if (this.storage) {
      try {
        const storeResult = await this.storage.insertEnvelope(envelope, { approval: approvalRequirement });
        if (storeResult && storeResult.deduplicated) {
          return {
            success: true,
            envelopeId: envelope.id,
            roomId: envelope.roomId,
            deduplicated: true,
          };
        }
      } catch (storageErr) {
        return {
          success: false,
          envelopeId: envelope.id,
          roomId: envelope.roomId,
          error: `Storage failure: ${storageErr.message}`,
        };
      }
    }

    // 6. In-memory cache & idempotency tracking
    this.seenEnvelopeIds.add(envelope.id);
    this.inMemoryDigests.set(envelope.id, computeEnvelopeDigest(envelope));
    const room = this.roomHistories.get(envelope.roomId) || [];
    room.push(envelope);
    this.roomHistories.set(envelope.roomId, room);

    return {
      success: true,
      envelopeId: envelope.id,
      roomId: envelope.roomId,
    };
  }

  evaluateAction(action) {
    return this.admissionGate.evaluate(action);
  }

  getRoomHistory(roomId) {
    return this.roomHistories.get(roomId) || [];
  }

  async getRoomHistoryAsync(roomId) {
    if (this.storage) {
      try {
        const persisted = await this.storage.getRoomEnvelopes(roomId);
        if (Array.isArray(persisted)) {
          this.roomHistories.set(roomId, persisted);
          for (const env of persisted) {
            if (env && env.id) this.seenEnvelopeIds.add(env.id);
          }
          return persisted;
        }
      } catch (err) {
        console.error('[Orchestrator] Error reading persistent history:', err);
      }
    }
    return this.roomHistories.get(roomId) || [];
  }

  listRooms() {
    return Array.from(this.roomHistories.keys());
  }
}

module.exports = {
  SCHEMA_VERSION,
  RoleSchema,
  ProviderKindSchema,
  FidelityLevelSchema,
  ContentFidelitySchema,
  SenderKindSchema,
  RecipientKindSchema,
  AuthStatusSchema,
  EvidenceProvenanceSchema,
  TransferStatusSchema,
  ProviderIdentitySchema,
  MessagePartSchema,
  EnvelopeStatusSchema,
  EnvelopeSchema,
  ApprovalStatusSchema,
  ApprovalTokenSchema,
  RecoveryStateSchema,
  TaskNodeSchema,
  CostClassificationSchema,
  UnionBotErrorCodeSchema,
  AdmissionActionTypeSchema,
  AdmissionActionSchema,
  AdmissionDecisionSchema,
  AdmissionPolicyGate,
  Orchestrator,
};
