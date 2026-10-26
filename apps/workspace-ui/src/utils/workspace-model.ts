import type { EnvelopeView, TaskItem } from "../types.ts";

export const AGENT_NAMES: Record<string, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  codex: "Codex",
  antigravity: "Antigravity",
  claude: "Claude",
  deepseek: "DeepSeek",
};
export const STATUS_LABELS: Record<string, string> = {
  queued: "Đang chờ",
  pending: "Chưa chạy",
  sending: "Đang chuẩn bị",
  streaming: "Đang viết",
  running: "Đang thực thi",
  completed: "Hoàn tất",
  failed: "Thất bại",
  blocked: "Bị chặn",
  waiting_input: "Chờ bạn",
  cancelled: "Đã hủy",
  cancel_requested: "Đang yêu cầu dừng",
  paused: "Tạm dừng",
  unknown: "Chưa xác định",
};
export function statusLabel(status?: string) {
  return STATUS_LABELS[status || "unknown"] || status || STATUS_LABELS.unknown;
}
export function providerOf(envelope: EnvelopeView): string {
  const identity = (
    envelope.delivery?.provider ||
    envelope.sender.provider ||
    envelope.sender.id ||
    ""
  ).toLowerCase();
  return Object.keys(AGENT_NAMES).find((id) => identity.includes(id)) || "";
}
export function messageState(envelope: EnvelopeView): string {
  return envelope.delivery?.state || envelope.status || "completed";
}
export function runIdOf(envelope: EnvelopeView): string {
  return (
    envelope.delivery?.runId ||
    envelope.correlationId ||
    envelope.delivery?.replyTo ||
    envelope.id
  );
}
export function mergeEnvelope(
  list: EnvelopeView[],
  next: EnvelopeView,
): EnvelopeView[] {
  const index = list.findIndex((e) => e.id === next.id);
  if (index < 0) return [...list, next];
  // Delayed history reads and stale queued events cannot replace a newer stream/final.
  const old = list[index];
  const rank: Record<string, number> = {
    queued: 0,
    sending: 1,
    streaming: 2,
    completed: 3,
    blocked: 3,
    failed: 3,
    cancelled: 3,
  };
  if ((rank[messageState(old)] ?? 0) > (rank[messageState(next)] ?? 0))
    return list;
  return list.map((e) => (e.id === next.id ? next : e));
}
export function taskState(task: Pick<TaskItem, "status">): string {
  const state = String(task.status || "unknown").toLowerCase();
  return (
    ({ done: "completed", canceled: "cancelled" } as Record<string, string>)[
      state
    ] || state
  );
}
export function taskProgress(
  task: Pick<TaskItem, "progress">,
): number | undefined {
  return typeof task.progress === "number" && Number.isFinite(task.progress)
    ? Math.max(0, Math.min(100, task.progress))
    : undefined;
}
export function isTaskActive(task: Pick<TaskItem, "status">) {
  return ["running", "cancel_requested"].includes(taskState(task));
}
export function textOf(envelope: EnvelopeView) {
  return envelope.parts
    .map(
      (p) =>
        p.text ||
        p.content ||
        (p.code ? "```" + (p.language || "") + "\n" + p.code + "\n```" : "") ||
        p.diff ||
        (p.filename ? `Tệp: ${p.filename}` : "") ||
        p.message ||
        "",
    )
    .filter(Boolean)
    .join("\n\n");
}
export function roomActivity(envelopes: EnvelopeView[]) {
  return envelopes.filter(
    (e) =>
      ["queued", "sending", "streaming"].includes(messageState(e)) &&
      e.sender.kind === "agent",
  );
}

export function isDiagnosticEnvelope(envelope: EnvelopeView) {
  return (
    envelope.isDemo === true ||
    envelope.metadata?.createdVia === "test" ||
    (envelope.sender.kind === "user" &&
      textOf(envelope).trim() === "Live GUI smoke test envelope")
  );
}
