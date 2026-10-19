/**
 * @file browser-service.cjs
 * @description Electron Browser Service managing isolated WebContentsView instances for AI Providers
 * Fulfills Phase P4 specification (Master Plan V3 tickets P4-001 to P4-012)
 */

const { WebContentsView, session, shell } = require('electron');
const path = require('path');
const { safeOpenExternal, validateExternalUrl } = require('./safe-external.js');
const {
  BrowserStateManager,
  PROVIDER_REGISTRY,
  isCostGuardBlockedUrl,
  resolveAddressBarInput,
  validateUrl,
  isAllowedProviderNavigation,
  inferAuthStatus,
} = require('../../../packages/browser-manager/src/browser-manager.cjs');

class BrowserService {
  constructor(mainWindow, storageService) {
    this.mainWindow = mainWindow;
    this.storageService = storageService;
    this.stateManager = new BrowserStateManager();
    this.views = new Map(); // tabId -> WebContentsView
    this.configuredPartitions = new Set();
  }

  /**
   * Initializes the browser service and default provider tabs
   */
  async initialize() {
    const defaultTabs = this.stateManager.initializeDefaultTabs();
    for (const tab of defaultTabs) {
      this._createViewForTab(tab);
    }
    this.updateLayout();
  }

  /**
   * Configures security, permissions, and cost guard filter for a partition
   */
  _ensurePartitionConfigured(partitionName) {
    if (this.configuredPartitions.has(partitionName)) return;

    try {
      const partSession = session.fromPartition(partitionName);

      // Ticket P4-005: Default deny for all sensitive device permissions
      partSession.setPermissionRequestHandler((webContents, permission, callback) => {
        console.warn(`[BrowserSession] Denied permission '${permission}' in partition '${partitionName}'`);
        callback(false);
      });

      // Ticket P4-003: Cost Guard network egress filter (blocks paid API endpoints)
      partSession.webRequest.onBeforeRequest((details, callback) => {
        if (isCostGuardBlockedUrl(details.url)) {
          console.warn(`[CostGuard-Session] Blocked paid API egress in ${partitionName}: ${details.url}`);
          callback({ cancel: true });
          return;
        }
        callback({ cancel: false });
      });

      this.configuredPartitions.add(partitionName);
    } catch (err) {
      console.warn(`[BrowserSession] Warning configuring partition ${partitionName}:`, err.message);
    }
  }

