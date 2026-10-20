/**
 * CommonJS export of Browser Manager utilities for Electron main process
 */

const { URL } = require('url');
const crypto = require('node:crypto');

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
  'about:',
]);

const ALLOWED_SCHEMES = new Set(['https:', 'http:']);
const DEFAULT_SEARCH_ENGINE_URL = 'https://duckduckgo.com/?q=';

function isPrivateOrLoopbackHost(hostname) {
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

function validateUrl(candidateUrl, allowPrivate = false) {
  if (typeof candidateUrl !== 'string' || candidateUrl.trim().length === 0) {
    return { valid: false, reason: 'Empty or non-string URL' };
  }

  const trimmed = candidateUrl.trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    return { valid: false, reason: `Malformed URL: ${err?.message || 'Invalid URL'}` };
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { valid: false, reason: `Disallowed protocol scheme '${parsed.protocol}'` };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'Embedded credentials in URL are strictly prohibited' };
  }

  if (!allowPrivate && isPrivateOrLoopbackHost(parsed.hostname)) {
    return { valid: false, reason: `Private or loopback address prohibited: ${parsed.hostname}` };
  }

  return { valid: true, sanitizedUrl: parsed.href };
}

function resolveAddressBarInput(input, searchEngineBase = DEFAULT_SEARCH_ENGINE_URL) {
  if (!input || typeof input !== 'string') {
    return { valid: false, reason: 'Empty input' };
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: 'Empty input' };
  }

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

function isAllowedProviderNavigation(targetUrl, approvedOrigin) {
  try {
    const targetParsed = new URL(targetUrl);
    const approvedParsed = new URL(approvedOrigin);

    if (!ALLOWED_SCHEMES.has(targetParsed.protocol)) return false;

    const targetHost = targetParsed.hostname.toLowerCase();
    const approvedHost = approvedParsed.hostname.toLowerCase();

    return targetHost === approvedHost || targetHost.endsWith(`.${approvedHost}`);
  } catch {
    return false;
  }
}

const PROVIDER_AUTH_ORIGINS = {
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

function isAllowedForProvider(providerId, targetUrl) {
  const validation = validateUrl(targetUrl);
  if (!validation.valid || !validation.sanitizedUrl) {
    return false;
  }

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


const PROVIDER_REGISTRY = {
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT Web',
    partition: 'persist:mcb-web-chatgpt',
    defaultUrl: 'https://chatgpt.com/',
    approvedOrigin: 'https://chatgpt.com',
    authIndicatorHint: {
      loginPathSubstrings: ['/login', '/auth'],
      readyIndicators: ['chatgpt.com/?', 'chatgpt.com/c/'],
    },
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    partition: 'persist:mcb-web-gemini',
    defaultUrl: 'https://gemini.google.com/app',
    approvedOrigin: 'https://gemini.google.com',
    authIndicatorHint: {
      loginPathSubstrings: ['accounts.google.com'],
      readyIndicators: ['gemini.google.com/app'],
    },
  },
  claude: {
    id: 'claude',
    name: 'Claude Web',
    partition: 'persist:mcb-web-claude',
    defaultUrl: 'https://claude.ai/',
    approvedOrigin: 'https://claude.ai',
    authIndicatorHint: {
      loginPathSubstrings: ['/login'],
      readyIndicators: ['claude.ai/chats', 'claude.ai/chat/'],
    },
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek Web',
    partition: 'persist:mcb-web-deepseek',
    defaultUrl: 'https://chat.deepseek.com/',
    approvedOrigin: 'https://chat.deepseek.com',
    authIndicatorHint: {
      loginPathSubstrings: ['/sign_in', '/login'],
      readyIndicators: ['chat.deepseek.com/chat/'],
    },
  },
  search: {
    id: 'search',
    name: 'Web Search',
    partition: 'persist:mcb-web-search',
    defaultUrl: 'https://duckduckgo.com/',
    approvedOrigin: 'https://duckduckgo.com',
  },
  custom: {
    id: 'custom',
    name: 'Custom URL',
    partition: 'persist:mcb-web-custom',
    defaultUrl: 'https://duckduckgo.com/',
    approvedOrigin: 'https://duckduckgo.com',
  },
  codex: {
    id: 'codex',
    name: 'Codex Local Agent',
    partition: 'local:codex',
    defaultUrl: 'https://github.com/openai/codex',
    approvedOrigin: 'https://github.com',
  },
  antigravity: {
    id: 'antigravity',
    name: 'Antigravity Local Agent',
    partition: 'local:antigravity',
    defaultUrl: 'https://github.com/google-deepmind',
    approvedOrigin: 'https://github.com',
  },
};

const BLOCKED_API_PATTERNS = [
  'api.openai.com',
  'api.anthropic.com',
  'api.deepseek.com',
  'generativelanguage.googleapis.com',
  'api.mistral.ai',
  'api.groq.com',
  'api.cohere.ai',
  'api.perplexity.ai',
];

function isCostGuardBlockedUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  for (const pattern of BLOCKED_API_PATTERNS) {
    if (lower.includes(pattern)) return true;
  }
  return false;
}

