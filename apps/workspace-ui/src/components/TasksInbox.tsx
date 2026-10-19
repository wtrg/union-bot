import React, { useState, useEffect } from 'react';
import { TaskItem } from '../types.ts';

const SAMPLE_TASKS: TaskItem[] = [
  {
    id: 'task-001',
    title: 'Zero-Cost Local Egress Audit',
    status: 'completed',
    role: 'QA_SECURITY',
    step: 3,
    progress: 100,
    retries: 0,
    updatedAt: new Date(Date.now() - 1200000).toLocaleTimeString(),
  },
  {
    id: 'task-002',
    title: 'SQLite WAL Transaction Check',
    status: 'completed',
    role: 'IMPLEMENTER',
    step: 2,
    progress: 100,
    retries: 0,
    updatedAt: new Date(Date.now() - 600000).toLocaleTimeString(),
  },
  {
    id: 'task-003',
    title: 'CAS Attachment Integrity Validation',
    status: 'running',
    role: 'IMPLEMENTER',
    step: 1,
    progress: 65,
    retries: 0,
    updatedAt: new Date().toLocaleTimeString(),
  },
];

export const TasksInbox: React.FC = () => {
  const [tasks, setTasks] = useState<TaskItem[]>(SAMPLE_TASKS);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'COMPLETED'>('ALL');
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newRole, setNewRole] = useState('IMPLEMENTER');
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const fetchTasks = async () => {
    if (!window.unionBotAPI || typeof window.unionBotAPI.listTasks !== 'function') {
      return;
    }
    setIsLoading(true);
    try {
      const realTasks = await window.unionBotAPI.listTasks({ limit: 100 });
      if (Array.isArray(realTasks)) {
        setTasks(realTasks);
      }
    } catch (err: any) {
      console.error('[TasksInbox] Failed to list tasks from SQLite:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;

    if (window.unionBotAPI && typeof window.unionBotAPI.createTask === 'function') {
      try {
        const res = await window.unionBotAPI.createTask({
          title,
          status: 'pending',
          progress: 0,
          metadata: { role: newRole, createdVia: 'TasksInbox' },
        });
        if (res && res.success) {
          setActionFeedback(`Task "${title}" created and persisted to SQLite WAL.`);
          setNewTitle('');
          setIsCreating(false);
          await fetchTasks();
        } else {
          setActionFeedback(`Failed to create task: ${res?.error || 'Unknown error'}`);
        }
      } catch (err: any) {
        setActionFeedback(`Error creating task: ${err.message}`);
      }
    } else {
      // Demo fallback
      const newTask: TaskItem = {
        id: `task_${Date.now()}`,
        title,
        status: 'pending',
        role: newRole,
        progress: 0,
        updatedAt: new Date().toLocaleTimeString(),
      };
      setTasks((prev) => [newTask, ...prev]);
      setNewTitle('');
      setIsCreating(false);
    }
  };

  const handleUpdateStatus = async (taskId: string, newStatus: 'pending' | 'running' | 'completed' | 'failed', progress?: number) => {
    if (window.unionBotAPI && typeof window.unionBotAPI.updateTask === 'function') {
      try {
        const res = await window.unionBotAPI.updateTask(taskId, {
          status: newStatus,
          progress: progress !== undefined ? progress : newStatus === 'completed' ? 100 : newStatus === 'running' ? 50 : 0,
        });
        if (res && res.success) {
          await fetchTasks();
        }
      } catch (err: any) {
        console.error('[TasksInbox] Failed to update task:', err);
      }
    } else {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: newStatus,
                progress: progress !== undefined ? progress : newStatus === 'completed' ? 100 : 50,
                updatedAt: new Date().toLocaleTimeString(),
              }
            : t
        )
      );
    }
  };

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
            Durably stored in SQLite WAL. Track background offline tasks, execution progress, and agent roles (UB-P3-R01-003).
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => setIsCreating(!isCreating)}
            style={{
              padding: '6px 14px',
              borderRadius: 4,
              border: 'none',
              background: 'var(--accent-blue)',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {isCreating ? 'Cancel' : '+ New Task'}
          </button>
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
            Active ({tasks.filter((t) => t.status === 'running' || t.status === 'pending').length})
          </button>
          <button
            className={`filter-btn ${filter === 'COMPLETED' ? 'active' : ''}`}
            onClick={() => setFilter('COMPLETED')}
            style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid var(--border-color)', background: filter === 'COMPLETED' ? 'var(--bg-secondary)' : 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}
          >
            Completed ({tasks.filter((t) => t.status === 'completed').length})
          </button>
          <button
            onClick={fetchTasks}
            disabled={isLoading}
            style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}
          >
            🔄
          </button>
        </div>
      </div>

      {actionFeedback && (
        <div style={{ padding: '8px 12px', borderRadius: 6, marginBottom: 14, background: 'rgba(56, 189, 248, 0.15)', border: '1px solid var(--accent-blue)', color: 'var(--accent-blue)', fontSize: 12 }}>
          {actionFeedback}
        </div>
      )}

      {/* Inline Create Task Form */}
      {isCreating && (
        <form
          onSubmit={handleCreateTask}
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--accent-blue)',
            borderRadius: 8,
            padding: 16,
            marginBottom: 16,
            display: 'flex',
            gap: 12,
            alignItems: 'center',
          }}
        >
          <input
            type="text"
            placeholder="Enter task title or execution goal..."
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            autoFocus
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 4,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              fontSize: 13,
              outline: 'none',
            }}
          />
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            style={{
              padding: '8px 10px',
              borderRadius: 4,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              fontSize: 12,
            }}
          >
            <option value="IMPLEMENTER">Implementer</option>
            <option value="QA_SECURITY">QA / Security</option>
            <option value="ARCHITECT">Architect</option>
            <option value="RESEARCHER">Researcher</option>
          </select>
          <button
            type="submit"
            disabled={!newTitle.trim()}
            style={{
              padding: '8px 16px',
              borderRadius: 4,
              border: 'none',
              background: 'var(--accent-green)',
              color: '#000',
              fontWeight: 700,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Create Task
          </button>
        </form>
      )}

      {/* Tasks List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {filteredTasks.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
            <div>No tasks found. Create a new task to track background execution.</div>
          </div>
        ) : (
          filteredTasks.map((t) => {
            const displayName = t.title || t.name || 'Untitled Task';
            const progressVal = t.progress !== undefined ? t.progress : t.status === 'completed' ? 100 : 0;
            return (
              <div
                key={t.id}
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 8,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>
                        {displayName}
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
                              : t.status === 'failed'
                              ? 'var(--accent-red)'
                              : 'var(--accent-amber)',
                          color: '#000',
                        }}
                      >
                        {t.status}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                      ID: <code>{t.id}</code> • Role: <strong>{t.role || 'CORE'}</strong> {t.room_id ? `• Room: #${t.room_id}` : ''}
                    </div>
                  </div>

                  {/* Task Actions */}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {t.status !== 'running' && t.status !== 'completed' && (
                      <button
                        onClick={() => handleUpdateStatus(t.id, 'running', 50)}
                        style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid var(--accent-blue)', background: 'transparent', color: 'var(--accent-blue)', fontSize: 11, cursor: 'pointer' }}
                      >
                        Start
                      </button>
                    )}
                    {t.status !== 'completed' && (
                      <button
                        onClick={() => handleUpdateStatus(t.id, 'completed', 100)}
                        style={{ padding: '4px 10px', borderRadius: 4, border: 'none', background: 'var(--accent-green)', color: '#000', fontWeight: 600, fontSize: 11, cursor: 'pointer' }}
                      >
                        Complete
                      </button>
                    )}
                    {t.status !== 'failed' && (
                      <button
                        onClick={() => handleUpdateStatus(t.id, 'failed', progressVal)}
                        style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid var(--accent-red)', background: 'transparent', color: 'var(--accent-red)', fontSize: 11, cursor: 'pointer' }}
                      >
                        Fail
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                    <span>Progress</span>
                    <span>{progressVal}%</span>
                  </div>
                  <div style={{ width: '100%', height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${progressVal}%`,
                        height: '100%',
                        background: t.status === 'failed' ? 'var(--accent-red)' : t.status === 'completed' ? 'var(--accent-green)' : 'var(--accent-blue)',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
