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
  PROVIDER_AUTH_ORIGINS,
  isCostGuardBlockedUrl,
  resolveAddressBarInput,
  validateUrl,
  isAllowedProviderNavigation,
  isAllowedForProvider,
  isPrivateOrLoopbackHost,
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
      try {
        this._createViewForTab(tab);
      } catch (err) {
        console.error(`[BrowserService] Failed to create view for default tab ${tab.id}:`, err.message);
      }
    }
    this.updateLayout();
  }

  /**
   * Configures security, permissions, and cost guard filter for a partition (Fail-closed)
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

      // Ticket P4-003 & P4-R02-T03: Egress & Private/Loopback Interception Filter
      partSession.webRequest.onBeforeRequest((details, callback) => {
        // Block private or loopback requests from renderer
        try {
          const parsed = new URL(details.url);
          if (isPrivateOrLoopbackHost(parsed.hostname)) {
            console.warn(`[BrowserSession] Blocked loopback/private request in ${partitionName}: ${details.url}`);
            callback({ cancel: true });
            return;
          }
        } catch {}

        if (isCostGuardBlockedUrl(details.url)) {
          console.warn(`[CostGuard-Session] Blocked paid API egress in ${partitionName}: ${details.url}`);
          callback({ cancel: true });
          return;
        }
        callback({ cancel: false });
      });

      this.configuredPartitions.add(partitionName);
    } catch (err) {
      console.error(`[BrowserSession] Fail-closed: security configuration failed for partition ${partitionName}:`, err.message);
      throw new Error(`SECURITY_INIT_FAILED: ${err.message}`);
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

    // P4-R02-T01: Pre-validate tab URL
    const check = validateUrl(tab.url);
    if (!check.valid) {
      throw new Error(`INVALID_TAB_URL: ${check.reason}`);
    }

    // P4-R02-T02: Enforce provider boundary on initial URL
    if (tab.providerId !== 'search' && tab.providerId !== 'custom') {
      if (!isAllowedForProvider(tab.providerId, tab.url)) {
        throw new Error(`PROVIDER_ORIGIN_VIOLATION: Initial URL '${tab.url}' is not allowed for provider '${tab.providerId}'`);
      }
    }

    // P4-R02-T03: Partition security setup must succeed or fail-closed
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

    // UB-P4-R01-002: setWindowOpenHandler
    // Allows OAuth/auth popups in same partition session, denies/routes external links to OS browser safely
    view.webContents.setWindowOpenHandler(({ url }) => {
      const urlCheck = validateUrl(url);
      if (!urlCheck.valid) {
        console.warn(`[BrowserView] Blocked dangerous window.open request from ${tab.id}: ${url}`);
        return { action: 'deny' };
      }

      if (isAllowedForProvider(tab.providerId, url)) {
        console.log(`[BrowserView] Allowed auth/provider popup in partition ${tab.partition}: ${url}`);
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            parent: this.mainWindow,
            modal: false,
            autoHideMenuBar: true,
            webPreferences: {
              session: partSession,
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
            },
          },
        };
      }

      console.log(`[BrowserView] Routing external popup link from ${tab.id} to OS browser: ${url}`);
      safeOpenExternal(url, shell);
      return { action: 'deny' };
    });

    // Main frame navigation guard (P4-R02-T02)
    view.webContents.on('will-navigate', (event, targetUrl) => {
      const navCheck = validateUrl(targetUrl);
      if (!navCheck.valid) {
        console.warn(`[BrowserView] Blocked invalid navigation (${navCheck.reason}): ${targetUrl}`);
        event.preventDefault();
        return;
      }

      if (tab.providerId !== 'search' && tab.providerId !== 'custom') {
        if (!isAllowedForProvider(tab.providerId, targetUrl)) {
          console.log(`[BrowserView] Navigation left provider boundary, opening externally: ${targetUrl}`);
          event.preventDefault();
          safeOpenExternal(targetUrl, shell);
        }
      }
    });

    // Scheme redirect guard (P4-R02-T02)
    view.webContents.on('will-redirect', (event, targetUrl) => {
      const redirCheck = validateUrl(targetUrl);
      if (!redirCheck.valid) {
        console.warn(`[BrowserView] Blocked dangerous redirect to: ${targetUrl}`);
        event.preventDefault();
        return;
      }

      if (tab.providerId !== 'search' && tab.providerId !== 'custom') {
        if (!isAllowedForProvider(tab.providerId, targetUrl)) {
          console.warn(`[BrowserView] Redirect left provider boundary, opening externally: ${targetUrl}`);
          event.preventDefault();
          safeOpenExternal(targetUrl, shell);
        }
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
    const check = validateUrl(url);
    if (!check.valid) {
      console.warn(`[BrowserService] createTab rejected invalid URL (${check.reason}): ${url}`);
      return { success: false, error: check.reason };
    }

    if (providerId !== 'search' && providerId !== 'custom') {
      if (!isAllowedForProvider(providerId, check.sanitizedUrl)) {
        console.warn(`[BrowserService] createTab rejected cross-provider URL: ${url}`);
        return {
          success: false,
          error: `Target URL violates provider boundary for '${providerId}': ${url}`,
        };
      }
    }

    const tab = this.stateManager.createTab(providerId, check.sanitizedUrl, title);
    try {
      this._createViewForTab(tab);
    } catch (err) {
      console.error(`[BrowserService] Failed to create view for tab ${tab.id}:`, err.message);
      this.stateManager.closeTab(tab.id);
      return { success: false, error: err.message };
    }

    this.updateLayout();
    this._notifyRenderer();
    return { success: true, tab };
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

    const tab = this.stateManager.tabs.get(targetTabId);
    if (!tab) {
      return { success: false, error: 'Tab not found' };
    }

    const resolution = resolveAddressBarInput(inputUrl);
    if (!resolution.valid || !resolution.sanitizedUrl) {
      return { success: false, error: resolution.reason || 'Invalid navigation URL' };
    }

    // P4-R02-T02: Enforce provider boundary in navigate
    if (tab.providerId !== 'search' && tab.providerId !== 'custom') {
      if (!isAllowedForProvider(tab.providerId, resolution.sanitizedUrl)) {
        // Route outside target to dedicated search partition tab to preserve provider isolation
        let searchTab = Array.from(this.stateManager.tabs.values()).find(t => t.providerId === 'search');
        if (!searchTab) {
          const createRes = this.createTab('search', resolution.sanitizedUrl, 'Search');
          searchTab = createRes.tab;
        } else {
          this.stateManager.updateTab(searchTab.id, { url: resolution.sanitizedUrl });
          const searchView = this.views.get(searchTab.id);
          if (searchView) {
            searchView.webContents.loadURL(resolution.sanitizedUrl).catch(() => {});
          }
        }
        if (searchTab) {
          this.selectTab(searchTab.id);
        }
        return {
          success: true,
          sanitizedUrl: resolution.sanitizedUrl,
          routedToSearchTab: true,
          partitionIsolated: true,
          tabId: searchTab?.id,
        };
      }
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
   * Fulfills P4-010 & UB-P4-R01-003: Manual share selection or page summary to group room
   * Provenance strictly derived from target tab; fail-closed on storage failure.
   */
  async shareSelection(tabId, selectedText, roomId) {
    const targetTabId = tabId || this.stateManager.getState().activeTabId;
    if (!targetTabId) {
      return { success: false, error: 'No target tab specified or active' };
    }

    const tab = this.stateManager.tabs.get(targetTabId);
    if (!tab) {
      return { success: false, error: 'Target tab state not found' };
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

    if (!this.storageService) {
      return { success: false, error: 'Storage service unavailable' };
    }

    try {
      if (typeof this.storageService.insertEnvelope === 'function') {
        await this.storageService.insertEnvelope(envelope);
      } else if (typeof this.storageService.dispatchEnvelope === 'function') {
        await this.storageService.dispatchEnvelope(envelope);
      } else {
        return { success: false, error: 'No compatible storage insert method found' };
      }

      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('union-bot:envelope-received', envelope);
      }

      return { success: true, envelope };
    } catch (err) {
      console.error('[BrowserService] Fail-closed: Error saving shared envelope to storage:', err.message);
      return { success: false, error: `STORAGE_WRITE_FAILED: ${err.message}` };
    }
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
