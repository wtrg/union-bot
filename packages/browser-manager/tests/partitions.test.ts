import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  PROVIDER_REGISTRY,
  isCostGuardBlockedUrl,
  inferAuthStatus,
  BLOCKED_API_PATTERNS,
} from '../src/partitions.ts';
const runtime = createRequire(import.meta.url)('../src/browser-manager.cjs');

describe('OAuth cost guard regression (TypeScript and Electron runtime)', () => {
  for (const [name, blocked] of [['typescript', isCostGuardBlockedUrl], ['electron', runtime.isCostGuardBlockedUrl]] as const) {
    it(`${name}: allows OAuth audiences, blocks only actual API destinations`, () => {
      assert.equal(blocked('https://auth.openai.com/api/accounts/authorize?audience=https%3A%2F%2Fapi.openai.com%2Fv1&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fapi%2Fauth%2Fcallback%2Fopenai'), false);
      assert.equal(blocked('https://accounts.google.com/o/oauth2/auth?redirect_uri=https://generativelanguage.googleapis.com/'), false);
      assert.equal(blocked('https://example.com/api.openai.com'), false);
      assert.equal(blocked('https://api.openai.com.evil.example/'), false);
      for (const domain of BLOCKED_API_PATTERNS) {
        assert.equal(blocked(`https://${domain}/v1/test`), true);
        assert.equal(blocked(`https://sub.${domain}/v1/test`), true);
        assert.equal(blocked(`https://${domain.toUpperCase()}./v1/test`), true);
      }
      assert.equal(blocked('invalid-url'), true);
    });
  }
});

describe('Browser Partition Registry & Cost Guard Isolation (P4-003 / P4-004 / P4-006)', () => {
  it('registers distinct isolated partitions for the 4 core AI providers', () => {
    assert.equal(PROVIDER_REGISTRY.chatgpt.partition, 'persist:mcb-web-chatgpt');
    assert.equal(PROVIDER_REGISTRY.gemini.partition, 'persist:mcb-web-gemini');
    assert.equal(PROVIDER_REGISTRY.claude.partition, 'persist:mcb-web-claude');
    assert.equal(PROVIDER_REGISTRY.deepseek.partition, 'persist:mcb-web-deepseek');
    assert.equal(PROVIDER_REGISTRY.search.partition, 'persist:mcb-web-search');

    // Assert all partitions are completely unique
    const partitions = [
      PROVIDER_REGISTRY.chatgpt.partition,
      PROVIDER_REGISTRY.gemini.partition,
      PROVIDER_REGISTRY.claude.partition,
      PROVIDER_REGISTRY.deepseek.partition,
      PROVIDER_REGISTRY.search.partition,
    ];
    const unique = new Set(partitions);
    assert.equal(unique.size, partitions.length);
  });

  it('blocks paid API endpoints fail-closed via Cost Guard egress filter', () => {
    assert.equal(isCostGuardBlockedUrl('https://api.openai.com/v1/chat/completions'), true);
    assert.equal(isCostGuardBlockedUrl('https://api.anthropic.com/v1/messages'), true);
    assert.equal(isCostGuardBlockedUrl('https://api.deepseek.com/chat/completions'), true);
    assert.equal(isCostGuardBlockedUrl('https://generativelanguage.googleapis.com/v1beta/models'), true);
    assert.equal(isCostGuardBlockedUrl('https://api.perplexity.ai/chat/completions'), true);

    // Public web interfaces are NOT blocked by the paid API filter
    assert.equal(isCostGuardBlockedUrl('https://chatgpt.com/'), false);
    assert.equal(isCostGuardBlockedUrl('https://gemini.google.com/app'), false);
    assert.equal(isCostGuardBlockedUrl('https://claude.ai/login'), false);
    assert.equal(isCostGuardBlockedUrl('https://chat.deepseek.com/'), false);
    assert.equal(isCostGuardBlockedUrl('https://www.google.com/'), false);
  });

  it('infers authentication status from visible allowed signals without credentials', () => {
    // ChatGPT
    assert.equal(
      inferAuthStatus('chatgpt', 'https://chatgpt.com/auth/login', 'Log In - ChatGPT'),
      'LOGIN_REQUIRED'
    );
    assert.equal(
      inferAuthStatus('chatgpt', 'https://chatgpt.com/c/6ad4b4fe', 'Ý tưởng AI Workspace'),
      'READY_OR_LANDING'
    );

    // Claude
    assert.equal(
      inferAuthStatus('claude', 'https://claude.ai/login', 'Sign in - Claude'),
      'LOGIN_REQUIRED'
    );
    assert.equal(
      inferAuthStatus('claude', 'https://claude.ai/chats', 'Claude'),
      'READY_OR_LANDING'
    );

    // DeepSeek
    assert.equal(
      inferAuthStatus('deepseek', 'https://chat.deepseek.com/sign_in', 'DeepSeek - Sign in'),
      'LOGIN_REQUIRED'
    );

    // Empty/Unknown
    assert.equal(inferAuthStatus('chatgpt', '', ''), 'UNKNOWN');
  });
});
