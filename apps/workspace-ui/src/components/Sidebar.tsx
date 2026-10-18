import React from 'react';
import { AgentInfo, RoomInfo } from '../types.ts';

interface SidebarProps {
  rooms: RoomInfo[];
  activeRoomId: string;
  onSelectRoom: (roomId: string) => void;
  agents: AgentInfo[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  rooms,
  activeRoomId,
  onSelectRoom,
  agents,
}) => {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand-badge">
          <div className="brand-logo">UB</div>
          <div>
            <div className="brand-title">Union Bot</div>
          </div>
        </div>
        <span className="zero-cost-pill">0đ ZERO COST</span>
      </div>

      <div className="rooms-list">
        <div className="section-label">Collaboration Rooms</div>
        {rooms.map((room) => (
          <div
            key={room.id}
            className={`room-item ${room.id === activeRoomId ? 'active' : ''}`}
            onClick={() => onSelectRoom(room.id)}
          >
            <span>#</span>
            <span>{room.name}</span>
          </div>
        ))}
      </div>

      <div className="provider-list">
        <div className="section-label" style={{ padding: '4px 0 8px 0' }}>
          Team & Providers
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
    </aside>
  );
};
