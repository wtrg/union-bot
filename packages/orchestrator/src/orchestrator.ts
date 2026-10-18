/**
 * @file orchestrator.ts
 * @description Core multi-agent collaboration orchestrator for Union Bot (Phase P2).
 * Integrates:
 * - Persistent SQLite Storage & Event Sourcing (P2-003, P2-004)
 * - Anti-Spoofing & Context Security Gate (C02, C03)
 * - Zero-Cost AdmissionPolicyGate (P2-008, C02)
 * - Idempotency & Outbox Deduplication (P2-005, C01, C05)
 * - Approval Token Gate for Action Execution (P2-006, C02)
 */

import {
  EnvelopeSchema,
  type Envelope,
  type AdmissionAction,
  type AdmissionDecision,
} from '../../protocol/src/index.ts';
import { CostGuard } from '../../cost-guard/src/index.ts';
import { ArtifactStore } from '../../artifact-store/src/index.ts';
import {
  StorageEngine,
  EventStore,
  IdempotencyManager,
  ApprovalGateManager,
  UnionBotError,
} from '../../storage/src/index.ts';
import { AdmissionPolicyGate } from './admission-gate.ts';

export interface DispatchContext {
  isFromRenderer?: boolean;
  senderFrameUrl?: string;
  approvalTokenId?: string;
}

export interface OrchestratorOptions {
  costGuard?: CostGuard;
  artifactStore?: ArtifactStore;
  paidApiEnabled?: boolean;
  storage?: StorageEngine;
  eventStore?: EventStore;
  idempotency?: IdempotencyManager;
  approvalGate?: ApprovalGateManager;
  initialRooms?: string[];
}

export interface DispatchResult {
  success: boolean;
  envelopeId: string;
  roomId: string;
  status?: string;
  error?: string;
}

export class Orchestrator {
  public readonly admissionGate: AdmissionPolicyGate;
  public readonly costGuard: CostGuard;
  public readonly artifactStore?: ArtifactStore;
  public readonly storage?: StorageEngine;
  public readonly eventStore?: EventStore;
  public readonly idempotency?: IdempotencyManager;
  public readonly approvalGate?: ApprovalGateManager;
  private readonly roomHistories = new Map<string, Envelope[]>();

  constructor(options: OrchestratorOptions = {}) {
    this.costGuard = options.costGuard ?? new CostGuard();
    this.artifactStore = options.artifactStore;
    this.storage = options.storage;
    this.eventStore = options.eventStore ?? (this.storage ? new EventStore(this.storage) : undefined);
    this.idempotency = options.idempotency ?? (this.storage ? new IdempotencyManager(this.storage) : undefined);
    this.approvalGate = options.approvalGate ?? (this.storage ? new ApprovalGateManager(this.storage) : undefined);

    this.admissionGate = new AdmissionPolicyGate({
      costGuard: this.costGuard,
      paidApiEnabled: options.paidApiEnabled ?? false,
    });

    const initialRooms = options.initialRooms || ['general', 'orchestration', 'research', 'artifacts'];
    for (const r of initialRooms) {
      this.roomHistories.set(r, []);
      if (this.storage) {
        this.storage.ensureRoom(r);
      }
    }
  }

