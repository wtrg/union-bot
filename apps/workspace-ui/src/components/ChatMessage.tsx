import { memo, useState } from "react";
import type { EnvelopeView } from "../types.ts";
import { AGENTS } from "../utils/agents.ts";
import { AGENT_NAMES, providerOf, messageState, textOf, statusLabel } from "../utils/workspace-model.ts";
import { MessageContent, CopyButton } from "./MessageContent.tsx";
import { MemberMentions } from "./MemberMentions.tsx";

const LIVE = ["queued", "sending", "streaming"];
function timeOf(envelope: EnvelopeView) {
  return new Date(envelope.timestamp).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}
function previewOf(text: string) {
  const plain = text.replace(/```[^\n]*\n?/g, "").replace(/^#{1,6}\s+/gm, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/g, "$1");
  const preview = plain.split("\n").filter(line => line.trim()).slice(0, 6).join("\n").slice(0, 460);
  return preview.length < plain.length ? `${preview.trimEnd()}…` : preview;
}
function ExpandableMessage({ text, live }: { text: string; live: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 720 || text.split("\n").length > 12;
  return (
    <details className="ub-message-content" data-long={long} open={!long || live || expanded}
      onToggle={e => { if (long && !live) setExpanded(e.currentTarget.open); }}>
      <summary hidden={!long || live}>
        <span className="ub-message-preview"><MemberMentions text={long && !live ? previewOf(text) : ""} /></span>
        <span className="ub-expand-label"><span className="when-closed">Xem thêm</span><span className="when-open">Thu gọn</span></span>
      </summary>
      <MessageContent text={text} />
    </details>
  );
}
export function isRunNotice(envelope: EnvelopeView) {
  return envelope.sender.kind === "system" && ["blocked", "failed", "cancelled", "waiting_input"].includes(messageState(envelope));
}
function noticeText(envelope: EnvelopeView) {
  const text = textOf(envelope);
  if (messageState(envelope) === "cancelled") return "Đã dừng lượt; nội dung nhận được vẫn được giữ lại.";
  if (/LOGIN_REQUIRED|Cần đăng nhập|chưa đăng nhập/i.test(text)) return "Cần đăng nhập để tiếp tục.";
  if (/PERMISSION_REQUIRED|permission denied|tool permission/i.test(text)) return "Cần duyệt quyền trong ứng dụng gốc.";
  if (/bản nháp chưa gửi|Ô nhập đã thay đổi|bảo toàn bản nháp/i.test(text)) return "Có bản nháp cần kiểm tra trước khi gửi.";
  if (/không tìm được nút gửi|không tìm thấy nút gửi/i.test(text)) return "Chưa gửi được; bản nháp được giữ trong tab gốc.";
  if (/TIMEOUT|thời gian chờ|timed out/i.test(text)) return "Quá thời gian chờ; kiểm tra tab gốc trước khi gửi lại.";
  return "Lượt chưa hoàn tất. Mở chi tiết để kiểm tra nguyên nhân.";
}
export const RunNotices = memo(function RunNotices({ envelopes, onOpenThread }: { envelopes: EnvelopeView[]; onOpenThread: (envelope: EnvelopeView) => void }) {
  if (!envelopes.length) return null;
  const providers = [...new Set(envelopes.map(providerOf).filter(Boolean))];
  const stopped = envelopes.every(e => messageState(e) === "cancelled");
  const names = providers.map(id => AGENT_NAMES[id]).join(", ");
  return (
    <details className="ub-run-notices" data-testid="run-notices">
      <summary>
        <span className="ub-notice-icon" aria-hidden="true">{stopped ? "◼" : "!"}</span>
        <strong>{providers.length ? `${providers.length} AI ${stopped ? "đã dừng" : "cần xử lý"}` : `${envelopes.length} thông báo hệ thống`}</strong>
        <span className="ub-notice-names">{envelopes.length === 1 ? `${names} · ${noticeText(envelopes[0])}` : names}</span><span className="ub-notice-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div className="ub-notice-list">
        {envelopes.map(envelope => {
          const provider = providerOf(envelope);
          return (
            <section key={envelope.id} className="ub-notice-item" data-provider={provider} data-state={messageState(envelope)}>
              <div className="ub-notice-heading"><strong>{AGENT_NAMES[provider] || "Hệ thống"}</strong><time>{timeOf(envelope)}</time></div>
              <p>{noticeText(envelope)}</p>
              <div className="ub-notice-controls">
                {["chatgpt", "gemini", "claude", "deepseek"].includes(provider) && <button type="button" onClick={() => onOpenThread(envelope)}>Mở tab gốc ↗</button>}
                <details className="ub-notice-debug"><summary>Chi tiết kỹ thuật</summary><pre>{textOf(envelope)}</pre><CopyButton text={textOf(envelope)} /></details>
              </div>
            </section>
          );
        })}
      </div>
    </details>
  );
});
export const ChatMessage = memo(function ChatMessage({ envelope, continuation = false, onReply, onOpenThread }: {
  envelope: EnvelopeView;
  continuation?: boolean;
  onReply: (provider: string) => void;
  onOpenThread: (envelope: EnvelopeView) => void;
}) {
  const provider = providerOf(envelope);
  const state = messageState(envelope);
  const isSystem = envelope.sender.kind === "system";
  const isUser = envelope.sender.kind === "user";
  const text = textOf(envelope);
  const live = LIVE.includes(state);
  const name = isUser ? "Bạn" : AGENT_NAMES[provider] || (isSystem ? "Thông báo" : envelope.sender.name);
  const progress = envelope.delivery?.progressStage;
  const label = state === "sending" && progress ? { loading: "Đang tải", preparing: "Đang soạn", sending: "Đang gửi", waiting: "Chờ AI" }[progress] : statusLabel(state);
  return (
    <article data-provider={provider} data-message-id={envelope.id} data-continuation={continuation}
      className={`ub-message ${isUser ? "from-user" : ""} ${isSystem ? "from-system" : ""} ${envelope.delivery?.phase === "summary" ? "is-summary" : ""}`}
      data-testid="workspace-message" data-state={state} data-enter={live}>
      {!isUser && <span className="ub-sender-avatar" title={name} aria-hidden="true">{AGENTS[AGENT_NAMES[provider]]?.emoji || "U"}</span>}
      <div className="ub-message-bubble">
        <header className="ub-message-heading">
          <strong>{name}</strong>
          {envelope.delivery?.phase === "summary" && <span className="ub-summary-label">Kết luận chung</span>}
          {(live || state === "failed" || state === "blocked") && <span className={`ub-status state-${state}`}>{label}</span>}
        </header>
        {text ? <ExpandableMessage text={text} live={live} /> : <p className="ub-wait"><span aria-hidden="true" className={live ? "ub-working-dot" : ""} />{envelope.delivery?.progressText || (state === "queued" ? "Đợi đến lượt xử lý." : "Đang chuẩn bị phản hồi…")}</p>}
        <footer className="ub-message-meta">
          <time dateTime={new Date(envelope.timestamp).toISOString()}>{timeOf(envelope)}</time>
          <details className="ub-message-menu">
          <summary aria-label={`Thao tác tin nhắn của ${name}`} title="Sao chép, trả lời và xem nguồn">•••</summary>
          <div className="ub-message-actions">
            <CopyButton text={text} />
            {!isUser && !isSystem && <button type="button" onClick={() => onReply(provider)}>Trả lời {name}</button>}
            {envelope.delivery?.conversationId && ["chatgpt", "gemini", "claude", "deepseek"].includes(provider) && <button type="button" onClick={() => onOpenThread(envelope)}>Hội thoại gốc ↗</button>}
          </div>
          </details>
          {isUser && state === "failed" && <span className="ub-message-failure">Chưa gửi · bản nháp đã giữ lại</span>}
        </footer>
      </div>
    </article>
  );
});
