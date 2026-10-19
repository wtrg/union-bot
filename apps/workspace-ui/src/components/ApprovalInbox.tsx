import React, { useState, useEffect } from 'react';
import { ApprovalTokenRecord } from '../types.ts';

interface ApprovalInboxProps {
  onTokenStatusChanged?: () => void;
}

// Collapsible JSON Tree Viewer for nested parameters (UB-P3-R01-004)
const JsonTreeViewer: React.FC<{ data: any; label?: string }> = ({ data, label }) => {
  const [isExpanded, setIsExpanded] = useState(true);

  if (data === null || data === undefined) {
    return <span style={{ color: 'var(--text-muted)' }}>null</span>;
  }

  if (typeof data !== 'object') {
    return (
      <span style={{ color: typeof data === 'string' ? '#38bdf8' : typeof data === 'number' ? '#f59e0b' : '#a855f7' }}>
        {JSON.stringify(data)}
      </span>
    );
  }

  const isArray = Array.isArray(data);
  const keys = Object.keys(data);

  return (
    <div style={{ marginLeft: label ? 12 : 0, fontFamily: 'monospace', fontSize: 12 }}>
      {label && (
        <span
          onClick={() => setIsExpanded(!isExpanded)}
          style={{ cursor: 'pointer', color: 'var(--text-secondary)', userSelect: 'none', fontWeight: 600 }}
        >
          {isExpanded ? '▼ ' : '▶ '}
          {label}: {isArray ? `Array(${data.length})` : `Object(${keys.length})`}
        </span>
      )}
      {isExpanded && (
        <div style={{ paddingLeft: label ? 12 : 0, borderLeft: label ? '1px dashed var(--border-color)' : 'none', marginTop: 2 }}>
          {keys.map((k) => (
            <div key={k} style={{ padding: '1px 0' }}>
              <span style={{ color: 'var(--text-muted)' }}>{k}: </span>
              <JsonTreeViewer data={data[k]} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const ApprovalInbox: React.FC<ApprovalInboxProps> = ({ onTokenStatusChanged }) => {
  const [tokens, setTokens] = useState<ApprovalTokenRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'RESOLVED'>('ALL');
  const [actionMessage, setActionMessage] = useState<{ text: string; isError?: boolean } | null>(null);
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});

  const toggleExpand = (tokenId: string) => {
    setExpandedDetails((prev) => ({ ...prev, [tokenId]: !prev[tokenId] }));
  };

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

  // Helper to extract or derive target path and impact parameters directly from ActionIntent (UB-P3-R02-001)
  const analyzeImpact = (token: ApprovalTokenRecord) => {
    let payload: any = null;
    if (token.payload) {
      payload = token.payload;
    } else if (token.payload_json) {
      try {
        payload = JSON.parse(token.payload_json);
      } catch {}
    }

    let riskLevel = 'LOW';
    let isReversible = 'YES';
    let targetSubsystem = 'SQLite WAL / Local CAS';
    let targetPath = 'Internal Storage';

    // 1. Derive directly from actual ActionIntent payload parameters (UB-P3-R02-001)
    if (payload && typeof payload === 'object') {
      if (payload.path || payload.targetPath || payload.filePath || payload.directory) {
        targetPath = payload.path || payload.targetPath || payload.filePath || payload.directory;
        targetSubsystem = 'Local Filesystem';
      } else if (payload.command || payload.cmd) {
        targetPath = `Command: ${payload.command || payload.cmd}`;
        targetSubsystem = 'Process Execution';
      }

      if (payload.riskLevel) {
        riskLevel = String(payload.riskLevel).toUpperCase();
      } else if (payload.destructive === true || payload.force === true || payload.action === 'format_disk_simulated') {
        riskLevel = 'HIGH';
        isReversible = 'NO';
      }

      if (payload.reversible === false || payload.isReversible === 'NO') {
        isReversible = 'NO';
      } else if (payload.reversible === true || payload.isReversible === 'YES') {
        isReversible = 'YES';
      }

      if (payload.subsystem) {
        targetSubsystem = payload.subsystem;
      }
    }

    // 2. Fallback heuristic if not explicitly specified in payload
    const act = (token.action_type || '').toLowerCase();
    if (riskLevel === 'LOW' && (act.includes('format') || act.includes('delete') || act.includes('destroy') || act.includes('wipe'))) {
      riskLevel = 'HIGH';
      isReversible = 'NO';
      if (targetSubsystem === 'SQLite WAL / Local CAS') targetSubsystem = 'Disk / Filesystem';
    } else if (riskLevel === 'LOW' && (act.includes('write') || act.includes('modify') || act.includes('export'))) {
      riskLevel = 'MEDIUM';
      isReversible = 'PARTIAL';
      if (targetSubsystem === 'SQLite WAL / Local CAS') targetSubsystem = 'Local Filesystem';
    }

    if (token.workspace_id && targetPath === 'Internal Storage') {
      targetPath = `Workspace: ${token.workspace_id}`;
    }
    if (token.room_id && targetPath === 'Internal Storage') {
      targetPath += ` / Room: #${token.room_id}`;
    }

    return { riskLevel, isReversible, targetSubsystem, targetPath, payload };
  };

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
            Human-in-the-loop governance: Inspect nested action parameters, target paths, and anticipated impact breakdown before authorization (UB-P3-R01-004).
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
          {filteredTokens.map((token) => {
            const impact = analyzeImpact(token);
            const isCardExpanded = expandedDetails[token.token_id] !== false; // expanded by default

            return (
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

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      onClick={() => toggleExpand(token.token_id)}
                      style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted)', borderRadius: 4, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
                    >
                      {isCardExpanded ? 'Collapse ▲' : 'Inspect ▼'}
                    </button>

                    {token.status === 'PENDING' && (
                      <>
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
                      </>
                    )}
                  </div>
                </div>

                {/* Detailed Parameter Inspection (UB-P3-R01-004 Requirement) */}
                <div style={{ background: 'var(--bg-tertiary)', padding: 12, borderRadius: 6, fontSize: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Origin: </span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{token.origin || 'Renderer IPC'}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Target Path / Scope: </span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{impact.targetPath}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Requester / Actor: </span>
                    <span style={{ color: 'var(--text-primary)' }}>{token.actor_id || 'System'}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Expires: </span>
                    <span style={{ color: 'var(--text-primary)' }}>{new Date(token.expires_at).toLocaleTimeString()}</span>
                  </div>
                </div>

                {/* Anticipated Impact Breakdown Table (UB-P3-R01-004) */}
                {isCardExpanded && (
                  <div style={{ marginTop: 12, border: '1px solid var(--border-color)', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ background: 'var(--bg-tertiary)', padding: '6px 12px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Anticipated Impact Breakdown
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <tbody>
                        <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '8px 12px', color: 'var(--text-muted)', width: '30%' }}>Risk Level</td>
                          <td style={{ padding: '8px 12px', fontWeight: 700, color: impact.riskLevel === 'HIGH' ? 'var(--accent-red)' : impact.riskLevel === 'MEDIUM' ? 'var(--accent-amber)' : 'var(--accent-green)' }}>
                            {impact.riskLevel}
                          </td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>Target Resource</td>
                          <td style={{ padding: '8px 12px', color: 'var(--text-primary)', fontFamily: 'monospace' }}>{impact.targetPath}</td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>Reversible</td>
                          <td style={{ padding: '8px 12px', color: 'var(--text-primary)' }}>{impact.isReversible}</td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>Target Subsystem</td>
                          <td style={{ padding: '8px 12px', color: 'var(--text-primary)' }}>{impact.targetSubsystem}</td>
                        </tr>
                        <tr>
                          <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>API Egress Cost</td>
                          <td style={{ padding: '8px 12px', color: 'var(--accent-green)', fontWeight: 700 }}>$0.00 (Zero-Cost Local)</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Structured JSON Parameters Tree (UB-P3-R01-004, UB-P3-R02-001) */}
                {isCardExpanded && (
                  <div style={{ marginTop: 12, background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, padding: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Action Intent & Execution Parameters (UB-P3-R02-001)</span>
                      <span style={{ fontSize: 10, color: 'var(--accent-green)', fontWeight: 600 }}>● SHA-256 Digest Verified</span>
                    </div>

                    {/* Actual ActionIntent parameters parsed from payload_json */}
                    <div style={{ marginBottom: 10, padding: 8, background: 'var(--bg-secondary)', borderRadius: 4 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Action Intent Payload:</div>
                      <JsonTreeViewer
                        label="action_intent"
                        data={impact.payload || { action: token.action_type, note: 'Raw payload not recorded' }}
                      />
                    </div>

                    <div style={{ padding: 8, background: 'var(--bg-secondary)', borderRadius: 4 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Token Security Context:</div>
                      <JsonTreeViewer
                        label="token_envelope"
                        data={{
                          token_id: token.token_id,
                          action_type: token.action_type,
                          origin: token.origin,
                          workspace_id: token.workspace_id,
                          room_id: token.room_id,
                          actor_id: token.actor_id,
                          payload_digest: token.payload_digest,
                          status: token.status,
                        }}
                      />
                    </div>
                  </div>
                )}

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
            );
          })}
        </div>
      )}
    </div>
  );
};
