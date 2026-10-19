import React, { useState, useEffect } from 'react';
import { ApprovalTokenRecord } from '../types.ts';

interface ApprovalInboxProps {
  onTokenStatusChanged?: () => void;
}

export const ApprovalInbox: React.FC<ApprovalInboxProps> = ({ onTokenStatusChanged }) => {
  const [tokens, setTokens] = useState<ApprovalTokenRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'RESOLVED'>('ALL');
  const [actionMessage, setActionMessage] = useState<{ text: string; isError?: boolean } | null>(null);

  const fetchApprovals = async () => {
    if (!window.unionBotAPI) return;
    setIsLoading(true);
    try {
      const list = await window.unionBotAPI.listApprovals({ limit: 100 });
      setTokens(list || []);
    } catch (err: any) {
      console.error('[ApprovalInbox] Failed to load approvals:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchApprovals();
    const interval = setInterval(fetchApprovals, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleApprove = async (token: ApprovalTokenRecord) => {
    if (!window.unionBotAPI) return;
    setActionMessage(null);
    try {
      const res = await window.unionBotAPI.approveToken({
        tokenId: token.token_id,
        decisionContext: {
          expectedDigest: token.payload_digest,
          actionType: token.action_type,
          confirmedByUser: true,
        },
      });
      if (res && res.success) {
        setActionMessage({ text: `Token ${token.token_id.slice(0, 8)}... successfully approved!` });
        await fetchApprovals();
        if (onTokenStatusChanged) onTokenStatusChanged();
      } else {
        setActionMessage({ text: `Approval failed: ${res?.error || 'Unknown error'}`, isError: true });
      }
    } catch (err: any) {
      setActionMessage({ text: `Approval error: ${err.message}`, isError: true });
    }
  };

  const handleReject = async (token: ApprovalTokenRecord) => {
    if (!window.unionBotAPI) return;
    setActionMessage(null);
    try {
      const res = await window.unionBotAPI.rejectApproval(token.token_id, 'Action rejected by operator via Approval Inbox');
      if (res && res.success) {
        setActionMessage({ text: `Token ${token.token_id.slice(0, 8)}... rejected.` });
        await fetchApprovals();
        if (onTokenStatusChanged) onTokenStatusChanged();
      } else {
        setActionMessage({ text: `Rejection failed: ${res?.error || 'Unknown error'}`, isError: true });
      }
    } catch (err: any) {
      setActionMessage({ text: `Rejection error: ${err.message}`, isError: true });
    }
  };

  const filteredTokens = tokens.filter((t) => {
    if (filter === 'PENDING') return t.status === 'PENDING';
    if (filter === 'RESOLVED') return t.status !== 'PENDING';
    return true;
  });

  const pendingCount = tokens.filter((t) => t.status === 'PENDING').length;

  return (
    <div className="inbox-container" style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: 24, overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>🛡️ Approval Inbox</span>
            {pendingCount > 0 && (
              <span style={{ background: 'var(--accent-amber)', color: '#000', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 12 }}>
                {pendingCount} PENDING
              </span>
            )}
          </h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Human-in-the-loop governance: Inspect action parameters and cryptographic digests before affirmative authorization (P3-C01).
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`filter-btn ${filter === 'ALL' ? 'active' : ''}`}
            onClick={() => setFilter('ALL')}
            style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid var(--border-color)', background: filter === 'ALL' ? 'var(--bg-secondary)' : 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}
          >
            All ({tokens.length})
          </button>
          <button
            className={`filter-btn ${filter === 'PENDING' ? 'active' : ''}`}
            onClick={() => setFilter('PENDING')}
            style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid var(--border-color)', background: filter === 'PENDING' ? 'var(--bg-secondary)' : 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}
          >
            Pending ({pendingCount})
          </button>
          <button
            className={`filter-btn ${filter === 'RESOLVED' ? 'active' : ''}`}
            onClick={() => setFilter('RESOLVED')}
            style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid var(--border-color)', background: filter === 'RESOLVED' ? 'var(--bg-secondary)' : 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}
          >
            Resolved ({tokens.length - pendingCount})
          </button>
          <button
            onClick={fetchApprovals}
            disabled={isLoading}
            style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {actionMessage && (
        <div style={{ padding: '10px 14px', borderRadius: 6, marginBottom: 16, background: actionMessage.isError ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)', border: `1px solid ${actionMessage.isError ? 'var(--accent-red)' : 'var(--accent-green)'}`, color: actionMessage.isError ? 'var(--accent-red)' : 'var(--accent-green)', fontSize: 13 }}>
          {actionMessage.text}
        </div>
      )}

      {filteredTokens.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--text-muted)', padding: 60 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
          <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>No approval tokens matching filter</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>All automated actions are verified or awaiting dispatch.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {filteredTokens.map((token) => (
            <div
              key={token.token_id}
              className="approval-card"
              style={{
                background: 'var(--bg-secondary)',
                border: `1px solid ${token.status === 'PENDING' ? 'var(--accent-amber)' : 'var(--border-color)'}`,
                borderRadius: 8,
                padding: 16,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
                      Action: {token.action_type}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 3,
                        background:
                          token.status === 'APPROVED'
                            ? 'var(--accent-green)'
                            : token.status === 'CONSUMED'
                            ? 'var(--accent-blue)'
                            : token.status === 'REJECTED'
                            ? 'var(--accent-red)'
                            : 'var(--accent-amber)',
                        color: token.status === 'PENDING' ? '#000' : '#fff',
                      }}
                    >
                      {token.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Token ID: <code>{token.token_id}</code> • Created: {new Date(token.created_at).toLocaleString()}
                  </div>
                </div>

                {token.status === 'PENDING' && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => handleReject(token)}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 4,
                        border: '1px solid var(--accent-red)',
                        background: 'transparent',
                        color: 'var(--accent-red)',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => handleApprove(token)}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 4,
                        border: 'none',
                        background: 'var(--accent-green)',
                        color: '#000',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Approve & Authorize
                    </button>
                  </div>
                )}
              </div>

              {/* Detailed Parameter Inspection (P3-C01 Requirement) */}
              <div style={{ background: 'var(--bg-tertiary)', padding: 12, borderRadius: 6, fontSize: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Origin: </span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{token.origin || 'Renderer IPC'}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Workspace: </span>
                  <span style={{ color: 'var(--text-primary)' }}>{token.workspace_id || 'active-workspace'}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Room: </span>
                  <span style={{ color: 'var(--text-primary)' }}>#{token.room_id || 'global'}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Requester / Actor: </span>
                  <span style={{ color: 'var(--text-primary)' }}>{token.actor_id || 'System'}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Expires: </span>
                  <span style={{ color: 'var(--text-primary)' }}>{new Date(token.expires_at).toLocaleTimeString()}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Cost Egress: </span>
                  <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>$0.00 (Zero-Cost Local)</span>
                </div>
              </div>

              {/* Immutable Cryptographic Digest Display */}
              <div style={{ marginTop: 10, fontSize: 11 }}>
                <span style={{ color: 'var(--text-muted)' }}>Immutable Payload Digest (SHA-256): </span>
                <code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: 3, color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                  {token.payload_digest}
                </code>
              </div>

              {token.rejection_reason && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--accent-red)' }}>
                  Rejection Reason: {token.rejection_reason}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
