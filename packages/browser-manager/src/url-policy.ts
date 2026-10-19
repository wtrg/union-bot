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
 * Checks if a hostname resolves to loopback, private IPv4/IPv6, link-local, or internal host.
 * Strictly blocks 127.0.0.0/8, 169.254.0.0/16, ::1, [::1], fe80::/10, fc00::/7, private LANs.
 */
export function isPrivateOrLoopbackHost(hostname: string | null | undefined): boolean {
  if (!hostname) return true;
  let lower = hostname.toLowerCase().trim();

  // Strip brackets from IPv6 hostnames (e.g. [::1] -> ::1)
  if (lower.startsWith('[') && lower.endsWith(']')) {
    lower = lower.slice(1, -1);
  }

  // Common localhost names & internal TLDs
  if (
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal') ||
    lower === '0.0.0.0'
  ) {
    return true;
  }

  // IPv4 Loopback range: 127.0.0.0/8 (127.0.0.1 - 127.255.255.255)
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lower)) {
    return true;
  }

  // IPv4 Link-Local / Cloud Metadata: 169.254.0.0/16 (e.g. 169.254.169.254)
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(lower)) {
    return true;
  }

  // Private IPv4 ranges:
  // 10.0.0.0/8
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lower)) {
    return true;
  }
  // 172.16.0.0/12
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(lower)) {
    return true;
  }
  // 192.168.0.0/16
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(lower)) {
    return true;
  }
  // 0.0.0.0/8
  if (/^0\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lower)) {
    return true;
  }

  // IPv6 Loopback: ::1, 0:0:0:0:0:0:0:1
  if (lower === '::1' || lower === '::' || /^0*(:0*)*:1$/.test(lower)) {
    return true;
  }

  // IPv6 Link-Local: fe80::/10
  if (lower.startsWith('fe80:') || /^fe[89ab][0-9a-f]:/i.test(lower)) {
    return true;
  }

  // IPv6 Unique Local Address (ULA): fc00::/7 (fc00:: - fdff::)
  if (/^f[cd][0-9a-f]{2}:/i.test(lower)) {
    return true;
  }

  // IPv4-mapped IPv6: ::ffff:127.0.0.1
  if (lower.startsWith('::ffff:')) {
    const v4Part = lower.slice(7);
    return isPrivateOrLoopbackHost(v4Part);
  }

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
 * Approved authentication and origin boundaries per provider (UB-P4-R01-002).
 * Enables OAuth identity federation (Google, Microsoft, Apple) in-session while blocking external leaks.
 */
export const PROVIDER_AUTH_ORIGINS: Record<string, string[]> = {
  chatgpt: [
    'https://chatgpt.com',
    'https://auth.openai.com',
    'https://auth0.openai.com',
    'https://platform.openai.com',
    'https://accounts.google.com',
    'https://appleid.apple.com',
    'https://login.microsoftonline.com',
    'https://login.live.com',
  ],
  gemini: [
    'https://gemini.google.com',
    'https://accounts.google.com',
    'https://myaccount.google.com',
    'https://policies.google.com',
    'https://support.google.com',
  ],
  claude: [
    'https://claude.ai',
    'https://anthropic.com',
    'https://accounts.google.com',
    'https://appleid.apple.com',
  ],
  deepseek: [
    'https://chat.deepseek.com',
    'https://deepseek.com',
    'https://auth.deepseek.com',
  ],
  search: [
    'https://duckduckgo.com',
    'https://html.duckduckgo.com',
  ],
};

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

/**
 * Checks if a URL is permitted for a specific provider (including allowed OAuth federation domains).
 */
export function isAllowedForProvider(providerId: string, targetUrl: string): boolean {
  const validation = validateUrl(targetUrl);
  if (!validation.valid || !validation.sanitizedUrl) {
    return false;
  }

  // Search or custom tab permits any valid public URL
  if (providerId === 'search' || providerId === 'custom') {
    return true;
  }

  const allowedOrigins = PROVIDER_AUTH_ORIGINS[providerId];
  if (!allowedOrigins || allowedOrigins.length === 0) {
    return false;
  }

  try {
    const targetParsed = new URL(validation.sanitizedUrl);
    // UB-P4-R02-001 / P4-R03-A01: Strict HTTPS enforcement for provider & auth origins (HTTP is rejected)
    if (targetParsed.protocol !== 'https:') {
      return false;
    }
    const targetHost = targetParsed.hostname.toLowerCase();

    for (const origin of allowedOrigins) {
      const originParsed = new URL(origin);
      const originHost = originParsed.hostname.toLowerCase();
      if (targetHost === originHost || targetHost.endsWith(`.${originHost}`)) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

