/**
 * @file crypto.ts
 * @description Client-side deterministic recursive canonical JSON serializer and Web Crypto SHA-256 digest calculator.
 * Used by ApprovalInbox for live client-side verification of ActionIntent payload integrity (UB-P3-R02-001, UB-P3-R02-004).
 */

export function canonicalizeJson(value: any, seen = new WeakSet()): string {
  if (value === null) {
    return 'null';
  }

  const valueType = typeof value;

  if (valueType === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (valueType === 'number') {
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      throw new Error(`Canonicalization rejected non-finite number: ${value}`);
    }
    return Object.is(value, -0) ? '0' : String(value);
  }

  if (valueType === 'string') {
    return JSON.stringify(value);
  }

  if (valueType === 'object') {
    if (seen.has(value)) {
      throw new Error('Canonicalization rejected circular structure');
    }
    seen.add(value);

    try {
      if (Array.isArray(value)) {
        const elements: string[] = [];
        for (let i = 0; i < value.length; i++) {
          if (!(i in value)) {
            throw new Error(`Canonicalization rejected sparse array hole at index ${i}`);
          }
          const item = value[i];
          if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
            throw new Error(`Canonicalization rejected unsupported array item: ${typeof item}`);
          }
          elements.push(canonicalizeJson(item, seen));
        }
        return `[${elements.join(',')}]`;
      }

      const keys = Object.keys(value).sort();
      const entries: string[] = [];

      for (const key of keys) {
        const val = value[key];
        if (val === undefined || typeof val === 'function' || typeof val === 'symbol') {
          throw new Error(`Canonicalization rejected unsupported property value at key ${key}`);
        }
        const canonKey = JSON.stringify(key);
        const canonVal = canonicalizeJson(val, seen);
        entries.push(`${canonKey}:${canonVal}`);
      }

      return `{${entries.join(',')}}`;
    } finally {
      seen.delete(value);
    }
  }

  throw new Error(`Unsupported type in canonicalization: ${valueType}`);
}

/**
 * Computes deterministic SHA-256 hexadecimal digest using browser's native Web Crypto API.
 */
export async function computeClientCanonicalDigest(payload: any, version = 1): Promise<string> {
  const canonicalStr = canonicalizeJson(payload);
  const digestInput = `v${version}:${canonicalStr}`;
  const msgBuffer = new TextEncoder().encode(digestInput);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
