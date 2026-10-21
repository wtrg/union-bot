/**
 * @file browser-service.cjs
 * @description Electron Browser Service managing isolated WebContentsView instances for AI Providers
 * Fulfills Phase P4 specification (Master Plan V3 tickets P4-001 to P4-012)
 */

const { WebContentsView, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { safeOpenExternal, validateExternalUrl } = require('./safe-external.js');
const {
  BrowserStateManager,
  PROVIDER_REGISTRY,
  PROVIDER_AUTH_ORIGINS,
  DEFAULT_PROVIDER_ROLES,
  isCostGuardBlockedUrl,
  resolveAddressBarInput,
  validateUrl,
  isAllowedProviderNavigation,
  isAllowedForProvider,
  isPrivateOrLoopbackHost,
  inferAuthStatus,
  detectProviderHealth,
  extractThreadReference,
  ProviderSessionRegistry,
} = require('../../../packages/browser-manager/src/browser-manager.cjs');

class BrowserService {
  constructor(mainWindow, storageService, artifactStore, workspaceRoot) {
    this.mainWindow = mainWindow;
    this.storageService = storageService;
    this.artifactStore = artifactStore;
    this.workspaceRoot = path.resolve(workspaceRoot || process.cwd());
    this.stateManager = new BrowserStateManager();
    this.sessionRegistry = new ProviderSessionRegistry();
    this.views = new Map(); // tabId -> WebContentsView
    this.configuredPartitions = new Set();
    this._testHealthOverrides = new Map();
  }

  /**
   * Initializes the browser service and default provider tabs
   */
  async initialize() {
    const defaultTabs = this.stateManager.initializeDefaultTabs();
    for (const tab of defaultTabs) {
      try {
        this._createViewForTab(tab);
        this.sessionRegistry.createSession({
          providerId: tab.providerId,
          tabId: tab.id,
          partition: tab.partition,
          assignedRole: DEFAULT_PROVIDER_ROLES[tab.providerId] || 'USER',
          authStatus: tab.authStatus,
        });
      } catch (err) {
        console.error(`[BrowserService] Failed to create view for default tab ${tab.id}:`, err.message);
      }
    }

    // Register backend sessions for local agent providers (Codex & Antigravity) to complete 6-AI ecosystem
    this.sessionRegistry.createSession({
      providerId: 'codex',
      tabId: 'local_agent_codex',
      partition: 'local:codex',
      assignedRole: 'QA_SECURITY',
      authStatus: 'READY_OR_LANDING',
    });
    this.sessionRegistry.createSession({
      providerId: 'antigravity',
      tabId: 'local_agent_antigravity',
      partition: 'local:antigravity',
      assignedRole: 'IMPLEMENTER',
      authStatus: 'READY_OR_LANDING',
    });

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
   * Attaches navigation, loading, and anti-TOCTOU generation listeners (U08-R12-01, U08-R14-01).
   * Monotonically increments tab.navigationGeneration on loading, navigation, and in-page navigation.
   */
  attachNavigationListeners(tab, view) {
    if (!view || !view.webContents) return;

    view.webContents.on('did-start-loading', () => {
      view.__latestStructuredMessage = null;
      const currentTab = this.stateManager.tabs.get(tab.id);
      const nextGen = ((currentTab && currentTab.navigationGeneration) || 0) + 1;
      this.stateManager.updateTab(tab.id, {
        isLoading: true,
        lastError: null,
        structuredMessage: null,
        navigationGeneration: nextGen,
      });
      this._notifyRenderer();
    });

    view.webContents.on('did-navigate', (event, url) => {
      view.__latestStructuredMessage = null;
      const currentTab = this.stateManager.tabs.get(tab.id);
      const nextGen = ((currentTab && currentTab.navigationGeneration) || 0) + 1;
      this.stateManager.updateTab(tab.id, {
        structuredMessage: null,
        navigationGeneration: nextGen,
      });
    });

    view.webContents.on('did-navigate-in-page', (event, url, isMainFrame) => {
      if (isMainFrame !== false) {
        view.__latestStructuredMessage = null;
        const currentTab = this.stateManager.tabs.get(tab.id);
        const nextGen = ((currentTab && currentTab.navigationGeneration) || 0) + 1;
        this.stateManager.updateTab(tab.id, {
          url: url || (currentTab && currentTab.url),
          structuredMessage: null,
          navigationGeneration: nextGen,
        });
      }
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
        authStatus: inferAuthStatus(tab.providerId, currentUrl, currentTitle),
        canGoBack,
        canGoForward,
      });
      this._notifyRenderer();
    });

    view.webContents.on('page-title-updated', (event, title) => {
      this.stateManager.updateTab(tab.id, { title });
      this._notifyRenderer();
    });
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
        backgroundThrottling: false,
        // No privileged preload for untrusted provider websites
      },
    });

    // Give inactive room tabs a real viewport so the provider can initialize
    // its composer before the user opens the browser dock.
    view.setBounds({ x: 0, y: 0, width: 1024, height: 768 });

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

    // UB-P4-R02-001 / P4-R03-A01: Protect allowed popup windows with identical navigation and redirect policies
    view.webContents.on('did-create-window', (childWindow) => {
      childWindow.webContents.on('will-navigate', (event, targetUrl) => {
        const navCheck = validateUrl(targetUrl);
        if (!navCheck.valid || !isAllowedForProvider(tab.providerId, targetUrl)) {
          console.warn(`[BrowserPopup] Navigation in child window blocked or cross-boundary: ${targetUrl}`);
          event.preventDefault();
          safeOpenExternal(targetUrl, shell);
        }
      });

      childWindow.webContents.on('will-redirect', (event, targetUrl) => {
        const redirCheck = validateUrl(targetUrl);
        if (!redirCheck.valid || !isAllowedForProvider(tab.providerId, targetUrl)) {
          console.warn(`[BrowserPopup] Redirect in child window blocked or cross-boundary: ${targetUrl}`);
          event.preventDefault();
          safeOpenExternal(targetUrl, shell);
        }
      });
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

    // Loading & state change listeners (clears stale review snapshot on navigation/reload, increments navigationGeneration - U08-R12-01, U08-R14-01)
    this.attachNavigationListeners(tab, view);

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

  runGroupTurn(options) {
    delete require.cache[require.resolve('./services/web-group-turn.cjs')];
    return require('./services/web-group-turn.cjs').runGroupTurn(this, options);
  }

  createTab(providerId, url, title) {
    // UB-P4-R02-003 / P4-R03-A03: If URL is omitted, resolve defaultUrl from PROVIDER_REGISTRY first
    let candidateUrl = url;
    if (!candidateUrl || (typeof candidateUrl === 'string' && candidateUrl.trim().length === 0)) {
      const reg = PROVIDER_REGISTRY[providerId];
      if (reg && reg.defaultUrl) {
        candidateUrl = reg.defaultUrl;
      }
    }

    const check = validateUrl(candidateUrl);
    if (!check.valid) {
      console.warn(`[BrowserService] createTab rejected invalid URL (${check.reason}): ${candidateUrl}`);
      return { success: false, error: check.reason };
    }

    if (providerId !== 'search' && providerId !== 'custom') {
      if (!isAllowedForProvider(providerId, check.sanitizedUrl)) {
        console.warn(`[BrowserService] createTab rejected cross-provider URL: ${candidateUrl}`);
        return {
          success: false,
          error: `Target URL violates provider boundary for '${providerId}': ${candidateUrl}`,
        };
      }
    }

    const tabTitle = title || PROVIDER_REGISTRY[providerId]?.name || 'New Tab';
    const tab = this.stateManager.createTab(providerId, check.sanitizedUrl, tabTitle);
    try {
      this._createViewForTab(tab);
      this.sessionRegistry.createSession({
        providerId: tab.providerId,
        tabId: tab.id,
        partition: tab.partition,
        assignedRole: DEFAULT_PROVIDER_ROLES[tab.providerId] || 'USER',
        authStatus: tab.authStatus,
      });
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
    this.sessionRegistry.removeSessionByTab(tabId);
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

    // UB-P4-R02-001 / P4-R03-A01: Insecure HTTP auth on provider tab is strictly denied fail-closed
    const allowedAuthOrigins = PROVIDER_AUTH_ORIGINS[tab.providerId] || [];
    const targetParsed = new URL(resolution.sanitizedUrl);
    const targetHost = targetParsed.hostname.toLowerCase();
    const isAuthHost = allowedAuthOrigins.some(origin => {
      const oHost = new URL(origin).hostname.toLowerCase();
      return targetHost === oHost || targetHost.endsWith(`.${oHost}`);
    });

    if (isAuthHost && targetParsed.protocol !== 'https:') {
      console.warn(`[BrowserService] Insecure HTTP auth navigation blocked: ${resolution.sanitizedUrl}`);
      return { success: false, error: 'Insecure HTTP authentication is prohibited (UB-P4-R02-001)' };
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
          if (typeof view.webContents.isCrashed === 'function' && view.webContents.isCrashed()) {
            try {
              if (this._isViewAttached(view)) {
                this.mainWindow.contentView.removeChildView(view);
              }
              if (typeof view.webContents.removeAllListeners === 'function') {
                view.webContents.removeAllListeners();
              }
              view.webContents.close();
            } catch {}
            this.views.delete(targetTabId);
            this._createViewForTab(tab);
            this.updateLayout();
          }
          this.stateManager.updateTab(targetTabId, { crashed: false, lastError: null });
        } else {
          try {
            view.webContents.reload();
          } catch {}
        }
        this._notifyRenderer();
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
      if (this._testStorageFaultMode === 'throw') {
        throw new Error('ERR_TEST_INJECTED_STORAGE_FAULT: Simulated SQLite write exception');
      }

      let insertRes = null;
      if (this._testStorageFaultMode === 'return_false') {
        insertRes = { success: false, error: 'ERR_TEST_INJECTED_STORAGE_FAILURE: Simulated SQLite write rejection' };
      } else if (typeof this.storageService.insertEnvelope === 'function') {
        insertRes = await this.storageService.insertEnvelope(envelope);
      } else if (typeof this.storageService.dispatchEnvelope === 'function') {
        insertRes = await this.storageService.dispatchEnvelope(envelope);
      } else {
        return { success: false, error: 'No compatible storage insert method found' };
      }

      // UB-P4-R02-002 / P4-R03-A02: Fail-closed if storage returns explicit { success: false }
      if (insertRes && insertRes.success === false) {
        console.error('[BrowserService] Storage returned failure for shared envelope:', insertRes.error);
        return { success: false, error: `STORAGE_WRITE_FAILED: ${insertRes.error || 'Write rejected'}` };
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

  /**
   * Phase P9: Retrieves backend-authenticated provider session for a tab
   */
  getProviderSession(tabId) {
    const targetTabId = tabId || this.stateManager.getState().activeTabId;
    if (!targetTabId) return null;
    return this.sessionRegistry.getSessionByTab(targetTabId);
  }

  /**
   * Phase P9: Retrieves all registered provider sessions (4 web + 2 local)
   */
  getAllProviderSessions() {
    return this.sessionRegistry.getAllSessions();
  }

  /**
   * Phase P9: Provider Health Monitor (P9-XX5, P9-007)
   * Detects Cloudflare Captcha, Login requirements, Quota exhaustion, Outage
   */
  async checkProviderHealth(tabId) {
    const targetTabId = tabId || this.stateManager.getState().activeTabId;
    if (!targetTabId) {
      return {
        providerId: 'custom',
        tabId: '',
        status: 'SERVICE_UNAVAILABLE',
        errorCode: 'ERR_PROVIDER_SESSION_NOT_FOUND',
        message: 'No active tab for health check',
        checkedAt: Date.now(),
      };
    }

    if (this._testHealthOverrides && this._testHealthOverrides.has(targetTabId)) {
      return this._testHealthOverrides.get(targetTabId);
    }

    const tab = this.stateManager.tabs.get(targetTabId);
    if (!tab) {
      return {
        providerId: 'custom',
        tabId: targetTabId,
        status: 'SERVICE_UNAVAILABLE',
        errorCode: 'ERR_PROVIDER_SESSION_NOT_FOUND',
        message: 'Tab not found',
        checkedAt: Date.now(),
      };
    }

    const view = this.views.get(targetTabId);
    let title = tab.title;
    let url = tab.url;
    let bodySnippet = '';

    if (view && !view.webContents.isDestroyed()) {
      try {
        title = view.webContents.getTitle() || title;
        url = view.webContents.getURL() || url;
        if (!view.webContents.isLoading()) {
          const jsPromise = view.webContents.executeJavaScript('document.body ? document.body.innerText.slice(0, 500) : ""');
          const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(''), 500));
          bodySnippet = await Promise.race([jsPromise, timeoutPromise]).catch(() => '');
        }
      } catch {}
    }

    const report = detectProviderHealth({
      providerId: tab.providerId,
      tabId: targetTabId,
      url,
      title,
      bodySnippet,
    });

    if (report.status === 'CHALLENGE_REQUIRED') {
      this.stateManager.updateTab(targetTabId, { authStatus: 'CHALLENGE_REQUIRED', lastError: report.message });
      this._notifyRenderer();
    } else if (report.status === 'LOGIN_REQUIRED') {
      this.stateManager.updateTab(targetTabId, { authStatus: 'LOGIN_REQUIRED' });
      this._notifyRenderer();
    } else if (report.status === 'QUOTA_EXCEEDED' || report.status === 'SERVICE_UNAVAILABLE') {
      this.stateManager.updateTab(targetTabId, { lastError: report.message });
      this._notifyRenderer();
    }

    return report;
  }

  /**
   * Phase P9: Captures native thread reference from provider page (P9-XX4)
   */
  captureThreadReference(tabId) {
    const targetTabId = tabId || this.stateManager.getState().activeTabId;
    if (!targetTabId) {
      return { providerId: 'custom', threadId: null, canonicalUrl: null, isReopenable: false };
    }
    const tab = this.stateManager.tabs.get(targetTabId);
    if (!tab) {
      return { providerId: 'custom', threadId: null, canonicalUrl: null, isReopenable: false };
    }
    const ref = extractThreadReference(tab.providerId, tab.url);
    const session = this.sessionRegistry.getSessionByTab(targetTabId);
    if (session && ref.threadId) {
      this.sessionRegistry.updateSession(session.sessionId, {
        threadId: ref.threadId,
        threadUrl: ref.canonicalUrl,
        isReopenable: ref.isReopenable,
      });
    }
    return ref;
  }

  /**
   * Phase P4 / UB-V4-U08: Returns authoritative runtime tab context for review inspection (U08-R10-01, U08-R11-01)
   */
  getTabContext(tabId) {
    const targetTabId = tabId || this.stateManager.getState().activeTabId;
    if (!targetTabId) return null;
    const tab = this.stateManager.tabs.get(targetTabId);
    const view = this.views.get(targetTabId);
    if (!tab && !view) return null;
    const currentUrl = view && !view.webContents.isDestroyed() ? view.webContents.getURL() : (tab ? tab.url : '');
    const currentTitle = view && !view.webContents.isDestroyed() ? view.webContents.getTitle() : (tab ? tab.title : '');
    const threadRef = this.captureThreadReference(targetTabId);
    const conversationId = (threadRef && threadRef.threadId) || (currentUrl && currentUrl.includes('/c/') ? currentUrl.split('/c/')[1].split(/[?#]/)[0] : null);

    // Proven structured assistant message captured from WebContents (U08-R11-01)
    const structuredMessage = (tab && tab.structuredMessage) || (view && view.__latestStructuredMessage) || null;

    return {
      tabId: targetTabId,
      url: currentUrl,
      title: currentTitle,
      providerId: tab ? tab.providerId : 'custom',
      conversationId,
      structuredMessage,
      isSynthetic: false,
      capturedAt: Date.now(),
    };
  }

  /**
   * Phase P4 / UB-V4-U08: Extracts structured reviewer assistant message directly from WebContents DOM (U08-R11-01, U08-R13-03, U08-R14-01)
   * Enforces Anti-TOCTOU consistency checks on WebContents ID, URL, conversationId and navigation generation.
   */
  async extractReviewMessageFromWebContents(tabId) {
    const targetTabId = tabId || this.stateManager.getState().activeTabId;
    if (!targetTabId) return null;
    const view = this.views.get(targetTabId);
    const preTab = this.stateManager.tabs.get(targetTabId);
    if (!view || view.webContents.isDestroyed() || !preTab) return null;

    // 1. Capture pre-extraction invariants (U08-R13-03, U08-R14-01)
    const preWebContentsId = view.webContents.id;
    const preUrl = view.webContents.getURL();
    const preNavGen = preTab.navigationGeneration || 0;
    const preThreadRef = this.captureThreadReference(targetTabId);
    const preConvId = (preThreadRef && preThreadRef.threadId) || (preUrl.includes('/c/') ? preUrl.split('/c/')[1].split(/[?#]/)[0] : null);

    // Initial URL must be a trusted reviewer URL
    if (!preUrl.startsWith('https://chatgpt.com/c/')) {
      return null;
    }

    try {
      const extracted = await view.webContents.executeJavaScript(`
        (() => {
          const articles = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
          if (articles.length === 0) return null;
          const latest = articles[articles.length - 1];
          const rawId = latest.getAttribute('data-message-id') || latest.id;
          const text = latest.innerText || '';
          if (!text) return null;
          return {
            role: 'assistant',
            messageId: rawId,
            text: text
          };
        })()
      `);

      // 2. Post-extraction invariants & Anti-TOCTOU consistency checks (U08-R13-03, U08-R14-01)
      if (view.webContents.isDestroyed()) return null;
      if (view.webContents.id !== preWebContentsId) return null; // WebContents changed
      const postUrl = view.webContents.getURL();
      if (postUrl !== preUrl) return null; // URL changed during async execution

      // Re-read current tab from stateManager (guarantees reading fresh generation even after updateTab replacement - U08-R14-01)
      const postTab = this.stateManager.tabs.get(targetTabId);
      if (!postTab) return null;
      const postNavGen = postTab.navigationGeneration || 0;
      if (postNavGen !== preNavGen) return null; // Navigation or reload occurred during async execution

      const postThreadRef = this.captureThreadReference(targetTabId);
      const postConvId = (postThreadRef && postThreadRef.threadId) || (postUrl.includes('/c/') ? postUrl.split('/c/')[1].split(/[?#]/)[0] : null);
      if (postConvId !== preConvId || !postConvId) return null; // Conversation changed

      if (extracted && extracted.role === 'assistant' && extracted.messageId && extracted.text) {
        const fullMsg = {
          role: 'assistant',
          messageId: extracted.messageId,
          conversationId: postConvId,
          text: extracted.text,
          capturedAt: Date.now(),
        };
        view.__latestStructuredMessage = fullMsg;
        this.stateManager.updateTab(targetTabId, { structuredMessage: fullMsg });
        return fullMsg;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Phase P9: Provenance-tracked manual & assisted text sharing (P9-XX2)
   */
  async shareTextWithProvenance(tabId, text, options = {}) {
    const targetTabId = tabId || this.stateManager.getState().activeTabId;
    if (!targetTabId) {
      return { success: false, error: 'No target tab specified or active', code: 'ERR_UNAUTHORIZED_ACTION' };
    }

    const tab = this.stateManager.tabs.get(targetTabId);
    if (!tab) {
      return { success: false, error: 'Target tab state not found', code: 'ERR_PROVIDER_SESSION_NOT_FOUND' };
    }

    const session = this.sessionRegistry.getSessionByTab(targetTabId);
    if (!session) {
      return { success: false, error: 'Backend session not found for tab', code: 'ERR_PROVIDER_SESSION_NOT_FOUND' };
    }

    let textToShare = text;
    if (!textToShare) {
      const view = this.views.get(targetTabId);
      if (view) {
        try {
          textToShare = await view.webContents.executeJavaScript('window.getSelection().toString()');
        } catch {}
      }
    }

    if (!textToShare) {
      textToShare = `(Shared reference to ${tab.title})`;
    }

    const threadRef = extractThreadReference(tab.providerId, tab.url);
    if (threadRef.threadId) {
      session.threadId = threadRef.threadId;
      session.threadUrl = threadRef.canonicalUrl;
      session.isReopenable = true;
    }

    const roomId = options.roomId || 'orchestration';
    const parts = [
      {
        kind: 'text',
        text: `[Provider Share: ${tab.title}]\nSource: ${tab.url}\nRole: ${session.assignedRole}\n\n${textToShare}`,
      },
    ];

    if (threadRef.canonicalUrl) {
      parts.push({
        kind: 'reference',
        url: threadRef.canonicalUrl,
        providerId: tab.providerId,
        threadId: threadRef.threadId || undefined,
        pageTitle: tab.title,
        isReopenable: threadRef.isReopenable,
      });
    }

    const envelope = {
      schemaVersion: '1.0.0',
      id: `share_txt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      traceId: `trc_share_${Date.now()}`,
      timestamp: Date.now(),
      sender: {
        kind: 'agent',
        id: session.sessionId,
        name: `${tab.title} (${session.assignedRole})`,
        role: session.assignedRole,
        provider: tab.providerId,
        providerIdentity: {
          provider: tab.providerId,
          profileId: session.sessionId,
          sessionId: session.sessionId,
          partitionKey: tab.partition,
          capabilityVersion: '1.0.0',
          authStatus: session.authStatus === 'AUTHENTICATED' ? 'AUTHENTICATED' : 'NOT_VERIFIED',
          evidenceProvenance: 'LIVE_WEB',
        },
      },
      recipient: {
        kind: 'room',
        id: roomId,
      },
      roomId,
      fidelity: 'L1_FORMATTED_MARKDOWN',
      status: 'acknowledged',
      parts,
      metadata: {
        sourceTabId: tab.id,
        sourceUrl: tab.url,
        threadId: threadRef.threadId,
        providerSessionId: session.sessionId,
      },
    };

    if (this.storageService) {
      try {
        if (typeof this.storageService.insertEnvelope === 'function') {
          await this.storageService.insertEnvelope(envelope);
        } else if (typeof this.storageService.dispatchEnvelope === 'function') {
          await this.storageService.dispatchEnvelope(envelope);
        }
      } catch (err) {
        return { success: false, error: `STORAGE_WRITE_FAILED: ${err.message}`, code: 'ERR_STORAGE_CORRUPTION' };
      }
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('union-bot:envelope-received', envelope);
    }

    return {
      success: true,
      envelope,
      threadReference: threadRef,
      session,
    };
  }

  /**
   * Phase P9: Legitimate File & Image Artifact Sharing with Canonical Boundary Containment (P9-XX3)
   */
  async shareFileWithProvenance(tabId, filePath, options = {}) {
    const targetTabId = tabId || this.stateManager.getState().activeTabId;
    if (!targetTabId) {
      return { success: false, error: 'No target tab specified or active', code: 'ERR_UNAUTHORIZED_ACTION' };
    }

    const tab = this.stateManager.tabs.get(targetTabId);
    if (!tab) {
      return { success: false, error: 'Target tab state not found', code: 'ERR_PROVIDER_SESSION_NOT_FOUND' };
    }

    const session = this.sessionRegistry.getSessionByTab(targetTabId);
    if (!session) {
      return { success: false, error: 'Backend session not found for tab', code: 'ERR_PROVIDER_SESSION_NOT_FOUND' };
    }

    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'File path must be a non-empty string', code: 'ERR_SCHEMA_VALIDATION_FAILED' };
    }

    // Canonical Workspace Boundary Containment Check
    let realFilePath;
    try {
      realFilePath = fs.realpathSync(path.resolve(this.workspaceRoot, filePath));
    } catch (err) {
      return { success: false, error: `File not found or unresolvable: ${err.message}`, code: 'ERR_PATH_TRAVERSAL_DENIED' };
    }

    const canonicalWorkspace = fs.realpathSync(this.workspaceRoot);
    const relative = path.relative(canonicalWorkspace, realFilePath);
    const isEscaping = relative.startsWith('..') || path.isAbsolute(relative);

    if (isEscaping) {
      return {
        success: false,
        error: `ERR_PATH_TRAVERSAL_DENIED: Target file '${filePath}' resolves outside canonical workspace boundary.`,
        code: 'ERR_PATH_TRAVERSAL_DENIED',
      };
    }

    // File Stat & Size Check (Max 100MiB boundary)
    let stats;
    try {
      stats = fs.statSync(realFilePath);
    } catch (err) {
      return { success: false, error: `Could not stat file: ${err.message}`, code: 'ERR_SCHEMA_VALIDATION_FAILED' };
    }

    if (stats.isDirectory()) {
      return { success: false, error: 'Directories cannot be shared as file artifacts', code: 'ERR_SCHEMA_VALIDATION_FAILED' };
    }

    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MiB
    if (stats.size > MAX_FILE_SIZE) {
      return {
        success: false,
        error: `ERR_INVALID_FILE_SIZE: File size (${stats.size} bytes) exceeds 100MiB maximum allowable boundary.`,
        code: 'ERR_INVALID_FILE_SIZE',
      };
    }

    // MIME type check
    const ext = path.extname(realFilePath).toLowerCase();
    const DISALLOWED_EXECUTABLE_EXTS = new Set(['.exe', '.dll', '.bat', '.cmd', '.vbs', '.msi', '.com', '.scr', '.pif']);
    if (DISALLOWED_EXECUTABLE_EXTS.has(ext)) {
      return {
        success: false,
        error: `ERR_INVALID_MIME_TYPE: Executable binary or script extension '${ext}' is prohibited from provider artifact exchange.`,
        code: 'ERR_INVALID_MIME_TYPE',
      };
    }

    const MIME_MAP = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.json': 'application/json',
      '.csv': 'text/csv',
      '.ts': 'text/plain',
      '.js': 'text/javascript',
      '.py': 'text/x-python',
    };
    const mimeType = options.mimeType || MIME_MAP[ext] || 'application/octet-stream';

    // Compute SHA256 digest
    const fileBytes = fs.readFileSync(realFilePath);
    const sha256 = crypto.createHash('sha256').update(fileBytes).digest('hex');
    const filename = path.basename(realFilePath);

    // Store in ArtifactStore if available
    let artifactId = sha256;
    if (this.artifactStore && typeof this.artifactStore.storeBytes === 'function') {
      try {
        const stored = this.artifactStore.storeBytes(fileBytes, filename, { mimeType });
        artifactId = stored.sha256;
      } catch (err) {
        console.warn('[BrowserService] ArtifactStore warning:', err.message);
      }
    }

    const roomId = options.roomId || 'orchestration';
    const envelope = {
      schemaVersion: '1.0.0',
      id: `share_file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      traceId: `trc_share_${Date.now()}`,
      timestamp: Date.now(),
      sender: {
        kind: 'agent',
        id: session.sessionId,
        name: `${tab.title} (${session.assignedRole})`,
        role: session.assignedRole,
        provider: tab.providerId,
        providerIdentity: {
          provider: tab.providerId,
          profileId: session.sessionId,
          sessionId: session.sessionId,
          partitionKey: tab.partition,
          capabilityVersion: '1.0.0',
          authStatus: session.authStatus === 'AUTHENTICATED' ? 'AUTHENTICATED' : 'NOT_VERIFIED',
          evidenceProvenance: 'LIVE_WEB',
        },
      },
      recipient: {
        kind: 'room',
        id: roomId,
      },
      roomId,
      fidelity: 'L2_STANDALONE_ARTIFACT',
      status: 'acknowledged',
      parts: [
        {
          kind: 'artifact',
          sha256,
          mimeType,
          filename,
          sizeBytes: stats.size,
          contentFidelity: 'original_bytes',
          provenance: 'LIVE_WEB',
          transferStatus: 'VERIFIED_TRANSFERRED',
        },
      ],
      metadata: {
        sourceTabId: tab.id,
        sourceUrl: tab.url,
        providerSessionId: session.sessionId,
      },
    };

    if (this.storageService) {
      try {
        if (typeof this.storageService.insertEnvelope === 'function') {
          await this.storageService.insertEnvelope(envelope);
        } else if (typeof this.storageService.dispatchEnvelope === 'function') {
          await this.storageService.dispatchEnvelope(envelope);
        }
      } catch (err) {
        return { success: false, error: `STORAGE_WRITE_FAILED: ${err.message}`, code: 'ERR_STORAGE_CORRUPTION' };
      }
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('union-bot:envelope-received', envelope);
    }

    return {
      success: true,
      sha256,
      sizeBytes: stats.size,
      mimeType,
      filename,
      envelope,
    };
  }

  /**
   * Test injection helper for E2E harness
   */
  setTestHealthOverride(tabId, report) {
    if (!this._testHealthOverrides) this._testHealthOverrides = new Map();
    if (report === null) {
      this._testHealthOverrides.delete(tabId);
    } else {
      this._testHealthOverrides.set(tabId, report);
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
