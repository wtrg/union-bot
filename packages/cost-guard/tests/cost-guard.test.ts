import { test, describe } from 'node:test';
import assert from 'node:assert';
import * as http from 'node:http';
import * as https from 'node:https';
import { CostGuard, installNodeCostGuardInterceptor, installElectronCostGuardInterceptor, CostGuardViolationError } from '../src/cost-guard.ts';

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

  test('Runtime Node.js Interceptor blocks global fetch to paid APIs', async () => {
    const uninstall = installNodeCostGuardInterceptor(guard);
    try {
      await assert.rejects(
        async () => {
          await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST' });
        },
        (err: any) => {
          assert.ok(err instanceof CostGuardViolationError);
          assert.strictEqual(err.violation.reason, 'PAID_API_BLOCKED');
          return true;
        }
      );

      await assert.rejects(
        async () => {
          await fetch('https://paid-cloud-service.com/compute');
        },
        (err: any) => {
          assert.ok(err instanceof CostGuardViolationError);
          assert.strictEqual(err.violation.reason, 'NOT_IN_ALLOWLIST');
          return true;
        }
      );
    } finally {
      uninstall();
    }
  });

  test('Runtime Electron Interceptor cancels forbidden egress requests', () => {
    let beforeRequestCallback: ((details: any, cb: (res: { cancel: boolean }) => void) => void) | null = null;
    const mockSession = {
      webRequest: {
        onBeforeRequest: (cb: any) => {
          beforeRequestCallback = cb;
        }
      }
    };

    installElectronCostGuardInterceptor(mockSession, guard);
    assert.ok(beforeRequestCallback);

    // 1. Test paid API cancellation
    let cancelled = false;
    beforeRequestCallback!({ url: 'https://api.openai.com/v1/models' }, (res) => {
      cancelled = res.cancel;
    });
    assert.strictEqual(cancelled, true, 'Electron interceptor must cancel paid OpenAI API request');

    // 2. Test billing endpoint cancellation
    cancelled = false;
    beforeRequestCallback!({ url: 'https://chatgpt.com/billing/payment' }, (res) => {
      cancelled = res.cancel;
    });
    assert.strictEqual(cancelled, true, 'Electron interceptor must cancel billing endpoint request');

    // 3. Test allowed domain pass-through
    cancelled = true;
    beforeRequestCallback!({ url: 'https://chatgpt.com/c/work-session' }, (res) => {
      cancelled = res.cancel;
    });
    assert.strictEqual(cancelled, false, 'Electron interceptor must allow approved chatgpt.com web UI');
  });

  test('Runtime Node.js Interceptor blocks http.get and http.request to paid or unapproved endpoints', () => {
    const uninstall = installNodeCostGuardInterceptor(guard);
    try {
      assert.throws(() => {
        http.get('http://api.openai.com/v1/models');
      }, (err: any) => {
        assert.ok(err instanceof CostGuardViolationError);
        assert.strictEqual(err.violation.reason, 'PAID_API_BLOCKED');
        return true;
      });

      assert.throws(() => {
        http.request({ host: 'random-paid-service.com', port: 80, path: '/api' });
      }, (err: any) => {
        assert.ok(err instanceof CostGuardViolationError);
        assert.strictEqual(err.violation.reason, 'NOT_IN_ALLOWLIST');
        return true;
      });
    } finally {
      uninstall();
    }
  });

  test('Runtime Node.js Interceptor blocks https.get and https.request to paid endpoints', () => {
    const uninstall = installNodeCostGuardInterceptor(guard);
    try {
      assert.throws(() => {
        https.get('https://api.anthropic.com/v1/messages');
      }, (err: any) => {
        assert.ok(err instanceof CostGuardViolationError);
        assert.strictEqual(err.violation.reason, 'PAID_API_BLOCKED');
        return true;
      });

      assert.throws(() => {
        https.request({ host: 'api.deepseek.com', port: 443, path: '/chat' });
      }, (err: any) => {
        assert.ok(err instanceof CostGuardViolationError);
        assert.strictEqual(err.violation.reason, 'PAID_API_BLOCKED');
        return true;
      });
    } finally {
      uninstall();
    }
  });
});
