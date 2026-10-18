/**
 * @file cost-guard.cjs
 * @description Electron main process CostGuard integration enforcing Zero-Cost (0 VND) egress policy.
 */
const { URL } = require('url');

class CostGuard {
  static DENIED_HOSTS = [
    'api.openai.com',
    'generativelanguage.googleapis.com',
    'api.anthropic.com',
    'api.deepseek.com',
    'api.mistral.ai',
    'api.cohere.ai'
  ];

  static DEFAULT_ALLOWLIST = [
    '127.0.0.1',
    'localhost',
    '::1',
    'chatgpt.com',
    'openai.com',
    'gemini.google.com',
    'google.com',
    'claude.ai',
    'anthropic.com',
    'deepseek.com'
  ];

  static BILLING_PATTERNS = [
    '/v1/billing',
    '/billing',
    '/pricing',
    '/api/v1/checkout',
    '/checkout'
  ];

  constructor(options = {}) {
    this.allowLocalhost = options.allowLocalhost ?? true;
    this.extraAllowlist = options.extraAllowlist || [];
    this.violations = [];
    this.onViolation = options.onViolation;
  }

  isUrlAllowed(rawUrl) {
    if (!rawUrl) return false;
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return false;
    }

    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    // 1. Check explicitly denied paid API hosts
    for (const denied of CostGuard.DENIED_HOSTS) {
      if (host === denied || host.endsWith('.' + denied)) {
        this.recordViolation({
          url: rawUrl,
          hostname: host,
          reason: 'PAID_API_BLOCKED',
          timestamp: new Date().toISOString()
        });
        return false;
      }
    }

    // 2. Check billing / checkout endpoints
    for (const pattern of CostGuard.BILLING_PATTERNS) {
      if (pathname.includes(pattern)) {
        this.recordViolation({
          url: rawUrl,
          hostname: host,
          reason: 'BILLING_ENDPOINT_BLOCKED',
          timestamp: new Date().toISOString()
        });
        return false;
      }
    }

    // 3. Localhost and loopback
    if (this.allowLocalhost && (host === 'localhost' || host === '127.0.0.1' || host === '::1')) {
      return true;
    }

    // 4. Approved web UI domains
    const allowlist = [...CostGuard.DEFAULT_ALLOWLIST, ...this.extraAllowlist];
    for (const allowed of allowlist) {
      if (host === allowed || host.endsWith('.' + allowed)) {
        return true;
      }
    }

    // Default DENY
    this.recordViolation({
      url: rawUrl,
      hostname: host,
      reason: 'NOT_IN_ALLOWLIST',
      timestamp: new Date().toISOString()
    });
    return false;
  }

  recordViolation(violation) {
    this.violations.push(violation);
    if (typeof this.onViolation === 'function') {
      try {
        this.onViolation(violation);
      } catch {}
    }
  }

  getViolations() {
    return [...this.violations];
  }
}

function installElectronCostGuardInterceptor(session, costGuard) {
  if (!session || !session.webRequest || !session.webRequest.onBeforeRequest) {
    throw new Error('Invalid Electron session object provided to installElectronCostGuardInterceptor.');
  }

  session.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    // Allow local file:// URLs for bundled workspace UI
    if (url.startsWith('file://') || url.startsWith('devtools://')) {
      callback({ cancel: false });
      return;
    }

    if (!costGuard.isUrlAllowed(url)) {
      console.warn(`[CostGuard] BLOCKED request to: ${url}`);
      callback({ cancel: true });
      return;
    }
    callback({ cancel: false });
  });
}

module.exports = {
  CostGuard,
  installElectronCostGuardInterceptor
};
