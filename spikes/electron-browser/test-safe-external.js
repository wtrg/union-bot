const test = require('node:test');
const assert = require('node:assert/strict');
const { validateExternalUrl, safeOpenExternal, isPrivateOrLoopbackHost } = require('./safe-external.js');

test('SafeExternal Security Validation Tests', async (t) => {
  await t.test('Rejects dangerous and local file schemes', () => {
    const dangerousSchemes = [
      'file:///C:/Windows/System32/cmd.exe',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox("test")',
      'shell:personal',
      'chrome://settings',
      'ms-settings:privacy',
      'ms-windows-store://home',
      'powershell:Start-Process calc'
    ];

    for (const url of dangerousSchemes) {
      const res = validateExternalUrl(url);
      assert.equal(res.valid, false, `Expected ${url} to be invalid`);
      assert.match(res.reason, /Disallowed protocol scheme/);
    }
  });

  await t.test('Rejects URLs with embedded credentials', () => {
    const credentialUrls = [
      'https://user:password@malicious-site.com/login',
      'https://admin:@phishing.org',
      'http://guest:guest@10.0.0.1'
    ];

    for (const url of credentialUrls) {
      const res = validateExternalUrl(url);
      assert.equal(res.valid, false, `Expected ${url} to be invalid`);
    }
  });

  await t.test('Rejects private IPv4 and loopback addresses by default', () => {
    const localTargets = [
      'http://localhost:8080/admin',
      'http://127.0.0.1/status',
      'http://192.168.1.1/router',
      'http://10.0.0.5/internal',
      'http://172.16.1.1/gateway'
    ];

    for (const url of localTargets) {
      const res = validateExternalUrl(url);
      assert.equal(res.valid, false, `Expected ${url} to be invalid`);
      assert.match(res.reason, /Private or loopback address prohibited/);
    }
  });

  await t.test('Rejects malformed and empty URLs', () => {
    assert.equal(validateExternalUrl('').valid, false);
    assert.equal(validateExternalUrl('   ').valid, false);
    assert.equal(validateExternalUrl('not-a-valid-url').valid, false);
    assert.equal(validateExternalUrl(null).valid, false);
  });

  await t.test('Permits valid public HTTPS external URLs', () => {
    const validUrls = [
      'https://chatgpt.com',
      'https://google.com/search?q=test',
      'https://github.com/wtrg/union-bot',
      'https://docs.anthropic.com/en/docs'
    ];

    for (const url of validUrls) {
      const res = validateExternalUrl(url);
      assert.equal(res.valid, true, `Expected ${url} to be valid`);
      assert.ok(res.sanitizedUrl.startsWith('https://'));
    }
  });

  await t.test('safeOpenExternal never invokes shell.openExternal for invalid schemes', async () => {
    let invoked = false;
    const mockShell = {
      openExternal: async () => {
        invoked = true;
      }
    };

    const result = await safeOpenExternal('file:///C:/autoexec.bat', mockShell);
    assert.equal(result.opened, false);
    assert.equal(invoked, false, 'shell.openExternal must NOT be invoked for file://');
  });

  await t.test('safeOpenExternal invokes shell.openExternal for approved public HTTPS URLs', async () => {
    let openedUrl = null;
    const mockShell = {
      openExternal: async (url) => {
        openedUrl = url;
      }
    };

    const target = 'https://chatgpt.com';
    const result = await safeOpenExternal(target, mockShell);
    assert.equal(result.opened, true);
    assert.equal(openedUrl, 'https://chatgpt.com/');
  });
});
