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
  isBrowserOpen = false,
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
      {/* Left: Room Title & Status (Never Truncated) */}
      <div className="room-title-group">
        <h1 className="room-name" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: 'var(--accent-indigo)', fontWeight: 800 }}>#</span>
          <span>{room?.name || 'room'}</span>
        </h1>

        {room?.description && (
          <span className="room-description" title={room.description}>
            {room.description}
          </span>
        )}

        {isDemoMode ? (
          <span className="demo-badge">
            PREVIEW
          </span>
        ) : (
          <span className="live-badge" title="Orchestrator SQLite WAL Active">
            <span className="pulse-dot" />
            <span>0đ Sẵn sàng</span>
          </span>
        )}
      </div>

      {/* Right: Clean, Modern Action Buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {onToggleDiscovery && (
          <button
            className={`header-action-btn ${isDiscoveryOpen ? 'active' : ''}`}
            data-testid="toggle-discovery-btn"
            onClick={onToggleDiscovery}
            title="Bật/Tắt Drawer Đặc tả yêu cầu dự án"
          >
            <span>📋</span>
            <span>{workspaceMode === 'discovery' ? 'Yêu cầu' : 'Thực thi'}</span>
            <span style={{ fontSize: 9, opacity: 0.7 }}>{isDiscoveryOpen ? '✕' : '▶'}</span>
          </button>
        )}

        {onToggleBrowser && (
          <button
            className={`header-action-btn ${isBrowserOpen ? 'active-blue' : ''}`}
            data-testid="toggle-browser-btn"
            onClick={onToggleBrowser}
            title={isBrowserOpen ? 'Đóng AI Browser Dock' : 'Mở AI Web Browser (ChatGPT / Gemini / Claude)'}
          >
            <span>🌐</span>
            <span>AI Browser</span>
          </button>
        )}

        {onToggleActivity && (
          <button
            className={`header-action-btn ${isActivityOpen ? 'active' : ''}`}
            data-testid="toggle-activity-btn"
            onClick={onToggleActivity}
            title={`Nhật ký hoạt động (Trạng thái: ${workflowState}, ${activeLeasesCount} lease)`}
          >
            <span>⚡</span>
            <span>Hoạt động{activeLeasesCount > 0 ? ` (${activeLeasesCount})` : ''}</span>
          </button>
        )}

        {onOpenCommandPalette && (
          <button
            className="header-action-btn btn-command-palette"
            onClick={onOpenCommandPalette}
            title="Bảng lệnh nhanh (Ctrl+K)"
            style={{ padding: '4px 8px' }}
          >
            <kbd style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'inherit' }}>⌘K</kbd>
          </button>
        )}

        <span className="cost-guard-badge" title="CostGuard Active: 0 VNĐ phát sinh">
          0đ Free
        </span>
      </div>
    </header>
  );
};
