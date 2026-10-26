const { contextBridge, clipboard, ipcRenderer } = require("electron");
const {
  EnvelopeSchema,
} = require("../../../apps/desktop/src/orchestrator.cjs");
const messages = [],
  taskListeners = new Set(),
  listeners = new Set();
const stats = {
  sends: [],
  executes: [],
  cancels: [],
  loginOpens: [],
  sessionChecks: [],
};
let failSend = false;
const originalClipboard = clipboard.readText();
const tasks = [
  {
    id: "ui-task",
    title: "Kiểm tra giao diện cục bộ",
    room_id: "orchestration",
    status: "pending",
    progress: 0,
    metadata: { provider: "codex", assignee: "codex", createdVia: "workspace" },
  },
];
const emit = (envelope) => {
  const index = messages.findIndex((e) => e.id === envelope.id);
  if (index < 0) messages.push(envelope);
  else messages[index] = envelope;
  for (const listener of listeners) listener(envelope);
};
const taskEmit = () =>
  taskListeners.forEach((callback) => callback({ taskId: "ui-task" }));
contextBridge.exposeInMainWorld("unionBotAPI", {
  isElectron: true,
  clipboardWriteText: (text) =>
    ipcRenderer.invoke("union-bot:clipboard-write-text", text),
  getRooms: async () => [],
  listTasks: async () => structuredClone(tasks),
  getRoomHistory: async (roomId) =>
    structuredClone(messages.filter((e) => e.roomId === roomId)),
  onEnvelopeReceived(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
  },
  onTaskUpdated(callback) {
    taskListeners.add(callback);
    return () => taskListeners.delete(callback);
  },
  browserGetState: async () => ({
    tabs: [],
    activeTabId: null,
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    isVisible: false,
    isModalActive: false,
  }),
  browserSetVisibility: async () => ({}),
  onBrowserStateUpdated() {
    return () => {};
  },
  browserSetBounds: async () => ({}),
  providerOpenLogin: async ({ providerId }) => {
    stats.loginOpens.push(providerId);
    return {
      success: true,
      providerId,
      tabId: "session-" + providerId,
      message:
        "Đăng nhập trực tiếp trên trang DeepSeek, sau đó kiểm tra lại phiên.",
    };
  },
  providerCheckSession: async ({ providerId }) => {
    stats.sessionChecks.push(providerId);
    return {
      success: true,
      providerId,
      status: "LOGIN_REQUIRED",
      message: "Chưa đăng nhập. Hãy hoàn tất đăng nhập trong tab nhà cung cấp.",
    };
  },
  getGroupBindings: async () => ({ success: true, bindings: {} }),
  async sendGroupMessage(envelope) {
    const parsed = EnvelopeSchema.safeParse(envelope);
    if (!parsed.success) return { success: false, error: parsed.error.message };
    stats.sends.push(envelope);
    if (failSend) return { success: false, error: "MOCK_IPC_FAILURE" };
    emit(envelope);
    const response = {
      ...envelope,
      id: "reply_" + envelope.id,
      correlationId: envelope.id,
      sender: { kind: "agent", provider: "codex", id: "codex", name: "Codex" },
      delivery: { state: "streaming", provider: "codex", runId: envelope.id },
      parts: [{ kind: "text", text: "Đang kiểm tra" }],
    };
    setTimeout(() => emit(response), 40);
    setTimeout(
      () =>
        emit({
          ...response,
          status: "completed",
          delivery: { ...response.delivery, state: "completed" },
          parts: [
            {
              kind: "text",
              text: '## Kết quả\nKiểm tra cục bộ hoàn tất.\n\n| Mục | Trạng thái |\n| --- | --- |\n| Giao diện | Đạt |\n\n```js\nconsole.log("<script>safe</script>");\n```',
            },
          ],
        }),
      140,
    );
    return { success: true };
  },
  async createTask(data) {
    const task = {
      ...data,
      room_id: data.roomId,
      id: "created_" + tasks.length,
    };
    tasks.push(task);
    return { success: true, task };
  },
  async executeTask({ taskId }) {
    stats.executes.push(taskId);
    tasks[0].status = "running";
    taskEmit();
    await new Promise((resolve) => setTimeout(resolve, 900));
    if (tasks[0].status === "cancelled")
      return { success: true, status: "cancelled" };
    tasks[0].status = "completed";
    tasks[0].progress = 100;
    taskEmit();
    return { success: true };
  },
  async cancelTask({ taskId }) {
    stats.cancels.push(taskId);
    tasks[0].status = "cancelled";
    tasks[0].progress = 0;
    taskEmit();
    return { success: true, status: "cancelled" };
  },
  cancelGroupRun: async () => ({ success: true }),
  openGroupThread: async () => ({ success: true }),
});
contextBridge.exposeInMainWorld("__workspaceTest", {
  emit,
  readClipboard: () => clipboard.readText(),
  restoreClipboard: () => clipboard.writeText(originalClipboard),
  stats: () => structuredClone(stats),
  failSend(value) {
    failSend = value;
  },
});