function inferAuthStatus(providerId, currentUrl, pageTitle) {
  if (!currentUrl) return 'UNKNOWN';

  const provider = PROVIDER_REGISTRY[providerId];
  if (!provider || !provider.authIndicatorHint) {
    return 'READY_OR_LANDING';
  }

  const lowerUrl = currentUrl.toLowerCase();
  const lowerTitle = (pageTitle || '').toLowerCase();

  if (provider.authIndicatorHint.loginPathSubstrings) {
    for (const sub of provider.authIndicatorHint.loginPathSubstrings) {
      if (lowerUrl.includes(sub.toLowerCase())) return 'LOGIN_REQUIRED';
    }
  }

  if (lowerTitle.includes('sign in') || lowerTitle.includes('log in') || lowerTitle.includes('login')) {
    return 'LOGIN_REQUIRED';
  }

  if (provider.authIndicatorHint.readyIndicators) {
    for (const ind of provider.authIndicatorHint.readyIndicators) {
      if (lowerUrl.includes(ind.toLowerCase())) return 'READY_OR_LANDING';
    }
  }

  return 'READY_OR_LANDING';
}

class BrowserStateManager {
  constructor() {
    this.tabs = new Map();
    this.activeTabId = null;
    this.bounds = { x: 0, y: 0, width: 0, height: 0 };
    this.isVisible = false;
    this.isModalActive = false;
  }

  initializeDefaultTabs() {
    const defaultProviders = ['chatgpt', 'gemini', 'claude', 'deepseek'];
    const created = [];
    for (const pid of defaultProviders) {
      const tab = this.createTab(pid);
      created.push(tab);
    }
    if (created.length > 0 && !this.activeTabId) {
      this.activeTabId = created[0].id;
    }
    return created;
  }

