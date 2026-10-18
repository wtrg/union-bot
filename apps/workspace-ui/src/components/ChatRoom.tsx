import React, { useState } from 'react';
import { EnvelopeView } from '../types.ts';

interface ChatRoomProps {
  roomName?: string;
  envelopes: EnvelopeView[];
  onSendMessage: (text: string) => void;
}

export const ChatRoom: React.FC<ChatRoomProps> = ({ roomName, envelopes, onSendMessage }) => {
  const [inputText, setInputText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div className="chat-feed">
        {envelopes.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
            <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}>#{roomName || 'Room'} Ready</div>
            <div style={{ fontSize: 13, marginTop: 6, maxWidth: 360 }}>
              Zero-Cost (0đ) collaboration channel active. Send a message to start real-time coordination.
            </div>
          </div>
        ) : (
          envelopes.map((env) => (
            <div key={env.id} className="envelope-card">
              <div className="envelope-meta">
                <div className="sender-tag">
                  <span className="sender-name">{env.sender.name}</span>
                  {env.sender.role && (
                    <span className="sender-role">{env.sender.role}</span>
                  )}
                  {env.isDemo && (
                    <span style={{ fontSize: 9, color: 'var(--accent-amber)', border: '1px solid var(--accent-amber)', padding: '1px 4px', borderRadius: 2 }}>
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

            {env.parts.map((part, idx) => {
              switch (part.kind) {
                case 'text':
                  return (
                    <div key={idx} className="part-text">
                      {part.text}
                    </div>
                  );
                case 'code':
                  return (
                    <div key={idx} className="part-code">
                      {part.filename && (
                        <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>
                          // File: {part.filename}
                        </div>
                      )}
                      <code>{part.content || part.code}</code>
                    </div>
                  );
                case 'artifact':
                  return (
                    <div key={idx} className="part-artifact">
                      <div className="artifact-info">
                        <span className="artifact-name">
                          📦 {part.filename || 'Artifact'}
                        </span>
                        <span className="artifact-sha">
                          SHA256: {part.sha256}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          {part.mimeType} • {part.sizeBytes} bytes • Verified CAS
                        </span>
                      </div>
                    </div>
                  );
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
        )))}
      </div>

      <form className="chat-input-bar" onSubmit={handleSubmit}>
        <input
          type="text"
          className="chat-input"
          placeholder="Collaborate with Union Bot team (offline safe, zero-cost)..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
        />
        <button type="submit" className="send-button">
          Send
        </button>
      </form>
    </div>
  );
};
