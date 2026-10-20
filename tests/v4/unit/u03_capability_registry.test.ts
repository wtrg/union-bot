import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore
import { CapabilityRegistry } from '../../../apps/desktop/src/services/capability-registry.cjs';

describe('UB-V4-U03: Provider Capability & Native Runtime Truth', () => {
  it('U03-001: enforces truthful default capabilities and zero fake green status', () => {
    const registry = new CapabilityRegistry();
    const all = registry.getAllCapabilities();

    // Antigravity: Free local CLI runner (0đ)
    assert.equal(all.antigravity.status, 'free_local');
    assert.equal(all.antigravity.badge, 'FREE_LOCAL');
    assert.ok(all.antigravity.costRate.includes('0đ'));

    // Codex: Unavailable in session — NOT fake green or mock-ready
    assert.equal(all.codex.status, 'unavailable_in_session');
    assert.equal(all.codex.badge, 'PENDING_QA');

    // ChatGPT Web: Ready for manual review
    assert.equal(all.chatgpt_web.status, 'ready_manual');
    assert.equal(all.chatgpt_web.badge, 'READY_MANUAL');

    // Other web members start in auth_required
    assert.equal(all.gemini_web.status, 'auth_required');
    assert.equal(all.claude_web.status, 'auth_required');
    assert.equal(all.deepseek_web.status, 'auth_required');
  });

  it('U03-002: detects Cloudflare challenge and transitions badge to CHALLENGE', () => {
    const registry = new CapabilityRegistry();

    // Update with Cloudflare challenge
    const res = registry.updateWebStatus('gemini_web', {
      title: 'Just a moment... | Cloudflare',
      url: 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform',
    });

    assert.ok(res);
    assert.equal(res.status, 'challenge_required');
    assert.equal(res.badge, 'CHALLENGE');
    assert.ok(res.details.includes('Cloudflare'));
  });

  it('U03-003: detects Login screen and transitions badge to AUTH_REQ', () => {
    const registry = new CapabilityRegistry();

    const res = registry.updateWebStatus('claude_web', {
      title: 'Log in to Claude',
      url: 'https://claude.ai/login',
    });

    assert.ok(res);
    assert.equal(res.status, 'auth_required');
    assert.equal(res.badge, 'AUTH_REQ');
  });

  it('U03-004: detects authenticated workspace surface and marks READY_MANUAL', () => {
    const registry = new CapabilityRegistry();

    const res = registry.updateWebStatus('deepseek_web', {
      title: 'DeepSeek Chat',
      url: 'https://chat.deepseek.com/',
    });

    assert.ok(res);
    assert.equal(res.status, 'ready_manual');
    assert.equal(res.badge, 'READY_MANUAL');
  });

  it('U03-005: correctly formats truthful agent info list for Sidebar UI', () => {
    const registry = new CapabilityRegistry();
    const list = registry.toAgentInfoList();

    assert.equal(list.length, 6);
    const agy = list.find((a: any) => a.id === 'antigravity');
    assert.ok(agy);
    assert.equal(agy.badge, 'FREE_LOCAL');

    const codex = list.find((a: any) => a.id === 'codex');
    assert.ok(codex);
    assert.equal(codex.badge, 'PENDING_QA');
  });
});
