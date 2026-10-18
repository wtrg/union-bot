/**
 * @file schemas.ts
 * @description Zod schemas and TypeScript types for Union Bot protocol envelopes, message parts, and admission actions.
 */

import { z } from 'zod';

export const RoleSchema = z.enum([
  'LEADER',
  'IMPLEMENTER',
  'QA_SECURITY',
  'RESEARCHER',
  'ORCHESTRATOR',
  'USER',
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

export const FidelityLevelSchema = z.enum([
  'L0_RAW_TEXT',
  'L1_FORMATTED_MARKDOWN',
  'L2_STANDALONE_ARTIFACT',
  'L3_INTERACTIVE_CANVAS',
]);
export type FidelityLevel = z.infer<typeof FidelityLevelSchema>;

export const SenderKindSchema = z.enum(['agent', 'human', 'system']);
export type SenderKind = z.infer<typeof SenderKindSchema>;

export const RecipientKindSchema = z.enum(['agent', 'room', 'system', 'broadcast']);
export type RecipientKind = z.infer<typeof RecipientKindSchema>;

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
});
export type ActionMessagePart = z.infer<typeof ActionMessagePartSchema>;

export const StatusMessagePartSchema = z.object({
  kind: z.literal('status'),
  code: z.string(),
  message: z.string(),
  level: z.enum(['info', 'warning', 'error']),
});
export type StatusMessagePart = z.infer<typeof StatusMessagePartSchema>;

export const MessagePartSchema = z.discriminatedUnion('kind', [
  TextMessagePartSchema,
  CodeMessagePartSchema,
  ArtifactMessagePartSchema,
  ActionMessagePartSchema,
  StatusMessagePartSchema,
]);
export type MessagePart = z.infer<typeof MessagePartSchema>;

// Sender & Recipient
export const SenderSchema = z.object({
  kind: SenderKindSchema,
  id: z.string().min(1),
  name: z.string().min(1),
  role: RoleSchema.optional(),
  provider: ProviderKindSchema.optional(),
});
export type Sender = z.infer<typeof SenderSchema>;

export const RecipientSchema = z.object({
  kind: RecipientKindSchema,
  id: z.string().min(1),
});
export type Recipient = z.infer<typeof RecipientSchema>;

// Envelope
export const EnvelopeSchema = z.object({
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
export type Envelope = z.infer<typeof EnvelopeSchema>;

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

export const AdmissionActionSchema = z.object({
  actionId: z.string().min(1),
  actionType: AdmissionActionTypeSchema,
  provider: ProviderKindSchema,
  estimatedCost: z.number().nonnegative().default(0),
  requestedBy: z.string().min(1),
  targetUrl: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type AdmissionAction = z.infer<typeof AdmissionActionSchema>;

export const AdmissionDecisionSchema = z.object({
  actionId: z.string().min(1),
  allowed: z.boolean(),
  reason: z.string(),
  policyCode: z.string(),
  timestamp: z.number().int(),
});
export type AdmissionDecision = z.infer<typeof AdmissionDecisionSchema>;

/**
 * Creates a valid Envelope with generated timestamp and ID if not provided.
 */
export function createEnvelope(params: {
  id?: string;
  traceId?: string;
  sender: Sender;
  recipient: Recipient;
  roomId: string;
  parts: MessagePart[];
  fidelity?: FidelityLevel;
  metadata?: Record<string, unknown>;
}): Envelope {
  const envelope: Envelope = {
    id: params.id || `env_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    traceId: params.traceId || `trace_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    timestamp: Date.now(),
    sender: params.sender,
    recipient: params.recipient,
    roomId: params.roomId,
    parts: params.parts,
    fidelity: params.fidelity || 'L0_RAW_TEXT',
    metadata: params.metadata,
  };
  return EnvelopeSchema.parse(envelope);
}
