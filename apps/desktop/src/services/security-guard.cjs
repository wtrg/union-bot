/**
 * @file security-guard.cjs
 * @description Security, Reliability, Observability & Performance Engine (UB-V4-U11).
 * Enforces:
 * - Prompt injection, jailbreak & exfiltration detection.
 * - Unicode bidi override & terminal escape sanitization.
 * - Zero-cost 0đ egress audit logging.
 * - SQLite database integrity check & safe WAL checkpointing.
 * - Latency & performance monitoring with bounded execution windows.
 */

const crypto = require('node:crypto');

const PROMPT_INJECTION_PATTERNS = [
  // Instruction override
  /(?:ignore|forget|disregard)\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules|directives)/i,
  // Jailbreak / Unrestricted persona override
  /(?:you are now|pretend you are|acting as)\s+(?:in\s+)?(?:DAN|developer|jailbreak|unrestricted|god)\s+mode/i,
  // Direct system prompt injection
  /(?:system\s+prompt|system\s+instruction)\s*:\s*you\s+must/i,
  // Exfiltration targets
  /(?:exfiltrate|dump|leak|steal)\s+(?:credentials?|passwords?|keys?|tokens?|env|database)/i,
  // Malicious webhook exfiltration
  /(?:curl|wget|fetch)\s+https?:\/\/(?:[a-z0-9_-]+\.)*(?:webhook\.site|requestbin|pipedream|hookbin|burpcollaborator)/i,
  // Sensitive local credential file reading
  /(?:cat|type|get-content)\s+[^\n]*\.(?:env|id_rsa|git\/config|credentials)/i,
];

// Dangerous Unicode Directional Overrides (Trojan Source / RTL spoofing)
const BIDI_OVERRIDE_REGEX = /[\u202A-\u202E\u2066-\u2069]/g;

