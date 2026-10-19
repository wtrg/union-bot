/**
 * Partition registry, provider definitions, and session isolation configs
 * Fulfills Master Plan V3 tickets P4-003, P4-004, P4-005, P4-006.
 */

import type { ProviderDefinition, ProviderId, AuthStatus } from './types.ts';

export const PROVIDER_REGISTRY: Record<ProviderId, ProviderDefinition> = {
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

/**
 * List of known paid API endpoints blocked by CostGuard at the session network layer
 */
export const BLOCKED_API_PATTERNS = [
  'api.openai.com',
  'api.anthropic.com',
  'api.deepseek.com',
  'generativelanguage.googleapis.com',
  'api.mistral.ai',
  'api.groq.com',
  'api.cohere.ai',
  'api.perplexity.ai',
];

/**
 * Determines whether a URL request should be blocked fail-closed under 0đ Zero-Cost policy.
 */
export function isCostGuardBlockedUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  for (const pattern of BLOCKED_API_PATTERNS) {
    if (lower.includes(pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Infers authentication status from page URL and title without privileged credential extraction.
 * Fulfills P4-006: Visible allowed signals only.
 */
export function inferAuthStatus(providerId: ProviderId, currentUrl: string, pageTitle: string): AuthStatus {
  if (!currentUrl) return 'UNKNOWN';

  const provider = PROVIDER_REGISTRY[providerId];
  if (!provider || !provider.authIndicatorHint) {
    return 'READY_OR_LANDING';
  }

  const lowerUrl = currentUrl.toLowerCase();
  const lowerTitle = (pageTitle || '').toLowerCase();

  // Check login path indicators
  if (provider.authIndicatorHint.loginPathSubstrings) {
    for (const sub of provider.authIndicatorHint.loginPathSubstrings) {
      if (lowerUrl.includes(sub.toLowerCase())) {
        return 'LOGIN_REQUIRED';
      }
    }
  }

  // Check common login titles
  if (lowerTitle.includes('sign in') || lowerTitle.includes('log in') || lowerTitle.includes('login')) {
    return 'LOGIN_REQUIRED';
  }

  // Check ready indicators
  if (provider.authIndicatorHint.readyIndicators) {
    for (const ind of provider.authIndicatorHint.readyIndicators) {
      if (lowerUrl.includes(ind.toLowerCase())) {
        return 'READY_OR_LANDING';
      }
    }
  }

  return 'READY_OR_LANDING';
}
