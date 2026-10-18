/**
 * @file errors.ts
 * @description Structured error taxonomy and retry policy for Union Bot (P2-011).
 */

import { type UnionBotErrorCode } from '../../protocol/src/index.ts';

export interface UnionBotErrorOptions {
  code: UnionBotErrorCode;
  message: string;
  cause?: unknown;
  details?: Record<string, unknown>;
  retryable?: boolean;
}

export class UnionBotError extends Error {
  public readonly code: UnionBotErrorCode;
  public readonly details: Record<string, unknown>;
  public readonly retryable: boolean;

  constructor(options: UnionBotErrorOptions) {
    super(options.message);
    this.name = 'UnionBotError';
    this.code = options.code;
    this.details = options.details || {};
    this.retryable = options.retryable ?? isCodeRetryable(options.code);
    if (options.cause) {
      this.cause = options.cause;
    }
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      details: this.details,
    };
  }
}

/**
 * Determines default retryability of error codes.
 * Security/validation/cost policy errors are strictly NON-RETRYABLE.
 * Transient network/timeout errors are RETRYABLE.
 */
export function isCodeRetryable(code: UnionBotErrorCode): boolean {
  switch (code) {
    case 'ERR_NETWORK_DISCONNECTED':
    case 'ERR_TIMEOUT':
      return true;
    case 'ERR_COST_LIMIT_EXCEEDED':
    case 'ERR_UNKNOWN_COST_DENIED':
    case 'ERR_UNTRUSTED_SENDER':
    case 'ERR_UNTRUSTED_ACTION':
    case 'ERR_APPROVAL_EXPIRED':
    case 'ERR_APPROVAL_NOT_APPROVED':
    case 'ERR_APPROVAL_ALREADY_CONSUMED':
    case 'ERR_APPROVAL_HASH_MISMATCH':
    case 'ERR_CANONICALIZATION_FAILED':
    case 'ERR_PAYLOAD_MISMATCH':
    case 'ERR_UNSUPPORTED_SCHEMA_VERSION':
    case 'ERR_PATH_TRAVERSAL_DENIED':
    case 'ERR_SCHEMA_VALIDATION_FAILED':
    case 'ERR_STORAGE_CORRUPTION':
    case 'ERR_MIGRATION_FAILED':
    case 'ERR_MIGRATION_TAMPERED':
    case 'ERR_IDEMPOTENCY_CONFLICT':
    case 'ERR_RECONCILIATION_REQUIRED':
    default:
      return false;
  }
}
