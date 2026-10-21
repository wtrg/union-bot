import React, { useState } from 'react';
import type { RequirementFactInfo, OpenQuestionInfo } from '../types';

interface DiscoveryPanelProps {
  projectId: string;
  facts: RequirementFactInfo[];
  questions: OpenQuestionInfo[];
  onConfirmFact: (key: string, value: string) => Promise<void>;
  onResolveQuestion: (id: string, resolution: string) => Promise<void>;
  onSwitchToWork: () => void;
  onClose?: () => void;
}

export const DiscoveryPanel: React.FC<DiscoveryPanelProps> = ({
  projectId,
  facts,
  questions,
  onConfirmFact,
  onResolveQuestion,
  onSwitchToWork,
  onClose,
}) => {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [resolutionMap, setResolutionMap] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const openQuestions = questions.filter((q) => !q.resolved);
  const blockingQuestions = openQuestions.filter((q) => q.blocking);
  const isReadyForWork = facts.length > 0 && blockingQuestions.length === 0;

  const handleAddFact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim() || !newValue.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onConfirmFact(newKey.trim(), newValue.trim());
      setNewKey('');
      setNewValue('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResolve = async (questionId: string) => {
    const resolution = resolutionMap[questionId];
    if (!resolution || !resolution.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onResolveQuestion(questionId, resolution.trim());
      setResolutionMap((prev) => {
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <aside className="discovery-panel" data-testid="discovery-panel">
      {/* Discovery Header */}
      <div className="discovery-header">
        <div>
          <div className="discovery-title">📋 Đặc tả Yêu cầu</div>
          <div className="discovery-project-id">Dự án: {projectId}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            className={`discovery-status-badge ${
              isReadyForWork ? 'ready' : 'discovery'
            }`}
          >
            {isReadyForWork ? 'Sẵn sàng /work' : 'Đang làm rõ'}
          </span>
          {onClose && (
            <button
              onClick={onClose}
              className="discovery-close-btn"
              title="Đóng bảng đặc tả"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* DiscoveryReadyGate Banner */}
      <div className={`discovery-gate-card ${isReadyForWork ? 'ready' : 'blocked'}`}>
        {isReadyForWork ? (
          <div>
            <div className="discovery-gate-title">✓ Đủ điều kiện khởi động /work</div>
            <p className="discovery-gate-desc">
              Tất cả câu hỏi quan trọng đã được chốt và có ít nhất 1 yêu cầu xác nhận.
            </p>
            <button
              onClick={onSwitchToWork}
              className="btn-switch-work"
              data-testid="switch-to-work-btn"
            >
              <span>🚀</span>
              <span>Bắt đầu Thực thi (/work)</span>
            </button>
          </div>
        ) : (
          <div>
            <div className="discovery-gate-title">⏳ Cần hoàn tất yêu cầu</div>
            <p className="discovery-gate-desc">
              {blockingQuestions.length > 0
                ? `Còn ${blockingQuestions.length} câu hỏi quan trọng cần xác nhận phản hồi.`
                : 'Cần ít nhất 1 yêu cầu được xác nhận (Confirmed Fact) trước khi chuyển chế độ.'}
            </p>
          </div>
        )}
      </div>

      {/* Open Questions List */}
      <div className="discovery-section">
        <div className="discovery-section-header">
          <span className="discovery-section-title">
            Câu hỏi cần giải quyết ({openQuestions.length})
          </span>
        </div>

        {openQuestions.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 11.5, fontStyle: 'italic', padding: '4px 0' }}>
            Không có câu hỏi mở nào.
          </div>
        ) : (
          openQuestions.map((q) => {
            const priorityClass =
              q.priority === 'CRITICAL'
                ? 'critical'
                : q.priority === 'HIGH'
                ? 'high'
                : 'normal';

            return (
              <div
                key={q.id}
                className={`discovery-card ${q.blocking ? 'blocking' : ''}`}
                data-testid={`question-item-${q.id}`}
              >
                <div className="discovery-card-header">
                  <span className="discovery-card-key">{q.requirementKey}</span>
                  <span className={`priority-tag ${priorityClass}`}>
                    {q.priority}
                  </span>
                </div>
                <div className="discovery-card-value">{q.question}</div>
                <div className="discovery-input-row">
                  <input
                    type="text"
                    placeholder="Nhập câu trả lời..."
                    value={resolutionMap[q.id] || ''}
                    onChange={(e) =>
                      setResolutionMap((prev) => ({ ...prev, [q.id]: e.target.value }))
                    }
                    className="discovery-text-input"
                  />
                  <button
                    onClick={() => handleResolve(q.id)}
                    disabled={isSubmitting || !resolutionMap[q.id]?.trim()}
                    className="btn-resolve-question"
                  >
                    Xác nhận
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Confirmed Facts List */}
      <div className="discovery-section">
        <div className="discovery-section-header">
          <span className="discovery-section-title">
            Yêu cầu đã xác nhận ({facts.length})
          </span>
        </div>

        {facts.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 11.5, fontStyle: 'italic', padding: '4px 0' }}>
            Chưa có yêu cầu nào được chốt.
          </div>
        ) : (
          facts.map((f) => (
            <div key={f.id} className="discovery-card fact" data-testid={`fact-item-${f.id}`}>
              <div className="discovery-card-header">
                <span className="discovery-card-key">{f.key}</span>
                <span style={{ fontSize: 10, color: 'var(--accent-emerald)', fontWeight: 600 }}>
                  {f.confirmedBy ? `✓ ${f.confirmedBy}` : '✓ Xác nhận'}
                </span>
              </div>
              <div style={{ color: 'var(--text-primary)', fontSize: 12 }}>{f.value}</div>
            </div>
          ))
        )}
      </div>

      {/* Add Fact Form */}
      <form onSubmit={handleAddFact} className="add-fact-form">
        <div className="add-fact-title">➕ Thêm Yêu cầu (Fact)</div>
        <input
          type="text"
          placeholder="Tên yêu cầu (ví dụ: targetPlatform)"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          className="discovery-text-input"
          style={{ width: '100%', marginBottom: 6 }}
        />
        <input
          type="text"
          placeholder="Nội dung (ví dụ: Windows 10/11 x64)"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          className="discovery-text-input"
          style={{ width: '100%', marginBottom: 8 }}
        />
        <button
          type="submit"
          disabled={isSubmitting || !newKey.trim() || !newValue.trim()}
          className="btn-save-fact"
        >
          {isSubmitting ? 'Đang lưu...' : 'Lưu Yêu cầu'}
        </button>
      </form>
    </aside>
  );
};