  createTab(providerId, customUrl, customTitle) {
    const provider = PROVIDER_REGISTRY[providerId] || PROVIDER_REGISTRY.custom;
    const tabId = `tab_${providerId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const targetUrl = customUrl ? customUrl : provider.defaultUrl;
    const targetTitle = customTitle || provider.name;

    const newTab = {
      id: tabId,
      providerId,
      title: targetTitle,
      url: targetUrl,
      partition: provider.partition,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      authStatus: 'UNKNOWN',
      crashed: false,
      lastError: null,
      zoomFactor: 1.0,
      createdAt: Date.now(),
    };

    this.tabs.set(tabId, newTab);
    if (!this.activeTabId) {
      this.activeTabId = tabId;
    }
    return newTab;
  }

  closeTab(tabId) {
    if (!this.tabs.has(tabId)) {
      return { closed: false, nextActiveTabId: this.activeTabId };
    }

    const tabList = Array.from(this.tabs.keys());
    const closingIndex = tabList.indexOf(tabId);
    this.tabs.delete(tabId);

    if (this.activeTabId === tabId) {
      const remaining = Array.from(this.tabs.keys());
      if (remaining.length === 0) {
        this.activeTabId = null;
      } else {
        const nextIndex = Math.min(closingIndex, remaining.length - 1);
        this.activeTabId = remaining[nextIndex];
      }
    }

    return { closed: true, nextActiveTabId: this.activeTabId };
  }

  selectTab(tabId) {
    if (this.tabs.has(tabId)) {
      this.activeTabId = tabId;
      return true;
    }
    return false;
  }

  updateTab(tabId, updates) {
    const existing = this.tabs.get(tabId);
    if (!existing) return null;

    const updated = { ...existing, ...updates };
    if ((updates.url || updates.title) && !updates.authStatus) {
      updated.authStatus = inferAuthStatus(updated.providerId, updated.url, updated.title);
    }

    this.tabs.set(tabId, updated);
    return updated;
  }

  setBounds(bounds) {
    this.bounds = {
      x: Math.max(0, Math.round(bounds.x || 0)),
      y: Math.max(0, Math.round(bounds.y || 0)),
      width: Math.max(0, Math.round(bounds.width || 0)),
      height: Math.max(0, Math.round(bounds.height || 0)),
    };
    return this.bounds;
  }

  setVisibility(visible) {
    this.isVisible = Boolean(visible);
    return this.isEffectiveVisible();
  }

  setModalActive(active) {
    this.isModalActive = Boolean(active);
    return this.isEffectiveVisible();
  }

  isEffectiveVisible() {
    return this.isVisible && !this.isModalActive;
  }

  applyZoomAction(tabId, action) {
    const tab = this.tabs.get(tabId);
    if (!tab) return 1.0;

    let newZoom = tab.zoomFactor;
    if (action === 'zoom-in') {
      newZoom = Math.min(2.5, Math.round((tab.zoomFactor + 0.1) * 10) / 10);
    } else if (action === 'zoom-out') {
      newZoom = Math.max(0.5, Math.round((tab.zoomFactor - 0.1) * 10) / 10);
    } else if (action === 'zoom-reset') {
      newZoom = 1.0;
    }

    this.updateTab(tabId, { zoomFactor: newZoom });
    return newZoom;
  }

  createSharePayload(tabId, selectedText, roomId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return null;

    return {
      selectedText: selectedText || '',
      pageUrl: tab.url,
      pageTitle: tab.title,
      providerId: tab.providerId,
      roomId,
    };
  }

  getState() {
    return {
      tabs: Array.from(this.tabs.values()),
      activeTabId: this.activeTabId,
      bounds: { ...this.bounds },
      isVisible: this.isVisible,
      isModalActive: this.isModalActive,
    };
  }

  getActiveTab() {
    if (!this.activeTabId) return null;
    return this.tabs.get(this.activeTabId) || null;
  }
}

const CHALLENGE_TITLE_PATTERNS = [
  'just a moment...',
  'attention required! | cloudflare',
  'security check',
  'cloudflare',
  'verifying you are human',
  'bot verification',
  'captcha',
  'challenge',
];

const CHALLENGE_URL_PATTERNS = [
  'challenges.cloudflare.com',
  'cf-chl',
  '/cdn-cgi/challenge-platform',
  'turnstile',
  'hcaptcha',
  'recaptcha',
];

const QUOTA_PATTERNS = [
  'too many requests',
  'rate limit exceeded',
  'usage limit reached',
  'you have reached your limit',
  'you\'ve reached your limit',
  'reached your message limit',
  'quota exceeded',
  'try again in',
  'wait until',
];

const OUTAGE_PATTERNS = [
  '502 bad gateway',
  '503 service temporarily unavailable',
  '504 gateway timeout',
  'internal server error',
  'down for maintenance',
  'service is currently unavailable',
  'experiencing high traffic',
];

function detectProviderHealth(params) {
  const { providerId, tabId, url = '', title = '', bodySnippet = '', statusCode } = params;
  const now = Date.now();
  const lowerUrl = (url || '').toLowerCase();
  const lowerTitle = (title || '').toLowerCase();
  const lowerBody = (bodySnippet || '').toLowerCase();

  // 1. Check HTTP status code
  if (statusCode === 429) {
    return {
      providerId,
      tabId,
      status: 'QUOTA_EXCEEDED',
      errorCode: 'ERR_PROVIDER_QUOTA_EXCEEDED',
      message: `Provider '${providerId}' returned HTTP 429 Too Many Requests (Rate limit exceeded).`,
      checkedAt: now,
    };
  }

  if (statusCode && statusCode >= 500 && statusCode < 600) {
    return {
      providerId,
      tabId,
      status: 'SERVICE_UNAVAILABLE',
      errorCode: 'ERR_PROVIDER_SERVICE_UNAVAILABLE',
      message: `Provider '${providerId}' returned HTTP ${statusCode} (Service outage or unavailable).`,
      checkedAt: now,
    };
  }

  // 2. Check Cloudflare / Turnstile / Captcha
  const hasChallengeUrl = CHALLENGE_URL_PATTERNS.some((pat) => lowerUrl.includes(pat));
  const hasChallengeTitle = CHALLENGE_TITLE_PATTERNS.some((pat) => lowerTitle.includes(pat));
  const hasChallengeBody = lowerBody.includes('cf-browser-verification') ||
    lowerBody.includes('cf-challenge-form') ||
    lowerBody.includes('turnstile') ||
    lowerBody.includes('verify you are human');

  if (hasChallengeUrl || hasChallengeTitle || hasChallengeBody) {
    return {
      providerId,
      tabId,
      status: 'CHALLENGE_REQUIRED',
      errorCode: 'ERR_PROVIDER_CAPTCHA',
      message: `Cloudflare / Captcha challenge detected for '${providerId}'. Interactive user resolution required in browser.`,
      checkedAt: now,
      details: {
        detectedIn: hasChallengeUrl ? 'url' : hasChallengeTitle ? 'title' : 'body',
      },
    };
  }

  // 3. Check Quota / Rate Limit text
  const hasQuotaText = QUOTA_PATTERNS.some((pat) => lowerTitle.includes(pat) || lowerBody.includes(pat));
  if (hasQuotaText) {
    return {
      providerId,
      tabId,
      status: 'QUOTA_EXCEEDED',
      errorCode: 'ERR_PROVIDER_QUOTA_EXCEEDED',
      message: `Rate limit or quota message detected for '${providerId}'. Fail-closed without automatic retry.`,
      checkedAt: now,
    };
  }

  // 4. Check Outage text
  const hasOutageText = OUTAGE_PATTERNS.some((pat) => lowerTitle.includes(pat) || lowerBody.includes(pat));
  if (hasOutageText) {
    return {
      providerId,
      tabId,
      status: 'SERVICE_UNAVAILABLE',
      errorCode: 'ERR_PROVIDER_SERVICE_UNAVAILABLE',
      message: `Service outage or error page detected for '${providerId}'.`,
      checkedAt: now,
    };
  }

  // 5. Check Authentication Required
  const isAuthUrl =
    lowerUrl.includes('auth.openai.com') ||
    lowerUrl.includes('accounts.google.com') ||
    lowerUrl.includes('claude.ai/login') ||
    lowerUrl.includes('chat.deepseek.com/sign_in') ||
    lowerUrl.includes('chat.deepseek.com/login') ||
    lowerUrl.includes('/login') ||
    lowerUrl.includes('/sign_in');

  const isAuthTitle =
    lowerTitle.includes('sign in') ||
    lowerTitle.includes('log in') ||
    lowerTitle.includes('login') ||
    lowerTitle.includes('welcome back');

  if (isAuthUrl || isAuthTitle) {
    return {
      providerId,
      tabId,
      status: 'LOGIN_REQUIRED',
      errorCode: 'ERR_PROVIDER_AUTH_REQUIRED',
      message: `Provider '${providerId}' requires user authentication. Please log in via the browser tab.`,
      checkedAt: now,
    };
  }

  return {
    providerId,
    tabId,
    status: 'HEALTHY',
    message: `Provider '${providerId}' is operational and ready.`,
    checkedAt: now,
  };
}

function extractThreadReference(providerId, url) {
  if (!url || typeof url !== 'string') {
    return { providerId, threadId: null, canonicalUrl: null, isReopenable: false };
  }

  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    switch (providerId) {
      case 'chatgpt': {
        const match = parsed.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          return {
            providerId,
            threadId: match[1],
            canonicalUrl: `https://chatgpt.com/c/${match[1]}`,
            isReopenable: true,
          };
        }
        break;
      }
      case 'claude': {
        const match = parsed.pathname.match(/\/chat\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          return {
            providerId,
            threadId: match[1],
            canonicalUrl: `https://claude.ai/chat/${match[1]}`,
            isReopenable: true,
          };
        }
        break;
      }
      case 'gemini': {
        const match = parsed.pathname.match(/\/app\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          return {
            providerId,
            threadId: match[1],
            canonicalUrl: `https://gemini.google.com/app/${match[1]}`,
            isReopenable: true,
          };
        }
        break;
      }
      case 'deepseek': {
        const match = parsed.pathname.match(/\/chat\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          return {
            providerId,
            threadId: match[1],
            canonicalUrl: `https://chat.deepseek.com/chat/${match[1]}`,
            isReopenable: true,
          };
        }
        break;
      }
      default:
        break;
    }
  } catch {}

  return {
    providerId,
    threadId: null,
    canonicalUrl: url,
    isReopenable: false,
  };
}

