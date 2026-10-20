import React from 'react';
import { RoomInfo } from '../types.ts';

interface HeaderProps {
  room?: RoomInfo;
  isDemoMode: boolean;
  onToggleBrowser?: () => void;
  isBrowserOpen?: boolean;
  workspaceMode?: 'discovery' | 'work';
  onToggleDiscovery?: () => void;
  isDiscoveryOpen?: boolean;
  isActivityOpen?: boolean;
  onToggleActivity?: () => void;
  workflowState?: string;
  activeLeasesCount?: number;
  onOpenCommandPalette?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  room,
  isDemoMode,
  onToggleBrowser,
  isBrowserOpen,
  workspaceMode = 'discovery',
  onToggleDiscovery,
  isDiscoveryOpen = false,
  isActivityOpen = false,
  onToggleActivity,
  workflowState = 'RUNNING',
  activeLeasesCount = 0,
  onOpenCommandPalette,
}) => {
  return (
    <header className="room-header">
      <div className="room-title-group">
        <h1 className="room-name">#{room?.name || 'room'}</h1>
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          {room?.description}
        </span>
        {isDemoMode ? (
          <span className="demo-badge" style={{ fontSize: 10, color: 'var(--accent-amber)', border: '1px solid var(--accent-amber)', padding: '2px 6px', borderRadius: 4 }}>
            STANDALONE PREVIEW (OFFLINE SEED)
          </span>
        ) : (
          <span className="live-badge" style={{ fontSize: 10, color: 'var(--accent-emerald)', border: '1px solid var(--accent-emerald)', padding: '2px 6px', borderRadius: 4 }}>
            ELECTRON LIVE IPC (ZERO-COST ACTIVE)
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {onToggleDiscovery && (
          <button
            className={`btn-toggle-discovery ${isDiscoveryOpen ? 'active' : ''}`}
            data-testid="toggle-discovery-btn"
            onClick={onToggleDiscovery}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: isDiscoveryOpen ? 'var(--accent-purple, #7c3aed)' : 'var(--bg-surface-elevated, #1e293b)',
              color: '#ffffff',
              border: '1px solid var(--border-color)',
              borderRadius: 4,
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
            }}
            title="Discovery Ledger & Requirement Facts (/chat)"
          >
            <span>📋 {workspaceMode === 'discovery' ? 'Mode: /chat (BA)' : 'Mode: /work'}</span>
            <span style={{ fontSize: 10, opacity: 0.8 }}>{isDiscoveryOpen ? '◀' : '▶'}</span>
          </button>
        )}

        {onToggleBrowser && (
          <button
            className={`btn-toggle-browser ${isBrowserOpen ? 'active' : ''}`}
            data-testid="toggle-browser-btn"
            onClick={onToggleBrowser}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: isBrowserOpen ? 'var(--accent-blue, #2563eb)' : 'var(--bg-surface-elevated, #1e293b)',
              color: isBrowserOpen ? '#ffffff' : 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 4,
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
            }}
            title={isBrowserOpen ? 'Collapse Browser Dock' : 'Open Embedded AI Browser (ChatGPT / Gemini / Claude / DeepSeek)'}
          >
            <span>🌐 Browser Dock</span>
            <span style={{ fontSize: 10, opacity: 0.8 }}>{isBrowserOpen ? '◀' : '▶'}</span>
          </button>
        )}

        {onToggleActivity && (
          <button
            className={`btn-toggle-activity ${isActivityOpen ? 'active' : ''}`}
            data-testid="toggle-activity-btn"
            onClick={onToggleActivity}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: isActivityOpen ? 'var(--accent-indigo, #6366f1)' : 'var(--bg-surface-elevated, #1e293b)',
              color: '#ffffff',
              border: '1px solid var(--border-color)',
              borderRadius: 4,
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
            }}
            title={`Activity Feed & Workflow Events (Status: ${workflowState}, Active Leases: ${activeLeasesCount})`}
          >
            <span>⚡ Activity ({activeLeasesCount} lease)</span>
            <span style={{ fontSize: 10, opacity: 0.8 }}>{isActivityOpen ? '◀' : '▶'}</span>
          </button>
        )}

        {onOpenCommandPalette && (
          <button
            className="btn-command-palette"
            onClick={onOpenCommandPalette}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'var(--bg-surface-elevated, #1e293b)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 4,
              padding: '4px 8px',
              fontSize: 12,
              cursor: 'pointer',
            }}
            title="Open Command Palette (Ctrl+K)"
          >
            <span>⌘</span>
            <kbd style={{ fontSize: 10, color: 'var(--text-muted)' }}>Ctrl+K</kbd>
          </button>
        )}

        <span
          style={{
            fontSize: 11,
            color: 'var(--accent-blue)',
            fontFamily: 'monospace',
            backgroundColor: 'var(--bg-tertiary)',
            padding: '4px 8px',
            borderRadius: 4,
          }}
        >
          COST_GUARD: 0đ STRICT
        </span>
      </div>
    </header>
  );
};
