/**
 * @file approval-gate.ts
 * @description Action Approval Token Gate for Union Bot (P2-006, C02).
 */

import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { StorageEngine } from './storage-engine.ts';
import { type ApprovalToken, ApprovalTokenSchema } from '../../protocol/src/index.ts';
import { UnionBotError } from './errors.ts';

export interface CreateTokenParams {
  actionType: string;
  payload: unknown;
  origin: string;
  ttlMs?: number;
}

export class ApprovalGateManager {
  private db: DatabaseSync;

  private storage: StorageEngine;

  constructor(storage: StorageEngine) {
    this.storage = storage;
    this.db = storage.getRawDatabase();
  }

  /**
   * Computes deterministic SHA256 digest of canonical JSON.
   */
  public static computePayloadDigest(payload: unknown): string {
    const canonicalStr = JSON.stringify(payload, Object.keys(payload as any || {}).sort());
    return createHash('sha256').update(canonicalStr).digest('hex');
  }

  /**
   * Generates a new Approval Token tied to action payload digest.
   */
  public createToken(params: CreateTokenParams): ApprovalToken {
    const tokenId = `appr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const payloadDigest = ApprovalGateManager.computePayloadDigest(params.payload);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (params.ttlMs || 300000)).toISOString(); // default 5 min

    const token: ApprovalToken = {
      tokenId,
      actionType: params.actionType,
      payloadDigest,
      origin: params.origin,
      status: 'PENDING',
      createdAt: now.toISOString(),
      expiresAt,
    };

    ApprovalTokenSchema.parse(token);

    this.db
      .prepare(`
        INSERT INTO approvals (token_id, action_type, payload_digest, origin, status, created_at, expires_at)
        VALUES (?, ?, ?, ?, 'PENDING', ?, ?)
      `)
      .run(token.tokenId, token.actionType, token.payloadDigest, token.origin, token.createdAt, token.expiresAt);

    return token;
  }

  /**
   * Validates and consumes an approval token fail-closed.
   * Throws UnionBotError if token is missing, expired, hash mismatch, or already consumed.
   */
  public validateAndConsume(tokenId: string, actionType: string, payload: unknown): void {
    const row = this.db
      .prepare('SELECT token_id, action_type, payload_digest, status, expires_at, consumed_at FROM approvals WHERE token_id = ?')
      .get(tokenId) as any;

    if (!row) {
      throw new UnionBotError({
        code: 'ERR_UNTRUSTED_ACTION',
        message: `Approval token not found: ${tokenId}`,
        details: { tokenId },
      });
    }

    if (row.action_type !== actionType) {
      throw new UnionBotError({
        code: 'ERR_APPROVAL_HASH_MISMATCH',
        message: `Action type mismatch: expected ${row.action_type}, received ${actionType}`,
        details: { tokenId, expected: row.action_type, received: actionType },
      });
    }

    const currentDigest = ApprovalGateManager.computePayloadDigest(payload);
    if (row.payload_digest !== currentDigest) {
      throw new UnionBotError({
        code: 'ERR_APPROVAL_HASH_MISMATCH',
        message: `Payload digest mismatch for token ${tokenId}. Action payload has been tampered with.`,
        details: { tokenId, expected: row.payload_digest, actual: currentDigest },
      });
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      this.db.prepare("UPDATE approvals SET status = 'EXPIRED' WHERE token_id = ?").run(tokenId);
      throw new UnionBotError({
        code: 'ERR_APPROVAL_EXPIRED',
        message: `Approval token ${tokenId} has expired.`,
        details: { tokenId, expiresAt: row.expires_at },
      });
    }

    if (row.status === 'CONSUMED') {
      throw new UnionBotError({
        code: 'ERR_APPROVAL_ALREADY_CONSUMED',
        message: `Approval token ${tokenId} was already consumed on ${row.consumed_at}. Replay blocked.`,
        details: { tokenId, consumedAt: row.consumed_at },
      });
    }

    if (row.status !== 'PENDING' && row.status !== 'APPROVED') {
      throw new UnionBotError({
        code: 'ERR_UNTRUSTED_ACTION',
        message: `Approval token ${tokenId} is not valid for execution. Status: ${row.status}`,
        details: { tokenId, status: row.status },
      });
    }

    // Atomically consume token
    const nowIso = new Date().toISOString();
    this.db
      .prepare("UPDATE approvals SET status = 'CONSUMED', consumed_at = ? WHERE token_id = ?")
      .run(nowIso, tokenId);
  }
}
