import React, { useState } from 'react';
import type { RequirementFactInfo, OpenQuestionInfo } from '../types';

interface DiscoveryPanelProps {
  projectId: string;
  facts: RequirementFactInfo[];
  questions: OpenQuestionInfo[];
  onConfirmFact: (key: string, value: string) => Promise<void>;
  onResolveQuestion: (id: string, resolution: string) => Promise<void>;
  onSwitchToWork: () => void;
}

export const DiscoveryPanel: React.FC<DiscoveryPanelProps> = ({
  projectId,
  facts,
  questions,
  onConfirmFact,
  onResolveQuestion,
  onSwitchToWork,
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
    <div className="flex flex-col h-full bg-slate-900 text-slate-100 border-l border-slate-800 w-80 p-4 overflow-y-auto">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div>
          <h2 className="text-sm font-semibold tracking-wide uppercase text-indigo-400">
            Discovery Ledger (/chat)
          </h2>
          <p className="text-xs text-slate-400">Project: {projectId}</p>
        </div>
        <span
          className={`px-2 py-0.5 rounded text-xs font-medium ${
            isReadyForWork ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700' : 'bg-amber-900/60 text-amber-300 border border-amber-700'
          }`}
        >
          {isReadyForWork ? 'READY /work' : 'DISCOVERY'}
        </span>
      </div>

      {/* DiscoveryReadyGate Banner */}
      <div className="my-3">
        {isReadyForWork ? (
          <div className="p-2.5 rounded bg-emerald-950/40 border border-emerald-800 text-xs">
            <p className="text-emerald-300 font-medium">✓ Đủ điều kiện khởi động /work</p>
            <p className="text-emerald-400/80 mt-1">Tất cả câu hỏi quan trọng đã được chốt.</p>
            <button
              onClick={onSwitchToWork}
              className="mt-2 w-full py-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium transition-colors"
            >
              Chuyển sang Chế độ Thực thi (/work)
            </button>
          </div>
        ) : (
          <div className="p-2.5 rounded bg-amber-950/40 border border-amber-800 text-xs">
            <p className="text-amber-300 font-medium">Chưa thể sang /work</p>
            <p className="text-amber-400/80 mt-1">
              {blockingQuestions.length > 0
                ? `Còn ${blockingQuestions.length} câu hỏi quan trọng cần xác nhận.`
                : 'Cần ít nhất 1 yêu cầu được xác nhận (Confirmed Fact).'}
            </p>
          </div>
        )}
      </div>

      {/* Open Questions List */}
      <div className="mt-2">
        <h3 className="text-xs font-semibold uppercase text-slate-400 tracking-wider mb-2">
          Câu hỏi BA ({openQuestions.length})
        </h3>
        {openQuestions.length === 0 ? (
          <p className="text-xs text-slate-500 italic">Không có câu hỏi mở nào.</p>
        ) : (
          <div className="space-y-2">
            {openQuestions.map((q) => (
              <div
                key={q.id}
                className={`p-2.5 rounded text-xs border ${
                  q.blocking
                    ? 'bg-rose-950/30 border-rose-800/80 text-rose-200'
                    : 'bg-slate-800/50 border-slate-700 text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold">{q.requirementKey}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] uppercase font-bold ${
                      q.priority === 'CRITICAL'
                        ? 'bg-rose-900 text-rose-200'
                        : q.priority === 'HIGH'
                        ? 'bg-amber-900 text-amber-200'
                        : 'bg-slate-700 text-slate-300'
                    }`}
                  >
                    {q.priority}
                  </span>
                </div>
                <p className="text-slate-300 mb-2">{q.question}</p>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="Nhập câu trả lời..."
                    value={resolutionMap[q.id] || ''}
                    onChange={(e) =>
                      setResolutionMap((prev) => ({ ...prev, [q.id]: e.target.value }))
                    }
                    className="flex-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={() => handleResolve(q.id)}
                    disabled={isSubmitting || !resolutionMap[q.id]?.trim()}
                    className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded text-xs font-medium"
                  >
                    Xác nhận
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirmed Facts List */}
      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase text-slate-400 tracking-wider mb-2">
          Yêu cầu đã xác nhận ({facts.length})
        </h3>
        {facts.length === 0 ? (
          <p className="text-xs text-slate-500 italic">Chưa có fact nào.</p>
        ) : (
          <div className="space-y-1.5">
            {facts.map((f) => (
              <div
                key={f.id}
                className="p-2 rounded bg-slate-800/40 border border-slate-700/70 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-indigo-300">{f.key}</span>
                  <span className="text-[10px] text-slate-500">
                    {f.confirmedBy ? `✓ ${f.confirmedBy}` : 'Proposed'}
                  </span>
                </div>
                <p className="text-slate-200 mt-0.5">{f.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Fact Form */}
      <form onSubmit={handleAddFact} className="mt-5 pt-3 border-t border-slate-800 text-xs">
        <h4 className="font-medium text-slate-300 mb-2">Thêm Yêu cầu (Fact)</h4>
        <input
          type="text"
          placeholder="Tên yêu cầu (key, ví dụ: targetPlatform)"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          className="w-full mb-1.5 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
        />
        <input
          type="text"
          placeholder="Nội dung (value, ví dụ: Windows 10/11 x64)"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          className="w-full mb-2 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
        />
        <button
          type="submit"
          disabled={isSubmitting || !newKey.trim() || !newValue.trim()}
          className="w-full py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 rounded font-medium"
        >
          Lưu Fact
        </button>
      </form>
    </div>
  );
};
