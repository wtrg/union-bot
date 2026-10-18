const { URL } = require('url');

const DISALLOWED_SCHEMES = new Set([
  'file:',
  'javascript:',
  'data:',
  'vbscript:',
  'shell:',
  'chrome:',
  'ms-settings:',
  'ms-windows-store:',
  'powershell:',
  'cmd:',
  'about:'
]);

const ALLOWED_SCHEMES = new Set(['https:', 'http:']);

/**
 * Checks if a hostname resolves to loopback, private IPv4, or internal host.
 */
function isPrivateOrLoopbackHost(hostname) {
  if (!hostname) return true;
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === '127.0.0.1' || lower === '::1' || lower === '0.0.0.0') {
    return true;
  }
  // Private IPv4 ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lower)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(lower)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(lower)) return true;
  return false;
}

/**
 * Strictly validates an external URL before invoking native OS handlers.
 */
function validateExternalUrl(candidateUrl, allowPrivate = false) {
  if (typeof candidateUrl !== 'string' || candidateUrl.trim().length === 0) {
    return { valid: false, reason: 'Empty or non-string URL' };
  }
  let parsed;
  try {
    parsed = new URL(candidateUrl);
  } catch (err) {
    return { valid: false, reason: `Malformed URL: ${err.message}` };
  }

  // Scheme validation: must be https: or http:
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { valid: false, reason: `Disallowed protocol scheme '${parsed.protocol}'` };
  }

  // Credentials in URL check (e.g. https://user:pass@evil.com)
  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'Embedded credentials in URL are strictly prohibited' };
  }

  // Loopback / private check unless explicitly permitted
  if (!allowPrivate && isPrivateOrLoopbackHost(parsed.hostname)) {
    return { valid: false, reason: `Private or loopback address prohibited: ${parsed.hostname}` };
  }

  return { valid: true, sanitizedUrl: parsed.href };
}

/**
 * Trusted helper for opening external URLs safely in native browser.
 * Never delegates dangerous schemes or embedded credentials to shell.openExternal.
 */
async function safeOpenExternal(candidateUrl, shellModule, options = {}) {
  const check = validateExternalUrl(candidateUrl, options.allowPrivate);
  if (!check.valid) {
    console.warn(`[SafeExternal] BLOCKED unsafe openExternal attempt: '${candidateUrl}' (Reason: ${check.reason})`);
    return { opened: false, reason: check.reason };
  }

  if (shellModule && typeof shellModule.openExternal === 'function') {
    await shellModule.openExternal(check.sanitizedUrl);
    return { opened: true, url: check.sanitizedUrl };
  }
  return { opened: false, reason: 'shell.openExternal function unavailable' };
}

module.exports = {
  validateExternalUrl,
  safeOpenExternal,
  isPrivateOrLoopbackHost,
  ALLOWED_SCHEMES,
  DISALLOWED_SCHEMES
};
