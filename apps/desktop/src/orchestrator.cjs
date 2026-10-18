/**
 * @file orchestrator.cjs
 * @description Electron main process Orchestrator & AdmissionPolicyGate integration.
 * Enforces:
 * - Strict Envelope schema validation before room dispatch
 * - Sender identity verification & anti-spoofing (renderer cannot forge system/orchestrator roles)
 * - Zero-Cost (0đ) AdmissionPolicyGate (DENY_UNKNOWN_COST on missing/undefined cost)
 * - Room history isolation and broadcasting
 */

const { z } = require('zod');
const { CostGuard } = require('./cost-guard.cjs');

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

const SenderKindSchema = z.enum(['agent', 'human', 'system']);
const RecipientKindSchema = z.enum(['agent', 'room', 'system', 'broadcast']);

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
});

const ActionMessagePartSchema = z.object({
  kind: z.literal('action'),
  tool: z.string(),
  callId: z.string(),
  status: z.enum(['requested', 'executing', 'completed', 'failed']),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
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
});

const RecipientSchema = z.object({
  kind: RecipientKindSchema,
  id: z.string().min(1),
});

const EnvelopeSchema = z.object({
  id: z.string().min(1),
  traceId: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
  sender: SenderSchema,
  recipient: RecipientSchema,
  roomId: z.string().min(1),
  parts: z.array(MessagePartSchema).min(1),
  fidelity: FidelityLevelSchema,
  metadata: z.record(z.unknown()).optional(),
});

const AdmissionActionTypeSchema = z.enum([
  'SEND_PROMPT',
  'READ_WEB_DOM',
  'EXTRACT_ARTIFACT',
  'INVOKE_TOOL',
  'EXEC_CLI',
  'UNKNOWN_ACTION',
]);

// UB-P1-SEC-S1: estimatedCost is REQUIRED without default to enforce fail-closed zero-cost policy
const AdmissionActionSchema = z.object({
  actionId: z.string().min(1),
  actionType: AdmissionActionTypeSchema,
  provider: ProviderKindSchema,
  estimatedCost: z.number().nonnegative(),
  requestedBy: z.string().min(1),
  targetUrl: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const AdmissionDecisionSchema = z.object({
  actionId: z.string().min(1),
  allowed: z.boolean(),
  reason: z.string(),
  policyCode: z.string(),
  timestamp: z.number().int().nonnegative(),
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
    this.admissionGate = new AdmissionPolicyGate({
      costGuard: this.costGuard,
      paidApiEnabled: options.paidApiEnabled ?? false,
    });
    this.roomHistories = new Map();

    // Initialize default rooms
    const initialRooms = ['orchestration', 'agent-dev', 'qa-audit', 'review-briefing'];
    for (const r of initialRooms) {
      this.roomHistories.set(r, []);
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

    // 2. Anti-spoofing check for renderer submissions
    if (context.fromRenderer) {
      // Renderer clients can only submit as 'human' or 'agent' (with non-privileged role), NEVER 'system' or 'ORCHESTRATOR'
      if (envelope.sender.kind === 'system' || envelope.sender.role === 'ORCHESTRATOR') {
        return {
          success: false,
          envelopeId: envelope.id,
          roomId: envelope.roomId,
          error: 'Security violation: renderer cannot forge system or orchestrator identity',
        };
      }
    }

    // 3. If envelope contains action parts, evaluate admission through AdmissionPolicyGate
    for (const part of envelope.parts) {
      if (part.kind === 'action') {
        const actionDecision = this.admissionGate.evaluate({
          actionId: part.callId,
          actionType: 'INVOKE_TOOL',
          provider: envelope.sender.provider || 'system',
          estimatedCost: 0, // In-process tools are 0-cost
          requestedBy: envelope.sender.id,
          metadata: { tool: part.tool },
        });

        if (!actionDecision.allowed) {
          return {
            success: false,
            envelopeId: envelope.id,
            roomId: envelope.roomId,
            error: `Action admission denied: ${actionDecision.reason} (${actionDecision.policyCode})`,
          };
        }
      }
    }

    // 4. Store in room history
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

  listRooms() {
    return Array.from(this.roomHistories.keys());
  }
}

module.exports = {
  RoleSchema,
  ProviderKindSchema,
  FidelityLevelSchema,
  MessagePartSchema,
  EnvelopeSchema,
  AdmissionActionSchema,
  AdmissionDecisionSchema,
  AdmissionPolicyGate,
  Orchestrator,
};
