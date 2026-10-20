import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectProviderHealth,
  extractThreadReference,
} from '../src/index.ts';

describe('Phase P9: Provider Health & Error Detector Tests', () => {
  it('P9-H01: Detects Cloudflare / Captcha challenge in title, url, or body (Fail-closed)', () => {
    const reportFromTitle = detectProviderHealth({
      providerId: 'chatgpt',
      tabId: 'tab_chatgpt_1',
      title: 'Just a moment...',
      url: 'https://chatgpt.com/',
    });
    assert.equal(reportFromTitle.status, 'CHALLENGE_REQUIRED');
    assert.equal(reportFromTitle.errorCode, 'ERR_PROVIDER_CAPTCHA');

    const reportFromUrl = detectProviderHealth({
      providerId: 'claude',
      tabId: 'tab_claude_1',
      title: 'Security Verification',
      url: 'https://challenges.cloudflare.com/turnstile/v0/api.js',
    });
    assert.equal(reportFromUrl.status, 'CHALLENGE_REQUIRED');
    assert.equal(reportFromUrl.errorCode, 'ERR_PROVIDER_CAPTCHA');

    const reportFromBody = detectProviderHealth({
      providerId: 'deepseek',
      tabId: 'tab_deepseek_1',
      title: 'DeepSeek',
      url: 'https://chat.deepseek.com/',
      bodySnippet: '<div class="cf-browser-verification">Verifying you are human</div>',
    });
    assert.equal(reportFromBody.status, 'CHALLENGE_REQUIRED');
    assert.equal(reportFromBody.errorCode, 'ERR_PROVIDER_CAPTCHA');
  });

  it('P9-H02: Detects Auth / Login required from auth origins and title', () => {
    const reportFromUrl = detectProviderHealth({
      providerId: 'chatgpt',
      tabId: 'tab_chatgpt_2',
      title: 'OpenAI Auth',
      url: 'https://auth.openai.com/u/login',
    });
    assert.equal(reportFromUrl.status, 'LOGIN_REQUIRED');
    assert.equal(reportFromUrl.errorCode, 'ERR_PROVIDER_AUTH_REQUIRED');

    const reportFromTitle = detectProviderHealth({
      providerId: 'claude',
      tabId: 'tab_claude_2',
      title: 'Log in to Claude',
      url: 'https://claude.ai/login',
    });
    assert.equal(reportFromTitle.status, 'LOGIN_REQUIRED');
    assert.equal(reportFromTitle.errorCode, 'ERR_PROVIDER_AUTH_REQUIRED');
  });

  it('P9-H03: Detects Quota / Rate limit exhaustion (HTTP 429 & text cues)', () => {
    const reportFromCode = detectProviderHealth({
      providerId: 'gemini',
      tabId: 'tab_gemini_1',
      statusCode: 429,
      url: 'https://gemini.google.com/app',
    });
    assert.equal(reportFromCode.status, 'QUOTA_EXCEEDED');
    assert.equal(reportFromCode.errorCode, 'ERR_PROVIDER_QUOTA_EXCEEDED');

    const reportFromText = detectProviderHealth({
      providerId: 'chatgpt',
      tabId: 'tab_chatgpt_3',
      title: 'Rate Limit',
      bodySnippet: 'You have reached your limit of messages for GPT-4. Please wait until 2:00 PM.',
      url: 'https://chatgpt.com/c/123',
    });
    assert.equal(reportFromText.status, 'QUOTA_EXCEEDED');
    assert.equal(reportFromText.errorCode, 'ERR_PROVIDER_QUOTA_EXCEEDED');
  });

  it('P9-H04: Detects Service Outage / HTTP 5xx errors', () => {
    const report502 = detectProviderHealth({
      providerId: 'deepseek',
      tabId: 'tab_deepseek_2',
      statusCode: 502,
      url: 'https://chat.deepseek.com/',
    });
    assert.equal(report502.status, 'SERVICE_UNAVAILABLE');
    assert.equal(report502.errorCode, 'ERR_PROVIDER_SERVICE_UNAVAILABLE');

    const reportText = detectProviderHealth({
      providerId: 'claude',
      tabId: 'tab_claude_3',
      title: '503 Service Temporarily Unavailable',
      url: 'https://claude.ai/',
    });
    assert.equal(reportText.status, 'SERVICE_UNAVAILABLE');
    assert.equal(reportText.errorCode, 'ERR_PROVIDER_SERVICE_UNAVAILABLE');
  });

  it('P9-H05: Verifies healthy, operational provider signals', () => {
    const report = detectProviderHealth({
      providerId: 'chatgpt',
      tabId: 'tab_chatgpt_4',
      title: 'ChatGPT - Project Analysis',
      url: 'https://chatgpt.com/c/6ad64b63-ad44-83ec-90ca-83cacbc26da5',
      bodySnippet: 'Here is the architectural overview of the module.',
    });
    assert.equal(report.status, 'HEALTHY');
    assert.equal(report.errorCode, undefined);
  });

  it('P9-H06: Extracts native thread references from provider URLs (P9-XX4)', () => {
    // ChatGPT
    const cgRef = extractThreadReference('chatgpt', 'https://chatgpt.com/c/6ad64b63-ad44-83ec-90ca-83cacbc26da5');
    assert.equal(cgRef.threadId, '6ad64b63-ad44-83ec-90ca-83cacbc26da5');
    assert.equal(cgRef.canonicalUrl, 'https://chatgpt.com/c/6ad64b63-ad44-83ec-90ca-83cacbc26da5');
    assert.equal(cgRef.isReopenable, true);

    // Claude
    const clRef = extractThreadReference('claude', 'https://claude.ai/chat/031952a2-8b4e-4f15-8c03-bb131bb4bfe1');
    assert.equal(clRef.threadId, '031952a2-8b4e-4f15-8c03-bb131bb4bfe1');
    assert.equal(clRef.canonicalUrl, 'https://claude.ai/chat/031952a2-8b4e-4f15-8c03-bb131bb4bfe1');
    assert.equal(clRef.isReopenable, true);

    // Gemini
    const gmRef = extractThreadReference('gemini', 'https://gemini.google.com/app/1a2b3c4d5e');
    assert.equal(gmRef.threadId, '1a2b3c4d5e');
    assert.equal(gmRef.canonicalUrl, 'https://gemini.google.com/app/1a2b3c4d5e');
    assert.equal(gmRef.isReopenable, true);

    // DeepSeek
    const dsRef = extractThreadReference('deepseek', 'https://chat.deepseek.com/chat/c987654');
    assert.equal(dsRef.threadId, 'c987654');
    assert.equal(dsRef.canonicalUrl, 'https://chat.deepseek.com/chat/c987654');
    assert.equal(dsRef.isReopenable, true);

    // Non-thread landing page -> not reopenable
    const landingRef = extractThreadReference('chatgpt', 'https://chatgpt.com/');
    assert.equal(landingRef.threadId, null);
    assert.equal(landingRef.isReopenable, false);
  });
});
