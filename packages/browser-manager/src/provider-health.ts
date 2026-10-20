/**
 * @file provider-health.ts
 * @description Provider Health Monitor & Native Thread Reference Extractor
 * Fulfills Phase P9 specification (Master Plan V3 tickets P9-XX4, P9-XX5, P9-XX6, P9-007).
 */

import type {
  ProviderId,
  ProviderHealthCheckParams,
  ProviderHealthReport,
  ThreadReference,
} from './types.ts';

/**
 * Known Cloudflare / Captcha challenge indicators
 */
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

/**
 * Detects health status, captcha challenge, login requirement, quota, or outage from provider signals.
 * Fail-closed design: Never assumes successful reply or hides challenge states.
 */
export function detectProviderHealth(params: ProviderHealthCheckParams): ProviderHealthReport {
  const { providerId, tabId, url = '', title = '', bodySnippet = '', statusCode } = params;
  const now = Date.now();
  const lowerUrl = url.toLowerCase();
  const lowerTitle = title.toLowerCase();
  const lowerBody = bodySnippet.toLowerCase();

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

  // 3. Check Quota / Rate Limit text in title or body
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

  // 4. Check Outage / Service Unavailable text
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

  // 5. Check Authentication / Login Required
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

  // 6. Healthy
  return {
    providerId,
    tabId,
    status: 'HEALTHY',
    message: `Provider '${providerId}' is operational and ready.`,
    checkedAt: now,
  };
}

/**
 * Extracts native thread reference and conversation ID from provider URL.
 * Fulfills P9-XX4: Capture native reference to thread/tab when accessible.
 */
export function extractThreadReference(providerId: ProviderId, url: string): ThreadReference {
  if (!url || typeof url !== 'string') {
    return { providerId, threadId: null, canonicalUrl: null, isReopenable: false };
  }

  const trimmed = url.trim();

  try {
    const parsed = new URL(trimmed);

    switch (providerId) {
      case 'chatgpt': {
        // e.g. https://chatgpt.com/c/6ad64b63-ad44-83ec-90ca-83cacbc26da5
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
        // e.g. https://claude.ai/chat/031952a2-8b4e-4f15-8c03-bb131bb4bfe1
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
        // e.g. https://gemini.google.com/app/1a2b3c4d5e
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
        // e.g. https://chat.deepseek.com/chat/c123456
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
