import React from 'react';
import { AgentInfo, RoomInfo } from '../types.ts';

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
  projectName = 'Union Bot Workspace',
}) => {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand-badge">
          <div className="brand-logo">UB</div>
          <div>
            <div className="brand-title">Union Bot</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{projectName}</div>
          </div>
        </div>
        <span className="zero-cost-pill">0đ ZERO COST</span>
      </div>

      {/* Navigation Sections (P3-006, P3-007) */}
      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4, borderBottom: '1px solid var(--border-color)' }}>
        <button
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
          <span>📋 Tasks & DAG</span>
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
