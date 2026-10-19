/**
 * @file approval-gate.ts
 * @description Action Approval Token Gate for Union Bot (P2-006, C02, UB-P2-R01-001, UB-P2-R01-002).
 *
 * Enforces:
 * - Deterministic recursive canonical JSON serializer and versioned digest (UB-P2-R01-002, P2-T03).
 * - Approval token created in status 'PENDING'.
 * - Strict PO authorization requirement: validateAndConsume() ONLY consumes 'APPROVED' tokens (UB-P2-R01-001, P2-T01).
 * - Atomic compare-and-swap (CAS) conditional update ensuring single-use consumption across concurrent workers (P2-T02).
 * - Explicit approveToken() and rejectToken() methods with caller audit logging.
 * - Binding to workspace, room, actor, recipient, actionType, payload digest, expiry, and policy revision (P2-T17).
 */

import { DatabaseSync } from 'node:sqlite';
import { StorageEngine } from './storage-engine.ts';
import { type ApprovalToken, ApprovalTokenSchema } from '../../protocol/src/index.ts';
import { UnionBotError } from './errors.ts';
import { computeCanonicalDigest, canonicalizeJson, CANONICALIZATION_VERSION } from './canonical-json.ts';

export interface CreateTokenParams {
  actionType: string;
  payload: unknown;
  origin: string;
  ttlMs?: number;
  workspaceId?: string;
  roomId?: string;
  actorId?: string;
  recipient?: string;
  policyVersion?: string;
}

export interface ApproverIdentity {
  id: string;
  name?: string;
  role?: string;
  contextToken?: string;
  isTrustedContext?: boolean;
}

export interface ValidateAndConsumeOptions {
  workspaceId?: string;
  roomId?: string;
  actorId?: string;
  recipient?: string;
}

export class ApprovalGateManager {
  private db: DatabaseSync;
  private storage: StorageEngine;

  constructor(storage: StorageEngine) {
    this.storage = storage;
    this.db = storage.getRawDatabase();
  }

  /**
   * Computes deterministic SHA256 digest of recursively canonicalized JSON payload.
   */
  public static computePayloadDigest(payload: unknown, version = CANONICALIZATION_VERSION): string {
    return computeCanonicalDigest(payload, version);
  }

