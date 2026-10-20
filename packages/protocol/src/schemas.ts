/**
 * @file schemas.ts
 * @description Zod schemas and TypeScript types for Union Bot protocol envelopes,
 * message parts, provider identities, CAS fidelity levels, DAG tasks, and admission actions.
 */

import { z } from 'zod';

export const SCHEMA_VERSION = '1.0.0';

export const RoleSchema = z.enum([
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
export type Role = z.infer<typeof RoleSchema>;

export const ProviderKindSchema = z.enum([
  'chatgpt',
  'gemini',
  'claude',
  'deepseek',
  'codex',
  'antigravity',
  'system',
]);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

/**
 * 4 Display / Presentation Fidelity levels (UI rendering tier)
 */
export const FidelityLevelSchema = z.enum([
  'L0_RAW_TEXT',
  'L1_FORMATTED_MARKDOWN',
  'L2_STANDALONE_ARTIFACT',
  'L3_INTERACTIVE_CANVAS',
]);
export type FidelityLevel = z.infer<typeof FidelityLevelSchema>;

/**
 * 6 Semantic Content Preservation Fidelity tiers from V3.1 (UB-P2-R01-009, P2-T14)
 * Distinct from UI presentation levels L0-L3.
 */
export const SemanticPreservationLabelSchema = z.enum([
  'original_bytes',
  'structured_copy',
  'rendered_preview',
  'screenshot_only',
  'external_reference',
  'unavailable',
]);
export type SemanticPreservationLabel = z.infer<typeof SemanticPreservationLabelSchema>;

export const ContentFidelitySchema = z.enum([
  'original_bytes',
  'structured_copy',
  'rendered_preview',
  'screenshot_only',
  'external_reference',
  'unavailable',
  // Backward compatibility legacy labels (mapped losslessly to the 6 semantic labels)
  'RAW_BINARY',
  'SEMANTIC_INTERACTIVE',
  'STRUCTURED_DOC',
  'VECTOR_EMBEDDING',
  'LOSSLESS_EXPORT',
  'LOSSLESS_PREVIEW',
]);
export type ContentFidelity = z.infer<typeof ContentFidelitySchema>;

export function normalizeContentFidelity(fidelity: ContentFidelity): SemanticPreservationLabel {
  switch (fidelity) {
    case 'original_bytes':
    case 'RAW_BINARY':
      return 'original_bytes';
    case 'structured_copy':
    case 'STRUCTURED_DOC':
    case 'SEMANTIC_INTERACTIVE':
    case 'VECTOR_EMBEDDING':
      return 'structured_copy';
    case 'rendered_preview':
    case 'LOSSLESS_PREVIEW':
    case 'LOSSLESS_EXPORT':
      return 'rendered_preview';
    case 'screenshot_only':
      return 'screenshot_only';
    case 'external_reference':
      return 'external_reference';
    case 'unavailable':
      return 'unavailable';
    default:
      return 'unavailable';
  }
}

export const SenderKindSchema = z.enum(['agent', 'human', 'user', 'system']);
export type SenderKind = z.infer<typeof SenderKindSchema>;

export const RecipientKindSchema = z.enum(['agent', 'room', 'system', 'broadcast']);
export type RecipientKind = z.infer<typeof RecipientKindSchema>;

export const AuthStatusSchema = z.enum([
  'UNKNOWN',
  'NOT_VERIFIED',
  'AUTHENTICATED',
  'ANONYMOUS',
  'EXPIRED',
  'CHALLENGE_REQUIRED',
]);
export type AuthStatus = z.infer<typeof AuthStatusSchema>;

export const EvidenceProvenanceSchema = z.enum([
  'UNVERIFIED',
  'LIVE_WEB',
  'LOCAL_RPC',
  'CLI_HEADLESS',
  'USER_MANUAL',
  'RECONSTRUCTED',
]);
export type EvidenceProvenance = z.infer<typeof EvidenceProvenanceSchema>;

export const TransferStatusSchema = z.enum([
  'VERIFIED_TRANSFERRED',
  'PARTIAL_DEGRADED',
  'NATIVE_ONLY',
]);
export type TransferStatus = z.infer<typeof TransferStatusSchema>;

/**
 * 6 AI & Multi-account Provider Identity contract (UB-P2-R01-009, P2-T15)
 * Defaults to unverified/not authenticated; never assumes live access without proof.
 */
export const ProviderIdentitySchema = z.object({
  provider: ProviderKindSchema,
  profileId: z.string().min(1),
  profileName: z.string().optional(),
  sessionId: z.string().optional(),
  partitionKey: z.string().optional(),
  capabilityVersion: z.string().default('1.0.0'),
  authStatus: AuthStatusSchema.default('NOT_VERIFIED'),
  evidenceProvenance: EvidenceProvenanceSchema.default('UNVERIFIED'),
});
export type ProviderIdentity = z.infer<typeof ProviderIdentitySchema>;

// Message parts
export const TextMessagePartSchema = z.object({
  kind: z.literal('text'),
  text: z.string(),
});
export type TextMessagePart = z.infer<typeof TextMessagePartSchema>;

export const CodeMessagePartSchema = z.object({
  kind: z.literal('code'),
  language: z.string(),
  content: z.string(),
  filename: z.string().optional(),
});
export type CodeMessagePart = z.infer<typeof CodeMessagePartSchema>;

export const ArtifactMessagePartSchema = z.object({
  kind: z.literal('artifact'),
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/, 'Invalid SHA256 hex string'),
  mimeType: z.string(),
  filename: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  previewUrl: z.string().optional(),
  contentFidelity: ContentFidelitySchema.optional(),
  provenance: EvidenceProvenanceSchema.optional(),
  transferStatus: TransferStatusSchema.optional(),
});
export type ArtifactMessagePart = z.infer<typeof ArtifactMessagePartSchema>;

export const ActionMessagePartSchema = z.object({
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
export type ActionMessagePart = z.infer<typeof ActionMessagePartSchema>;

export const StatusMessagePartSchema = z.object({
  kind: z.literal('status'),
  code: z.string(),
  message: z.string(),
  level: z.enum(['info', 'warning', 'error']),
});
export type StatusMessagePart = z.infer<typeof StatusMessagePartSchema>;

export const ReferenceMessagePartSchema = z.object({
  kind: z.literal('reference'),
  url: z.string(),
  providerId: ProviderKindSchema.optional(),
  threadId: z.string().optional(),
  pageTitle: z.string().optional(),
  isReopenable: z.boolean().default(false),
});
export type ReferenceMessagePart = z.infer<typeof ReferenceMessagePartSchema>;

export const MessagePartSchema = z.discriminatedUnion('kind', [
  TextMessagePartSchema,
  CodeMessagePartSchema,
  ArtifactMessagePartSchema,
  ActionMessagePartSchema,
  StatusMessagePartSchema,
  ReferenceMessagePartSchema,
]);
export type MessagePart = z.infer<typeof MessagePartSchema>;

// Sender & Recipient
export const SenderSchema = z.object({
  kind: SenderKindSchema,
  id: z.string().min(1),
  name: z.string().min(1),
  role: RoleSchema.optional(),
  provider: ProviderKindSchema.optional(),
  providerIdentity: ProviderIdentitySchema.optional(),
});
export type Sender = z.infer<typeof SenderSchema>;

export const RecipientSchema = z.object({
  kind: RecipientKindSchema,
  id: z.string().min(1),
});
export type Recipient = z.infer<typeof RecipientSchema>;

export const EnvelopeStatusSchema = z.enum([
  'pending',
  'acknowledged',
  'failed',
  'unknown_needs_reconciliation',
]);
export type EnvelopeStatus = z.infer<typeof EnvelopeStatusSchema>;

// Envelope
export const EnvelopeSchema = z.object({
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
export type Envelope = z.infer<typeof EnvelopeSchema>;

// Approval Token Schema (P2-006, C02, UB-P2-R01-001, UB-P2-R01-002)
export const ApprovalStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CONSUMED',
  'EXPIRED',
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const ApprovalTokenSchema = z.object({
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
  payload_json: z.string().optional(),
  payloadJson: z.string().optional(),
  payload: z.unknown().optional(),
  approverId: z.string().optional(),
  approvedAt: z.string().optional(),
  rejectedAt: z.string().optional(),
  rejectionReason: z.string().optional(),
  consumedAt: z.string().optional(),
});
export type ApprovalToken = z.infer<typeof ApprovalTokenSchema>;

// DAG Task Graph Schema (P2 Task Graph Foundation)
export const RecoveryStateSchema = z.enum([
  'PENDING',
  'RUNNING',
  'WAITING_APPROVAL',
  'COMPLETED',
  'FAILED',
  'UNKNOWN_NEEDS_RECONCILIATION',
]);
export type RecoveryState = z.infer<typeof RecoveryStateSchema>;

export const TaskNodeSchema = z.object({
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
export type TaskNode = z.infer<typeof TaskNodeSchema>;

// --- Phase P8 Task Graph & Multi-Agent Consensus Schemas ---
export const StageTypeSchema = z.enum([
  'PLAN',
  'IMPLEMENT',
  'REVIEW',
  'FIX',
  'VERIFY',
]);
export type StageType = z.infer<typeof StageTypeSchema>;

export const TaskGraphStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export type TaskGraphStatus = z.infer<typeof TaskGraphStatusSchema>;

export const NodeExecutionStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'WAITING_APPROVAL',
  'WAITING_INPUT',
  'COMPLETED',
  'FAILED',
  'STALE',
  'CANCELLED',
  'SKIPPED',
  'REMEDIATING',
]);
export type NodeExecutionStatus = z.infer<typeof NodeExecutionStatusSchema>;

export const ConsensusDecisionSchema = z.enum([
  'APPROVE',
  'REJECT',
  'ABSTAIN',
]);
export type ConsensusDecision = z.infer<typeof ConsensusDecisionSchema>;

export const AuthorizedReviewerSchema = z.object({
  voterId: z.string().min(1),
  role: RoleSchema,
  providerId: z.string().optional(),
});
export type AuthorizedReviewer = z.infer<typeof AuthorizedReviewerSchema>;

export const ConsensusVoteSchema = z.object({
  voterId: z.string().min(1),
  voterRole: RoleSchema,
  decision: ConsensusDecisionSchema,
  reviewedDigest: z.string().min(1),
  rationale: z.string().default(''),
  timestamp: z.number().int().nonnegative().default(() => Date.now()),
});
export type ConsensusVote = z.infer<typeof ConsensusVoteSchema>;

export const ConsensusPolicyTypeSchema = z.enum([
  'unanimous',
  'majority',
  'threshold',
]);
export type ConsensusPolicyType = z.infer<typeof ConsensusPolicyTypeSchema>;

export const ConsensusPolicySchema = z.object({
  type: ConsensusPolicyTypeSchema.default('majority'),
  minThreshold: z.number().min(0).max(1).optional(),
  requiredRoles: z.array(RoleSchema).optional(),
  authorizedReviewers: z.array(AuthorizedReviewerSchema).optional(),
});
export type ConsensusPolicy = z.infer<typeof ConsensusPolicySchema>;

export const TaskNodeDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  stage: StageTypeSchema,
  assignedRole: RoleSchema,
  assignedProvider: ProviderKindSchema.optional(),
  dependencies: z.array(z.string()).default([]),
  targetDigest: z.string().optional(),
  actionPayload: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type TaskNodeDefinition = z.infer<typeof TaskNodeDefinitionSchema>;

export const TaskGraphDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  workspaceRoot: z.string().min(1),
  nodes: z.array(TaskNodeDefinitionSchema).min(1),
  consensusPolicy: ConsensusPolicySchema.optional(),
  maxFixAttempts: z.number().int().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type TaskGraphDefinition = z.infer<typeof TaskGraphDefinitionSchema>;

// Admission Gate schemas (for Zero-Cost & Policy Control)
export const AdmissionActionTypeSchema = z.enum([
  'SEND_PROMPT',
  'READ_WEB_DOM',
  'EXTRACT_ARTIFACT',
  'INVOKE_TOOL',
  'EXEC_CLI',
  'UNKNOWN_ACTION',
]);
export type AdmissionActionType = z.infer<typeof AdmissionActionTypeSchema>;

export const CostClassificationSchema = z.enum([
  'FREE_DOM',
  'ZERO_COST_LOCAL',
  'PAID_API_BLOCKED',
  'UNKNOWN_COST_DENIED',
  'APPROVED_BY_USER',
]);
export type CostClassification = z.infer<typeof CostClassificationSchema>;

export const AdmissionActionSchema = z.object({
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
export type AdmissionAction = z.infer<typeof AdmissionActionSchema>;

export const AdmissionDecisionSchema = z.object({
  actionId: z.string().min(1),
  allowed: z.boolean(),
  reason: z.string(),
  policyCode: z.string(),
  policyVersion: z.string().default('1.0.0'),
  costClassification: CostClassificationSchema.default('ZERO_COST_LOCAL'),
  timestamp: z.number().int(),
});
export type AdmissionDecision = z.infer<typeof AdmissionDecisionSchema>;

// Error Taxonomy (P2-011, Wave A, UB-P2-R01-001, UB-P2-R01-002, UB-P2-R01-006)
export const UnionBotErrorCodeSchema = z.enum([
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
  'ERR_IDEMPOTENCY_UNVERIFIED',
  'ERR_RECONCILIATION_REQUIRED',
  'ERR_NETWORK_DISCONNECTED',
  'ERR_TIMEOUT',
  'ERR_CYCLE_DETECTED',
  'ERR_TASK_GRAPH_FAILED',
  'ERR_INVALID_STAGE_TRANSITION',
  'ERR_CONSENSUS_FAILED',
  'ERR_UNAUTHORIZED_VOTER',
  'ERR_ROLE_MISMATCH',
  'ERR_STALE_VOTE_DIGEST',
  'ERR_NO_VOTES_RECORDED',
  'ERR_REVIEW_TARGET_NOT_READY',
  'ERR_UNAUTHORIZED_ACTION',
  'ERR_NODE_NOT_RUNNABLE',
  // Phase P9: Web Provider Capabilities & Extensions Error Codes
  'ERR_PROVIDER_CAPTCHA',
  'ERR_PROVIDER_AUTH_REQUIRED',
  'ERR_PROVIDER_QUOTA_EXCEEDED',
  'ERR_PROVIDER_SERVICE_UNAVAILABLE',
  'ERR_PROVIDER_AUTOMATION_DISABLED',
  'ERR_PROVIDER_SESSION_NOT_FOUND',
  'ERR_PROVIDER_HANDLER_UNAVAILABLE',
  'ERR_INVALID_FILE_SIZE',
  'ERR_INVALID_MIME_TYPE',
]);
export type UnionBotErrorCode = z.infer<typeof UnionBotErrorCodeSchema>;

// Phase P9: Provider Session & Health Schemas
export const WebProviderIdSchema = z.enum([
  'chatgpt',
  'gemini',
  'claude',
  'deepseek',
]);
export type WebProviderId = z.infer<typeof WebProviderIdSchema>;

export const ProviderSessionSchema = z.object({
  sessionId: z.string().min(1),
  providerId: ProviderKindSchema,
  assignedRole: RoleSchema,
  partition: z.string().min(1),
  tabId: z.string().min(1),
  authStatus: AuthStatusSchema,
  sessionNonce: z.string().min(1),
  threadId: z.string().optional(),
  threadUrl: z.string().optional(),
  isReopenable: z.boolean().default(false),
  createdAt: z.number().int().nonnegative(),
  lastActive: z.number().int().nonnegative(),
});
export type ProviderSession = z.infer<typeof ProviderSessionSchema>;

export const ProviderHealthStatusSchema = z.enum([
  'HEALTHY',
  'CHALLENGE_REQUIRED',
  'LOGIN_REQUIRED',
  'QUOTA_EXCEEDED',
  'SERVICE_UNAVAILABLE',
  'AUTOMATION_DISABLED',
]);
export type ProviderHealthStatus = z.infer<typeof ProviderHealthStatusSchema>;

export const ProviderHealthReportSchema = z.object({
  providerId: ProviderKindSchema,
  tabId: z.string().min(1),
  status: ProviderHealthStatusSchema,
  errorCode: UnionBotErrorCodeSchema.optional(),
  message: z.string().optional(),
  details: z.record(z.unknown()).optional(),
  checkedAt: z.number().int().nonnegative(),
});
export type ProviderHealthReport = z.infer<typeof ProviderHealthReportSchema>;

/**
 * Creates a valid Envelope with generated timestamp and ID if not provided.
 */
export function createEnvelope(params: {
  id?: string;
  traceId?: string;
  correlationId?: string;
  sender: Sender;
  recipient: Recipient;
  roomId: string;
  parts: MessagePart[];
  fidelity?: FidelityLevel;
  status?: EnvelopeStatus;
  metadata?: Record<string, unknown>;
}): Envelope {
  const envelope = {
    schemaVersion: SCHEMA_VERSION,
    id: params.id || `env_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    traceId: params.traceId || `trace_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    correlationId: params.correlationId,
    timestamp: Date.now(),
    sender: params.sender,
    recipient: params.recipient,
    roomId: params.roomId,
    parts: params.parts,
    fidelity: params.fidelity || 'L0_RAW_TEXT',
    status: params.status || 'acknowledged',
    metadata: params.metadata,
  };
  return EnvelopeSchema.parse(envelope);
}
