/**
 * @file orchestrator.ts
 * @description Core multi-agent collaboration orchestrator skeleton for Union Bot.
 */

import {
  EnvelopeSchema,
  type Envelope,
  type AdmissionAction,
  type AdmissionDecision,
} from '../../protocol/src/index.ts';
import { CostGuard } from '../../cost-guard/src/index.ts';
import { ArtifactStore } from '../../artifact-store/src/index.ts';
import { AdmissionPolicyGate } from './admission-gate.ts';

export interface OrchestratorOptions {
  costGuard?: CostGuard;
  artifactStore?: ArtifactStore;
  paidApiEnabled?: boolean;
}

export interface DispatchResult {
  success: boolean;
  envelopeId: string;
  roomId: string;
  error?: string;
}

export class Orchestrator {
  public readonly admissionGate: AdmissionPolicyGate;
  public readonly costGuard: CostGuard;
  public readonly artifactStore?: ArtifactStore;
  private readonly roomHistories = new Map<string, Envelope[]>();

  constructor(options: OrchestratorOptions = {}) {
    this.costGuard = options.costGuard ?? new CostGuard();
    this.artifactStore = options.artifactStore;
    this.admissionGate = new AdmissionPolicyGate({
      costGuard: this.costGuard,
      paidApiEnabled: options.paidApiEnabled ?? false,
    });
  }

  /**
   * Dispatches an envelope into the designated room history.
   */
  public async dispatchEnvelope(rawEnvelope: unknown): Promise<DispatchResult> {
    const parseResult = EnvelopeSchema.safeParse(rawEnvelope);
    if (!parseResult.success) {
      return {
        success: false,
        envelopeId: (rawEnvelope as any)?.id || 'unknown',
        roomId: (rawEnvelope as any)?.roomId || 'unknown',
        error: `Envelope schema validation error: ${parseResult.error.issues.map((i) => i.message).join('; ')}`,
      };
    }

    const envelope = parseResult.data;
    const room = this.roomHistories.get(envelope.roomId) || [];
    room.push(envelope);
    this.roomHistories.set(envelope.roomId, room);

    return {
      success: true,
      envelopeId: envelope.id,
      roomId: envelope.roomId,
    };
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
    return this.roomHistories.get(roomId) || [];
  }

  /**
   * Returns all active rooms.
   */
  public listRooms(): string[] {
    return Array.from(this.roomHistories.keys());
  }
}
