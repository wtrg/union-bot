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
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>0đ Desktop AI Workspace</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {onToggleTheme && (
            <button
              onClick={onToggleTheme}
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-color)',
                borderRadius: 4,
                padding: '2px 6px',
                cursor: 'pointer',
                fontSize: 12,
                color: 'var(--text-primary)',
              }}
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          )}
          <span className="zero-cost-pill">0đ ZERO COST</span>
        </div>
      </div>

      {/* Project Switcher Bar (UB-P3-R01-002) */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-color)', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span className="section-label" style={{ padding: 0, fontSize: 10 }}>PROJECT SCOPE</span>
          {onOpenCreateProject && (
            <button
              onClick={onOpenCreateProject}
              title="Create New Project (UB-P3-R01-002)"
              style={{
                background: 'transparent',
                border: '1px solid var(--border-color)',
                color: 'var(--text-primary)',
                borderRadius: 3,
                padding: '1px 6px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              + New
            </button>
          )}
        </div>

        <div
          onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 10px',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
            <span>📁</span>
            <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              {currentProject.name}
            </span>
          </div>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{isProjectDropdownOpen ? '▲' : '▼'}</span>
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
              borderRadius: 6,
              boxShadow: '0 8px 16px rgba(0,0,0,0.4)',
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
                  borderRadius: 4,
                  background: proj.id === selectedProjectId ? 'var(--bg-tertiary)' : 'transparent',
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
                      title="Rename Project"
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
                      title="Archive Project"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Archive project "${proj.name}"?`)) {
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

      {/* Navigation Sections (P3-006, P3-007) */}
      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4, borderBottom: '1px solid var(--border-color)' }}>
        <button
          data-testid="nav-chat-btn"
          onClick={() => onSelectView('chat')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 10px',
            borderRadius: 4,
            border: 'none',
            background: activeView === 'chat' ? 'var(--bg-tertiary)' : 'transparent',
            color: activeView === 'chat' ? 'var(--text-primary)' : 'var(--text-muted)',
            fontWeight: activeView === 'chat' ? 600 : 400,
            cursor: 'pointer',
            textAlign: 'left',
            fontSize: 13,
          }}
        >
          <span>💬 Collaboration Rooms</span>
        </button>

        <button
          data-testid="nav-approvals-btn"
          onClick={() => onSelectView('approvals')}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '7px 10px',
            borderRadius: 4,
            border: 'none',
            background: activeView === 'approvals' ? 'var(--bg-tertiary)' : 'transparent',
            color: activeView === 'approvals' ? 'var(--text-primary)' : 'var(--text-muted)',
            fontWeight: activeView === 'approvals' ? 600 : 400,
            cursor: 'pointer',
            textAlign: 'left',
            fontSize: 13,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>🛡️ Approval Inbox</span>
          </span>
          {pendingApprovalsCount > 0 && (
            <span style={{ background: 'var(--accent-amber)', color: '#000', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10 }}>
              {pendingApprovalsCount}
            </span>
          )}
        </button>

        <button
          data-testid="nav-tasks-btn"
          onClick={() => onSelectView('tasks')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 10px',
            borderRadius: 4,
            border: 'none',
            background: activeView === 'tasks' ? 'var(--bg-tertiary)' : 'transparent',
            color: activeView === 'tasks' ? 'var(--text-primary)' : 'var(--text-muted)',
            fontWeight: activeView === 'tasks' ? 600 : 400,
            cursor: 'pointer',
            textAlign: 'left',
            fontSize: 13,
          }}
        >
          <span>📋 Tasks & Execution</span>
        </button>
      </div>

      {/* Room list with "+ Add Room" (P3-003) */}
      <div className="rooms-list" style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px 4px 12px' }}>
          <span className="section-label" style={{ padding: 0 }}>Rooms</span>
          <button
            onClick={onOpenCreateRoom}
            title="Create Room (P3-003)"
            style={{
              background: 'transparent',
              border: '1px solid var(--border-color)',
              color: 'var(--text-primary)',
              borderRadius: 3,
              padding: '1px 6px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            + Add
          </button>
        </div>
        {rooms.map((room) => (
          <div
            key={room.id}
            className={`room-item ${activeView === 'chat' && room.id === activeRoomId ? 'active' : ''}`}
            onClick={() => {
              onSelectRoom(room.id);
              onSelectView('chat');
            }}
          >
            <span>#</span>
            <span>{room.name}</span>
          </div>
        ))}
      </div>

      {/* Providers Status */}
      <div className="provider-list">
        <div className="section-label" style={{ padding: '4px 0 8px 0' }}>
          Local Team & Standby
        </div>
        {agents.map((agent) => (
          <div key={agent.id} className="provider-item">
            <div>
              <span style={{ fontWeight: 600 }}>{agent.name}</span>
              <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 10 }}>
                {agent.role}
              </span>
            </div>
            <span
              className={`provider-status ${
                agent.status === 'active'
                  ? 'status-active'
                  : agent.status === 'ready'
                  ? 'status-ready'
                  : 'status-auth'
              }`}
            >
              {agent.status.toUpperCase()}
            </span>
          </div>
        ))}
      </div>

      {/* Settings / Preferences Footer */}
      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          onClick={onOpenPreferences}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: 4,
          }}
        >
          <span>⚙️ Settings & Diagnostics</span>
        </button>
      </div>
    </aside>
  );
};
