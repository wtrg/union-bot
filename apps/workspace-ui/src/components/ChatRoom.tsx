import React, { useState, useRef } from 'react';
import { EnvelopeView, AttachmentInfo, MessagePart } from '../types.ts';

interface ChatRoomProps {
  roomName?: string;
  envelopes: EnvelopeView[];
  onSendMessage: (text: string, attachments?: AttachmentInfo[]) => Promise<boolean> | boolean | void;
}

// Search Keyword Highlighting Component (UB-P3-R01-007)
const HighlightedText: React.FC<{ text?: string; query?: string }> = ({ text = '', query = '' }) => {
  if (!query.trim() || !text) return <>{text}</>;
  try {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const tokens = text.split(regex);
    return (
      <>
        {tokens.map((token, i) =>
          regex.test(token) ? (
            <mark key={i} className="search-highlight">
              {token}
            </mark>
          ) : (
            token
          )
        )}
      </>
    );
  } catch {
    return <>{text}</>;
  }
};

// Rich Artifact Preview Card (P5-002, P5-003, P5-004)
const ArtifactPreviewCard: React.FC<{ part: MessagePart; searchQuery: string }> = ({ part, searchQuery }) => {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);

  const isImg = part.mimeType?.startsWith('image/') || part.filename?.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i);
  const isCode = part.language || part.filename?.match(/\.(js|cjs|mjs|ts|tsx|json|html|css|py|rs|go|sh|md)$/i) || part.code || part.content;

  const handleCopySha = async () => {
    if (!part.sha256) return;
    try {
      await navigator.clipboard.writeText(part.sha256);
      setCopyStatus('Copied!');
      setTimeout(() => setCopyStatus(null), 2000);
    } catch {
      setCopyStatus('Failed to copy');
    }
  };

  const handleSaveAs = async () => {
    if (!part.sha256 || !window.unionBotAPI?.artifactSaveAs) return;
    try {
      setActionMessage('Saving...');
      const res = await window.unionBotAPI.artifactSaveAs({
        sha256: part.sha256,
        suggestedName: part.filename,
      });
      if (res.success) {
        setActionMessage(`Saved to ${res.savedPath}`);
      } else if (!res.canceled) {
        setActionMessage(`Error: ${res.error || 'Failed to save'}`);
      } else {
        setActionMessage(null);
      }
    } catch (err: any) {
      setActionMessage(`Error: ${err.message}`);
    }
    setTimeout(() => setActionMessage(null), 4000);
  };

  const handleShowInFolder = async () => {
    if (!part.sha256 || !window.unionBotAPI?.artifactShowInFolder) return;
    try {
      const res = await window.unionBotAPI.artifactShowInFolder(part.sha256);
      if (!res.success) {
        setActionMessage(`Error: ${res.error}`);
        setTimeout(() => setActionMessage(null), 3000);
      }
    } catch (err: any) {
      setActionMessage(`Error: ${err.message}`);
      setTimeout(() => setActionMessage(null), 3000);
    }
  };

  const handleOpenOriginal = async () => {
    if (!part.sha256 || !window.unionBotAPI?.artifactOpenOriginal) return;
    try {
      const res = await window.unionBotAPI.artifactOpenOriginal(part.sha256);
      if (!res.success) {
        setActionMessage(`Error: ${res.error}`);
        setTimeout(() => setActionMessage(null), 3000);
      }
    } catch (err: any) {
      setActionMessage(`Error: ${err.message}`);
      setTimeout(() => setActionMessage(null), 3000);
    }
  };

  const rawCode = part.content || part.code || '';
  const lines = rawCode ? rawCode.split('\n') : [];

  return (
    <div
      className="part-artifact"
      data-testid="part-artifact"
      style={{
        marginTop: 8,
        border: '1px solid var(--border-color)',
        borderRadius: 8,
        background: 'var(--bg-secondary)',
        overflow: 'hidden',
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'var(--bg-tertiary)',
          borderBottom: '1px solid var(--border-color)',
          fontSize: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
          <span style={{ fontSize: 16 }}>{isImg ? '🖼️' : isCode ? '💻' : '📄'}</span>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }} className="artifact-name">
            <HighlightedText text={part.filename || (part.sha256 ? `artifact-${part.sha256.slice(0, 8)}` : 'Artifact')} query={searchQuery} />
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            ({part.sizeBytes || 0} bytes • {part.mimeType || 'application/octet-stream'})
          </span>
        </div>

        {/* Action Toolbar (P5-004) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {part.sha256 && (
            <button
              onClick={handleCopySha}
              data-testid="artifact-copy-sha"
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 4,
                border: '1px solid var(--border-color)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
              title="Copy SHA-256 Digest"
            >
              {copyStatus || 'Copy SHA'}
            </button>
          )}

          {part.sha256 && (
            <button
              onClick={handleSaveAs}
              data-testid="artifact-save-as"
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 4,
                border: '1px solid var(--border-color)',
                background: 'transparent',
                color: '#38bdf8',
                cursor: 'pointer',
              }}
              title="Save file to local disk"
            >
              Save As...
            </button>
          )}

          {part.sha256 && (
            <button
              onClick={handleShowInFolder}
              data-testid="artifact-show-folder"
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 4,
                border: '1px solid var(--border-color)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
              title="Show file in folder"
            >
              Show in folder
            </button>
          )}

          {part.sha256 && (
            <button
              onClick={handleOpenOriginal}
              data-testid="artifact-open-original"
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 4,
                border: '1px solid var(--border-color)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
              title="Open with OS default program"
            >
              Open
            </button>
          )}
        </div>
      </div>

      {actionMessage && (
        <div style={{ padding: '4px 12px', fontSize: 11, background: 'var(--bg-tertiary)', color: '#4ade80' }}>
          {actionMessage}
        </div>
      )}

      {/* Previews (P5-002, P5-003) */}
      <div style={{ padding: 10 }}>
        {/* Image Preview */}
        {isImg && part.dataUrl && (
          <div style={{ display: 'flex', justifyContent: 'center', background: 'rgba(0,0,0,0.15)', borderRadius: 4, padding: 8 }}>
            <img
              src={part.dataUrl}
              alt={part.filename || 'Preview'}
              style={{
                maxWidth: '100%',
                maxHeight: 280,
                objectFit: 'contain',
                borderRadius: 4,
              }}
            />
          </div>
        )}

        {/* Code / Text Syntax Viewer with Line Numbers (P5-002) */}
        {isCode && rawCode && (
          <div style={{ position: 'relative', marginTop: 4, borderRadius: 4, background: '#0d1117', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: '#161b22', fontSize: 11, color: '#8b949e' }}>
              <span>{part.language || 'code'} • {lines.length} lines</span>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(rawCode);
                    setCodeCopied(true);
                    setTimeout(() => setCodeCopied(false), 2000);
                  } catch {}
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: codeCopied ? '#4ade80' : '#8b949e',
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                {codeCopied ? 'Copied code!' : 'Copy code'}
              </button>
            </div>
            <pre style={{ margin: 0, padding: '8px 12px', overflowX: 'auto', fontSize: 12, lineHeight: 1.5, fontFamily: 'monospace', color: '#e6edf3' }}>
              {lines.slice(0, 100).map((line, lIdx) => (
                <div key={lIdx} style={{ display: 'flex' }}>
                  <span style={{ width: 36, userSelect: 'none', color: '#484f58', textAlign: 'right', paddingRight: 12 }}>
                    {lIdx + 1}
                  </span>
                  <span><HighlightedText text={line} query={searchQuery} /></span>
                </div>
              ))}
              {lines.length > 100 && (
                <div style={{ color: '#8b949e', fontStyle: 'italic', paddingLeft: 48, paddingTop: 4 }}>
                  ... ({lines.length - 100} more lines truncated)
                </div>
              )}
            </pre>
          </div>
        )}

        {/* Test Result Card (P5-003) */}
        {part.testResult && (
          <div
            data-testid="test-result-card"
            style={{
              padding: 10,
              borderRadius: 6,
              background: part.testResult.passed ? 'rgba(74, 222, 128, 0.08)' : 'rgba(248, 113, 113, 0.08)',
              border: `1px solid ${part.testResult.passed ? '#4ade80' : '#f87171'}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: part.testResult.passed ? '#4ade80' : '#f87171' }}>
                {part.testResult.passed ? '✔ TEST SUITE PASSED' : '✖ TEST SUITE FAILED'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {part.testResult.durationMs ? `${part.testResult.durationMs}ms` : ''}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Suite: <strong>{part.testResult.suiteName}</strong>
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 12 }}>
              <span style={{ color: '#4ade80' }}>Passed: {part.testResult.passedCount}</span>
              <span style={{ color: '#f87171' }}>Failed: {part.testResult.failedCount}</span>
              <span style={{ color: 'var(--text-muted)' }}>Total: {part.testResult.total}</span>
            </div>
          </div>
        )}

        {/* CAS Verification Digest Badge */}
        {part.sha256 && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>Verified CAS:</span>
            <code style={{ fontSize: 10, background: 'var(--bg-tertiary)', padding: '2px 4px', borderRadius: 3 }}>
              {part.sha256}
            </code>
          </div>
        )}
      </div>
    </div>
  );
};

// Rich Action / MCP Tool Card (P5-008, P5-009)
const ActionToolCard: React.FC<{ part: MessagePart; searchQuery: string }> = ({ part, searchQuery }) => {
  const [copied, setCopied] = useState(false);
  const isCompleted = part.status === 'completed';
  const isFailed = part.status === 'failed';
  const isMcp = part.tool === 'calculator' || part.tool === 'artifact_inspect' || part.tool === 'workspace_summary' || part.mcpData;

  const handleCopyOutput = async () => {
    const textToCopy = typeof part.output === 'string' ? part.output : JSON.stringify(part.output, null, 2);
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div
      className="part-action"
      data-testid="part-action"
      style={{
        marginTop: 6,
        padding: '8px 12px',
        borderRadius: 6,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>{isMcp ? '⚡ MCP Tool:' : '⚙️ Tool Call:'}</span>
          <strong style={{ color: 'var(--text-primary)' }}>
            <HighlightedText text={part.tool} query={searchQuery} />
          </strong>
          {isMcp && (
            <span style={{ fontSize: 9, background: '#38bdf8', color: '#000', padding: '1px 4px', borderRadius: 2, fontWeight: 700 }}>
              LOCAL MCP
            </span>
          )}
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            color: isCompleted ? '#4ade80' : isFailed ? '#f87171' : '#fbbf24',
          }}
        >
          {part.status}
        </span>
      </div>

      {/* Tool Arguments */}
      {part.args && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
          Input: <code>{typeof part.args === 'string' ? part.args : JSON.stringify(part.args)}</code>
        </div>
      )}

      {/* Tool Output */}
      {part.output !== undefined && (
        <div style={{ marginTop: 4, background: '#0d1117', padding: '6px 8px', borderRadius: 4, position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
            <span style={{ fontSize: 10, color: '#8b949e' }}>Output:</span>
            <button
              onClick={handleCopyOutput}
              style={{ background: 'transparent', border: 'none', color: copied ? '#4ade80' : '#8b949e', cursor: 'pointer', fontSize: 10 }}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <pre style={{ margin: 0, fontSize: 11, color: '#e6edf3', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
            {typeof part.output === 'string' ? part.output : JSON.stringify(part.output, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

export const ChatRoom: React.FC<ChatRoomProps> = ({ roomName, envelopes, onSendMessage }) => {
  const [inputText, setInputText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentInfo[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportBundle = async () => {
    if (!window.unionBotAPI?.exportTranscriptBundle) return;
    try {
      setExportStatus('Exporting bundle...');
      const res = await window.unionBotAPI.exportTranscriptBundle({ roomId: roomName || 'orchestration' });
      if (res && res.success) {
        setExportStatus(`Exported ${res.artifactCount} artifacts!`);
      } else {
        setExportStatus(`Export failed: ${res?.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      setExportStatus(`Export error: ${err.message}`);
    }
    setTimeout(() => setExportStatus(null), 4000);
  };

  const handleImportBundle = async () => {
    if (!window.unionBotAPI?.importTranscriptBundle) return;
    try {
      let bundlePath = '';
      if (typeof window.unionBotAPI.selectDirectory === 'function') {
        const dirRes = await window.unionBotAPI.selectDirectory({ title: 'Select Transcript Bundle Directory' });
        if (dirRes && dirRes.success && dirRes.path) {
          bundlePath = dirRes.path;
        } else {
          return;
        }
      }
      if (!bundlePath) return;

      setExportStatus('Importing bundle...');
      const res = await window.unionBotAPI.importTranscriptBundle({
        bundleDir: bundlePath,
        targetRoomId: roomName || 'orchestration'
      });
      if (res && res.success) {
        setExportStatus(`Imported ${res.artifactCount || 0} artifacts & restored transcript!`);
      } else {
        setExportStatus(`Import failed: ${res?.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      setExportStatus(`Import error: ${err.message}`);
    }
    setTimeout(() => setExportStatus(null), 5000);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const textToSend = inputText.trim();
    if ((!textToSend && pendingAttachments.length === 0) || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const attachmentsToSend = [...pendingAttachments];
      const result = await onSendMessage(textToSend || '(Attached files)', attachmentsToSend);
      if (result !== false) {
        setInputText('');
        setPendingAttachments([]);
        setAttachmentError(null);
      }
    } catch (err) {
      console.error('[ChatRoom] Failed to send message:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleAttachClick = async () => {
    setAttachmentError(null);
    if (window.unionBotAPI && typeof window.unionBotAPI.openFileDialog === 'function') {
      try {
        const res = await window.unionBotAPI.openFileDialog();
        if (res && res.success && res.attachment) {
          setPendingAttachments((prev) => [...prev, res.attachment!]);
          return;
        } else if (res && !res.success && !res.canceled) {
          setAttachmentError(`Failed to attach file: ${res.error || 'Unknown error'}. Draft preserved.`);
          return;
        } else if (res && res.canceled) {
          return;
        }
      } catch (err) {
        console.warn('[ChatRoom] Native openFileDialog failed, falling back to input:', err);
      }
    }
    // Fallback: Trigger HTML file input
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setAttachmentError(null);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = (reader.result as string) || '';
        if (window.unionBotAPI && typeof window.unionBotAPI.saveAttachment === 'function') {
          try {
            const saveRes = await window.unionBotAPI.saveAttachment({
              filename: file.name,
              mimeType: file.type || 'application/octet-stream',
              dataBase64: base64Data,
            });
            if (saveRes && saveRes.success && saveRes.attachment) {
              setPendingAttachments((prev) => [...prev, saveRes.attachment!]);
              setAttachmentError(null);
              return;
            }
            // UB-P3-R04-G02: Never create fake SHA (local_...) when CAS save fails. Keep draft and report error.
            setAttachmentError(`Failed to save attachment '${file.name}' to CAS store: ${saveRes?.error || 'Save failed'}. Draft preserved.`);
            return;
          } catch (err: any) {
            console.error('[ChatRoom] saveAttachment error:', err);
            setAttachmentError(`Failed to save attachment '${file.name}' to CAS store: ${err?.message || err}. Draft preserved.`);
            return;
          }
        }
        setAttachmentError(`CAS storage API is unavailable. Cannot attach '${file.name}'. Draft preserved.`);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    setAttachmentError(null);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = (reader.result as string) || '';
        if (window.unionBotAPI && typeof window.unionBotAPI.saveAttachment === 'function') {
          try {
            const saveRes = await window.unionBotAPI.saveAttachment({
              filename: file.name,
              mimeType: file.type || 'application/octet-stream',
              dataBase64: base64Data,
            });
            if (saveRes && saveRes.success && saveRes.attachment) {
              setPendingAttachments((prev) => [...prev, saveRes.attachment!]);
              setAttachmentError(null);
              return;
            }
            // UB-P3-R04-G02: Never create fake SHA (local_...) when CAS save fails. Keep draft and report error.
            setAttachmentError(`Failed to save dropped attachment '${file.name}' to CAS store: ${saveRes?.error || 'Save failed'}. Draft preserved.`);
            return;
          } catch (err: any) {
            console.error('[ChatRoom] Drop saveAttachment error:', err);
            setAttachmentError(`Failed to save dropped attachment '${file.name}' to CAS store: ${err?.message || err}. Draft preserved.`);
            return;
          }
        }
        setAttachmentError(`CAS storage API is unavailable. Cannot attach '${file.name}'. Draft preserved.`);
      };
      reader.readAsDataURL(file);
    }
  };

  const removePendingAttachment = (index: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Filter envelopes by search query (P3-009)
  const filteredEnvelopes = envelopes.filter((env) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const senderMatch = env.sender?.name?.toLowerCase().includes(q) || env.sender?.role?.toLowerCase().includes(q);
    const partsMatch = env.parts?.some((p) => {
      if (p.text && p.text.toLowerCase().includes(q)) return true;
      if (p.filename && p.filename.toLowerCase().includes(q)) return true;
      if (p.code && p.code.toLowerCase().includes(q)) return true;
      return false;
    });
    return senderMatch || partsMatch;
  });

  return (
    <div
      className="chat-room"
      data-testid="chat-room"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Search & Filter Header with Keyword Highlighting (UB-P3-R01-007) */}
      <div
        style={{
          padding: '8px 16px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>🔍</span>
        <input
          type="text"
          data-testid="chat-search-input"
          placeholder="Filter messages or artifacts in this room (highlight matches)..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-primary)',
            fontSize: 13,
            outline: 'none',
          }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}
          >
            Clear
          </button>
        )}
        <button
          onClick={handleExportBundle}
          data-testid="export-transcript-bundle-btn"
          style={{
            padding: '3px 8px',
            borderRadius: 4,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-tertiary)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 12,
            whiteSpace: 'nowrap',
          }}
          title="Export complete room transcript and CAS manifest bundle (P5-011)"
        >
          📦 Export Bundle
        </button>
        <button
          onClick={handleImportBundle}
          data-testid="import-transcript-bundle-btn"
          style={{
            padding: '3px 8px',
            borderRadius: 4,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-tertiary)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 12,
            whiteSpace: 'nowrap',
          }}
          title="Import and restore a transcript backup bundle (UAT-021)"
        >
          📥 Import Bundle
        </button>
        {exportStatus && (
          <span style={{ fontSize: 11, color: '#4ade80', whiteSpace: 'nowrap' }}>{exportStatus}</span>
        )}
      </div>

      {/* Chat Messages Feed */}
      <div className="chat-feed" style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {filteredEnvelopes.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--text-muted)',
              textAlign: 'center',
              padding: 40,
            }}
          >
            {/* First-Run Onboarding Banner (UB-P3-R01-007) */}
            <div
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: 12,
                padding: '24px 32px',
                maxWidth: 480,
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 36, marginBottom: 10 }}>👋</div>
              <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text-primary)', marginBottom: 8 }}>
                Welcome to #{roomName || 'Room'}
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                Zero-Cost 0đ Desktop AI Workspace is active. All interactions and attachments are stored locally in SQLite WAL and Content Addressable Storage (CAS).
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16, textAlign: 'left', fontSize: 12, color: 'var(--text-muted)' }}>
                <div>💬 <strong>Coordinate:</strong> Send directives and collaboration messages.</div>
                <div>📎 <strong>Attachments:</strong> Drag & drop PNG diagrams or PDF documents into this room.</div>
                <div>🛡️ <strong>Governance:</strong> Sensitive actions trigger Approval Inbox review.</div>
              </div>
            </div>
          </div>
        ) : (
          filteredEnvelopes.map((env) => (
            <div key={env.id} className="envelope-card" data-testid="envelope-card">
              <div className="envelope-meta">
                <div className="sender-tag">
                  <span className="sender-name">
                    <HighlightedText text={env.sender.name} query={searchQuery} />
                  </span>
                  {env.sender.role && (
                    <span className="sender-role">
                      <HighlightedText text={env.sender.role} query={searchQuery} />
                    </span>
                  )}
                  {env.isDemo && (
                    <span
                      style={{
                        fontSize: 9,
                        color: 'var(--accent-amber)',
                        border: '1px solid var(--accent-amber)',
                        padding: '1px 4px',
                        borderRadius: 2,
                      }}
                    >
                      MOCK PREVIEW
                    </span>
                  )}
                </div>
                <span>
                  {new Date(env.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>

              {env.parts.map((part: MessagePart, idx: number) => {
                switch (part.kind) {
                  case 'text':
                    return (
                      <div key={idx} className="part-text" data-testid="message-text" style={{ whiteSpace: 'pre-wrap' }}>
                        <HighlightedText text={part.text} query={searchQuery} />
                      </div>
                    );
                  case 'code':
                    return (
                      <div key={idx} className="part-code">
                        {part.filename && (
                          <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>
                            // File: <HighlightedText text={part.filename} query={searchQuery} />
                          </div>
                        )}
                        <code>
                          <HighlightedText text={part.content || part.code} query={searchQuery} />
                        </code>
                      </div>
                    );
                  case 'artifact':
                  case 'attachment':
                    return <ArtifactPreviewCard key={idx} part={part} searchQuery={searchQuery} />;
                  case 'test_result':
                    return <ArtifactPreviewCard key={idx} part={part} searchQuery={searchQuery} />;
                  case 'action':
                    return <ActionToolCard key={idx} part={part} searchQuery={searchQuery} />;
                  default:
                    return null;
                }
              })}
            </div>
          ))
        )}
      </div>

      {/* Drag & Drop Overlay */}
      {isDragging && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(56, 189, 248, 0.1)',
            border: '2px dashed var(--accent-blue)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            pointerEvents: 'none',
          }}
        >
          <div style={{ background: 'var(--bg-secondary)', padding: '16px 24px', borderRadius: 8, fontWeight: 600, color: 'var(--accent-blue)' }}>
            📥 Drop files to attach (PNG, PDF, etc.)
          </div>
        </div>
      )}

      {/* Pending Attachments Bar */}
      {pendingAttachments.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            padding: '8px 14px',
            background: 'var(--bg-tertiary)',
            borderTop: '1px solid var(--border-color)',
          }}
        >
          {pendingAttachments.map((att, i) => (
            <div
              key={i}
              data-testid="pending-attachment-chip"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: 4,
                padding: '4px 8px',
                fontSize: 12,
              }}
            >
              <span>{att.mimeType?.startsWith('image/') ? '🖼️' : '📄'}</span>
              <span style={{ fontWeight: 600, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {att.filename}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>({Math.round(att.sizeBytes / 1024)} KB)</span>
              <button
                type="button"
                onClick={() => removePendingAttachment(i)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--accent-red)',
                  cursor: 'pointer',
                  fontWeight: 700,
                  padding: '0 2px',
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Attachment Error Banner (UB-P3-R04-G02) */}
      {attachmentError && (
        <div
          data-testid="chat-attachment-error"
          style={{
            padding: '8px 14px',
            background: 'rgba(239, 68, 68, 0.1)',
            borderTop: '1px solid var(--accent-red)',
            color: 'var(--accent-red)',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>⚠️ {attachmentError}</span>
          <button
            type="button"
            onClick={() => setAttachmentError(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--accent-red)',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Multi-line Composer with Attachment Button (P3-004) */}
      <form
        className="chat-input-bar"
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 8,
          padding: '10px 14px',
          background: 'var(--bg-secondary)',
          borderTop: '1px solid var(--border-color)',
        }}
      >
        <input
          type="file"
          ref={fileInputRef}
          data-testid="chat-file-input"
          onChange={handleFileInputChange}
          multiple
          accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.json,.md"
          style={{ display: 'none' }}
        />

        <button
          type="button"
          data-testid="chat-composer-attach-btn"
          onClick={handleAttachClick}
          title="Attach file (PNG, PDF, etc.)"
          style={{
            background: 'transparent',
            border: '1px solid var(--border-color)',
            color: 'var(--text-primary)',
            borderRadius: 4,
            padding: '8px 10px',
            cursor: 'pointer',
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          📎
        </button>

        <textarea
          className="chat-input"
          data-testid="chat-composer-textarea"
          placeholder="Type message (Shift+Enter for newline, Enter to send)..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          style={{
            flex: 1,
            resize: 'none',
            padding: '8px 12px',
            borderRadius: 4,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            fontSize: 13,
            lineHeight: 1.4,
            outline: 'none',
          }}
        />

        <button
          type="submit"
          className="send-button"
          data-testid="chat-composer-send-btn"
          disabled={isSubmitting || (!inputText.trim() && pendingAttachments.length === 0)}
          style={{
            padding: '8px 16px',
            borderRadius: 4,
            border: 'none',
            background: 'var(--accent-blue)',
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
            height: 38,
          }}
        >
          {isSubmitting ? '...' : 'Send'}
        </button>
      </form>
    </div>
  );
};
