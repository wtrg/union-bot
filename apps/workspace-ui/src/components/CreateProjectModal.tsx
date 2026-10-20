import React, { useState, useEffect } from 'react';
import { ProjectInfo } from '../types.ts';

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateProject: (name: string, description?: string, workspaceRoot?: string) => Promise<boolean>;
  onRenameProject?: (id: string, name: string) => Promise<boolean>;
  editingProject?: ProjectInfo | null;
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  isOpen,
  onClose,
  onCreateProject,
  onRenameProject,
  editingProject,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editingProject) {
      setName(editingProject.name || '');
      setDescription(editingProject.description || '');
      setWorkspaceRoot(editingProject.workspaceRoot || editingProject.workspace_root || '');
    } else {
      setName('');
      setDescription('');
      setWorkspaceRoot('');
    }
    setError(null);
  }, [editingProject, isOpen]);

  if (!isOpen) return null;

  const handleBrowseFolder = async () => {
    if (window.unionBotAPI && typeof window.unionBotAPI.selectDirectory === 'function') {
      try {
        const res = await window.unionBotAPI.selectDirectory({
          title: 'Chọn thư mục dự án (Project Workspace)',
          defaultPath: workspaceRoot || undefined,
        });
        if (res && res.success && res.path) {
          setWorkspaceRoot(res.path);
        }
      } catch (err: any) {
        console.warn('Folder selection error:', err);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Project name is required.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      let success = false;
      if (editingProject && onRenameProject) {
        success = await onRenameProject(editingProject.id, trimmedName);
      } else {
        success = await onCreateProject(trimmedName, description.trim() || undefined, workspaceRoot.trim() || undefined);
      }

      if (success) {
        setName('');
        setDescription('');
        setWorkspaceRoot('');
        onClose();
      } else {
        setError('Failed to save project. Please check if the name is unique.');
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        backdropFilter: 'blur(3px)',
      }}
    >
      <div
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 8,
          width: 440,
          maxWidth: '90vw',
          overflow: 'hidden',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
        }}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)' }}>
            {editingProject ? '✏️ Rename Project' : '📁 Create New Project'}
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: 18,
              cursor: 'pointer',
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: 20 }}>
          {error && (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 4,
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid var(--accent-red)',
                color: 'var(--accent-red)',
                fontSize: 12,
                marginBottom: 14,
              }}
            >
              {error}
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <label
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: 6,
              }}
            >
              Project Name *
            </label>
            <input
              type="text"
              data-testid="project-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Union Core, Marketing Reels, QA Alpha"
              disabled={isSubmitting}
              autoFocus
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 4,
                border: '1px solid var(--border-color)',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                fontSize: 13,
                outline: 'none',
              }}
            />
          </div>

          {!editingProject && (
            <>
              <div style={{ marginBottom: 14 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    marginBottom: 6,
                  }}
                >
                  Workspace Folder (Canonical Root)
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    data-testid="project-workspace-input"
                    value={workspaceRoot}
                    onChange={(e) => setWorkspaceRoot(e.target.value)}
                    placeholder="e.g. D:\Projects\MyWorkspace hoặc để trống để dùng thư mục an toàn"
                    disabled={isSubmitting}
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
                  <button
                    type="button"
                    data-testid="project-browse-btn"
                    onClick={handleBrowseFolder}
                    disabled={isSubmitting}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 4,
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-tertiary)',
                      color: 'var(--text-primary)',
                      fontSize: 12,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    📁 Browse...
                  </button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Thư mục làm việc cục bộ của dự án (hỗ trợ tiếng Việt có dấu và khoảng trắng).
                </div>
              </div>

              <div style={{ marginBottom: 18 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    marginBottom: 6,
                  }}
                >
                  Description (Optional)
                </label>
                <textarea
                  data-testid="project-desc-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Workspace scope, goals, and team isolation boundary"
                  rows={3}
                  disabled={isSubmitting}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 4,
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    fontSize: 13,
                    outline: 'none',
                    resize: 'vertical',
                  }}
                />
              </div>
            </>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              type="button"
              data-testid="project-cancel-btn"
              onClick={onClose}
              disabled={isSubmitting}
              style={{
                padding: '8px 16px',
                borderRadius: 4,
                border: '1px solid var(--border-color)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="project-submit-btn"
              disabled={isSubmitting || !name.trim()}
              style={{
                padding: '8px 16px',
                borderRadius: 4,
                border: 'none',
                background: 'var(--accent-blue)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: isSubmitting || !name.trim() ? 'not-allowed' : 'pointer',
                opacity: isSubmitting || !name.trim() ? 0.6 : 1,
              }}
            >
              {isSubmitting ? 'Saving...' : editingProject ? 'Update' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
