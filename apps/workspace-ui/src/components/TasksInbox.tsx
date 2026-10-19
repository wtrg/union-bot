import React, { useState } from 'react';
import { TaskItem } from '../types.ts';

const SAMPLE_TASKS: TaskItem[] = [
  {
    id: 'task-001',
    name: 'Zero-Cost Local Egress Audit',
    status: 'completed',
    role: 'QA_SECURITY',
    step: 3,
    retries: 0,
    updatedAt: new Date(Date.now() - 1200000).toLocaleTimeString(),
  },
  {
    id: 'task-002',
    name: 'SQLite WAL Transaction Check',
    status: 'completed',
    role: 'IMPLEMENTER',
    step: 2,
    retries: 0,
    updatedAt: new Date(Date.now() - 600000).toLocaleTimeString(),
  },
  {
    id: 'task-003',
    name: 'CAS Attachment Integrity Validation',
    status: 'running',
    role: 'IMPLEMENTER',
    step: 1,
    retries: 0,
    updatedAt: new Date().toLocaleTimeString(),
  },
];

export const TasksInbox: React.FC = () => {
  const [tasks] = useState<TaskItem[]>(SAMPLE_TASKS);
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'COMPLETED'>('ALL');

  const filteredTasks = tasks.filter((t) => {
    if (filter === 'ACTIVE') return t.status === 'running' || t.status === 'pending';
    if (filter === 'COMPLETED') return t.status === 'completed';
    return true;
  });

  return (
    <div className="inbox-container" style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: 24, overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>📋 Tasks & Execution Inbox</span>
          </h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Track background offline tasks, DAG steps, execution retries, and agent dependencies (P3-006).
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`filter-btn ${filter === 'ALL' ? 'active' : ''}`}
            onClick={() => setFilter('ALL')}
            style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid var(--border-color)', background: filter === 'ALL' ? 'var(--bg-secondary)' : 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}
          >
            All ({tasks.length})
          </button>
          <button
            className={`filter-btn ${filter === 'ACTIVE' ? 'active' : ''}`}
            onClick={() => setFilter('ACTIVE')}
            style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid var(--border-color)', background: filter === 'ACTIVE' ? 'var(--bg-secondary)' : 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}
          >
            Active ({tasks.filter(t => t.status === 'running' || t.status === 'pending').length})
          </button>
          <button
            className={`filter-btn ${filter === 'COMPLETED' ? 'active' : ''}`}
            onClick={() => setFilter('COMPLETED')}
            style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid var(--border-color)', background: filter === 'COMPLETED' ? 'var(--bg-secondary)' : 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}
          >
            Completed ({tasks.filter(t => t.status === 'completed').length})
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {filteredTasks.map((t) => (
          <div
            key={t.id}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              padding: 16,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>
                  {t.name}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    padding: '2px 6px',
                    borderRadius: 3,
                    background:
                      t.status === 'completed'
                        ? 'var(--accent-green)'
                        : t.status === 'running'
                        ? 'var(--accent-blue)'
                        : 'var(--accent-amber)',
                    color: '#000',
                  }}
                >
                  {t.status}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                Task ID: <code>{t.id}</code> • Role: <strong>{t.role}</strong> • Step: {t.step || 1} • Retries: {t.retries || 0}
              </div>
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Updated: {t.updatedAt}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
