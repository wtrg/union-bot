import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateUrl,
  resolveAddressBarInput,
  isAllowedProviderNavigation,
  isAllowedForProvider,
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

  it('rejects private IPv4, IPv6, cloud metadata, and loopback addresses by default (UB-P4-R01-001 / P4-R02-T03)', () => {
    assert.equal(isPrivateOrLoopbackHost('localhost'), true);
    assert.equal(isPrivateOrLoopbackHost('127.0.0.1'), true);
    assert.equal(isPrivateOrLoopbackHost('127.0.0.2'), true);
    assert.equal(isPrivateOrLoopbackHost('127.255.255.255'), true);
    assert.equal(isPrivateOrLoopbackHost('::1'), true);
    assert.equal(isPrivateOrLoopbackHost('[::1]'), true);
    assert.equal(isPrivateOrLoopbackHost('169.254.169.254'), true);
    assert.equal(isPrivateOrLoopbackHost('169.254.1.1'), true);
    assert.equal(isPrivateOrLoopbackHost('fe80::1'), true);
    assert.equal(isPrivateOrLoopbackHost('[fe80::1]'), true);
    assert.equal(isPrivateOrLoopbackHost('fc00::1'), true);
    assert.equal(isPrivateOrLoopbackHost('192.168.1.1'), true);
    assert.equal(isPrivateOrLoopbackHost('10.0.0.5'), true);
    assert.equal(isPrivateOrLoopbackHost('172.20.0.1'), true);
    assert.equal(isPrivateOrLoopbackHost('0.0.0.0'), true);
    assert.equal(isPrivateOrLoopbackHost('google.com'), false);

    const res1 = validateUrl('http://127.0.0.1:8080/exploit');
    assert.equal(res1.valid, false);
    assert.match(res1.reason || '', /Private or loopback address prohibited/);

    const res2 = validateUrl('http://127.0.0.2:8080/exploit');
    assert.equal(res2.valid, false);

    const res3 = validateUrl('http://[::1]:9000/');
    assert.equal(res3.valid, false);

    const res4 = validateUrl('http://169.254.169.254/latest/meta-data/');
    assert.equal(res4.valid, false);

    const res5 = validateUrl('http://192.168.1.50/');
    assert.equal(res5.valid, false);
  });

  it('validates provider authentication and navigation boundary enforcement (UB-P4-R01-002 / P4-R02-T04)', () => {
    // ChatGPT primary & OAuth federation domains

    assert.equal(isAllowedForProvider('chatgpt', 'https://chatgpt.com/c/new'), true);
    assert.equal(isAllowedForProvider('chatgpt', 'https://auth0.openai.com/u/login'), true);
    assert.equal(isAllowedForProvider('chatgpt', 'https://auth.openai.com/authorize'), true);
    assert.equal(isAllowedForProvider('chatgpt', 'https://accounts.google.com/o/oauth2/auth'), true);
    assert.equal(isAllowedForProvider('chatgpt', 'https://evil.com/'), false);

    // Gemini primary & Google account auth
    assert.equal(isAllowedForProvider('gemini', 'https://gemini.google.com/app'), true);
    assert.equal(isAllowedForProvider('gemini', 'https://accounts.google.com/signin'), true);
    assert.equal(isAllowedForProvider('gemini', 'https://openai.com/'), false);

    // Claude primary & auth
    assert.equal(isAllowedForProvider('claude', 'https://claude.ai/chats'), true);
    assert.equal(isAllowedForProvider('claude', 'https://anthropic.com/login'), true);
    assert.equal(isAllowedForProvider('claude', 'https://accounts.google.com/signin'), true);
    assert.equal(isAllowedForProvider('claude', 'https://chatgpt.com/'), false);

    // DeepSeek
    assert.equal(isAllowedForProvider('deepseek', 'https://chat.deepseek.com/'), true);
    assert.equal(isAllowedForProvider('deepseek', 'https://deepseek.com/'), true);
    assert.equal(isAllowedForProvider('deepseek', 'https://google.com/'), false);

    // Search allows any valid public web page
    assert.equal(isAllowedForProvider('search', 'https://wikipedia.org/wiki/Main_Page'), true);
    assert.equal(isAllowedForProvider('search', 'http://127.0.0.1/'), false); // blocked by loopback

    // UB-P4-R02-001 / P4-R03-A01: Rejection of insecure HTTP on auth origins
    assert.equal(isAllowedForProvider('chatgpt', 'http://accounts.google.com/signin'), false);
    assert.equal(isAllowedForProvider('gemini', 'http://accounts.google.com/'), false);
    assert.equal(isAllowedForProvider('claude', 'http://appleid.apple.com/'), false);
  });


  it('resolves address bar input: turns search query into safe public search URL', () => {
    const res = resolveAddressBarInput('what is machine learning');
    assert.equal(res.valid, true);
    assert.equal(res.sanitizedUrl, 'https://www.google.com/search?q=what%20is%20machine%20learning');
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
