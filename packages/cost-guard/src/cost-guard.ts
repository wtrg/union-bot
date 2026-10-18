/**
 * Cost Guard Engine for Union Bot
 * Enforces strict Zero-Cost (0 VND) policy by blocking paid API endpoints
 * and validating egress against approved allowlists.
 */

export interface CostGuardOptions {
  allowLocalhost?: boolean;
  extraAllowlist?: string[];
  onViolation?: (violation: CostGuardViolation) => void;
}

export interface CostGuardViolation {
  url: string;
  hostname: string;
  reason: 'PAID_API_BLOCKED' | 'NOT_IN_ALLOWLIST' | 'BILLING_ENDPOINT_BLOCKED';
  timestamp: string;
}

export class CostGuard {
  // Known paid API endpoints that must NEVER be accessed
  private static readonly DENIED_HOSTS: readonly string[] = [
    'api.openai.com',
    'generativelanguage.googleapis.com',
    'api.anthropic.com',
    'api.deepseek.com',
    'api.mistral.ai',
    'api.cohere.ai'
  ];

  // Approved free web UI domains
  private static readonly DEFAULT_ALLOWLIST: readonly string[] = [
    '127.0.0.1',
    'localhost',
    '::1',
    'chatgpt.com',
    'openai.com',
    'gemini.google.com',
    'google.com',
    'gstatic.com',
    'googleusercontent.com',
    'claude.ai',
    'anthropic.com',
    'chat.deepseek.com',
    'deepseek.com',
    'github.com',
    'githubusercontent.com'
  ];

  private readonly allowlist: Set<string>;
  private readonly violations: CostGuardViolation[] = [];
  private readonly onViolation?: (violation: CostGuardViolation) => void;

  constructor(options: CostGuardOptions = {}) {
    this.allowlist = new Set<string>([
      ...CostGuard.DEFAULT_ALLOWLIST,
      ...(options.extraAllowlist || [])
    ]);
    this.onViolation = options.onViolation;
  }

  /**
   * Check if a URL is permitted under the 0 VND zero-cost policy.
   * Returns true if allowed, false if blocked.
   */
  public isUrlAllowed(rawUrl: string): boolean {
    try {
      const parsed = new URL(rawUrl);
      const hostname = parsed.hostname.toLowerCase();

      // 1. Check strict denylist (Paid APIs)
      for (const denied of CostGuard.DENIED_HOSTS) {
        if (hostname === denied || hostname.endsWith('.' + denied)) {
          this.recordViolation({
            url: rawUrl,
            hostname,
            reason: 'PAID_API_BLOCKED',
            timestamp: new Date().toISOString()
          });
          return false;
        }
      }

      // 2. Check for billing/payment patterns in URL
      if (parsed.pathname.includes('/billing') || parsed.pathname.includes('/checkout') || parsed.pathname.includes('/subscribe')) {
        this.recordViolation({
          url: rawUrl,
          hostname,
          reason: 'BILLING_ENDPOINT_BLOCKED',
          timestamp: new Date().toISOString()
        });
        return false;
      }

      // 3. Match against allowlist
      let matched = false;
      for (const allowed of this.allowlist) {
        if (hostname === allowed || hostname.endsWith('.' + allowed)) {
          matched = true;
          break;
        }
      }

      if (!matched) {
        this.recordViolation({
          url: rawUrl,
          hostname,
          reason: 'NOT_IN_ALLOWLIST',
          timestamp: new Date().toISOString()
        });
        return false;
      }

      return true;
    } catch {
      // Invalid URL format is blocked by default
      return false;
    }
  }

  /**
   * Asserts that a URL is allowed, throwing an Error if blocked.
   */
  public assertUrlAllowed(rawUrl: string): void {
    if (!this.isUrlAllowed(rawUrl)) {
      throw new Error(`[COST_GUARD_VIOLATION] Access to "${rawUrl}" was blocked by Union Bot Zero-Cost (0đ) Policy.`);
    }
  }

  public getViolations(): readonly CostGuardViolation[] {
    return this.violations;
  }

  private recordViolation(violation: CostGuardViolation): void {
    this.violations.push(violation);
    if (this.onViolation) {
      try {
        this.onViolation(violation);
      } catch {
        // Suppress callback errors to avoid masking violation
      }
    }
  }
}
