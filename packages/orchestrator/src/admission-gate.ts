/**
 * @file admission-gate.ts
 * @description AdmissionPolicyGate enforcing Zero-Cost (0đ) and action allowlists before dispatch.
 */

import {
  AdmissionActionSchema,
  AdmissionDecisionSchema,
  type AdmissionAction,
  type AdmissionDecision,
} from '../../protocol/src/index.ts';
import { CostGuard } from '../../cost-guard/src/index.ts';

export interface AdmissionGateOptions {
  paidApiEnabled?: boolean;
  costGuard?: CostGuard;
}

export class AdmissionPolicyGate {
  public readonly paidApiEnabled: boolean;
  private readonly costGuard: CostGuard;
  private readonly auditLog: AdmissionDecision[] = [];

  constructor(options: AdmissionGateOptions = {}) {
    // Strictly default to false (0đ zero-cost policy)
    this.paidApiEnabled = options.paidApiEnabled ?? false;
    this.costGuard = options.costGuard ?? new CostGuard();
  }

  /**
   * Evaluates an admission action candidate against zero-cost policies and allowlists.
   */
  public evaluate(rawAction: unknown): AdmissionDecision {
    const timestamp = Date.now();

    // 1. Strict zero-cost check: reject unknown or unspecified cost
    const rawCost = (rawAction as any)?.estimatedCost;
    if (rawCost === undefined || rawCost === null || typeof rawCost !== 'number' || Number.isNaN(rawCost)) {
      const decision: AdmissionDecision = {
        actionId: (rawAction as any)?.actionId || 'unknown_action',
        allowed: false,
        reason: 'Zero-Cost violation: estimatedCost is undefined, missing, or unknown. Unspecified cost is strictly DENIED.',
        policyCode: 'DENY_UNKNOWN_COST',
        policyVersion: '1.0.0',
        costClassification: 'UNKNOWN_COST_DENIED',
        timestamp,
      };
      this.auditLog.push(decision);
      return decision;
    }

    // 2. Validate structure with Zod schema
    const parseResult = AdmissionActionSchema.safeParse(rawAction);
    if (!parseResult.success) {
      const decision: AdmissionDecision = {
        actionId: (rawAction as any)?.actionId || 'unknown_action',
        allowed: false,
        reason: `Schema validation failed: ${parseResult.error.issues.map((i) => i.message).join('; ')}`,
        policyCode: 'DENY_SCHEMA_INVALID',
        policyVersion: '1.0.0',
        costClassification: 'UNKNOWN_COST_DENIED',
        timestamp,
      };
      this.auditLog.push(decision);
      return decision;
    }

    const action = parseResult.data;

    // 2. Reject UNKNOWN_ACTION
    if (action.actionType === 'UNKNOWN_ACTION') {
      const decision: AdmissionDecision = {
        actionId: action.actionId,
        allowed: false,
        reason: `Rejected unknown action type: ${action.actionType}`,
        policyCode: 'DENY_UNKNOWN_ACTION',
        policyVersion: '1.0.0',
        costClassification: 'ZERO_COST_LOCAL',
        timestamp,
      };
      this.auditLog.push(decision);
      return decision;
    }

    // 3. Reject any paid cost if paid_api_enabled is false
    if (action.estimatedCost > 0 && !this.paidApiEnabled) {
      const decision: AdmissionDecision = {
        actionId: action.actionId,
        allowed: false,
        reason: `Zero-Cost (0đ) violation: Action requires estimated cost ${action.estimatedCost}, but paid APIs are strictly disabled`,
        policyCode: 'DENY_PAID_API_DISABLED',
        policyVersion: '1.0.0',
        costClassification: 'PAID_API_BLOCKED',
        timestamp,
      };
      this.auditLog.push(decision);
      return decision;
    }

    // 4. If action targets an external URL, verify through CostGuard egress boundaries
    if (action.targetUrl) {
      if (!this.costGuard.isUrlAllowed(action.targetUrl)) {
        const decision: AdmissionDecision = {
          actionId: action.actionId,
          allowed: false,
          reason: `Egress boundary violation: Target URL '${action.targetUrl}' is forbidden under Zero-Cost policy`,
          policyCode: 'DENY_EGRESS_BLOCKED',
          policyVersion: '1.0.0',
          costClassification: 'PAID_API_BLOCKED',
          timestamp,
        };
        this.auditLog.push(decision);
        return decision;
      }
    }

    // 5. Approved zero-cost action
    const decision: AdmissionDecision = {
      actionId: action.actionId,
      allowed: true,
      reason: `Action '${action.actionType}' on provider '${action.provider}' permitted under Zero-Cost policy`,
      policyCode: 'ALLOW_ZERO_COST',
      policyVersion: '1.0.0',
      costClassification: action.actionType === 'READ_WEB_DOM' ? 'FREE_DOM' : 'ZERO_COST_LOCAL',
      timestamp,
    };
    this.auditLog.push(decision);
    return decision;
  }

  /**
   * Retrieves read-only copy of the admission audit decisions.
   */
  public getAuditLog(): readonly AdmissionDecision[] {
    return [...this.auditLog];
  }
}
