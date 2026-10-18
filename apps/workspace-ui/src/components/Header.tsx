import React from 'react';
import { RoomInfo } from '../types.ts';

interface HeaderProps {
  room?: RoomInfo;
  isDemoMode: boolean;
}

export const Header: React.FC<HeaderProps> = ({ room, isDemoMode }) => {
  return (
    <header className="room-header">
      <div className="room-title-group">
        <h1 className="room-name">#{room?.name || 'room'}</h1>
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          {room?.description}
        </span>
        {isDemoMode && (
          <span className="demo-badge">
            DEMO MODE (OFFLINE / AIR-GAPPED)
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
