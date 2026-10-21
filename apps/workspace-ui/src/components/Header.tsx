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
      {/* Left Group: Room Info & Live Status */}
      <div className="room-title-group">
        <h1 className="room-name">#{room?.name || 'room'}</h1>
        {room?.description && (
          <span className="room-description" title={room.description}>
            {room.description}
          </span>
        )}
        {isDemoMode ? (
          <span className="demo-badge">
            PREVIEW OFFLINE
          </span>
        ) : (
          <span className="live-badge">
            <span className="pulse-dot" />
            <span>0đ Sẵn sàng</span>
          </span>
        )}
      </div>

      {/* Right Group: Action Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {onToggleDiscovery && (
          <button
            className={`header-action-btn ${isDiscoveryOpen ? 'active' : ''}`}
            data-testid="toggle-discovery-btn"
            onClick={onToggleDiscovery}
            title="Bật/Tắt Đặc tả Yêu cầu & Khám phá (/chat)"
          >
            <span>📋</span>
            <span>{workspaceMode === 'discovery' ? 'Yêu cầu (/chat)' : 'Thực thi (/work)'}</span>
            <span style={{ fontSize: 9, opacity: 0.7 }}>{isDiscoveryOpen ? '◀' : '▶'}</span>
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
            <span style={{ fontSize: 9, opacity: 0.7 }}>{isBrowserOpen ? '◀' : '▶'}</span>
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
            <span style={{ fontSize: 9, opacity: 0.7 }}>{isActivityOpen ? '◀' : '▶'}</span>
          </button>
        )}

        {onOpenCommandPalette && (
          <button
            className="header-action-btn btn-command-palette"
            onClick={onOpenCommandPalette}
            title="Mở bảng lệnh nhanh (Ctrl+K)"
          >
            <span>⌘</span>
            <kbd style={{ fontSize: 10, color: 'var(--text-muted)' }}>Ctrl+K</kbd>
          </button>
        )}

        <span className="cost-guard-badge" title="CostGuard Active: Đảm bảo 0 VNĐ chi phí API">
          0đ STRICT
        </span>
      </div>
    </header>
  );
};
