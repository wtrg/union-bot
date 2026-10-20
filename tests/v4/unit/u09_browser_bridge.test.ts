import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore
import { BrowserUseBridge } from '../../../apps/desktop/src/services/browser-use-bridge.cjs';

describe('UB-V4-U09: Real Browser-Use & Context Bridge', () => {
  it('U09-001: manages single-controller lease per tab and prevents conflicting control', () => {
    const bridge = new BrowserUseBridge({ leaseDurationMs: 10000 });

    // Controller A acquires lease on tab_1
    const l1 = bridge.acquireControllerLease('tab_1', 'agent_coder');
    assert.equal(l1.success, true);
    assert.ok(l1.leaseToken);
    assert.equal(l1.controllerId, 'agent_coder');

    // Controller B attempts to acquire lease on same tab -> conflict
    const l2 = bridge.acquireControllerLease('tab_1', 'agent_reviewer');
    assert.equal(l2.success, false);
    assert.equal(l2.code, 'ERR_LEASE_CONFLICT');
    assert.equal(l2.holder, 'agent_coder');

    // Controller A renews lease -> success
    const renew = bridge.renewControllerLease('tab_1', l1.leaseToken!);
    assert.equal(renew.success, true);

    // Controller A releases lease
    const released = bridge.releaseControllerLease('tab_1', l1.leaseToken!);
    assert.equal(released, true);

    // Controller B can now acquire lease
    const l3 = bridge.acquireControllerLease('tab_1', 'agent_reviewer');
    assert.equal(l3.success, true);
    assert.equal(l3.controllerId, 'agent_reviewer');
  });

  it('U09-002: extracts safe DOM snapshot with deterministic SHA-256 and stripped query params', () => {
    const bridge = new BrowserUseBridge();

    const snapshotResult = bridge.createSafeDomSnapshot({
      tabId: 'tab_test',
      url: 'https://chatgpt.com/c/6ad64b63-ad44-83ec-90ca-83cacbc26da5?token=secret123&session=abc',
      title: 'ChatGPT - Project Review',
      rawDomText: 'Welcome to the project review dashboard. All systems green.',
      interactiveElements: [
        { id: 'btn_submit', tag: 'button', role: 'button', text: 'Submit Review', x: 100, y: 200, width: 80, height: 32, clickable: true },
        { id: 'input_text', tag: 'input', role: 'textbox', text: 'Enter feedback', x: 100, y: 250, width: 200, height: 40, clickable: true },
      ],
      viewport: { width: 1280, height: 800 },
    });

    assert.ok(snapshotResult.snapshotSha256);
    assert.equal(snapshotResult.snapshotSha256.length, 64);
    assert.equal(snapshotResult.snapshot.url, 'https://chatgpt.com/c/6ad64b63-ad44-83ec-90ca-83cacbc26da5');
    assert.ok(!snapshotResult.snapshot.url.includes('secret123'));
    assert.equal(snapshotResult.snapshot.elementsCount, 2);
    assert.equal(snapshotResult.snapshot.interactiveElements[0].clickable, true);
  });

  it('U09-003: redacts sensitive passwords, JWTs, API keys, and secret tokens from DOM text', () => {
    const bridge = new BrowserUseBridge();

    const rawContent = `
      <div>
        <input type="password" name="pwd" value="SuperSecretPassword123" />
        <p>Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisSignature</p>
        <p>OpenAI Key: sk-proj-1234567890abcdef1234567890abcdef</p>
        <p>Google API: AIzaSyD9ABC1234567890123456789012345678</p>
        <p>GitHub PAT: ghp_1234567890abcdefghijklmnopqrstuvwxyz</p>
        <p>Credit Card: 4111 2222 3333 4444</p>
      </div>
    `;

    const sanitized = bridge.redactSensitiveData(rawContent);

    assert.ok(!sanitized.includes('SuperSecretPassword123'));
    assert.ok(sanitized.includes('[REDACTED_SECRET]'));
    assert.ok(!sanitized.includes('doNotLeakThisSignature'));
    assert.ok(sanitized.includes('[REDACTED_JWT]') || sanitized.includes('[REDACTED_TOKEN]'));
    assert.ok(!sanitized.includes('sk-proj-1234567890abcdef'));
    assert.ok(sanitized.includes('sk-[REDACTED_API_KEY]'));
    assert.ok(!sanitized.includes('AIzaSyD9ABC1234567890123456789012345678'));
    assert.ok(!sanitized.includes('ghp_1234567890abcdefghijklmnopqrstuvwxyz'));
    assert.ok(!sanitized.includes('4111 2222 3333 4444'));
    assert.ok(sanitized.includes('[REDACTED_CARD_NUMBER]'));
  });

  it('U09-004: enforces lease verification and bounds-checking for browser actions', () => {
    const bridge = new BrowserUseBridge({ defaultViewport: { width: 1280, height: 800 } });
    const lease = bridge.acquireControllerLease('tab_actions', 'agent_worker');

    // 1. Action without valid lease is rejected
    const unauthAction = bridge.executeAction({
      tabId: 'tab_actions',
      leaseToken: 'invalid_token',
      actionType: 'click',
      coordinates: { x: 100, y: 100 },
    });
    assert.equal(unauthAction.success, false);
    assert.equal(unauthAction.code, 'ERR_UNAUTHORIZED_LEASE');

    // 2. Click action within bounds succeeds
    const validClick = bridge.executeAction({
      tabId: 'tab_actions',
      leaseToken: lease.leaseToken!,
      actionType: 'click',
      coordinates: { x: 500, y: 300 },
    });
    assert.equal(validClick.success, true);
    assert.equal(validClick.actionType, 'click');

    // 3. Click out of bounds is rejected
    const oobClick = bridge.executeAction({
      tabId: 'tab_actions',
      leaseToken: lease.leaseToken!,
      actionType: 'click',
      coordinates: { x: 2000, y: 300 },
    });
    assert.equal(oobClick.success, false);
    assert.equal(oobClick.code, 'ERR_OUT_OF_BOUNDS');

    // 4. Fill text succeeds
    const validFill = bridge.executeAction({
      tabId: 'tab_actions',
      leaseToken: lease.leaseToken!,
      actionType: 'fill',
      text: 'Verified project summary report',
    });
    assert.equal(validFill.success, true);
    assert.equal(validFill.actionType, 'fill');

    // 5. Unsafe protocol navigation is rejected
    const unsafeNav = bridge.executeAction({
      tabId: 'tab_actions',
      leaseToken: lease.leaseToken!,
      actionType: 'navigate',
      url: 'javascript:alert(1)',
    });
    assert.equal(unsafeNav.success, false);
    assert.equal(unsafeNav.code, 'ERR_UNSAFE_PROTOCOL');

    // 6. Valid HTTPS navigation succeeds
    const validNav = bridge.executeAction({
      tabId: 'tab_actions',
      leaseToken: lease.leaseToken!,
      actionType: 'navigate',
      url: 'https://chatgpt.com',
    });
    assert.equal(validNav.success, true);
    assert.equal(validNav.actionType, 'navigate');
  });
});
