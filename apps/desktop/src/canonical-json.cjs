/**
 * @file canonical-json.cjs
 * @description Canonical JSON serializer and deterministic SHA-256 digest generator for Electron desktop.
 * Mirrors packages/storage/src/canonical-json.ts with 100% behavioral parity (UB-P2-R03-01, UB-P2-R03-03).
 */

const { createHash } = require('node:crypto');

const CANONICALIZATION_VERSION = 1;
const SUPPORTED_CANONICALIZATION_VERSIONS = [1];

function canonicalizeJson(value, seen = new WeakSet()) {
  if (value === null) {
    return 'null';
  }

  const valueType = typeof value;

  if (valueType === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (valueType === 'number') {
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      throw new Error(`ERR_CANONICALIZATION_FAILED: Canonicalization rejected non-finite number: ${value}`);
    }
    return Object.is(value, -0) ? '0' : String(value);
  }

  if (valueType === 'string') {
    return JSON.stringify(value);
  }

  if (valueType === 'bigint' || valueType === 'function' || valueType === 'symbol' || valueType === 'undefined') {
    throw new Error(`ERR_CANONICALIZATION_FAILED: Canonicalization rejected unsupported type: ${valueType}`);
  }

  if (valueType === 'object') {
    if (seen.has(value)) {
      throw new Error('ERR_CANONICALIZATION_FAILED: Canonicalization rejected circular structure');
    }
    seen.add(value);

    try {
      if (Array.isArray(value)) {
        const elements = [];
        for (let i = 0; i < value.length; i++) {
          if (!(i in value)) {
            throw new Error(`ERR_CANONICALIZATION_FAILED: Canonicalization rejected sparse array hole at index ${i}`);
          }
          const item = value[i];
          if (item === undefined || typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint') {
            throw new Error(`ERR_CANONICALIZATION_FAILED: Canonicalization rejected unsupported array element of type '${typeof item}' at index ${i}`);
          }
          elements.push(canonicalizeJson(item, seen));
        }
        return `[${elements.join(',')}]`;
      }

      const keys = Object.keys(value).sort();
      const entries = [];
      for (const key of keys) {
        const val = value[key];
        if (val === undefined || typeof val === 'function' || typeof val === 'symbol' || typeof val === 'bigint') {
          throw new Error(`ERR_CANONICALIZATION_FAILED: Canonicalization rejected unsupported property value of type '${typeof val}' at key '${key}'`);
        }
        entries.push(`${JSON.stringify(key)}:${canonicalizeJson(val, seen)}`);
      }
      return `{${entries.join(',')}}`;
    } finally {
      seen.delete(value);
    }
  }

  throw new Error(`ERR_CANONICALIZATION_FAILED: Unexpected value in canonicalization: ${String(value)}`);
}

function computeCanonicalDigest(payload, version = CANONICALIZATION_VERSION) {
  if (!SUPPORTED_CANONICALIZATION_VERSIONS.includes(version)) {
    throw new Error(`ERR_CANONICALIZATION_FAILED: Unsupported canonicalization version: ${version}`);
  }
  const canonicalStr = canonicalizeJson(payload);
  const digestInput = `v${version}:${canonicalStr}`;
  return createHash('sha256').update(digestInput, 'utf8').digest('hex');
}

/**
 * Computes deterministic canonical digest for an Envelope (UB-P2-R03-03, R05-H06).
 */
function computeEnvelopeDigest(envelope) {
  const normalized = {
    id: envelope.id,
    roomId: envelope.roomId,
    workspaceId: envelope.workspaceId || null,
    policyVersion: envelope.policyVersion || null,
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

/**
 * Extracts semantic action input stripped of transport-only metadata like approvalTokenId (R04-C02, R05-H07).
 */
function extractActionSemanticInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input;
  }
  const filtered = {};
  for (const [k, v] of Object.entries(input)) {
    if (k !== 'approvalTokenId' && k !== 'approval_token_id') {
      filtered[k] = v;
    }
  }
  return filtered;
}

module.exports = {
  CANONICALIZATION_VERSION,
  canonicalizeJson,
  computeCanonicalDigest,
  computeEnvelopeDigest,
  extractActionSemanticInput,
};

