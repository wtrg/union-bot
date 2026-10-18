const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { validateExternalUrl } = require('../src/safe-external.js');
const { CostGuard } = require('../src/cost-guard.cjs');

describe('Union Bot Desktop Security & Shell Verification', () => {
  it('safe-external strictly rejects dangerous protocols and credentials', () => {
    assert.equal(validateExternalUrl('file:///C:/Windows/System32/cmd.exe').valid, false);
    assert.equal(validateExternalUrl('javascript:alert(1)').valid, false);
    assert.equal(validateExternalUrl('ms-settings:network').valid, false);
    assert.equal(validateExternalUrl('https://admin:pass@phishing.com').valid, false);
    assert.equal(validateExternalUrl('http://192.168.1.1').valid, false);

    const validHttps = validateExternalUrl('https://github.com/wtrg/union-bot');
    assert.equal(validHttps.valid, true);
    assert.equal(validHttps.sanitizedUrl, 'https://github.com/wtrg/union-bot');
  });

  it('cost-guard main process interceptor strictly enforces Zero-Cost policy', () => {
    const cg = new CostGuard();
    assert.equal(cg.isUrlAllowed('https://api.openai.com/v1/chat/completions'), false);
    assert.equal(cg.isUrlAllowed('https://generativelanguage.googleapis.com/v1beta/models'), false);
    assert.equal(cg.isUrlAllowed('https://api.anthropic.com/v1/messages'), false);
    assert.equal(cg.isUrlAllowed('https://api.deepseek.com/chat/completions'), false);
    assert.equal(cg.isUrlAllowed('https://chatgpt.com/billing'), false);

    assert.equal(cg.isUrlAllowed('https://chatgpt.com/c/123'), true);
    assert.equal(cg.isUrlAllowed('https://gemini.google.com/app'), true);
    assert.equal(cg.isUrlAllowed('https://claude.ai/chat/abc'), true);
    assert.equal(cg.isUrlAllowed('https://chat.deepseek.com'), true);
  });

  it('preload.cjs enforces strict context isolation and no arbitrary Node access', () => {
    const preloadContent = fs.readFileSync(path.resolve(__dirname, '../src/preload.cjs'), 'utf-8');
    assert.match(preloadContent, /contextBridge\.exposeInMainWorld\('unionBotAPI'/);
    // Ensure raw ipcRenderer is NOT exposed globally
    assert.doesNotMatch(preloadContent, /window\.ipcRenderer\s*=/);
    assert.doesNotMatch(preloadContent, /window\.require\s*=/);
    assert.doesNotMatch(preloadContent, /window\.process\s*=/);
  });

  it('workspace UI production bundle exists and is ready for offline loading', () => {
    const distIndex = path.resolve(__dirname, '../../workspace-ui/dist/index.html');
    assert.equal(fs.existsSync(distIndex), true);
    const html = fs.readFileSync(distIndex, 'utf-8');
    assert.match(html, /<title>Union Bot<\/title>/);
    assert.match(html, /Content-Security-Policy/);
  });
});
