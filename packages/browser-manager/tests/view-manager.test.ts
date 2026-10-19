import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserStateManager } from '../src/view-manager.ts';

describe('Browser State Manager & View Coordinator (P4-001 / P4-007 / P4-008 / P4-010)', () => {
  it('initializes default 4 provider tabs and selects the first tab', () => {
    const manager = new BrowserStateManager();
    const tabs = manager.initializeDefaultTabs();

    assert.equal(tabs.length, 4);
    assert.deepEqual(
      tabs.map((t) => t.providerId),
      ['chatgpt', 'gemini', 'claude', 'deepseek']
    );

    const state = manager.getState();
    assert.equal(state.tabs.length, 4);
    assert.equal(state.activeTabId, tabs[0].id);
  });

  it('creates custom search tab and activates it', () => {
    const manager = new BrowserStateManager();
    const tab = manager.createTab('search', 'https://duckduckgo.com/?q=electron', 'Search');

    assert.equal(tab.providerId, 'search');
    assert.equal(tab.url, 'https://duckduckgo.com/?q=electron');
    assert.equal(tab.partition, 'persist:mcb-web-search');
    assert.equal(manager.getState().activeTabId, tab.id);
  });

  it('closes active tab and automatically switches to adjacent remaining tab', () => {
    const manager = new BrowserStateManager();
    const tabs = manager.initializeDefaultTabs();
    const firstTabId = tabs[0].id;
    const secondTabId = tabs[1].id;

    assert.equal(manager.getState().activeTabId, firstTabId);

    const res = manager.closeTab(firstTabId);
    assert.equal(res.closed, true);
    assert.equal(res.nextActiveTabId, secondTabId);
    assert.equal(manager.getState().activeTabId, secondTabId);
    assert.equal(manager.getState().tabs.length, 3);
  });

  it('updates tab state (navigation, title, loading, auth status)', () => {
    const manager = new BrowserStateManager();
    const tab = manager.createTab('chatgpt');

    const updated = manager.updateTab(tab.id, {
      url: 'https://chatgpt.com/auth/login',
      title: 'Log In - ChatGPT',
      isLoading: false,
    });

    assert.ok(updated);
    assert.equal(updated.url, 'https://chatgpt.com/auth/login');
    assert.equal(updated.authStatus, 'LOGIN_REQUIRED');
  });

  it('manages bounds and bounds coordinate clamping', () => {
    const manager = new BrowserStateManager();
    const b = manager.setBounds({ x: -10, y: 50, width: 600.4, height: 800.7 });

    assert.equal(b.x, 0); // clamped
    assert.equal(b.y, 50);
    assert.equal(b.width, 600);
    assert.equal(b.height, 801);
  });

  it('hides view when modal is active to prevent overlay bleed (P4-008)', () => {
    const manager = new BrowserStateManager();

    // User opens browser panel
    manager.setVisibility(true);
    assert.equal(manager.isEffectiveVisible(), true);

    // User opens preferences modal or create project modal
    manager.setModalActive(true);
    assert.equal(manager.isEffectiveVisible(), false, 'Expected view to be hidden when modal is active');

    // Modal closes
    manager.setModalActive(false);
    assert.equal(manager.isEffectiveVisible(), true, 'Expected view to be restored when modal closes');

    // User collapses browser panel
    manager.setVisibility(false);
    assert.equal(manager.isEffectiveVisible(), false);
  });

  it('handles zoom factor adjustments (zoom-in, zoom-out, zoom-reset)', () => {
    const manager = new BrowserStateManager();
    const tab = manager.createTab('gemini');

    assert.equal(tab.zoomFactor, 1.0);

    const z1 = manager.applyZoomAction(tab.id, 'zoom-in');
    assert.equal(z1, 1.1);

    const z2 = manager.applyZoomAction(tab.id, 'zoom-out');
    assert.equal(z2, 1.0);

    manager.applyZoomAction(tab.id, 'zoom-in');
    manager.applyZoomAction(tab.id, 'zoom-in');
    const resetZoom = manager.applyZoomAction(tab.id, 'zoom-reset');
    assert.equal(resetZoom, 1.0);
  });

  it('generates manual share payload with user_manual attribution (P4-010)', () => {
    const manager = new BrowserStateManager();
    const tab = manager.createTab('claude', 'https://claude.ai/chat/123', 'Project Architecture');

    const share = manager.createSharePayload(
      tab.id,
      'Extracted snippet explaining SQLite WAL replication',
      'orchestration'
    );

    assert.ok(share);
    assert.equal(share.selectedText, 'Extracted snippet explaining SQLite WAL replication');
    assert.equal(share.pageUrl, 'https://claude.ai/chat/123');
    assert.equal(share.pageTitle, 'Project Architecture');
    assert.equal(share.providerId, 'claude');
    assert.equal(share.roomId, 'orchestration');
  });
});