const DEFAULT_PROVIDER_ROLES = {
  chatgpt: 'LEADER',
  gemini: 'RESEARCHER',
  claude: 'REVIEWER',
  deepseek: 'REVIEWER',
  antigravity: 'IMPLEMENTER',
  codex: 'QA_SECURITY',
  search: 'USER',
  custom: 'USER',
};

class ProviderSessionRegistry {
  constructor() {
    this.sessionsByTabId = new Map();
    this.sessionsById = new Map();
    this.sessionsByProvider = new Map();
  }

  createSession(params) {
    const { providerId, tabId, partition } = params;
    const now = Date.now();
    const sessionId = `wps_${providerId}_${crypto.randomBytes(6).toString('hex')}`;
    const sessionNonce = crypto.randomBytes(16).toString('hex');
    const role = params.assignedRole || DEFAULT_PROVIDER_ROLES[providerId] || 'USER';

    const session = {
      sessionId,
      providerId,
      assignedRole: role,
      partition,
      tabId,
      sessionNonce,
      authStatus: params.authStatus || 'UNKNOWN',
      threadId: params.threadId,
      threadUrl: params.threadUrl,
      isReopenable: Boolean(params.isReopenable),
      createdAt: now,
      lastActive: now,
    };

    this.sessionsByTabId.set(tabId, session);
    this.sessionsById.set(sessionId, session);
    this.sessionsByProvider.set(providerId, session);
    return session;
  }

