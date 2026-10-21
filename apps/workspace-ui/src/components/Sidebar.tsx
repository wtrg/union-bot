import React, { useState } from 'react';
import { AgentInfo, RoomInfo, ProjectInfo } from '../types.ts';

interface SidebarProps {
  rooms: RoomInfo[];
  activeRoomId: string;
  onSelectRoom: (roomId: string) => void;
  agents: AgentInfo[];
  activeView: 'chat' | 'approvals' | 'tasks';
  onSelectView: (view: 'chat' | 'approvals' | 'tasks') => void;
  pendingApprovalsCount: number;
  onOpenCreateRoom: () => void;
  onOpenPreferences: () => void;
  projects?: ProjectInfo[];
  selectedProjectId?: string;
  onSelectProject?: (projectId: string) => void;
  onOpenCreateProject?: () => void;
  onOpenEditProject?: (project: ProjectInfo) => void;
  onArchiveProject?: (projectId: string) => void;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  projectName?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  rooms,
  activeRoomId,
  onSelectRoom,
  agents,
  activeView,
  onSelectView,
  pendingApprovalsCount,
  onOpenCreateRoom,
  onOpenPreferences,
  projects = [],
  selectedProjectId = 'default',
  onSelectProject,
  onOpenCreateProject,
  onOpenEditProject,
  onArchiveProject,
  theme = 'dark',
  onToggleTheme,
  projectName = 'Union Bot Workspace',
}) => {
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);

  const currentProject = projects.find((p) => p.id === selectedProjectId) || {
    id: selectedProjectId,
    name: projectName,
  };

  return (
    <aside className="sidebar">
      {/* Brand Header */}
      <div className="sidebar-header">
        <div className="brand-badge">
          <div className="brand-logo">UB</div>
          <div>
            <div className="brand-title">Union Bot</div>
            <div className="brand-subtitle">v4.0 Autonomous (0đ)</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {onToggleTheme && (
            <button
              onClick={onToggleTheme}
              title={`Chuyển sang chế độ ${theme === 'dark' ? 'Sáng' : 'Tối'}`}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                padding: '3px 6px',
                cursor: 'pointer',
                fontSize: 12,
                color: 'var(--text-primary)',
              }}
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          )}
          <span className="zero-cost-pill">0đ Free</span>
        </div>
      </div>

      {/* Project Switcher Bar */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-color)', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span className="section-label" style={{ padding: 0 }}>DỰ ÁN HIỆN TẠI</span>
          {onOpenCreateProject && (
            <button
              onClick={onOpenCreateProject}
              data-testid="open-create-project-btn"
              title="Tạo dự án mới"
              style={{
                background: 'transparent',
                border: '1px solid var(--border-color)',
                color: 'var(--text-secondary)',
                borderRadius: 'var(--radius-sm)',
                padding: '1px 6px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              + Mới
            </button>
          )}
        </div>

        <div
          onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
          data-testid="project-dropdown-trigger"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '7px 10px',
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-primary)',
            transition: 'border-color 0.15s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, overflow: 'hidden' }}>
            <span>📁</span>
            <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              {currentProject.name}
            </span>
          </div>
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{isProjectDropdownOpen ? '▲' : '▼'}</span>
        </div>

        {/* Project Dropdown Menu */}
        {isProjectDropdownOpen && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 12,
              right: 12,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              boxShadow: 'var(--shadow-lg)',
              zIndex: 100,
              maxHeight: 220,
              overflowY: 'auto',
              padding: 4,
            }}
          >
            {projects.map((proj) => (
              <div
                key={proj.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 8px',
                  borderRadius: 'var(--radius-sm)',
                  background: proj.id === selectedProjectId ? 'var(--bg-surface-elevated)' : 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: 'var(--text-primary)',
                }}
              >
                <div
                  style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  onClick={() => {
                    if (onSelectProject) onSelectProject(proj.id);
                    setIsProjectDropdownOpen(false);
                  }}
                >
                  <span style={{ fontWeight: proj.id === selectedProjectId ? 700 : 400 }}>{proj.name}</span>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {onOpenEditProject && proj.id !== 'default' && (
                    <button
                      title="Đổi tên dự án"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenEditProject(proj);
                        setIsProjectDropdownOpen(false);
                      }}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11 }}
                    >
                      ✏️
                    </button>
                  )}
                  {onArchiveProject && proj.id !== 'default' && (
                    <button
                      title="Lưu trữ dự án"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Bạn có chắc muốn lưu trữ dự án "${proj.name}"?`)) {
                          onArchiveProject(proj.id);
                          setIsProjectDropdownOpen(false);
                        }
                      }}
                      style={{ background: 'transparent', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', fontSize: 11 }}
                    >
                      📦
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Main Navigation Sections */}
      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4, borderBottom: '1px solid var(--border-color)' }}>
        <button
          className={`sidebar-nav-btn ${activeView === 'chat' ? 'active' : ''}`}
          data-testid="nav-chat-btn"
          onClick={() => onSelectView('chat')}
        >
          <span>💬</span>
          <span>Kênh Thảo Luận</span>
        </button>

        <button
          className={`sidebar-nav-btn ${activeView === 'approvals' ? 'active' : ''}`}
          data-testid="nav-approvals-btn"
          onClick={() => onSelectView('approvals')}
          style={{ justifyContent: 'space-between' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>🛡️</span>
            <span>Phê Duyệt Bảo Mật</span>
          </div>
          {pendingApprovalsCount > 0 && (
            <span
              style={{
                background: 'var(--accent-amber)',
                color: '#000000',
                fontSize: 10,
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: 'var(--radius-full)',
              }}
            >
              {pendingApprovalsCount}
            </span>
          )}
        </button>

        <button
          className={`sidebar-nav-btn ${activeView === 'tasks' ? 'active' : ''}`}
          data-testid="nav-tasks-btn"
          onClick={() => onSelectView('tasks')}
        >
          <span>📋</span>
          <span>Nhiệm Vụ & Tiến Độ</span>
        </button>
      </div>

      {/* Room list with "+ Add Room" */}
      <div className="rooms-list">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px 4px 8px' }}>
          <span className="section-label" style={{ padding: 0 }}>CÁC KÊNH PHÒNG HỌP</span>
          <button
            onClick={onOpenCreateRoom}
            data-testid="add-room-btn"
            title="Tạo phòng họp mới"
            style={{
              background: 'transparent',
              border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)',
              borderRadius: 'var(--radius-sm)',
              padding: '1px 6px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            + Thêm
          </button>
        </div>

        {rooms.map((room) => (
          <div
            key={room.id}
            data-testid={`room-item-${room.id}`}
            className={`room-item ${activeView === 'chat' && room.id === activeRoomId ? 'active' : ''}`}
            onClick={() => {
              onSelectRoom(room.id);
              onSelectView('chat');
            }}
          >
            <span className="hash">#</span>
            <span>{room.name}</span>
          </div>
        ))}
      </div>

      {/* AI Team Members List */}
      <div className="provider-list">
        <div className="section-label" style={{ padding: '0 0 6px 0' }}>
          ĐỘI NGŨ AI (LOCAL & WEB)
        </div>
        {agents.map((agent) => {
          let dotColor = '#94a3b8'; // gray
          let statusLabel = 'Standby';

          if (agent.status === 'active') {
            dotColor = '#10b981'; // emerald
            statusLabel = 'Active';
          } else if (agent.status === 'ready' || agent.status === 'ready_automated' || agent.status === 'ready_manual' || agent.status === 'free_local') {
            dotColor = '#34d399'; // green
            statusLabel = 'Ready';
          } else if (agent.status === 'challenge_required' || agent.status === 'auth_required') {
            dotColor = '#f59e0b'; // amber
            statusLabel = 'Login Needed';
          }

          return (
            <div key={agent.id} className="provider-item" title={`${agent.name} • ${agent.role} [${statusLabel}] (${agent.details || agent.status})`}>
              <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', gap: 6 }}>
                <span
                  className="provider-status-dot"
                  style={{ backgroundColor: dotColor, boxShadow: `0 0 5px ${dotColor}` }}
                />
                <span style={{ fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', fontSize: 12 }}>
                  {agent.name}
                </span>
              </div>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>
                {agent.role.split('/')[0].trim()}
              </span>
            </div>
          );
        })}
      </div>

      {/* Settings / Preferences Footer */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          onClick={onOpenPreferences}
          data-testid="open-preferences-btn"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary)',
            fontSize: 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 0',
            fontWeight: 500,
          }}
        >
          <span>⚙️</span>
          <span>Cài Đặt & Chẩn Đoán</span>
        </button>
      </div>
    </aside>
  );
};
