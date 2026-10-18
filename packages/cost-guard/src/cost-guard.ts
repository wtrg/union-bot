/**
 * Cost Guard Engine for Union Bot
 * Enforces strict Zero-Cost (0 VND) policy by blocking paid API endpoints
 * and validating egress against approved allowlists.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const http = require('node:http');
const https = require('node:https');
const http2 = require('node:http2');
const net = require('node:net');

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
 * Installs runtime network interceptors for Node.js global fetch, http.request, http.get, https.request, and https.get.
 * Returns an uninstall function to cleanly restore original network methods.
 */
export function installNodeCostGuardInterceptor(costGuard: CostGuard): () => void {
  const originalFetch = globalThis.fetch;
  const originalHttpAddRequest = http.Agent.prototype.addRequest;
  const originalHttpsAddRequest = https.Agent.prototype.addRequest;

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

  // 2. Intercept all http and https requests via Agent prototype
  function checkAgentRequest(opts: any, defaultProtocol: string) {
    const host = opts.host || opts.hostname || 'localhost';
    const port = opts.port ? `:${opts.port}` : '';
    const path = opts.path || opts.pathname || '/';
    const proto = opts.protocol || defaultProtocol;
    const urlStr = `${proto}//${host}${port}${path}`;

    if (!costGuard.isUrlAllowed(urlStr)) {
      const violations = costGuard.getViolations();
      const latest = violations[violations.length - 1] || {
        url: urlStr,
        hostname: host,
        reason: 'NOT_IN_ALLOWLIST' as const,
        timestamp: new Date().toISOString()
      };
      throw new CostGuardViolationError(latest);
    }
  }

  http.Agent.prototype.addRequest = function (req: any, opts: any) {
    checkAgentRequest(opts, 'http:');
    return originalHttpAddRequest.apply(this, arguments as any);
  };

  https.Agent.prototype.addRequest = function (req: any, opts: any) {
    checkAgentRequest(opts, 'https:');
    return originalHttpsAddRequest.apply(this, arguments as any);
  };

  // 3. Intercept HTTP/2 and raw TCP/TLS socket connections (net.Socket.prototype.connect)
  const originalHttp2Connect = http2 && typeof http2.connect === 'function' ? http2.connect : null;
  if (originalHttp2Connect) {
    http2.connect = function (authority: any, ...args: any[]) {
      let urlStr: string;
      if (typeof authority === 'string') {
        urlStr = authority.startsWith('http') ? authority : `https://${authority}`;
      } else if (authority instanceof URL) {
        urlStr = authority.toString();
      } else {
        urlStr = `https://${(authority as any)?.hostname || (authority as any)?.host || 'localhost'}`;
      }

      if (!costGuard.isUrlAllowed(urlStr)) {
        const violations = costGuard.getViolations();
        const latest = violations[violations.length - 1] || {
          url: urlStr,
          hostname: typeof authority === 'string' ? authority : 'unknown',
          reason: 'NOT_IN_ALLOWLIST' as const,
          timestamp: new Date().toISOString()
        };
        throw new CostGuardViolationError(latest);
      }
      return originalHttp2Connect.call(http2, authority, ...args);
    };
  }

  const originalNetSocketConnect = net && net.Socket && net.Socket.prototype ? net.Socket.prototype.connect : null;
  if (originalNetSocketConnect) {
    net.Socket.prototype.connect = function (...args: any[]) {
      let targetHost = 'localhost';
      let targetPort = '';
      const firstArg = args[0];

      if (typeof firstArg === 'object' && firstArg !== null) {
        if (firstArg.path) {
          return originalNetSocketConnect.apply(this, args);
        }
        targetHost = firstArg.host || firstArg.hostname || firstArg.servername || 'localhost';
        targetPort = firstArg.port ? String(firstArg.port) : '';
      } else if (typeof firstArg === 'number' || typeof firstArg === 'string') {
        if (typeof firstArg === 'string' && (firstArg.startsWith('/') || firstArg.startsWith('\\\\'))) {
          return originalNetSocketConnect.apply(this, args);
        }
        targetPort = String(firstArg);
        if (typeof args[1] === 'string') {
          targetHost = args[1];
        }
      }

      const proto = targetPort === '80' ? 'http:' : 'https:';
      const portSuffix = targetPort && targetPort !== '80' && targetPort !== '443' ? `:${targetPort}` : '';
      const urlStr = `${proto}//${targetHost}${portSuffix}/`;

      if (!costGuard.isUrlAllowed(urlStr)) {
        const violations = costGuard.getViolations();
        const latest = violations[violations.length - 1] || {
          url: urlStr,
          hostname: targetHost,
          reason: 'NOT_IN_ALLOWLIST' as const,
          timestamp: new Date().toISOString()
        };
        throw new CostGuardViolationError(latest);
      }

      return originalNetSocketConnect.apply(this, args);
    };
  }

  return function uninstall() {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    http.Agent.prototype.addRequest = originalHttpAddRequest;
    https.Agent.prototype.addRequest = originalHttpsAddRequest;
    if (originalHttp2Connect) {
      http2.connect = originalHttp2Connect;
    }
    if (originalNetSocketConnect) {
      net.Socket.prototype.connect = originalNetSocketConnect;
    }
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