  /**
   * Generates a new Approval Token bound to canonical payload digest in status PENDING.
   */
  public createToken(params: CreateTokenParams): ApprovalToken {
    const tokenId = `appr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const payloadDigest = ApprovalGateManager.computePayloadDigest(params.payload);
    const canonicalPayloadJson = canonicalizeJson(params.payload);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (params.ttlMs || 300000)).toISOString(); // default 5 min

    const token: ApprovalToken = {
      tokenId,
      actionType: params.actionType,
      payloadDigest,
      payload_json: canonicalPayloadJson,
      payload: params.payload,
      canonicalizationVersion: CANONICALIZATION_VERSION,
      origin: params.origin,
      workspaceId: params.workspaceId,
      roomId: params.roomId,
      actorId: params.actorId,
      recipient: params.recipient,
      policyVersion: params.policyVersion || '1.0.0',
      status: 'PENDING',
      createdAt: now.toISOString(),
      expiresAt,
    };

    ApprovalTokenSchema.parse(token);

    this.db
      .prepare(`
        INSERT INTO approvals (
          token_id, action_type, payload_digest, canonicalization_version, origin,
          workspace_id, room_id, actor_id, recipient, policy_version,
          status, created_at, expires_at, payload_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
      `)
      .run(
        token.tokenId,
        token.actionType,
        token.payloadDigest,
        token.canonicalizationVersion,
        token.origin,
        token.workspaceId || null,
        token.roomId || null,
        token.actorId || null,
        token.recipient || null,
        token.policyVersion,
        token.createdAt,
        token.expiresAt,
        canonicalPayloadJson
      );

    // Audit log
    this.recordAudit('APPROVAL_TOKEN_CREATED', `Approval token created for action '${token.actionType}'`, {
      tokenId: token.tokenId,
      actionType: token.actionType,
      payloadDigest: token.payloadDigest,
      origin: token.origin,
      workspaceId: token.workspaceId,
      expiresAt: token.expiresAt,
    });

    return token;
  }

  /**
   * Explicitly approves a pending token. Called only by authorized user/PO from trusted context.
   */
  public approveToken(
    tokenId: string,
    approver: ApproverIdentity,
    decisionContext?: Record<string, unknown>
  ): { success: boolean; tokenId: string; approvedAt: string } {
    if (!approver || typeof approver !== 'object' || !approver.id) {
      throw new UnionBotError({
        code: 'ERR_UNTRUSTED_SENDER',
        message: 'Approver identity with valid id is required to approve an action token (UB-P2-R03-02).',
      });
    }

    if (approver.isTrustedContext !== true) {
      throw new UnionBotError({
        code: 'ERR_UNTRUSTED_SENDER',
        message: 'Approver context must be verified by trusted main process (UB-P2-R03-02).',
      });
    }

    const authorizedRoles = ['LEADER', 'USER', 'ADMIN', 'OPERATOR'];
    if (!approver.role || !authorizedRoles.includes(approver.role)) {
      throw new UnionBotError({
        code: 'ERR_UNTRUSTED_SENDER',
        message: `Approver role is required and must be authorized (${authorizedRoles.join(', ')}).`,
        details: { approverId: approver.id, role: approver.role },
      });
    }

    const row = this.db
      .prepare('SELECT token_id, status, expires_at FROM approvals WHERE token_id = ?')
      .get(tokenId) as any;

    if (!row) {
      throw new UnionBotError({
        code: 'ERR_UNTRUSTED_ACTION',
        message: `Approval token not found: ${tokenId}`,
        details: { tokenId },
      });
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      this.db.prepare("UPDATE approvals SET status = 'EXPIRED' WHERE token_id = ?").run(tokenId);
      throw new UnionBotError({
        code: 'ERR_APPROVAL_EXPIRED',
        message: `Cannot approve token ${tokenId}: token has expired.`,
        details: { tokenId, expiresAt: row.expires_at },
      });
    }

    if (row.status === 'CONSUMED') {
      throw new UnionBotError({
        code: 'ERR_APPROVAL_ALREADY_CONSUMED',
        message: `Cannot approve token ${tokenId}: already consumed.`,
        details: { tokenId },
      });
    }

    if (row.status === 'REJECTED') {
      throw new UnionBotError({
        code: 'ERR_UNTRUSTED_ACTION',
        message: `Cannot approve token ${tokenId}: token was already rejected.`,
        details: { tokenId },
      });
    }

    const nowIso = new Date().toISOString();
    const result = this.db
      .prepare(`
        UPDATE approvals
        SET status = 'APPROVED', approver_id = ?, approved_at = ?
        WHERE token_id = ? AND status = 'PENDING' AND expires_at > ?
      `)
      .run(approver.id, nowIso, tokenId, nowIso);

    if (result.changes === 0) {
      throw new UnionBotError({
        code: 'ERR_UNTRUSTED_ACTION',
        message: `Failed to approve token ${tokenId}: token is no longer PENDING or has expired.`,
        details: { tokenId },
      });
    }

    this.recordAudit('APPROVAL_TOKEN_APPROVED', `Token ${tokenId} approved by ${approver.id}`, {
      tokenId,
      approverId: approver.id,
      approverRole: approver.role,
      approvedAt: nowIso,
      context: decisionContext,
    });

    return { success: true, tokenId, approvedAt: nowIso };
  }

  /**
   * Explicitly rejects a pending or approved token.
   */
  public rejectToken(
    tokenId: string,
    rejecter: { id: string },
    reason = 'Rejected by operator'
  ): { success: boolean; tokenId: string; rejectedAt: string } {
    const nowIso = new Date().toISOString();
    const result = this.db
      .prepare(`
        UPDATE approvals
        SET status = 'REJECTED', rejected_at = ?, rejection_reason = ?
        WHERE token_id = ? AND status IN ('PENDING', 'APPROVED')
      `)
      .run(nowIso, reason, tokenId);

    if (result.changes === 0) {
      throw new UnionBotError({
        code: 'ERR_UNTRUSTED_ACTION',
        message: `Cannot reject token ${tokenId}: token not found or already consumed/expired.`,
        details: { tokenId },
      });
    }

    this.recordAudit('APPROVAL_TOKEN_REJECTED', `Token ${tokenId} rejected: ${reason}`, {
      tokenId,
      rejecterId: rejecter.id,
      reason,
      rejectedAt: nowIso,
    });

    return { success: true, tokenId, rejectedAt: nowIso };
  }

  /**
   * Validates and consumes an approval token fail-closed.
   * STRICT ENFORCEMENT: ONLY tokens in status 'APPROVED' may be consumed (UB-P2-R01-001).
   * PENDING, REJECTED, EXPIRED, or CONSUMED tokens are strictly rejected.
   * Atomically executes conditional update: WHERE status = 'APPROVED' AND changes === 1.
   */
  public validateAndConsume(
    tokenId: string,
    actionType: string,
    payload: unknown,
    options: ValidateAndConsumeOptions = {}
  ): void {
    const row = this.db
      .prepare(`
        SELECT token_id, action_type, payload_digest, canonicalization_version,
               workspace_id, room_id, actor_id, recipient,
               status, expires_at, consumed_at, approved_at
        FROM approvals
        WHERE token_id = ?
      `)
      .get(tokenId) as any;

    if (!row) {
      throw new UnionBotError({
        code: 'ERR_UNTRUSTED_ACTION',
        message: `Approval token not found: ${tokenId}`,
        details: { tokenId },
      });
    }

    // 1. Action type and versioned canonical payload digest check (UB-P2-R01-002, P2-T03)
    if (row.action_type !== actionType) {
      throw new UnionBotError({
        code: 'ERR_APPROVAL_HASH_MISMATCH',
        message: `Action type mismatch: expected ${row.action_type}, received ${actionType}`,
        details: { tokenId, expected: row.action_type, received: actionType },
      });
    }

    if (payload === null || payload === undefined || payload === '') {
      throw new UnionBotError({
        code: 'ERR_APPROVAL_HASH_MISMATCH',
        message: `Payload is required to validate and consume approval token ${tokenId} (UB-P2-R03-01).`,
        details: { tokenId },
      });
    }

    const canonVersion = row.canonicalization_version || CANONICALIZATION_VERSION;
    const currentDigest = ApprovalGateManager.computePayloadDigest(payload, canonVersion);
    if (row.payload_digest !== currentDigest) {
      throw new UnionBotError({
        code: 'ERR_APPROVAL_HASH_MISMATCH',
        message: `Payload digest mismatch for token ${tokenId}. Action payload has been modified or tampered with.`,
        details: { tokenId, expected: row.payload_digest, actual: currentDigest },
      });
    }

    // 2. Expiration check
    if (new Date(row.expires_at).getTime() < Date.now()) {
      this.db.prepare("UPDATE approvals SET status = 'EXPIRED' WHERE token_id = ?").run(tokenId);
      throw new UnionBotError({
        code: 'ERR_APPROVAL_EXPIRED',
        message: `Approval token ${tokenId} has expired.`,
        details: { tokenId, expiresAt: row.expires_at },
      });
    }

    // 3. Status checks (UB-P2-R01-001, P2-T01): PENDING tokens MUST NOT BE CONSUMED!
    if (row.status === 'CONSUMED') {
      throw new UnionBotError({
        code: 'ERR_APPROVAL_ALREADY_CONSUMED',
        message: `Approval token ${tokenId} was already consumed on ${row.consumed_at}. Replay blocked.`,
        details: { tokenId, consumedAt: row.consumed_at },
      });
    }

    if (row.status === 'PENDING') {
      throw new UnionBotError({
        code: 'ERR_APPROVAL_NOT_APPROVED',
        message: `Approval token ${tokenId} is still in PENDING status. Explicit human/PO approval is required before action can be consumed.`,
        details: { tokenId, status: 'PENDING' },
      });
    }

    if (row.status !== 'APPROVED') {
      throw new UnionBotError({
        code: 'ERR_UNTRUSTED_ACTION',
        message: `Approval token ${tokenId} is not valid for execution. Status: ${row.status}`,
        details: { tokenId, status: row.status },
      });
    }

    // 3. Scope isolation checks (UB-P2-R02-003, P2-T17, R03-E06)
    // Fail-Closed: When a token has bound scope, missing request scope MUST DENY
    if (row.workspace_id) {
      if (!options.workspaceId) {
        throw new UnionBotError({
          code: 'ERR_UNTRUSTED_ACTION',
          message: `Token requires workspace scope '${row.workspace_id}', but none was provided in request.`,
          details: { tokenId, requiredWorkspace: row.workspace_id },
        });
      }
      if (row.workspace_id !== options.workspaceId) {
        throw new UnionBotError({
          code: 'ERR_UNTRUSTED_ACTION',
          message: `Token workspace scope mismatch: token bound to '${row.workspace_id}', requested by '${options.workspaceId}'`,
          details: { tokenId, boundWorkspace: row.workspace_id, requestedWorkspace: options.workspaceId },
        });
      }
    }

    if (row.room_id) {
      if (!options.roomId) {
        throw new UnionBotError({
          code: 'ERR_UNTRUSTED_ACTION',
          message: `Token requires room scope '${row.room_id}', but none was provided in request.`,
          details: { tokenId, requiredRoom: row.room_id },
        });
      }
      if (row.room_id !== options.roomId) {
        throw new UnionBotError({
          code: 'ERR_UNTRUSTED_ACTION',
          message: `Token room scope mismatch: token bound to '${row.room_id}', requested by '${options.roomId}'`,
          details: { tokenId, boundRoom: row.room_id, requestedRoom: options.roomId },
        });
      }
    }

    if (row.actor_id) {
      if (!options.actorId) {
        throw new UnionBotError({
          code: 'ERR_UNTRUSTED_ACTION',
          message: `Token requires actor scope '${row.actor_id}', but none was provided in request.`,
          details: { tokenId, requiredActor: row.actor_id },
        });
      }
      if (row.actor_id !== options.actorId) {
        throw new UnionBotError({
          code: 'ERR_UNTRUSTED_ACTION',
          message: `Token actor scope mismatch: token bound to '${row.actor_id}', requested by '${options.actorId}'`,
          details: { tokenId, boundActor: row.actor_id, requestedActor: options.actorId },
        });
      }
    }

    if (row.recipient) {
      if (!options.recipient) {
        throw new UnionBotError({
          code: 'ERR_UNTRUSTED_ACTION',
          message: `Token requires recipient scope '${row.recipient}', but none was provided in request.`,
          details: { tokenId, requiredRecipient: row.recipient },
        });
      }
      if (row.recipient !== options.recipient) {
        throw new UnionBotError({
          code: 'ERR_UNTRUSTED_ACTION',
          message: `Token recipient scope mismatch: token bound to '${row.recipient}', requested by '${options.recipient}'`,
          details: { tokenId, boundRecipient: row.recipient, requestedRecipient: options.recipient },
        });
      }
    }



    // Atomically consume token via CAS conditional update (P2-T02)
    const nowIso = new Date().toISOString();
    const result = this.db
      .prepare(`
        UPDATE approvals
        SET status = 'CONSUMED', consumed_at = ?
        WHERE token_id = ? AND status = 'APPROVED' AND expires_at > ? AND payload_digest = ?
      `)
      .run(nowIso, tokenId, nowIso, currentDigest);

    if (result.changes === 0) {
      // Another worker consumed concurrently or token expired in-flight
      throw new UnionBotError({
        code: 'ERR_APPROVAL_ALREADY_CONSUMED',
        message: `Approval token ${tokenId} was consumed concurrently by another worker. Replay blocked.`,
        details: { tokenId },
      });
    }

    // Record audit event
    this.recordAudit('APPROVAL_TOKEN_CONSUMED', `Token ${tokenId} consumed for action '${actionType}'`, {
      tokenId,
      actionType,
      consumedAt: nowIso,
    });
  }

  /**
   * Retrieves current status and details of an approval token.
   */
  public getToken(tokenId: string): ApprovalToken | null {
    const row = this.db
      .prepare('SELECT * FROM approvals WHERE token_id = ?')
      .get(tokenId) as any;
    if (!row) return null;

    let parsedPayload: any = undefined;
    if (row.payload_json) {
      try {
        parsedPayload = JSON.parse(row.payload_json);
      } catch {}
    }

    return {
      tokenId: row.token_id,
      actionType: row.action_type,
      payloadDigest: row.payload_digest,
      payload_json: row.payload_json || undefined,
      payload: parsedPayload,
      canonicalizationVersion: row.canonicalization_version || 1,
      origin: row.origin,
      workspaceId: row.workspace_id || undefined,
      roomId: row.room_id || undefined,
      actorId: row.actor_id || undefined,
      recipient: row.recipient || undefined,
      policyVersion: row.policy_version || '1.0.0',
      status: row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      approverId: row.approver_id || undefined,
      approvedAt: row.approved_at || undefined,
      rejectedAt: row.rejected_at || undefined,
      rejectionReason: row.rejection_reason || undefined,
      consumedAt: row.consumed_at || undefined,
    };
  }

  private recordAudit(eventType: string, summary: string, details?: Record<string, unknown>): void {
    try {
      this.db
        .prepare('INSERT INTO audit_ledger (event_type, summary, details_json, created_at) VALUES (?, ?, ?, ?)')
        .run(eventType, summary, details ? JSON.stringify(details) : null, new Date().toISOString());
    } catch {
      // Best-effort audit logging
    }
  }
}
