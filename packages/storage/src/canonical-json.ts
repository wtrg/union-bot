/**
 * @file canonical-json.ts
 * @description Deterministic recursive canonical JSON serializer and digest generator (UB-P2-R01-002, P2-T03).
 *
 * Guarantees:
 * - Deterministic recursive object key sorting at all depths.
 * - Array element order preserved exactly.
 * - Robust handling of primitives: booleans, numbers, strings, null, and Unicode.
 * - Strict rejection of non-deterministic / dangerous types:
 *   - Circular references (WeakSet detection)
 *   - NaN and Infinity
 *   - BigInt, Function, Symbol, and undefined root
 * - Versioned cryptographic digest algorithm (v1 default).
 */

import { createHash } from 'node:crypto';
import { UnionBotError } from './errors.ts';

export const CANONICALIZATION_VERSION = 1;

/**
 * Recursively canonicalizes any JSON-compatible value into a deterministic string representation.
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

  if (valueType === 'bigint' || valueType === 'function' || valueType === 'symbol') {
    throw new UnionBotError({
      code: 'ERR_CANONICALIZATION_FAILED',
      message: `Canonicalization rejected unsupported type: ${valueType}`,
      details: { valueType },
    });
  }

  if (valueType === 'undefined') {
    throw new UnionBotError({
      code: 'ERR_CANONICALIZATION_FAILED',
      message: 'Canonicalization rejected undefined root value',
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
          const item = obj[i];
          if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
            elements.push('null');
          } else {
            elements.push(canonicalizeJson(item, seen));
          }
        }
        return `[${elements.join(',')}]`;
      }

      // Plain or custom object: recursively sort keys lexicographically
      const keys = Object.keys(obj).sort();
      const entries: string[] = [];

      for (const key of keys) {
        const val = (obj as Record<string, unknown>)[key];
        // Standard JSON behavior: omit undefined, function, symbol properties
        if (val === undefined || typeof val === 'function' || typeof val === 'symbol') {
          continue;
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
 */
export function computeCanonicalDigest(payload: unknown, version = CANONICALIZATION_VERSION): string {
  const canonicalStr = canonicalizeJson(payload);
  const digestInput = `v${version}:${canonicalStr}`;
  return createHash('sha256').update(digestInput, 'utf8').digest('hex');
}