  /**
   * Creates and attaches a WebContentsView for a given tab state
   */
  _createViewForTab(tab) {
    if (!WebContentsView) {
      console.warn('[BrowserService] WebContentsView not supported in this environment');
      return null;
    }

    this._ensurePartitionConfigured(tab.partition);

    const partSession = session.fromPartition(tab.partition);
    const view = new WebContentsView({
      webPreferences: {
        session: partSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // No privileged preload for untrusted provider websites
      },
    });

    const approvedOrigin = PROVIDER_REGISTRY[tab.providerId]?.approvedOrigin || 'https://duckduckgo.com';

    // Strict setWindowOpenHandler: deny child popups, route safe URLs to OS browser
    view.webContents.setWindowOpenHandler(({ url }) => {
      console.log(`[BrowserView] Intercepted new-window request from ${tab.id} to: ${url}`);
      safeOpenExternal(url, shell);
      return { action: 'deny' };
    });

    // Main frame navigation guard
    view.webContents.on('will-navigate', (event, targetUrl) => {
      const check = validateUrl(targetUrl);
      if (!check.valid) {
        console.warn(`[BrowserView] Blocked invalid navigation (${check.reason}): ${targetUrl}`);
        event.preventDefault();
        return;
      }

      // If provider has an approved origin and navigation leaves it, route to OS browser
      if (tab.providerId !== 'search' && tab.providerId !== 'custom') {
        if (!isAllowedProviderNavigation(targetUrl, approvedOrigin)) {
          console.log(`[BrowserView] External link clicked in provider view, opening externally: ${targetUrl}`);
          event.preventDefault();
          safeOpenExternal(targetUrl, shell);
        }
      }
    });

    // Scheme redirect guard
    view.webContents.on('will-redirect', (event, targetUrl) => {
      const check = validateUrl(targetUrl);
      if (!check.valid) {
        console.warn(`[BrowserView] Blocked dangerous redirect to: ${targetUrl}`);
        event.preventDefault();
      }
    });

    // Loading & state change listeners
    view.webContents.on('did-start-loading', () => {
      this.stateManager.updateTab(tab.id, { isLoading: true, lastError: null });
      this._notifyRenderer();
    });

    view.webContents.on('did-stop-loading', () => {
      const currentUrl = view.webContents.getURL();
      const currentTitle = view.webContents.getTitle();
      const canGoBack = view.webContents.canGoBack();
      const canGoForward = view.webContents.canGoForward();

      this.stateManager.updateTab(tab.id, {
        isLoading: false,
        url: currentUrl || tab.url,
        title: currentTitle || tab.title,
        canGoBack,
        canGoForward,
      });
      this._notifyRenderer();
    });

    view.webContents.on('page-title-updated', (event, title) => {
      this.stateManager.updateTab(tab.id, { title });
      this._notifyRenderer();
    });

    view.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      if (errorCode === -3) return; // Aborted by user / navigation
      console.warn(`[BrowserView] Failed load on ${tab.id}: ${errorCode} - ${errorDescription} (${validatedURL})`);
      this.stateManager.updateTab(tab.id, {
        isLoading: false,
        lastError: `${errorCode}: ${errorDescription}`,
      });
      this._notifyRenderer();
    });

    // Ticket P4-009: Tab crash isolation
    view.webContents.on('render-process-gone', (event, details) => {
      console.error(`[BrowserView] Render process crashed for tab ${tab.id}:`, details.reason);
      this.stateManager.updateTab(tab.id, {
        crashed: true,
        lastError: `Process crashed: ${details.reason}`,
        isLoading: false,
      });
      this._notifyRenderer();
    });

    // Initial load
    try {
      view.webContents.loadURL(tab.url).catch((err) => {
        console.warn(`[BrowserView] Initial loadURL caught error for tab ${tab.id}:`, err.message);
      });
    } catch (err) {
      console.warn(`[BrowserView] Could not load URL for tab ${tab.id}:`, err.message);
    }

    this.views.set(tab.id, view);
    return view;
  }

  /**
   * Synchronizes WebContentsView visibility and bounds with main window
   */
  updateLayout() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    const state = this.stateManager.getState();
    const effectiveVisible = this.stateManager.isEffectiveVisible();
    const activeTabId = state.activeTabId;
    const bounds = state.bounds;

    for (const [tabId, view] of this.views.entries()) {
      const isThisTabActive = tabId === activeTabId;

      if (effectiveVisible && isThisTabActive && bounds.width > 0 && bounds.height > 0) {
        // Ensure child view is mounted
        if (!this._isViewAttached(view)) {
          this.mainWindow.contentView.addChildView(view);
        }
        view.setBounds({
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        });
        if (typeof view.setVisible === 'function') {
          view.setVisible(true);
        }
      } else {
        // Hide inactive view or hide when modal is active (P4-008)
        if (typeof view.setVisible === 'function') {
          view.setVisible(false);
        } else if (this._isViewAttached(view)) {
          this.mainWindow.contentView.removeChildView(view);
        }
      }
    }
  }

  _isViewAttached(view) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return false;
    const children = this.mainWindow.contentView.children;
    return Array.isArray(children) && children.includes(view);
  }

  _notifyRenderer() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('union-bot:browser-state-updated', this.getState());
    }
  }

  getState() {
    return this.stateManager.getState();
  }

  createTab(providerId, url, title) {
    const tab = this.stateManager.createTab(providerId, url, title);
    this._createViewForTab(tab);
    this.updateLayout();
    this._notifyRenderer();
    return tab;
  }

  closeTab(tabId) {
    const view = this.views.get(tabId);
    if (view) {
      if (this._isViewAttached(view)) {
        this.mainWindow.contentView.removeChildView(view);
      }
      try {
        view.webContents.close();
      } catch {}
      this.views.delete(tabId);
    }

    const res = this.stateManager.closeTab(tabId);
    this.updateLayout();
    this._notifyRenderer();
    return res;
  }

  selectTab(tabId) {
    const success = this.stateManager.selectTab(tabId);
    if (success) {
      this.updateLayout();
      this._notifyRenderer();
    }
    return success;
  }

  async navigate(tabId, inputUrl) {
    const targetTabId = tabId || this.stateManager.getState().activeTabId;
    if (!targetTabId) {
      return { success: false, error: 'No active tab' };
    }

    const resolution = resolveAddressBarInput(inputUrl);
    if (!resolution.valid || !resolution.sanitizedUrl) {
      return { success: false, error: resolution.reason || 'Invalid navigation URL' };
    }

    const view = this.views.get(targetTabId);
    if (!view) {
      return { success: false, error: 'View not found for tab' };
    }

    this.stateManager.updateTab(targetTabId, {
      url: resolution.sanitizedUrl,
      isLoading: true,
      lastError: null,
      crashed: false,
    });
    this._notifyRenderer();

    try {
      await view.webContents.loadURL(resolution.sanitizedUrl);
      return { success: true, sanitizedUrl: resolution.sanitizedUrl };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async performAction(tabId, action) {
    const targetTabId = tabId || this.stateManager.getState().activeTabId;
    if (!targetTabId) {
      return { success: false, error: 'No active tab' };
    }

    const view = this.views.get(targetTabId);
    if (!view) {
      return { success: false, error: 'View not found for tab' };
    }

    try {
      if (action === 'back') {
        if (view.webContents.canGoBack()) view.webContents.goBack();
      } else if (action === 'forward') {
        if (view.webContents.canGoForward()) view.webContents.goForward();
      } else if (action === 'reload') {
        // If tab was crashed, recover it
        const tab = this.stateManager.tabs.get(targetTabId);
        if (tab && tab.crashed) {
          this.stateManager.updateTab(targetTabId, { crashed: false, lastError: null });
        }
        try {
          view.webContents.reload();
        } catch {}
      } else if (action === 'stop') {
        view.webContents.stop();
      } else if (action.startsWith('zoom-')) {
        const newZoom = this.stateManager.applyZoomAction(targetTabId, action);
        view.webContents.setZoomFactor(newZoom);
        this._notifyRenderer();
        return { success: true, zoomFactor: newZoom };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  setBounds(bounds) {
    this.stateManager.setBounds(bounds);
    this.updateLayout();
    return { success: true };
  }

  setVisibility(visible) {
    const effective = this.stateManager.setVisibility(visible);
    this.updateLayout();
    this._notifyRenderer();
    return { success: true, isEffectiveVisible: effective };
  }

  setModalActive(active) {
    const effective = this.stateManager.setModalActive(active);
    this.updateLayout();
    this._notifyRenderer();
    return { success: true, isEffectiveVisible: effective };
  }

  /**
   * Fulfills P4-010: Manual share selection or page summary to group room
   */
  async shareSelection(tabId, selectedText, roomId) {
    const targetTabId = tabId || this.stateManager.getState().activeTabId;
    if (!targetTabId) {
      return { success: false, error: 'No active tab' };
    }

    const tab = this.stateManager.getActiveTab();
    if (!tab) {
      return { success: false, error: 'Active tab state not found' };
    }

    let textToShare = selectedText;
    if (!textToShare) {
      const view = this.views.get(targetTabId);
      if (view) {
        try {
          textToShare = await view.webContents.executeJavaScript('window.getSelection().toString()');
        } catch {}
      }
    }

    const sharePayload = this.stateManager.createSharePayload(
      targetTabId,
      textToShare || `(Shared link to ${tab.title})`,
      roomId || 'orchestration'
    );

    if (!sharePayload) {
      return { success: false, error: 'Could not create share payload' };
    }

    const envelope = {
      id: `share_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      traceId: `trc_share_${Date.now()}`,
      timestamp: Date.now(),
      sender: {
        kind: 'user',
        id: 'user_manual',
        name: 'User (Manual Share)',
        role: 'USER',
        provider: tab.providerId,
      },
      recipient: {
        kind: 'room',
        id: sharePayload.roomId,
      },
      roomId: sharePayload.roomId,
      fidelity: 'L1_FORMATTED_MARKDOWN',
      parts: [
        {
          kind: 'text',
          text: `[Browser Share: ${sharePayload.pageTitle}]\nSource: ${sharePayload.pageUrl}\n\n${sharePayload.selectedText}`,
        },
      ],
    };

    if (this.storageService) {
      try {
        if (typeof this.storageService.insertEnvelope === 'function') {
          await this.storageService.insertEnvelope(envelope);
        } else if (typeof this.storageService.dispatchEnvelope === 'function') {
          await this.storageService.dispatchEnvelope(envelope);
        }
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('union-bot:envelope-received', envelope);
        }
      } catch (err) {
        console.warn('[BrowserService] Error saving shared envelope to storage:', err.message);
      }
    }

    return { success: true, envelope };
  }

  destroy() {
    for (const view of this.views.values()) {
      try {
        if (this._isViewAttached(view)) {
          this.mainWindow.contentView.removeChildView(view);
        }
        view.webContents.close();
      } catch {}
    }
    this.views.clear();
  }
}

module.exports = {
  BrowserService,
};
