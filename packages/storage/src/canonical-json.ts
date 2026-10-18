/**
 * @file canonical-json.ts
 * @description Deterministic recursive canonical JSON serializer and digest generator (UB-P2-R01-002, UB-P2-R02-007, P2-T03, R03-E12).
 *
 * Guarantees:
 * - Deterministic recursive object key sorting at all depths.
 * - Array element order preserved exactly.
 * - Robust handling of primitives: booleans, numbers, strings, null, and Unicode.
 * - Fail-closed rejection of non-deterministic / dangerous / non-standard JSON types at all depths:
 *   - Circular references (WeakSet detection)
 *   - NaN and Infinity
 *   - BigInt, Function, Symbol, and undefined (root, nested objects, and array elements)
 *   - Sparse arrays
 * - Versioned cryptographic digest algorithm (v1 default) returning 64-character SHA-256 hex string.
 */

import { createHash } from 'node:crypto';
import { UnionBotError } from './errors.ts';

export const CANONICALIZATION_VERSION = 1;
export const SUPPORTED_CANONICALIZATION_VERSIONS = [1] as const;

/**
 * Recursively canonicalizes any JSON-compatible value into a deterministic string representation.
 * Strictly fail-closed: rejects non-standard types (undefined, function, symbol, bigint, sparse arrays) at all depths.
 */
export function canonicalizeJson(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) {
    return 'null';
  }

  const valueType = typeof value;

  if (valueType === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (valueType === 'number') {
    const num = value as number;
    if (Number.isNaN(num) || !Number.isFinite(num)) {
      throw new UnionBotError({
        code: 'ERR_CANONICALIZATION_FAILED',
        message: `Canonicalization rejected non-finite number: ${num}`,
        details: { value },
      });
    }
    // Zero normalization (-0 to 0)
    return Object.is(num, -0) ? '0' : String(num);
  }

  if (valueType === 'string') {
    return JSON.stringify(value);
  }

  if (valueType === 'bigint' || valueType === 'function' || valueType === 'symbol' || valueType === 'undefined') {
    throw new UnionBotError({
      code: 'ERR_CANONICALIZATION_FAILED',
      message: `Canonicalization rejected unsupported type: ${valueType}`,
      details: { valueType },
    });
  }

  if (valueType === 'object') {
    const obj = value as object;

    if (seen.has(obj)) {
      throw new UnionBotError({
        code: 'ERR_CANONICALIZATION_FAILED',
        message: 'Canonicalization rejected circular structure',
      });
    }
    seen.add(obj);

    try {
      if (Array.isArray(obj)) {
        const elements: string[] = [];
        for (let i = 0; i < obj.length; i++) {
          // Detect sparse arrays
          if (!(i in obj)) {
            throw new UnionBotError({
              code: 'ERR_CANONICALIZATION_FAILED',
              message: `Canonicalization rejected sparse array hole at index ${i}`,
              details: { index: i },
            });
          }
          const item = obj[i];
          if (item === undefined || typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint') {
            throw new UnionBotError({
              code: 'ERR_CANONICALIZATION_FAILED',
              message: `Canonicalization rejected unsupported array element of type '${typeof item}' at index ${i}`,
              details: { index: i, itemType: typeof item },
            });
          }
          elements.push(canonicalizeJson(item, seen));
        }
        return `[${elements.join(',')}]`;
      }

      // Plain or custom object: recursively sort keys lexicographically
      const keys = Object.keys(obj).sort();
      const entries: string[] = [];

      for (const key of keys) {
        const val = (obj as Record<string, unknown>)[key];
        // Strictly reject unsupported property values rather than silently dropping them (UB-P2-R02-007)
        if (val === undefined || typeof val === 'function' || typeof val === 'symbol' || typeof val === 'bigint') {
          throw new UnionBotError({
            code: 'ERR_CANONICALIZATION_FAILED',
            message: `Canonicalization rejected unsupported property value of type '${typeof val}' at key '${key}'`,
            details: { key, valType: typeof val },
          });
        }
        const canonKey = JSON.stringify(key);
        const canonVal = canonicalizeJson(val, seen);
        entries.push(`${canonKey}:${canonVal}`);
      }

      return `{${entries.join(',')}}`;
    } finally {
      seen.delete(obj);
    }
  }

  throw new UnionBotError({
    code: 'ERR_CANONICALIZATION_FAILED',
    message: `Unexpected value in canonicalization: ${String(value)}`,
  });
}

/**
 * Computes a versioned SHA-256 hexadecimal digest of canonicalized payload.
 * Returns 64-character lowercase hex string digest.
 * Verifies version is supported before computing.
 */
export function computeCanonicalDigest(payload: unknown, version = CANONICALIZATION_VERSION): string {
  if (!SUPPORTED_CANONICALIZATION_VERSIONS.includes(version as any)) {
    throw new UnionBotError({
      code: 'ERR_CANONICALIZATION_FAILED',
      message: `Unsupported canonicalization version: ${version}. Supported versions: ${SUPPORTED_CANONICALIZATION_VERSIONS.join(', ')}`,
      details: { version },
    });
  }
  const canonicalStr = canonicalizeJson(payload);
  const digestInput = `v${version}:${canonicalStr}`;
  return createHash('sha256').update(digestInput, 'utf8').digest('hex');
}

/**
 * Computes deterministic canonical digest for an Envelope.
 */
export function computeEnvelopeDigest(envelope: any): string {
  const normalized = {
    id: envelope.id,
    roomId: envelope.roomId,
    workspaceId: envelope.workspaceId || null,
    sender: {
      kind: envelope.sender.kind,
      id: envelope.sender.id,
      role: envelope.sender.role || null,
    },
    recipient: envelope.recipient ? {
      kind: envelope.recipient.kind,
      id: envelope.recipient.id,
    } : null,
    parts: envelope.parts || [],
  };
  return computeCanonicalDigest(normalized, CANONICALIZATION_VERSION);
}