// Terminal escape codes (ANSI CSI)
const ANSI_ESCAPE_REGEX = /\x1B\[[0-9;]*[a-zA-Z]/g;

class SecurityGuardService {
  constructor(options = {}) {
    this.storage = options.storage || null;
    this.costGuard = options.costGuard || null;
    this.maxLatencyMs = options.maxLatencyMs || 100;

    this.auditLogs = [];
    this.violations = [];
  }

  /**
   * Scans text or envelope content for prompt injection & security risks (U11-001).
   */
  inspectContent(text) {
    if (typeof text !== 'string') {
      return { safe: true, riskScore: 0, flags: [] };
    }

    const flags = [];
    let riskScore = 0;

    // 1. Check for prompt injection / jailbreak patterns
    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        flags.push({
          type: 'PROMPT_INJECTION',
          pattern: pattern.toString(),
          severity: 'HIGH',
        });
        riskScore += 40;
      }
    }

    // 2. Check for Unicode Bidi overrides
    if (BIDI_OVERRIDE_REGEX.test(text)) {
      flags.push({
        type: 'UNICODE_BIDI_OVERRIDE',
        severity: 'CRITICAL',
        description: 'Contains hidden right-to-left or directional formatting override characters',
      });
      riskScore += 50;
    }

    // 3. Check for raw ANSI terminal escapes
    if (ANSI_ESCAPE_REGEX.test(text)) {
      flags.push({
        type: 'ANSI_ESCAPE_CODES',
        severity: 'MEDIUM',
        description: 'Contains terminal escape sequences that may spoof terminal outputs',
      });
      riskScore += 20;
    }

    const isSafe = riskScore < 30;

    if (!isSafe) {
      this.violations.push({
        timestamp: Date.now(),
        riskScore,
        flags,
        sample: text.slice(0, 200),
      });
    }

    return {
      safe: isSafe,
      riskScore,
      blocked: !isSafe,
      flags,
    };
  }

  /**
   * Sanitizes text by stripping dangerous characters and terminal escapes.
   */
  sanitizeContent(text) {
    if (typeof text !== 'string') return '';
    let clean = text;

    // Strip Bidi overrides
    clean = clean.replace(BIDI_OVERRIDE_REGEX, '');

    // Strip ANSI escape sequences
    clean = clean.replace(ANSI_ESCAPE_REGEX, '');

    return clean;
  }

  /**
   * Verifies Zero-Cost 0đ policy on outbound egress (U11-002).
   */
  auditEgress(url) {
    if (!url || typeof url !== 'string') {
      return { allowed: false, reason: 'INVALID_URL', cost: 0 };
    }

    // Disallow paid APIs
    const paidDomains = [
      'api.openai.com',
      'generativelanguage.googleapis.com',
      'api.anthropic.com',
      'api.deepseek.com',
      'api.mistral.ai',
      'api.cohere.ai',
    ];

    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();

      if (paidDomains.some((d) => host === d || host.endsWith('.' + d))) {
        this.violations.push({
          timestamp: Date.now(),
          type: 'PAID_API_BLOCKED',
          url,
          costViolation: true,
        });
        return {
          allowed: false,
          reason: 'ERR_PAID_API_BLOCKED',
          cost: 0,
          error: `Egress to paid API '${host}' is strictly prohibited under 0 VNĐ policy`,
        };
      }

      this.auditLogs.push({
        timestamp: Date.now(),
        url,
        status: 'ALLOWED_ZERO_COST',
      });

      return {
        allowed: true,
        cost: 0,
        currency: 'VND',
        verifiedZeroCost: true,
      };
    } catch (err) {
      return { allowed: false, reason: 'URL_PARSE_ERROR', error: err.message, cost: 0 };
    }
  }

  /**
   * Database self-healing and WAL checkpointing (U11-003).
   */
  performDatabaseHealthCheck() {
    if (!this.storage) {
      return { healthy: false, error: 'No storage provider configured' };
    }

    const rawDb = this.storage.nativeDb || (this.storage.client && this.storage.client.db);
    if (!rawDb) {
      return { healthy: false, error: 'Underlying SQLite database handle unavailable' };
    }

    try {
      // 1. Run SQLite integrity check
      const integrityRow = rawDb.prepare('PRAGMA integrity_check').get();
      const integrityStatus = integrityRow ? Object.values(integrityRow)[0] : 'unknown';

      // 2. Safe WAL checkpoint
      let checkpointResult = null;
      try {
        checkpointResult = rawDb.prepare('PRAGMA wal_checkpoint(PASSIVE)').get();
      } catch (cpErr) {
        // In-memory databases do not support wal_checkpoint
      }

      const isOk = integrityStatus === 'ok';

      return {
        healthy: isOk,
        integrityCheck: integrityStatus,
        walCheckpoint: checkpointResult,
        checkedAt: Date.now(),
      };
    } catch (err) {
      return {
        healthy: false,
        error: err.message,
        checkedAt: Date.now(),
      };
    }
  }

  /**
   * Measures execution time and ensures operations finish within bounded latency (U11-004).
   */
  async measurePerformance(name, fn) {
    const start = performance.now();
    try {
      const result = await fn();
      const durationMs = performance.now() - start;
      const exceedsThreshold = durationMs > this.maxLatencyMs;

      return {
        success: true,
        name,
        durationMs,
        exceedsThreshold,
        result,
      };
    } catch (err) {
      const durationMs = performance.now() - start;
      return {
        success: false,
        name,
        durationMs,
        error: err.message,
      };
    }
  }

  /**
   * Retrieves summary security metrics.
   */
  getSecurityMetrics() {
    return {
      totalViolations: this.violations.length,
      recentViolations: this.violations.slice(-10),
      totalAuditLogs: this.auditLogs.length,
      zeroCostEnforced: true,
      timestamp: Date.now(),
    };
  }
}

module.exports = {
  SecurityGuardService,
  PROMPT_INJECTION_PATTERNS,
};
