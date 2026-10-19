/**
 * CommonJS export of Browser Manager utilities for Electron main process
 */

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

module.exports = {
  DISALLOWED_SCHEMES,
  ALLOWED_SCHEMES,
  DEFAULT_SEARCH_ENGINE_URL,
  PROVIDER_REGISTRY,
  PROVIDER_AUTH_ORIGINS,
  BLOCKED_API_PATTERNS,
  isPrivateOrLoopbackHost,
  validateUrl,
  resolveAddressBarInput,
  isAllowedProviderNavigation,
  isAllowedForProvider,
  isCostGuardBlockedUrl,
  inferAuthStatus,
  BrowserStateManager,
};

