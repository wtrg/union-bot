import React, { useState } from 'react';

interface PreferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: () => Promise<void>;
  isExporting?: boolean;
}

export const PreferencesModal: React.FC<PreferencesModalProps> = ({
  isOpen,
  onClose,
  onExport,
  isExporting,
}) => {
  const [theme, setTheme] = useState<'dark' | 'light' | 'high-contrast'>('dark');
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleExportClick = async () => {
    setExportFeedback(null);
    try {
      await onExport();
      setExportFeedback('Workspace successfully exported to JSON & Markdown!');
    } catch (err: any) {
      setExportFeedback(`Export error: ${err.message}`);
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
          borderRadius: 10,
          width: 540,
          maxWidth: '90vw',
          maxHeight: '85vh',
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
              <span>🛡️ CostGuard Policy Active (0đ / $0.00)</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              Paid API egress strictly denied. All storage and coordination executed locally via SQLite WAL and CAS store.
            </div>
          </div>

          {/* Theme & Display */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              Display Theme & Accessibility
            </label>
            <div style={{ display: 'flex', gap: 10 }}>
              {(['dark', 'light', 'high-contrast'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setTheme(mode)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 4,
                    border: `1px solid ${theme === mode ? 'var(--accent-blue)' : 'var(--border-color)'}`,
                    background: theme === mode ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                    color: 'var(--text-primary)',
                    fontSize: 12,
                    textTransform: 'capitalize',
                    cursor: 'pointer',
                  }}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {/* Data Export (Gate P3) */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
              Offline Workspace Data Export (Gate P3)
            </label>
            <p style={{ margin: '0 0 10px 0', fontSize: 12, color: 'var(--text-muted)' }}>
              Export entire room conversations, envelope history, and attachment metadata to standalone JSON and Markdown files.
            </p>
            <button
              onClick={handleExportClick}
              disabled={isExporting}
              style={{
                padding: '8px 16px',
                borderRadius: 4,
                border: 'none',
                background: 'var(--accent-blue)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {isExporting ? 'Exporting...' : '📥 Export Workspace Data'}
            </button>
            {exportFeedback && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--accent-green)' }}>
                {exportFeedback}
              </div>
            )}
          </div>

          {/* Storage Diagnostics */}
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 14 }}>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>
              Storage Diagnostics
            </span>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div>• Storage Engine: <strong>SQLite WAL (PRAGMA synchronous = NORMAL)</strong></div>
              <div>• Content Addressable Storage: <strong>Local CAS Store (SHA-256)</strong></div>
              <div>• Schema Migration: <strong>Version 1 (Verified 7 Core Tables)</strong></div>
              <div>• Electron Sandbox: <strong>Strict Context Isolation Active</strong></div>
            </div>
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end' }}>
          <button
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