  /**
   * Dispatches an envelope into the designated room history with full security,
   * idempotency, zero-cost admission, and durable event storage.
   */
  public async dispatchEnvelope(rawEnvelope: unknown, context?: DispatchContext): Promise<DispatchResult> {
    const raw = rawEnvelope as any;

    // 1. Renderer anti-spoofing security check (C03)
    if (context?.isFromRenderer) {
      const senderKind = raw?.sender?.kind;
      const senderRole = raw?.sender?.role;

      if (senderKind !== 'user' && senderKind !== 'human') {
        return {
          success: false,
          envelopeId: raw?.id || 'unknown',
          roomId: raw?.roomId || 'unknown',
          error: 'Security violation: renderer can only dispatch as sender.kind === "user"',
        };
      }

      if (senderRole && senderRole !== 'USER') {
        return {
          success: false,
          envelopeId: raw?.id || 'unknown',
          roomId: raw?.roomId || 'unknown',
          error: 'Security violation: renderer can only dispatch as role === "USER"',
        };
      }
    }

    // 2. Validate envelope schema
    const parseResult = EnvelopeSchema.safeParse(rawEnvelope);
    if (!parseResult.success) {
      return {
        success: false,
        envelopeId: raw?.id || 'unknown',
        roomId: raw?.roomId || 'unknown',
        error: `Envelope schema validation error: ${parseResult.error.issues.map((i) => i.message).join('; ')}`,
      };
    }

    const envelope = parseResult.data;

    // 3. Idempotency Check (P2-005, C01, C05)
    if (this.idempotency) {
      const acq = this.idempotency.acquire(envelope.id, envelope.roomId);
      if (acq.isDuplicate && acq.cachedResponse) {
        return {
          success: true,
          envelopeId: envelope.id,
          roomId: envelope.roomId,
          status: 'acknowledged',
        };
      }
    }

    // 4. Action Parts & Approval Token Validation (C02, P2-006)
    for (const part of envelope.parts) {
      if (part.kind === 'action') {
        // C02: Untrusted action parts from renderer cannot self-claim status='completed' or run tools unapproved
        if (context?.isFromRenderer) {
          if (part.status === 'completed') {
            if (this.idempotency) {
              this.idempotency.fail(envelope.id, { error: 'Untrusted tool result' });
            }
            return {
              success: false,
              envelopeId: envelope.id,
              roomId: envelope.roomId,
              error: 'Security violation: renderer cannot claim action status="completed". Authoritative tool results must come from trusted main process or local agent.',
            };
          }

          if (!part.approvalTokenId) {
            if (this.idempotency) {
              this.idempotency.fail(envelope.id, { error: 'Missing approval token' });
            }
            return {
              success: false,
              envelopeId: envelope.id,
              roomId: envelope.roomId,
              error: 'Security violation: renderer action requires a valid approvalTokenId signed by local approval gate.',
            };
          }

          // Validate approval token with ApprovalGateManager
          if (this.approvalGate) {
            try {
              this.approvalGate.validateAndConsume(part.approvalTokenId, part.tool, part.input);
            } catch (err: any) {
              if (this.idempotency) {
                this.idempotency.fail(envelope.id, { error: err.message });
              }
              return {
                success: false,
                envelopeId: envelope.id,
                roomId: envelope.roomId,
                error: `Approval token rejection: ${err.message}`,
              };
            }
          }
        }

        // Pass action to AdmissionPolicyGate (Zero-Cost Policy)
        const declaredCost = (part as any)?.input?.estimatedCost ?? (part as any)?.estimatedCost;
        const admissionDecision = this.admissionGate.evaluate({
          actionId: part.callId,
          actionType: part.tool === 'read_web' ? 'READ_WEB_DOM' : 'INVOKE_TOOL',
          provider: (envelope.sender.provider as any) || 'system',
          estimatedCost: declaredCost,
          requestedBy: envelope.sender.id,
        });

        if (!admissionDecision.allowed) {
          if (this.idempotency) {
            this.idempotency.fail(envelope.id, { error: admissionDecision.reason });
          }
          return {
            success: false,
            envelopeId: envelope.id,
            roomId: envelope.roomId,
            error: `Admission policy denied action '${part.tool}': ${admissionDecision.reason} (${admissionDecision.policyCode})`,
          };
        }
      }
    }

    // 5. Durable Event Persistence (P2-003, P2-004)
    if (this.storage) {
      this.storage.insertEnvelope(envelope);
    }
    if (this.eventStore) {
      this.eventStore.appendEvent(`room:${envelope.roomId}`, 'ENVELOPE_RECORDED', envelope as any);
    }

    // 6. In-Memory Projection
    const room = this.roomHistories.get(envelope.roomId) || [];
    room.push(envelope);
    this.roomHistories.set(envelope.roomId, room);

    // 7. Complete Idempotency
    const result: DispatchResult = {
      success: true,
      envelopeId: envelope.id,
      roomId: envelope.roomId,
      status: 'acknowledged',
    };

    if (this.idempotency) {
      this.idempotency.complete(envelope.id, result as any);
    }

    return result;
  }

  /**
   * Submits an action to the AdmissionPolicyGate before executing it.
   */
  public evaluateAction(action: unknown): AdmissionDecision {
    return this.admissionGate.evaluate(action);
  }

  /**
   * Retrieves conversation history for a given room.
   */
  public getRoomHistory(roomId: string): readonly Envelope[] {
    if (this.storage) {
      return this.storage.getRoomEnvelopes(roomId);
    }
    return this.roomHistories.get(roomId) || [];
  }

  /**
   * Returns all active rooms.
   */
  public listRooms(): string[] {
    if (this.storage) {
      return this.storage.getRooms().map((r) => r.id);
    }
    return Array.from(this.roomHistories.keys());
  }
}
