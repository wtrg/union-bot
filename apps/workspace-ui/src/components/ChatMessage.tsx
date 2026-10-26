import { memo } from "react";
import type { EnvelopeView } from "../types.ts";
import { AGENTS } from "../utils/agents.ts";
import {
  AGENT_NAMES,
  providerOf,
  messageState,
  textOf,
  statusLabel,
} from "../utils/workspace-model.ts";
import { MessageContent, CopyButton } from "./MessageContent.tsx";
function Avatar({ provider }: { provider: string }) {
  return (
    <span className="ub-avatar" aria-hidden="true">
      {AGENTS[AGENT_NAMES[provider]]?.emoji || "U"}
    </span>
  );
}
function Badge({ state, label }: { state: string; label?: string }) {
  return (
    <span className={`ub-status state-${state}`}>{label || statusLabel(state)}</span>
  );
}
export const ChatMessage = memo(function ChatMessage({
  envelope,
  onReply,
  onOpenThread,
}: {
  envelope: EnvelopeView;
  onReply: (provider: string) => void;
  onOpenThread: (envelope: EnvelopeView) => void;
}) {
  const provider = providerOf(envelope);
  const state = messageState(envelope);
  const isSystem = envelope.sender.kind === "system";
  const isUser = envelope.sender.kind === "user";
  const text = textOf(envelope);
  const name = isSystem
    ? "Union Bot · Hệ thống"
    : isUser
      ? "Bạn"
      : AGENT_NAMES[provider] || envelope.sender.name;
  return (
    <article
      data-provider={provider}
      className={`ub-message ${isUser ? "from-user" : ""} ${isSystem ? "from-system" : ""} ${envelope.delivery?.phase === "summary" ? "is-summary" : ""}`}
      data-testid="workspace-message"
      data-state={state}
      data-enter={["queued", "sending", "streaming"].includes(state)}
    >
      <header>
        <div>
          <Avatar provider={isSystem || isUser ? "" : provider} />
          <strong>{name}</strong>
          {envelope.delivery?.phase === "summary" && (
            <span className="ub-eyebrow">Kết luận chung</span>
          )}
        </div>
        <div>
          {!isUser && <Badge state={state} label={state === 'sending' && envelope.delivery?.progressStage ? ({loading:'Đang tải', preparing:'Đang soạn', sending:'Đang gửi', waiting:'Chờ AI'}[envelope.delivery.progressStage]) : undefined} />}
          <time>
            {new Date(envelope.timestamp).toLocaleTimeString("vi-VN", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        </div>
      </header>
      {text ? (
        <MessageContent text={text} />
      ) : (
        <p className="ub-wait">
          <span
            aria-hidden="true"
            className={
              state === "streaming" || state === "sending"
                ? "ub-working-dot"
                : ""
            }
          />
          {envelope.delivery?.progressText || (state === "queued"
            ? "Đợi đến lượt xử lý."
            : "Đang mở hội thoại và chuẩn bị phản hồi…")}
        </p>
      )}
      <footer>
        <CopyButton text={text} />
        {!isUser && !isSystem && (
          <button onClick={() => onReply(provider)}>Trả lời {name}</button>
        )}
        {envelope.delivery?.conversationId &&
          ["chatgpt", "gemini", "claude", "deepseek"].includes(provider) && (
            <button onClick={() => onOpenThread(envelope)}>
              Hội thoại gốc ↗
            </button>
          )}
        {isUser && state === "failed" && (
          <span>Chưa gửi · bản nháp đã giữ lại</span>
        )}
      </footer>
    </article>
  );
});
