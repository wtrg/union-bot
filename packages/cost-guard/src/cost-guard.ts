/**
 * Cost Guard Engine for Union Bot
 * Enforces strict Zero-Cost (0 VND) policy by blocking paid API endpoints
 * and validating egress against approved allowlists.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const http = require('node:http');
const https = require('node:https');

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

export class CostGuardViolationError extends Error {
  public readonly violation: CostGuardViolation;
  constructor(violation: CostGuardViolation) {
    super(`[COST_GUARD_VIOLATION] Egress blocked to "${violation.url}" (${violation.reason}) by Union Bot Zero-Cost (0 VND) Policy.`);
    this.name = 'CostGuardViolationError';
    this.violation = violation;
  }
}

function resolveRequestUrl(urlOrOptions: any, defaultProtocol: string): string {
  if (typeof urlOrOptions === 'string') {
    return urlOrOptions;
  }
  if (urlOrOptions instanceof URL) {
    return urlOrOptions.toString();
  }
  if (urlOrOptions && typeof urlOrOptions === 'object') {
    const protocol = urlOrOptions.protocol || defaultProtocol;
    const host = urlOrOptions.hostname || urlOrOptions.host || 'localhost';
    const port = urlOrOptions.port ? `:${urlOrOptions.port}` : '';
    const pathname = urlOrOptions.path || urlOrOptions.pathname || '/';
    return `${protocol}//${host}${port}${pathname}`;
  }
  return '';
}

/**
 * Installs runtime network interceptors for Node.js global fetch, http.request, and https.request.
 * Returns an uninstall function to cleanly restore original network methods.
 */
export function installNodeCostGuardInterceptor(costGuard: CostGuard): () => void {
  const originalFetch = globalThis.fetch;
  const originalHttpRequest = http.request;
  const originalHttpsRequest = https.request;

  // 1. Intercept global fetch
  if (typeof globalThis.fetch === 'function') {
    globalThis.fetch = async function costGuardFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      let urlStr: string;
      if (typeof input === 'string') {
        urlStr = input;
      } else if (input instanceof URL) {
        urlStr = input.toString();
      } else if (input && typeof (input as any).url === 'string') {
        urlStr = (input as any).url;
      } else {
        urlStr = String(input);
      }

      if (!costGuard.isUrlAllowed(urlStr)) {
        const violations = costGuard.getViolations();
        const latest = violations[violations.length - 1] || {
          url: urlStr,
          hostname: 'unknown',
          reason: 'NOT_IN_ALLOWLIST' as const,
          timestamp: new Date().toISOString()
        };
        throw new CostGuardViolationError(latest);
      }

      return originalFetch.call(globalThis, input, init);
    };
  }

  // 2. Intercept http.request
  const interceptedHttpRequest = function (urlOrOptions: any, ...args: any[]): http.ClientRequest {
    const urlStr = resolveRequestUrl(urlOrOptions, 'http:');
    if (!costGuard.isUrlAllowed(urlStr)) {
      const violations = costGuard.getViolations();
      const latest = violations[violations.length - 1] || {
        url: urlStr,
        hostname: 'unknown',
        reason: 'NOT_IN_ALLOWLIST' as const,
        timestamp: new Date().toISOString()
      };
      throw new CostGuardViolationError(latest);
    }
    return (originalHttpRequest as any).call(http, urlOrOptions, ...args);
  };
  (http as any).request = interceptedHttpRequest;

  // 3. Intercept https.request
  const interceptedHttpsRequest = function (urlOrOptions: any, ...args: any[]): http.ClientRequest {
    const urlStr = resolveRequestUrl(urlOrOptions, 'https:');
    if (!costGuard.isUrlAllowed(urlStr)) {
      const violations = costGuard.getViolations();
      const latest = violations[violations.length - 1] || {
        url: urlStr,
        hostname: 'unknown',
        reason: 'NOT_IN_ALLOWLIST' as const,
        timestamp: new Date().toISOString()
      };
      throw new CostGuardViolationError(latest);
    }
    return (originalHttpsRequest as any).call(https, urlOrOptions, ...args);
  };
  (https as any).request = interceptedHttpsRequest;

  return function uninstall() {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    http.request = originalHttpRequest;
    https.request = originalHttpsRequest;
  };
}

/**
 * Installs Electron session network request interceptor.
 * Blocks forbidden egress in Electron WebContentsView or BrowserWindow before sending.
 */
export function installElectronCostGuardInterceptor(session: any, costGuard: CostGuard): void {
  if (!session || !session.webRequest || !session.webRequest.onBeforeRequest) {
    throw new Error('Invalid Electron session object provided to installElectronCostGuardInterceptor.');
  }

  session.webRequest.onBeforeRequest((details: any, callback: (response: { cancel: boolean }) => void) => {
    const url = details.url;
    if (!costGuard.isUrlAllowed(url)) {
      callback({ cancel: true });
      return;
    }
    callback({ cancel: false });
  });
}
