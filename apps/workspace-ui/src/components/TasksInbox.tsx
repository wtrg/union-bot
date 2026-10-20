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
  const [dispatchingTaskIds, setDispatchingTaskIds] = useState<Set<string>>(new Set());

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

    let unsubscribe: (() => void) | undefined;
    if (window.unionBotAPI?.onTaskUpdated) {
      unsubscribe = window.unionBotAPI.onTaskUpdated((update) => {
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== update.taskId) return t;
            return {
              ...t,
              status: update.status || t.status,
              progress: typeof update.progress === 'number' ? update.progress : t.progress,
              metadata: { ...(t.metadata || {}), ...(update.metadata || {}) }
            };
          })
        );
      });
    }

    return () => {
      clearInterval(interval);
      if (unsubscribe) unsubscribe();
    };
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
      const newTask: TaskItem = {
        id: `task_${Date.now()}`,
        title,
        status: 'pending',
        role: newRole,
        progress: 0,
        metadata: { role: newRole },
        updatedAt: new Date().toLocaleTimeString(),
      };
      setTasks((prev) => [newTask, ...prev]);
      setNewTitle('');
      setIsCreating(false);
    }
  };

  const handleExecuteTask = async (taskId: string) => {
    if (dispatchingTaskIds.has(taskId)) return; // Anti-double-dispatch

    setDispatchingTaskIds((prev) => new Set(prev).add(taskId));
    setActionFeedback(`Dispatching task execution for ${taskId}...`);

    if (window.unionBotAPI && typeof window.unionBotAPI.executeTask === 'function') {
      try {
        const res = await window.unionBotAPI.executeTask({ taskId });
        if (res && res.success) {
          if (res.status === 'completed') {
            setActionFeedback(`Task ${taskId} completed successfully.`);
          } else if (res.status === 'waiting_input') {
            setActionFeedback(`Task ${taskId} is waiting for user input.`);
          } else if (res.status === 'blocked') {
            setActionFeedback(`Task ${taskId} is blocked: ${res.error || 'Authentication or quota required'}`);
          } else if (res.status === 'cancelled') {
            setActionFeedback(`Task ${taskId} was cancelled.`);
          } else {
            setActionFeedback(`Task ${taskId} dispatched (status: ${res.status || 'running'}).`);
          }
        } else {
          setActionFeedback(`Task ${taskId} failed: ${res?.error || 'Unknown execution error'}`);
        }
      } catch (err: any) {
        setActionFeedback(`Error dispatching task ${taskId}: ${err.message}`);
      } finally {
        setDispatchingTaskIds((prev) => {
          const next = new Set(prev);
          next.delete(taskId);
          return next;
        });
        await fetchTasks();
      }
    } else {
      setActionFeedback(`ERR_API_UNAVAILABLE: executeTask API is not available in current window environment`);
      setDispatchingTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  };

  const handleCancelTask = async (taskId: string) => {
    if (window.unionBotAPI && typeof window.unionBotAPI.cancelTask === 'function') {
      try {
        setActionFeedback(`Requesting cancellation for task ${taskId}...`);
        const res = await window.unionBotAPI.cancelTask({ taskId });
        if (res && res.success) {
          setActionFeedback(`Task ${taskId} cancel request acknowledged (${res.status || 'cancelled'}).`);
          await fetchTasks();
        } else {
          setActionFeedback(`Failed to cancel task: ${res?.error || 'Unknown error'}`);
        }
      } catch (err: any) {
        setActionFeedback(`Error cancelling task: ${err.message}`);
      }
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
                              : t.status === 'waiting_input' || t.status === 'blocked'
                              ? '#f59e0b'
                              : t.status === 'cancelled'
                              ? '#6b7280'
                              : 'var(--accent-amber)',
                          color: '#000',
                        }}
                      >
                        {t.status}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                      ID: <code>{t.id}</code> • Role: <strong>{t.metadata?.role || t.role || 'IMPLEMENTER'}</strong> {t.room_id ? `• Room: #${t.room_id}` : ''}
                    </div>
                  </div>

                  {/* Task Actions - Real Native Execution (No Fake Completions) */}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {(t.status === 'pending' || t.status === 'failed' || t.status === 'cancelled') && (
                      <button
                        disabled={dispatchingTaskIds.has(t.id)}
                        onClick={() => handleExecuteTask(t.id)}
                        style={{
                          padding: '4px 12px',
                          borderRadius: 4,
                          border: 'none',
                          background: dispatchingTaskIds.has(t.id) ? 'var(--bg-tertiary)' : 'var(--accent-blue)',
                          color: '#fff',
                          fontWeight: 600,
                          fontSize: 11,
                          cursor: dispatchingTaskIds.has(t.id) ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {dispatchingTaskIds.has(t.id) ? 'Dispatching...' : 'Start Execution'}
                      </button>
                    )}
                    {t.status === 'running' && (
                      <button
                        onClick={() => handleCancelTask(t.id)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 4,
                          border: '1px solid var(--accent-red)',
                          background: 'transparent',
                          color: 'var(--accent-red)',
                          fontWeight: 600,
                          fontSize: 11,
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                    <span>{t.metadata?.statusMessage || (t.status === 'running' ? 'Executing natively...' : 'Status')}</span>
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

                {/* Real Execution Result Display */}
                {t.metadata?.executionResult && (
                  <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 6, background: 'var(--bg-tertiary)', border: '1px solid rgba(74, 222, 128, 0.3)', fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ color: 'var(--accent-green)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>✔</span> Execution Verified & Complete
                      </span>
                      {t.metadata.executionResult.verifiedByCodex && (
                        <span style={{ fontSize: 10, background: 'rgba(56, 189, 248, 0.2)', color: 'var(--accent-blue)', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>
                          Codex Verified (Digest & Boundary)
                        </span>
                      )}
                    </div>
                    {t.metadata.executionResult.artifactPath && (
                      <div style={{ color: 'var(--text-primary)', marginBottom: 4 }}>
                        <strong>Artifact:</strong> <code>{t.metadata.executionResult.artifactPath}</code>
                        {t.metadata.executionResult.bytesWritten !== undefined && (
                          <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>({t.metadata.executionResult.bytesWritten} bytes)</span>
                        )}
                      </div>
                    )}
                    {t.metadata.executionResult.digest && (
                      <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 6 }}>
                        <strong>SHA-256 CAS:</strong> <code>{t.metadata.executionResult.digest}</code>
                      </div>
                    )}
                    {t.metadata.executionResult.output && (
                      <pre style={{ margin: 0, padding: 8, borderRadius: 4, background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 11, overflowX: 'auto', maxHeight: 150 }}>
                        {t.metadata.executionResult.output}
                      </pre>
                    )}
                  </div>
                )}

                {/* Real Error Display */}
                {(t.metadata?.error || (t.status === 'failed' && t.metadata?.statusMessage)) && (
                  <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 6, background: 'rgba(239, 68, 68, 0.15)', border: '1px solid var(--accent-red)', color: 'var(--accent-red)', fontSize: 12 }}>
                    <strong>Execution Error:</strong> {t.metadata?.error || t.metadata?.statusMessage}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
