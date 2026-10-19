import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateUrl,
  resolveAddressBarInput,
  isAllowedProviderNavigation,
  isPrivateOrLoopbackHost,
  DISALLOWED_SCHEMES,
} from '../src/url-policy.ts';

describe('Browser URL Policy & Navigation Safety (P4-002 / P4-005)', () => {
  it('allows safe HTTPS and HTTP URLs', () => {
    const res1 = validateUrl('https://example.com/test');
    assert.equal(res1.valid, true);
    assert.equal(res1.sanitizedUrl, 'https://example.com/test');

    const res2 = validateUrl('http://example.org/');
    assert.equal(res2.valid, true);
    assert.equal(res2.sanitizedUrl, 'http://example.org/');
  });

  it('rejects disallowed schemes fail-closed', () => {
    const dangerousUrls = [
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'data:text/html,<b>pwned</b>',
      'powershell:Start-Process calc',
      'cmd:/c echo evil',
      'ms-settings:privacy',
      'chrome://settings',
      'vbscript:MsgBox(1)',
    ];

    for (const url of dangerousUrls) {
      const res = validateUrl(url);
      assert.equal(res.valid, false, `Expected ${url} to be rejected`);
      assert.match(res.reason || '', /Disallowed protocol scheme|Malformed URL/);
    }
  });

  it('rejects embedded credentials in URL', () => {
    const res = validateUrl('https://admin:secret123@target.internal/');
    assert.equal(res.valid, false);
    assert.match(res.reason || '', /Embedded credentials/);
  });

  it('rejects private IPv4 and loopback addresses by default', () => {
    assert.equal(isPrivateOrLoopbackHost('localhost'), true);
    assert.equal(isPrivateOrLoopbackHost('127.0.0.1'), true);
    assert.equal(isPrivateOrLoopbackHost('192.168.1.1'), true);
    assert.equal(isPrivateOrLoopbackHost('10.0.0.5'), true);
    assert.equal(isPrivateOrLoopbackHost('172.20.0.1'), true);
    assert.equal(isPrivateOrLoopbackHost('google.com'), false);

    const res1 = validateUrl('http://127.0.0.1:8080/exploit');
    assert.equal(res1.valid, false);
    assert.match(res1.reason || '', /Private or loopback address prohibited/);

    const res2 = validateUrl('http://192.168.1.50/');
    assert.equal(res2.valid, false);
  });

  it('resolves address bar input: turns search query into safe public search URL', () => {
    const res = resolveAddressBarInput('what is machine learning');
    assert.equal(res.valid, true);
    assert.equal(res.sanitizedUrl, 'https://duckduckgo.com/?q=what%20is%20machine%20learning');
  });

  it('resolves address bar input: prepends https:// to domain if missing scheme', () => {
    const res = resolveAddressBarInput('github.com/wtrg/union-bot');
    assert.equal(res.valid, true);
    assert.equal(res.sanitizedUrl, 'https://github.com/wtrg/union-bot');
  });

  it('rejects empty or malformed address bar input', () => {
    const res1 = resolveAddressBarInput('');
    assert.equal(res1.valid, false);

    const res2 = resolveAddressBarInput('   ');
    assert.equal(res2.valid, false);
  });

  it('validates provider origin boundary enforcement', () => {
    assert.equal(
      isAllowedProviderNavigation('https://chatgpt.com/c/123-abc', 'https://chatgpt.com'),
      true
    );
    assert.equal(
      isAllowedProviderNavigation('https://sub.chatgpt.com/page', 'https://chatgpt.com'),
      true
    );
    assert.equal(
      isAllowedProviderNavigation('https://evil-spoof-chatgpt.com/', 'https://chatgpt.com'),
      false
    );
    assert.equal(
      isAllowedProviderNavigation('https://google.com/', 'https://chatgpt.com'),
      false
    );
  });
});
