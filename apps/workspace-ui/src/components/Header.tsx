import React from 'react';
import { RoomInfo } from '../types.ts';

interface HeaderProps {
  room?: RoomInfo;
  isDemoMode: boolean;
  onToggleBrowser?: () => void;
  isBrowserOpen?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ room, isDemoMode, onToggleBrowser, isBrowserOpen }) => {
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