  getSessionByTab(tabId) {
    return this.sessionsByTabId.get(tabId) || null;
  }

  getSessionById(sessionId) {
    return this.sessionsById.get(sessionId) || null;
  }

  getSessionByProvider(providerId) {
    return this.sessionsByProvider.get(providerId) || null;
  }

  getAllSessions() {
    return Array.from(this.sessionsById.values());
  }

  verifySessionNonce(sessionId, sessionNonce) {
    if (!sessionId || !sessionNonce) return false;
    const session = this.sessionsById.get(sessionId);
    if (!session) return false;
    return session.sessionNonce === sessionNonce;
  }

  validateSenderIdentity(params) {
    let session;
    if (params.tabId) {
      session = this.sessionsByTabId.get(params.tabId);
    } else if (params.sessionId) {
      session = this.sessionsById.get(params.sessionId);
    }

    if (!session) {
      return {
        valid: false,
        error: 'ERR_PROVIDER_SESSION_NOT_FOUND: No backend provider session bound to this caller.',
        code: 'ERR_PROVIDER_SESSION_NOT_FOUND',
      };
    }

    if (params.claimedProvider && params.claimedProvider !== session.providerId) {
      return {
        valid: false,
        error: `ERR_UNAUTHORIZED_ACTION: Claimed provider '${params.claimedProvider}' does not match session provider '${session.providerId}'.`,
        code: 'ERR_UNAUTHORIZED_ACTION',
      };
    }

    if (params.claimedRole && params.claimedRole !== session.assignedRole) {
      return {
        valid: false,
        error: `ERR_ROLE_MISMATCH: Claimed role '${params.claimedRole}' does not match authoritative backend role '${session.assignedRole}'.`,
        code: 'ERR_ROLE_MISMATCH',
      };
    }

    session.lastActive = Date.now();
    return { valid: true, session };
  }

  updateSession(sessionId, updates) {
    const session = this.sessionsById.get(sessionId);
    if (!session) return null;
    Object.assign(session, updates, { lastActive: Date.now() });
    return session;
  }

  removeSessionByTab(tabId) {
    const session = this.sessionsByTabId.get(tabId);
    if (!session) return false;
    this.sessionsByTabId.delete(tabId);
    this.sessionsById.delete(session.sessionId);
    if (this.sessionsByProvider.get(session.providerId)?.sessionId === session.sessionId) {
      this.sessionsByProvider.delete(session.providerId);
    }
    return true;
  }

  clear() {
    this.sessionsByTabId.clear();
    this.sessionsById.clear();
    this.sessionsByProvider.clear();
  }
}

module.exports = {
  DISALLOWED_SCHEMES,
  ALLOWED_SCHEMES,
  DEFAULT_SEARCH_ENGINE_URL,
  PROVIDER_REGISTRY,
  PROVIDER_AUTH_ORIGINS,
  BLOCKED_API_PATTERNS,
  DEFAULT_PROVIDER_ROLES,
  isPrivateOrLoopbackHost,
  validateUrl,
  resolveAddressBarInput,
  isAllowedProviderNavigation,
  isAllowedForProvider,
  isCostGuardBlockedUrl,
  inferAuthStatus,
  detectProviderHealth,
  extractThreadReference,
  BrowserStateManager,
  ProviderSessionRegistry,
};

