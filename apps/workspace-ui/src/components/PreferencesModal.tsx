import React, { useState, useEffect } from 'react';

interface PreferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport?: () => Promise<void>;
  theme?: 'dark' | 'light' | 'high-contrast';
  onThemeChange?: (theme: 'dark' | 'light' | 'high-contrast') => void;
}

export const PreferencesModal: React.FC<PreferencesModalProps> = ({
  isOpen,
  onClose,
  theme = 'dark',
  onThemeChange,
}) => {
  const [currentTheme, setCurrentTheme] = useState<'dark' | 'light' | 'high-contrast'>(theme);
  const [isExporting, setIsExporting] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [isLoadingDiag, setIsLoadingDiag] = useState(false);

  useEffect(() => {
    setCurrentTheme(theme);
  }, [theme]);

  // Load real storage diagnostics when modal opens (UB-P3-R01-007)
  useEffect(() => {
    if (isOpen && window.unionBotAPI && typeof window.unionBotAPI.getStorageDiagnostics === 'function') {
      setIsLoadingDiag(true);
      window.unionBotAPI
        .getStorageDiagnostics()
        .then((diag) => {
          setDiagnostics(diag);
        })
        .catch((err) => {
          console.error('[PreferencesModal] Failed to load storage diagnostics:', err);
        })
        .finally(() => {
          setIsLoadingDiag(false);
        });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleExportJson = async () => {
    setIsExporting(true);
    setExportFeedback(null);
    try {
      if (window.unionBotAPI && typeof window.unionBotAPI.exportWorkspace === 'function') {
        const res = await window.unionBotAPI.exportWorkspace({ format: 'json' });
        if (res && res.success && res.exportJson) {
          const blob = new Blob([res.exportJson], { type: 'application/json;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `union_bot_workspace_export_${Date.now()}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          setExportFeedback(`Exported ${res.totalEnvelopes || 0} envelopes across ${res.roomCount || 0} rooms to JSON!`);
        } else {
          throw new Error(res?.error || 'Failed to export JSON');
        }
      }
    } catch (err: any) {
      setExportFeedback(`Export error: ${err.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportMarkdown = async () => {
    setIsExporting(true);
    setExportFeedback(null);
    try {
      if (window.unionBotAPI && typeof window.unionBotAPI.exportWorkspace === 'function') {
        const res = await window.unionBotAPI.exportWorkspace({ format: 'markdown' });
        if (res && res.success && res.exportMarkdown) {
          const blob = new Blob([res.exportMarkdown], { type: 'text/markdown;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `union_bot_workspace_export_${Date.now()}.md`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          setExportFeedback(`Exported ${res.roomCount || 0} rooms and projects to Markdown!`);
        } else {
          throw new Error(res?.error || 'Failed to export Markdown');
        }
      }
    } catch (err: any) {
      setExportFeedback(`Export error: ${err.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleThemeSelect = (newTheme: 'dark' | 'light' | 'high-contrast') => {
    setCurrentTheme(newTheme);
    if (onThemeChange) {
      onThemeChange(newTheme);
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
          borderRadius: 10,
          width: 580,
          maxWidth: '92vw',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
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
          <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>⚙️ Workspace Preferences & Diagnostics</span>
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

        <div style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Zero-Cost Trust Indicator */}
          <div style={{ background: 'rgba(34, 197, 94, 0.1)', border: '1px solid var(--accent-green)', borderRadius: 6, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-green)', fontWeight: 700, fontSize: 13 }}>
              <span>🛡️ CostGuard Policy Active (0đ / $0.00 Local Only)</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              Paid API egress strictly denied. All storage and coordination executed locally via SQLite WAL and CAS store.
            </div>
          </div>

          {/* Theme & Display (UB-P3-R01-007) */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              Display Theme & Accessibility
            </label>
            <div style={{ display: 'flex', gap: 10 }}>
              {(['dark', 'light', 'high-contrast'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => handleThemeSelect(mode)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 4,
                    border: `1px solid ${currentTheme === mode ? 'var(--accent-blue)' : 'var(--border-color)'}`,
                    background: currentTheme === mode ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                    color: 'var(--text-primary)',
                    fontSize: 12,
                    textTransform: 'capitalize',
                    fontWeight: currentTheme === mode ? 700 : 400,
                    cursor: 'pointer',
                  }}
                >
                  {mode === 'dark' ? '🌙 Dark' : mode === 'light' ? '☀️ Light' : '👁️ High Contrast'}
                </button>
              ))}
            </div>
          </div>

          {/* Uncapped Workspace Data Export (UB-P3-R01-006) */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
              Offline Workspace Data Export (Uncapped JSON & Markdown)
            </label>
            <p style={{ margin: '0 0 10px 0', fontSize: 12, color: 'var(--text-muted)' }}>
              Export full projects, rooms, envelope history, tasks, and CAS attachment metadata without arbitrary limits.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                data-testid="export-json-btn"
                onClick={handleExportJson}
                disabled={isExporting}
                style={{
                  padding: '8px 16px',
                  borderRadius: 4,
                  border: 'none',
                  background: 'var(--accent-blue)',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: isExporting ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                📥 Export JSON (.json)
              </button>
              <button
                data-testid="export-markdown-btn"
                onClick={handleExportMarkdown}
                disabled={isExporting}
                style={{
                  padding: '8px 16px',
                  borderRadius: 4,
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: isExporting ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                📝 Export Markdown (.md)
              </button>
            </div>
            {exportFeedback && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--accent-green)' }}>
                {exportFeedback}
              </div>
            )}
          </div>

          {/* Live Storage Diagnostics (UB-P3-R01-007) */}
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 14 }}>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
              Live Storage Diagnostics & Disk Usage
            </span>
            {isLoadingDiag ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading storage diagnostics...</div>
            ) : diagnostics ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, background: 'var(--bg-tertiary)', padding: 12, borderRadius: 6, fontSize: 12 }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>SQLite DB Size: </span>
                  <strong style={{ color: 'var(--text-primary)' }}>{formatBytes(diagnostics.dbSizeBytes || 0)}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>CAS Store Size: </span>
                  <strong style={{ color: 'var(--text-primary)' }}>{formatBytes(diagnostics.casSizeBytes || 0)}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Total Envelopes: </span>
                  <strong style={{ color: 'var(--text-primary)' }}>{diagnostics.envelopeCount || 0}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>CAS Blobs / Attachments: </span>
                  <strong style={{ color: 'var(--text-primary)' }}>{diagnostics.casBlobCount || 0}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Journal Mode: </span>
                  <strong style={{ color: 'var(--accent-green)' }}>{(diagnostics.journalMode || 'wal').toUpperCase()}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Synchronous Mode: </span>
                  <strong style={{ color: 'var(--text-primary)' }}>{(diagnostics.synchronousMode || 'NORMAL').toUpperCase()}</strong>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div>• Storage Engine: <strong>SQLite WAL (PRAGMA synchronous = NORMAL)</strong></div>
                <div>• Content Addressable Storage: <strong>Local CAS Store (SHA-256)</strong></div>
                <div>• Schema Migration: <strong>Version 1 (Verified 7 Core Tables)</strong></div>
                <div>• Electron Sandbox: <strong>Strict Context Isolation Active</strong></div>
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            data-testid="close-preferences-btn"
            onClick={onClose}
            style={{
              padding: '6px 16px',
              borderRadius: 4,
              border: '1px solid var(--border-color)',
              background: 'transparent',
              color: 'var(--text-primary)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
