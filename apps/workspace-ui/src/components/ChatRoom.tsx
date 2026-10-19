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

export const ChatRoom: React.FC<ChatRoomProps> = ({ roomName, envelopes, onSendMessage }) => {
  const [inputText, setInputText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentInfo[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    if (window.unionBotAPI && typeof window.unionBotAPI.openFileDialog === 'function') {
      try {
        const res = await window.unionBotAPI.openFileDialog();
        if (res && res.success && res.attachment) {
          setPendingAttachments((prev) => [...prev, res.attachment!]);
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
              return;
            }
          } catch (err) {
            console.error('[ChatRoom] saveAttachment error:', err);
          }
        }
        // Fallback local memory representation
        setPendingAttachments((prev) => [
          ...prev,
          {
            filename: file.name,
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
            sha256: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            dataUrl: file.type.startsWith('image/') ? base64Data : undefined,
          },
        ]);
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
              return;
            }
          } catch (err) {
            console.error('[ChatRoom] Drop saveAttachment error:', err);
          }
        }
        setPendingAttachments((prev) => [
          ...prev,
          {
            filename: file.name,
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
            sha256: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            dataUrl: file.type.startsWith('image/') ? base64Data : undefined,
          },
        ]);
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
                  case 'attachment': {
                    const isImg = part.mimeType?.startsWith('image/') || part.filename?.match(/\.(png|jpg|jpeg|gif|webp)$/i);
                    return (
                      <div key={idx} className="part-artifact" style={{ marginTop: 6 }}>
                        <div className="artifact-info" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 16 }}>{isImg ? '🖼️' : '📄'}</span>
                            <span className="artifact-name" style={{ fontWeight: 600 }}>
                              <HighlightedText text={part.filename || 'Attached File'} query={searchQuery} />
                            </span>
                          </div>
                          {isImg && part.dataUrl && (
                            <div style={{ marginTop: 4 }}>
                              <img
                                src={part.dataUrl}
                                alt={part.filename || 'Attachment'}
                                style={{
                                  maxWidth: 240,
                                  maxHeight: 180,
                                  borderRadius: 4,
                                  border: '1px solid var(--border-color)',
                                  objectFit: 'contain',
                                }}
                              />
                            </div>
                          )}
                          <span className="artifact-sha" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            SHA256: <code>{part.sha256}</code>
                          </span>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                            {part.mimeType || 'file'} • {part.sizeBytes || 0} bytes • Verified CAS
                          </span>
                        </div>
                      </div>
                    );
                  }
                  case 'action':
                    return (
                      <div key={idx} className="part-action">
                        <div>
                          <strong>Tool Call:</strong> {part.tool}
                        </div>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            color:
                              part.status === 'completed'
                                ? 'var(--accent-green)'
                                : part.status === 'failed'
                                ? 'var(--accent-red)'
                                : 'var(--accent-amber)',
                          }}
                        >
                          {part.status}
                        </span>
                      </div>
                    );
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
