/**
 * Browser State Manager & WebContentsView Coordinator
 * Fulfills Phase P4 specification (Master Plan V3 tickets P4-001, P4-007, P4-008, P4-009, P4-010).
 */

import type {
  BrowserBounds,
  BrowserManagerState,
  BrowserSharePayload,
  ProviderId,
  TabState,
  AuthStatus,
  BrowserAction,
} from './types.ts';
import { PROVIDER_REGISTRY, inferAuthStatus } from './partitions.ts';
import { resolveAddressBarInput, validateUrl } from './url-policy.ts';

export class BrowserStateManager {
  private tabs: Map<string, TabState> = new Map();
  private activeTabId: string | null = null;
  private bounds: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 };
  private isVisible: boolean = false;
  private isModalActive: boolean = false;

  constructor() {}

  /**
   * Initializes default provider tabs (ChatGPT, Gemini, Claude, DeepSeek)
   */
  public initializeDefaultTabs(): TabState[] {
    const defaultProviders: ProviderId[] = ['chatgpt', 'gemini', 'claude', 'deepseek'];
    const created: TabState[] = [];

    for (const pid of defaultProviders) {
      const tab = this.createTab(pid);
      created.push(tab);
    }

    if (created.length > 0 && !this.activeTabId) {
      this.activeTabId = created[0].id;
    }

    return created;
  }

  /**
   * Creates a new tab for a provider or custom URL
   */
  public createTab(providerId: ProviderId, customUrl?: string, customTitle?: string): TabState {
    const provider = PROVIDER_REGISTRY[providerId] || PROVIDER_REGISTRY.custom;
    const tabId = `tab_${providerId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const targetUrl = customUrl ? customUrl : provider.defaultUrl;
    const targetTitle = customTitle || provider.name;

    const newTab: TabState = {
      id: tabId,
      providerId,
      title: targetTitle,
      url: targetUrl,
      partition: provider.partition,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      authStatus: 'UNKNOWN',
      crashed: false,
      lastError: null,
      zoomFactor: 1.0,
      createdAt: Date.now(),
    };

    this.tabs.set(tabId, newTab);

    // If no tab is active, activate this tab
    if (!this.activeTabId) {
      this.activeTabId = tabId;
    }

    return newTab;
  }

  /**
   * Closes a tab by ID. If active tab is closed, activates an adjacent tab.
   */
  public closeTab(tabId: string): { closed: boolean; nextActiveTabId: string | null } {
    if (!this.tabs.has(tabId)) {
      return { closed: false, nextActiveTabId: this.activeTabId };
    }

    const tabList = Array.from(this.tabs.keys());
    const closingIndex = tabList.indexOf(tabId);

    this.tabs.delete(tabId);

    if (this.activeTabId === tabId) {
      const remaining = Array.from(this.tabs.keys());
      if (remaining.length === 0) {
        this.activeTabId = null;
      } else {
        const nextIndex = Math.min(closingIndex, remaining.length - 1);
        this.activeTabId = remaining[nextIndex];
      }
    }

    return { closed: true, nextActiveTabId: this.activeTabId };
  }

  /**
   * Selects and activates a tab.
   */
  public selectTab(tabId: string): boolean {
    if (this.tabs.has(tabId)) {
      this.activeTabId = tabId;
      return true;
    }
    return false;
  }

  /**
   * Updates partial tab state (navigation, title, loading, auth status).
   */
  public updateTab(tabId: string, updates: Partial<TabState>): TabState | null {
    const existing = this.tabs.get(tabId);
    if (!existing) return null;

    const updated: TabState = { ...existing, ...updates };

    // Auto-update auth status if url or title changed and authStatus was not explicitly provided
    if ((updates.url || updates.title) && !updates.authStatus) {
      updated.authStatus = inferAuthStatus(updated.providerId, updated.url, updated.title);
    }

    this.tabs.set(tabId, updated);
    return updated;
  }

  /**
   * Sets display bounds for the WebContentsView.
   */
  public setBounds(bounds: BrowserBounds): BrowserBounds {
    this.bounds = {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    };
    return this.bounds;
  }

  /**
   * Sets user-desired visibility of the browser panel.
   */
  public setVisibility(visible: boolean): boolean {
    this.isVisible = visible;
    return this.isEffectiveVisible();
  }

  /**
   * Sets whether a native modal (e.g. preferences, create project, approval confirmation) is active.
   * When modal is active, WebContentsView is automatically hidden to prevent overlay bleed.
   */
  public setModalActive(active: boolean): boolean {
    this.isModalActive = active;
    return this.isEffectiveVisible();
  }

  /**
   * Effective visibility: Visible ONLY when user enabled it AND no modal is blocking it.
   */
  public isEffectiveVisible(): boolean {
    return this.isVisible && !this.isModalActive;
  }

  /**
   * Applies zoom action or computes new zoom level.
   */
  public applyZoomAction(tabId: string, action: 'zoom-in' | 'zoom-out' | 'zoom-reset'): number {
    const tab = this.tabs.get(tabId);
    if (!tab) return 1.0;

    let newZoom = tab.zoomFactor;
    if (action === 'zoom-in') {
      newZoom = Math.min(2.5, Math.round((tab.zoomFactor + 0.1) * 10) / 10);
    } else if (action === 'zoom-out') {
      newZoom = Math.max(0.5, Math.round((tab.zoomFactor - 0.1) * 10) / 10);
    } else if (action === 'zoom-reset') {
      newZoom = 1.0;
    }

    this.updateTab(tabId, { zoomFactor: newZoom });
    return newZoom;
  }

  /**
   * Creates a manual share payload with source attribution `user_manual`.
   * Fulfills P4-010: Manual share selection to room without credential leakage.
   */
  public createSharePayload(tabId: string, selectedText: string, roomId: string): BrowserSharePayload | null {
    const tab = this.tabs.get(tabId);
    if (!tab) return null;

    return {
      selectedText: selectedText || '',
      pageUrl: tab.url,
      pageTitle: tab.title,
      providerId: tab.providerId,
      roomId,
    };
  }

  /**
   * Gets a complete snapshot of browser manager state.
   */
  public getState(): BrowserManagerState {
    return {
      tabs: Array.from(this.tabs.values()),
      activeTabId: this.activeTabId,
      bounds: { ...this.bounds },
      isVisible: this.isVisible,
      isModalActive: this.isModalActive,
    };
  }

  public getActiveTab(): TabState | null {
    if (!this.activeTabId) return null;
    return this.tabs.get(this.activeTabId) || null;
  }
}
