import { memo, useEffect, useState } from "react";
import "./AgentSignalStrip3D.css";

export type AgentStatus =
  | "idle"
  | "queued"
  | "sending"
  | "streaming"
  | "completed"
  | "blocked"
  | "cancelled";

export interface AgentNodeData {
  id: string;
  name: string;
  status: AgentStatus;
  statusText?: string;
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "Chưa có lượt",
  queued: "Đang chờ xử lý",
  sending: "Đang chuẩn bị",
  streaming: "Đang trả lời",
  completed: "Hoàn tất",
  blocked: "Bị chặn",
  cancelled: "Đã hủy",
};

export const AgentSignalStrip3D = memo(function AgentSignalStrip3D({
  agents,
  onSelectAgent,
  motionEnabled,
}: {
  agents: AgentNodeData[];
  onSelectAgent: (id: string) => void;
  motionEnabled: boolean;
}) {
  const [isHidden, setIsHidden] = useState(() =>
    typeof document !== "undefined" ? document.hidden : false,
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibilityChange = () => setIsHidden(document.hidden);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    handleVisibilityChange();
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  return (
    <section
      className="ub-signal-stage"
      aria-label="Trạng thái các trợ lý AI"
      lang="vi"
      data-paused={isHidden || !motionEnabled}
    >
      <div className="ub-signal-grid">
        {agents.slice(0, 6).map((agent) => (
          <button
            key={agent.id}
            type="button"
            className="ub-node-button"
            data-status={agent.status}
            aria-label={`${agent.name}: ${agent.statusText || STATUS_LABEL[agent.status]}`}
            title={`${agent.name}: ${agent.statusText || STATUS_LABEL[agent.status]}`}
            onClick={() => onSelectAgent(agent.id)}
          >
            <span className="ub-node-orb" aria-hidden="true">
              <span className="ub-node-core" />
              <span className="ub-node-ring" />
            </span>
            <span className="ub-node-meta">
              <span className="ub-node-name">{agent.name}</span>
              <span className="ub-node-state">
                {agent.statusText || STATUS_LABEL[agent.status]}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
});
