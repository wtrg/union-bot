import { test, describe } from 'node:test';
import assert from 'node:assert';
import { CostGuard } from '../src/cost-guard.ts';

describe('CostGuard Zero-Cost (0đ) Policy Enforcement', () => {
  const guard = new CostGuard();

  test('Permits localhost and loopback requests', () => {
    assert.strictEqual(guard.isUrlAllowed('http://localhost:3000/api/health'), true);
    assert.strictEqual(guard.isUrlAllowed('http://127.0.0.1:8080/ws'), true);
  });

  test('Permits approved AI web UI domains', () => {
    assert.strictEqual(guard.isUrlAllowed('https://chatgpt.com/c/12345'), true);
    assert.strictEqual(guard.isUrlAllowed('https://gemini.google.com/app'), true);
    assert.strictEqual(guard.isUrlAllowed('https://claude.ai/chat/abc'), true);
    assert.strictEqual(guard.isUrlAllowed('https://chat.deepseek.com'), true);
    assert.strictEqual(guard.isUrlAllowed('https://github.com/user/repo'), true);
  });

  test('Strictly BLOCKS paid OpenAI Developer Platform API', () => {
    assert.strictEqual(guard.isUrlAllowed('https://api.openai.com/v1/chat/completions'), false);
    assert.throws(() => {
      guard.assertUrlAllowed('https://api.openai.com/v1/models');
    }, /COST_GUARD_VIOLATION/);
  });

  test('Strictly BLOCKS paid Google Gemini Generative Language API', () => {
    assert.strictEqual(guard.isUrlAllowed('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent'), false);
    assert.throws(() => {
      guard.assertUrlAllowed('https://generativelanguage.googleapis.com/v1beta/models');
    }, /COST_GUARD_VIOLATION/);
  });

  test('Strictly BLOCKS paid Anthropic Developer API', () => {
    assert.strictEqual(guard.isUrlAllowed('https://api.anthropic.com/v1/messages'), false);
    assert.throws(() => {
      guard.assertUrlAllowed('https://api.anthropic.com/v1/complete');
    }, /COST_GUARD_VIOLATION/);
  });

  test('Strictly BLOCKS paid DeepSeek API', () => {
    assert.strictEqual(guard.isUrlAllowed('https://api.deepseek.com/chat/completions'), false);
  });

  test('Blocks billing and checkout endpoints', () => {
    assert.strictEqual(guard.isUrlAllowed('https://chatgpt.com/billing/upgrade'), false);
  });

  test('Blocks unknown external domains not in allowlist', () => {
    assert.strictEqual(guard.isUrlAllowed('https://random-paid-cloud-service.com/api'), false);
    assert.strictEqual(guard.isUrlAllowed('https://crypto-token-miner.xyz'), false);
  });

  test('Records violations in audit ledger', () => {
    const violations = guard.getViolations();
    assert.ok(violations.length >= 6, `Expected at least 6 violations, got ${violations.length}`);
    const openaiViolation = violations.find(v => v.hostname === 'api.openai.com');
    assert.ok(openaiViolation);
    assert.strictEqual(openaiViolation?.reason, 'PAID_API_BLOCKED');
  });
});
