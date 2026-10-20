import React, { useState, useEffect } from 'react';
import { ActivityEventInfo } from '../types.ts';

interface ActivityFeedPanelProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  workflowState?: string;
  activeLeasesCount?: number;
  onPauseWorkflow?: () => void;
  onResumeWorkflow?: () => void;
}

export const ActivityFeedPanel: React.FC<ActivityFeedPanelProps> = ({
  projectId,
  isOpen,
  onClose,
  workflowState = 'RUNNING',
  activeLeasesCount = 0,
  onPauseWorkflow,
  onResumeWorkflow,
}) => {
  const [events, setEvents] = useState<ActivityEventInfo[]>([]);
  const [filter, setFilter] = useState<string>('ALL');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fetchEvents = async () => {
    if (window.unionBotAPI && typeof window.unionBotAPI.listActivityEvents === 'function') {
      setIsLoading(true);
      try {
        const list = await window.unionBotAPI.listActivityEvents({ projectId });
        if (Array.isArray(list)) {
          setEvents(list);
        }
      } catch (err) {
        console.warn('[ActivityFeedPanel] Failed to fetch events:', err);
      } finally {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchEvents();
      const timer = setInterval(fetchEvents, 5000);
      return () => clearInterval(timer);
    }
  }, [isOpen, projectId]);

  if (!isOpen) return null;

  const filteredEvents = events.filter((evt) => {
    if (filter === 'ALL') return true;
    if (filter === 'MILESTONE') return evt.kind.toLowerCase().includes('milestone');
    if (filter === 'LEASE') return evt.kind.toLowerCase().includes('lease');
    if (filter === 'LIFECYCLE') return evt.kind.toLowerCase().includes('goal') || evt.kind.toLowerCase().includes('plan');
    return evt.kind === filter;
  });

  return (
    <aside
      className="activity-feed-panel"
      data-testid="activity-feed-panel"
      style={{
        width: 340,
        backgroundColor: 'var(--bg-secondary, #0f172a)',
        borderLeft: '1px solid var(--border-color, #334155)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        zIndex: 50,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-color, #334155)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'var(--bg-primary, #020617)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>⚡</span>
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary, #f8fafc)' }}>
            Activity Feed
          </span>
          <span
            style={{
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 10,
              backgroundColor: 'var(--bg-tertiary, #1e293b)',
              color: 'var(--text-muted, #94a3b8)',
            }}
          >
            {events.length}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted, #94a3b8)',
            cursor: 'pointer',
            fontSize: 16,
            padding: '2px 6px',
          }}
          title="Close feed"
        >
          ✕
        </button>
      </div>

      {/* Workflow HUD Control */}
      <div
        style={{
          padding: '10px 16px',
          backgroundColor: 'var(--bg-surface-elevated, #1e293b)',
          borderBottom: '1px solid var(--border-color, #334155)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)' }}>Workflow State</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: workflowState === 'RUNNING' ? 'var(--accent-emerald, #10b981)' : 'var(--accent-amber, #f59e0b)',
              }}
            />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary, #f8fafc)' }}>
              {workflowState} ({activeLeasesCount} lease{activeLeasesCount === 1 ? '' : 's'})
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {workflowState === 'RUNNING' ? (
            <button
              onClick={onPauseWorkflow}
              style={{
                fontSize: 11,
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid var(--accent-amber, #f59e0b)',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                color: 'var(--accent-amber, #f59e0b)',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              ⏸ Pause
            </button>
          ) : (
            <button
              onClick={onResumeWorkflow}
              style={{
                fontSize: 11,
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid var(--accent-emerald, #10b981)',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                color: 'var(--accent-emerald, #10b981)',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              ▶ Resume
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '8px 16px',
          borderBottom: '1px solid var(--border-color, #334155)',
          overflowX: 'auto',
        }}
      >
        {['ALL', 'LIFECYCLE', 'MILESTONE', 'LEASE'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              fontSize: 11,
              padding: '3px 8px',
              borderRadius: 4,
              border: 'none',
              backgroundColor: filter === f ? 'var(--accent-blue, #2563eb)' : 'transparent',
              color: filter === f ? '#ffffff' : 'var(--text-muted, #94a3b8)',
              cursor: 'pointer',
              fontWeight: filter === f ? 600 : 400,
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Event Stream */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filteredEvents.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-muted, #94a3b8)', fontSize: 13 }}>
            {isLoading ? 'Loading activity...' : 'No activity events recorded yet.'}
          </div>
        ) : (
          filteredEvents.map((evt) => (
            <div
              key={evt.id}
              style={{
                padding: '10px 12px',
                backgroundColor: 'var(--bg-primary, #020617)',
                border: '1px solid var(--border-color, #1e293b)',
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    color: 'var(--accent-blue, #38bdf8)',
                  }}
                >
                  {evt.kind}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-muted, #64748b)' }}>
                  {new Date(evt.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
              <div style={{ color: 'var(--text-primary, #f1f5f9)', lineHeight: 1.4, wordBreak: 'break-word' }}>
                {evt.summary}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 10, color: 'var(--text-muted, #94a3b8)' }}>
                <span>Actor: {evt.actor.provider} ({evt.actor.role})</span>
                {evt.receiptState && (
                  <span style={{ color: 'var(--accent-emerald, #10b981)' }}>• {evt.receiptState}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
};
