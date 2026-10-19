import React, { useState, useEffect, useRef } from 'react';
import { BrowserTabInfo, BrowserManagerState } from '../types.ts';

interface BrowserPanelProps {
  isOpen: boolean;
  onClose: () => void;
  activeRoomId: string;
}

export const BrowserPanel: React.FC<BrowserPanelProps> = ({ isOpen, onClose, activeRoomId }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [browserState, setBrowserState] = useState<BrowserManagerState>({
    tabs: [],
    activeTabId: null,
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    isVisible: isOpen,
    isModalActive: false,
  });
  const [addressInput, setAddressInput] = useState<string>('');
  const [shareSuccess, setShareSuccess] = useState<boolean>(false);

  // Synchronize open state with Electron main
  useEffect(() => {
    if (window.unionBotAPI && typeof window.unionBotAPI.browserSetVisibility === 'function') {
      window.unionBotAPI.browserSetVisibility(isOpen);
    }
  }, [isOpen]);

  // Initial fetch and listener for browser state updates
  useEffect(() => {
    if (!window.unionBotAPI) {
      // Demo / Browser preview fallback tabs
      const demoTabs: BrowserTabInfo[] = [
        {
          id: 'demo_chatgpt',
          providerId: 'chatgpt',
          title: 'ChatGPT Web',
          url: 'https://chatgpt.com/',
          partition: 'persist:mcb-web-chatgpt',
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          authStatus: 'READY_OR_LANDING',
          crashed: false,
          lastError: null,
          zoomFactor: 1.0,
        },
        {
          id: 'demo_gemini',
          providerId: 'gemini',
          title: 'Google Gemini',
          url: 'https://gemini.google.com/app',
          partition: 'persist:mcb-web-gemini',
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          authStatus: 'READY_OR_LANDING',
          crashed: false,
          lastError: null,
          zoomFactor: 1.0,
        },
        {
          id: 'demo_claude',
          providerId: 'claude',
          title: 'Claude Web',
          url: 'https://claude.ai/',
          partition: 'persist:mcb-web-claude',
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          authStatus: 'LOGIN_REQUIRED',
          crashed: false,
          lastError: null,
          zoomFactor: 1.0,
        },
        {
          id: 'demo_deepseek',
          providerId: 'deepseek',
          title: 'DeepSeek Web',
          url: 'https://chat.deepseek.com/',
          partition: 'persist:mcb-web-deepseek',
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          authStatus: 'LOGIN_REQUIRED',
          crashed: false,
          lastError: null,
          zoomFactor: 1.0,
        },
      ];
      setBrowserState({
        tabs: demoTabs,
        activeTabId: demoTabs[0].id,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        isVisible: isOpen,
        isModalActive: false,
      });
      setAddressInput(demoTabs[0].url);
      return;
    }

    if (typeof window.unionBotAPI.browserGetState === 'function') {
      window.unionBotAPI.browserGetState().then((st) => {
        if (st && Array.isArray(st.tabs)) {
          setBrowserState(st);
          const act = st.tabs.find((t) => t.id === st.activeTabId);
          if (act) setAddressInput(act.url);
        }
      });
    }

    if (typeof window.unionBotAPI.onBrowserStateUpdated === 'function') {
      const unsub = window.unionBotAPI.onBrowserStateUpdated((st) => {
        if (st && Array.isArray(st.tabs)) {
          setBrowserState(st);
          const act = st.tabs.find((t) => t.id === st.activeTabId);
          if (act) setAddressInput(act.url);
        }
      });
      return unsub;
    }
  }, []);

  // Update bounds to Electron main whenever panel is resized or visible
  const updateBounds = () => {
    if (!isOpen || !mountRef.current || !window.unionBotAPI || typeof window.unionBotAPI.browserSetBounds !== 'function') {
      return;
    }
    const rect = mountRef.current.getBoundingClientRect();
    window.unionBotAPI.browserSetBounds({
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  };

  useEffect(() => {
    if (isOpen) {
      updateBounds();
      const ro = new ResizeObserver(() => updateBounds());
      if (mountRef.current) ro.observe(mountRef.current);
      window.addEventListener('resize', updateBounds);
      return () => {
        ro.disconnect();
        window.removeEventListener('resize', updateBounds);
      };
    }
  }, [isOpen]);

  const activeTab = browserState.tabs.find((t) => t.id === browserState.activeTabId) || browserState.tabs[0];

  const handleSelectTab = (tabId: string) => {
    if (window.unionBotAPI && typeof window.unionBotAPI.browserSelectTab === 'function') {
      window.unionBotAPI.browserSelectTab(tabId);
    } else {
      setBrowserState((prev) => ({ ...prev, activeTabId: tabId }));
      const t = browserState.tabs.find((tab) => tab.id === tabId);
      if (t) setAddressInput(t.url);
    }
  };

  const handleCloseTab = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    if (window.unionBotAPI && typeof window.unionBotAPI.browserCloseTab === 'function') {
      window.unionBotAPI.browserCloseTab(tabId);
    } else {
      setBrowserState((prev) => {
        const remaining = prev.tabs.filter((t) => t.id !== tabId);
        return {
          ...prev,
          tabs: remaining,
          activeTabId: prev.activeTabId === tabId ? remaining[0]?.id || null : prev.activeTabId,
        };
      });
    }
  };

  const handleAddTab = (providerId: string = 'search') => {
    if (window.unionBotAPI && typeof window.unionBotAPI.browserCreateTab === 'function') {
      window.unionBotAPI.browserCreateTab({ providerId });
    }
  };

  const handleNavigate = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!addressInput.trim()) return;
    if (window.unionBotAPI && typeof window.unionBotAPI.browserNavigate === 'function') {
      window.unionBotAPI.browserNavigate({
        tabId: activeTab?.id,
        url: addressInput.trim(),
      });
    } else {
      setBrowserState((prev) => ({
        ...prev,
        tabs: prev.tabs.map((t) =>
          t.id === prev.activeTabId ? { ...t, url: addressInput.trim() } : t
        ),
      }));
    }
  };

  const handleAction = (action: string) => {
    if (window.unionBotAPI && typeof window.unionBotAPI.browserPerformAction === 'function') {
      window.unionBotAPI.browserPerformAction({
        tabId: activeTab?.id,
        action,
      });
    }
  };

  const handleShareToRoom = async () => {
    if (!activeTab) return;
    if (window.unionBotAPI && typeof window.unionBotAPI.browserShareSelection === 'function') {
      const res = await window.unionBotAPI.browserShareSelection({
        tabId: activeTab.id,
        roomId: activeRoomId,
      });
      if (res && res.success) {
        setShareSuccess(true);
        setTimeout(() => setShareSuccess(false), 2500);
      }
    } else {
      alert(`[Demo Mode] Đã chia sẻ liên kết ${activeTab.title} vào phòng ${activeRoomId}!`);
      setShareSuccess(true);
      setTimeout(() => setShareSuccess(false), 2500);
    }
  };

  if (!isOpen) return null;

  return (
    <aside className="browser-panel" data-testid="browser-panel-container">
      {/* 1. Browser Tab Strip */}
      <div className="browser-tab-strip" data-testid="browser-tab-strip">
        <div className="browser-tabs-scroll">
          {browserState.tabs.map((tab) => {
            const isActive = tab.id === browserState.activeTabId;
            return (
              <div
                key={tab.id}
                className={`browser-tab-item ${isActive ? 'active' : ''}`}
                data-testid={`browser-tab-${tab.providerId}`}
                onClick={() => handleSelectTab(tab.id)}
                title={`${tab.title} (${tab.partition})`}
              >
                <span className="browser-tab-title">{tab.title}</span>
                {browserState.tabs.length > 1 && (
                  <button
                    className="browser-tab-close"
                    data-testid={`browser-tab-close-${tab.id}`}
                    onClick={(e) => handleCloseTab(e, tab.id)}
                    title="Close tab"
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="browser-tab-actions">
          <button
            className="browser-btn-icon"
            data-testid="browser-add-tab-btn"
            onClick={() => handleAddTab('search')}
            title="New Search Tab"
          >
            +
          </button>
          <button
            className="browser-btn-icon"
            data-testid="browser-close-panel-btn"
            onClick={onClose}
            title="Close Browser Dock"
          >
            ✕
          </button>
        </div>
      </div>

      {/* 2. Navigation Bar & Controls */}
      <div className="browser-toolbar" data-testid="browser-toolbar">
        <div className="browser-nav-group">
          <button
            className="browser-nav-btn"
            data-testid="browser-back-btn"
            onClick={() => handleAction('back')}
            disabled={!activeTab?.canGoBack}
            title="Go Back"
          >
            ←
          </button>
          <button
            className="browser-nav-btn"
            data-testid="browser-forward-btn"
            onClick={() => handleAction('forward')}
            disabled={!activeTab?.canGoForward}
            title="Go Forward"
          >
            →
          </button>
          <button
            className="browser-nav-btn"
            data-testid="browser-reload-btn"
            onClick={() => handleAction('reload')}
            title="Reload page"
          >
            ↻
          </button>
        </div>

        {/* Address / Search Bar */}
        <form className="browser-address-form" onSubmit={handleNavigate}>
          <div className="browser-address-wrapper">
            <span className="browser-security-badge" title="Encrypted HTTPS connection">
              🔒
            </span>
            <input
              type="text"
              className="browser-address-input"
              data-testid="browser-address-input"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              placeholder="Enter HTTPS address or search query..."
            />
            {activeTab?.isLoading && (
              <span className="browser-loading-spinner" title="Loading...">
                ⏳
              </span>
            )}
            <button type="submit" className="browser-go-btn" data-testid="browser-go-btn">
              Go
            </button>
          </div>
        </form>

        {/* Provider Auth Status Indicator */}
        <div className="browser-status-group">
          {activeTab?.authStatus === 'LOGIN_REQUIRED' ? (
            <span
              className="browser-auth-chip login-required"
              data-testid="browser-auth-login"
              title="Authentication required. Please log in through this isolated browser tab."
            >
              🔑 Login Required
            </span>
          ) : activeTab?.authStatus === 'READY_OR_LANDING' ? (
            <span
              className="browser-auth-chip ready"
              data-testid="browser-auth-ready"
              title="Provider surface loaded and ready."
            >
              ✓ Ready
            </span>
          ) : (
            <span className="browser-auth-chip unknown">Checking...</span>
          )}

          {/* Share to Room Button (P4-010) */}
          <button
            className={`browser-share-btn ${shareSuccess ? 'success' : ''}`}
            data-testid="browser-share-btn"
            onClick={handleShareToRoom}
            title="Share selected text or active link to current room (source: user_manual)"
          >
            {shareSuccess ? '✓ Đã chia sẻ!' : '↗ Chia sẻ vào nhóm'}
          </button>
        </div>
      </div>

      {/* 3. Native WebContentsView Mount Container */}
      <div className="browser-view-container" ref={mountRef} data-testid="browser-view-mount">
        {/* Crash Recovery Card (Ticket P4-009) */}
        {activeTab?.crashed && (
          <div className="browser-crash-overlay" data-testid="browser-crash-banner">
            <h3>⚠️ Tab Process Crashed</h3>
            <p>{activeTab.lastError || 'The render process for this tab unexpectedly terminated.'}</p>
            <p>Main desktop application and state remain healthy and durable.</p>
            <button
              className="browser-recovery-btn"
              data-testid="browser-crash-reload-btn"
              onClick={() => handleAction('reload')}
            >
              ↻ Reload Tab
            </button>
          </div>
        )}

        {/* Offline / Demo / Loading fallback placeholder when WebContentsView is inactive */}
        {(!window.unionBotAPI || !activeTab) && (
          <div className="browser-offline-placeholder" data-testid="browser-offline-placeholder">
            <div className="browser-offline-card">
              <h4>🌐 Embedded AI Provider View</h4>
              <p>Active Provider: <strong>{activeTab?.title || 'None'}</strong></p>
              <p>Partition: <code>{activeTab?.partition || 'none'}</code></p>
              <p>URL: <code>{activeTab?.url || 'about:blank'}</code></p>
              <p className="browser-tip">
                Phân vùng cookie được cô lập hoàn toàn mức Chromium profile. Không rò rỉ session token giữa các nhà cung cấp.
              </p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
