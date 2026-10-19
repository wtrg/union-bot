/**
 * URL Policy & Safe Navigation Sanitizer for Union Bot Browser Manager
 * Strict enforcement of scheme boundaries, search resolution, and external navigation rules.
 */

export const DISALLOWED_SCHEMES = new Set([
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
  'about:',
]);

export const ALLOWED_SCHEMES = new Set(['https:', 'http:']);

export const DEFAULT_SEARCH_ENGINE_URL = 'https://duckduckgo.com/?q=';

export interface UrlValidationResult {
  valid: boolean;
  sanitizedUrl?: string;
  reason?: string;
}

/**
 * Checks if a hostname resolves to loopback, private IPv4, or internal host.
 */
export function isPrivateOrLoopbackHost(hostname: string | null | undefined): boolean {
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
 * Strictly validates an external or navigation URL.
 */
export function validateUrl(candidateUrl: unknown, allowPrivate = false): UrlValidationResult {
  if (typeof candidateUrl !== 'string' || candidateUrl.trim().length === 0) {
    return { valid: false, reason: 'Empty or non-string URL' };
  }

  const trimmed = candidateUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (err: any) {
    return { valid: false, reason: `Malformed URL: ${err?.message || 'Invalid URL'}` };
  }

  // Protocol scheme validation
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
 * Resolves user address bar input:
 * If the input looks like a valid URL, sanitizes and returns it.
 * Otherwise, formats it into a safe search engine query URL.
 */
export function resolveAddressBarInput(
  input: string,
  searchEngineBase: string = DEFAULT_SEARCH_ENGINE_URL
): UrlValidationResult {
  if (!input || typeof input !== 'string') {
    return { valid: false, reason: 'Empty input' };
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: 'Empty input' };
  }

  // If input contains spaces or does not contain a scheme/dot, treat as search query
  const hasSpaces = /\s/.test(trimmed);
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
  const hasDomainDot = trimmed.includes('.') && !hasSpaces;

  if (!hasScheme && (hasSpaces || !hasDomainDot)) {
    const searchUrl = `${searchEngineBase}${encodeURIComponent(trimmed)}`;
    return validateUrl(searchUrl, false);
  }

  const urlCandidate = hasScheme ? trimmed : `https://${trimmed}`;
  return validateUrl(urlCandidate, false);
}

/**
 * Validates whether a target URL is within the approved origin or domain of a provider.
 */
export function isAllowedProviderNavigation(targetUrl: string, approvedOrigin: string): boolean {
  try {
    const targetParsed = new URL(targetUrl);
    const approvedParsed = new URL(approvedOrigin);

    if (!ALLOWED_SCHEMES.has(targetParsed.protocol)) {
      return false;
    }

    // Exact host match or approved subdomain match
    const targetHost = targetParsed.hostname.toLowerCase();
    const approvedHost = approvedParsed.hostname.toLowerCase();

    if (targetHost === approvedHost) {
      return true;
    }

    if (targetHost.endsWith(`.${approvedHost}`)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
