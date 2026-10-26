import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Sora3DIslandRef } from "./components/Sora3DIsland.tsx";
import { AGENTS } from "./utils/agents.ts";
const Sora3DIsland = React.lazy(() =>
  import("./components/Sora3DIsland.tsx").then((module) => ({
    default: module.Sora3DIsland,
  })),
);
import { ProviderSessionControls } from "./components/ProviderSessionControls.tsx";
import { ChatMessage, RunNotices, isRunNotice } from "./components/ChatMessage.tsx";
import {
  AgentSignalStrip3D,
  type AgentNodeData,
  type AgentStatus,
} from "./components/AgentSignalStrip3D.tsx";
import { CosmicSakuraSky, type CosmicSakuraSkyRef } from "./components/CosmicSakuraSky.tsx";
import { playChime } from "./utils/audio.ts";
import { createEnvelopeBuffer } from "./utils/envelope-buffer.ts";
import "./workspace-refinement.css";
import "./glass-workspace.css";
import "./chat-thread.css";
import { commandMentionTargets } from "./utils/mentions.ts";
import { MemberMentions } from "./components/MemberMentions.tsx";
import { AetherOrb } from "./components/AetherOrb.tsx";
import { BrowserPanel } from "./components/BrowserPanel.tsx";
import { MessageContent } from "./components/MessageContent.tsx";
import type { EnvelopeView, TaskItem, BrowserManagerState } from "./types.ts";
import {
  AGENT_NAMES,
  isDiagnosticEnvelope,
  isTaskActive,
  mergeEnvelope,
  messageState,
  providerOf,
  roomActivity,
  runIdOf,
  statusLabel,
  taskProgress,
  taskState,
  textOf,
} from "./utils/workspace-model.ts";

const DEFAULT_ROOMS = [
  { id: "orchestration", name: "Chung", description: "Thảo luận và điều phối" },
  { id: "agent-dev", name: "Phát triển", description: "Code và triển khai" },
  { id: "qa-audit", name: "Kiểm thử", description: "Chất lượng và kiểm tra" },
  {
    id: "review-briefing",
    name: "Review",
    description: "Đánh giá và quyết định",
  },
];
function Badge({ state }: { state: string }) {
  return (
    <span className={`ub-status state-${state}`}>{statusLabel(state)}</span>
  );
}
function Avatar({ provider }: { provider: string }) {
  return (
    <span className="ub-avatar" aria-hidden="true">
      {AGENTS[AGENT_NAMES[provider]]?.emoji || "U"}
    </span>
  );
}

const EMPTY_MESSAGES: EnvelopeView[] = [];
const DRAFT_KEY = "union-bot:room-drafts:v1";
function loadDrafts(): Record<string, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}");
    return Object.fromEntries(
      Object.entries(saved).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

export const App: React.FC = () => {
  const api = window.unionBotAPI;
  const [rooms, setRooms] = useState(DEFAULT_ROOMS);
  const [activeRoom, setActiveRoom] = useState("orchestration");
  const [messages, setMessages] = useState<Record<string, EnvelopeView[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>(loadDrafts);
  const [recipient, setRecipient] = useState("chatgpt");
  const [mode, setMode] = useState<"direct" | "review">("direct");
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskAgent, setTaskAgent] = useState("codex");
  const [taskBusy, setTaskBusy] = useState<Set<string>>(new Set());
  const taskLocks = useRef(new Set<string>());
  const [showHistory, setShowHistory] = useState(false);
  const [search, setSearch] = useState("");
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const [browser, setBrowser] = useState<BrowserManagerState | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth >= 1100);
  const [navigationCollapsed, setNavigationCollapsed] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(true);
  const [pageHidden, setPageHidden] = useState(document.hidden);
  const composing = useRef(false);
  const [inspectorTab, setInspectorTab] = useState<
    "members" | "tasks" | "decisions"
  >("members");
  const [garden, setGarden] = useState(false);
  const [focusedAgent, setFocusedAgent] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(14);
  const [toast, setToast] = useState("");
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [newMessages, setNewMessages] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [focusChatMode, setFocusChatMode] = useState(false);
  const [densityLabel, setDensityLabel] = useState("Hoa & Sao: Rực rỡ");
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  const skyRef = useRef<CosmicSakuraSkyRef>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const islandRef = useRef<Sora3DIslandRef>(null);
  const nearBottom = useRef(true);
  const roomRef = useRef(activeRoom);
  const messageStates = useRef(new Map<string, string>());
  const historyRequest = useRef(0);
  const taskRequest = useRef(0);
  const sendLock = useRef(false);
  roomRef.current = activeRoom;
  const notify = useCallback((text: string) => setToast(text), []);
  useEffect(() => {
    const save = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
      } catch {
        /* Draft stays in memory when storage is unavailable. */
      }
    }, 250);
    return () => clearTimeout(save);
  }, [drafts]);
  useEffect(() => {
    const flushDrafts = () => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draftsRef.current));
      } catch {}
    };
    window.addEventListener("pagehide", flushDrafts);
    window.addEventListener("beforeunload", flushDrafts);
    return () => {
      flushDrafts();
      window.removeEventListener("pagehide", flushDrafts);
      window.removeEventListener("beforeunload", flushDrafts);
    };
  }, []);
  useLayoutEffect(() => {
    const viewport = chatRef.current,
      feed = feedRef.current;
    if (!viewport || !feed) return;
    const observer = new ResizeObserver(() => {
      const selection = window.getSelection();
      const selecting =
        selection &&
        !selection.isCollapsed &&
        selection.anchorNode &&
        viewport.contains(selection.anchorNode);
      if (nearBottom.current && !selecting)
        viewport.scrollTop = viewport.scrollHeight;
    });
    observer.observe(viewport);
    observer.observe(feed);
    return () => observer.disconnect();
  }, [activeRoom]);
  useEffect(() => {
    const changed = () => setPageHidden(document.hidden);
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(168, Math.max(48, el.scrollHeight))}px`;
      if (nearBottom.current && chatRef.current)
        chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [activeRoom, drafts[activeRoom]]);
  useLayoutEffect(() => {
    const viewport = chatRef.current;
    const selection = window.getSelection();
    const selecting =
      viewport &&
      selection &&
      !selection.isCollapsed &&
      selection.anchorNode &&
      viewport.contains(selection.anchorNode);
    if (viewport && nearBottom.current && !selecting)
      viewport.scrollTop = viewport.scrollHeight;
  }, [fontSize, inspectorOpen, garden]);
  const selectAgent = useCallback((provider: string) => {
    setRecipient(provider);
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const loadTasks = useCallback(async () => {
    if (!api) return;
    const request = ++taskRequest.current;
    try {
      const rows = await api.listTasks({ limit: 500 });
      if (request === taskRequest.current && Array.isArray(rows))
        setTasks(rows);
    } catch (error) {
      notify(`Không tải được công việc: ${String(error)}`);
    }
  }, [api, notify]);
  useEffect(() => {
    loadTasks();
    return api?.onTaskUpdated?.(() => {
      loadTasks();
    });
  }, [loadTasks, api]);
  useEffect(() => {
    if (!api) return;
    api
      .getRooms()
      .then((rows) => {
        if (Array.isArray(rows))
          setRooms((prev) => [
            ...prev,
            ...rows
              .filter((r) => !prev.some((p) => p.id === r.id))
              .map((r) => ({
                id: r.id,
                name: r.name,
                description: r.description || "Phòng làm việc",
              })),
          ]);
      })
      .catch(() => {});
    api
      .browserGetState?.()
      .then(setBrowser)
      .catch(() => {});
    const unsubBrowser = api.onBrowserStateUpdated?.(setBrowser);
    const buffer = createEnvelopeBuffer((rows) =>
      setMessages((prev) => {
        const next = { ...prev };
        for (const row of rows)
          next[row.roomId] = mergeEnvelope(next[row.roomId] || [], row);
        return next;
      }),
    );
    const unsub = api.onEnvelopeReceived((envelope) => {
      if (!envelope?.roomId) return;
      const state = messageState(envelope);
      const previous = messageStates.current.get(envelope.id);
      messageStates.current.set(envelope.id, state);
      buffer.push(envelope);
      if (envelope.roomId !== roomRef.current && !previous)
        setUnread((prev) => ({
          ...prev,
          [envelope.roomId]: (prev[envelope.roomId] || 0) + 1,
        }));
      if (
        envelope.roomId === roomRef.current &&
        state !== previous &&
        state === "completed" &&
        envelope.sender.kind === "agent"
      ) {
        islandRef.current?.triggerHappyBounce(
          AGENT_NAMES[providerOf(envelope)],
          "Hoàn tất",
        );
        if (soundEnabledRef.current) playChime("success");
        skyRef.current?.triggerSakuraBurst(window.innerWidth * 0.5, window.innerHeight * 0.35, 14);
      }
    });
    return () => {
      unsub();
      buffer.dispose();
      unsubBrowser?.();
    };
  }, [api]);
  const refreshHistory = useCallback(async () => {
    if (!api) return;
    const room = activeRoom;
    const request = ++historyRequest.current;
    setLoadingHistory(true);
    try {
      const history = await api.getRoomHistory(room);
      if (request !== historyRequest.current) return;
      if (!Array.isArray(history)) throw Error("Dữ liệu lịch sử không hợp lệ");
      setMessages((prev) => {
        let merged = history;
        for (const live of prev[room] || [])
          merged = mergeEnvelope(merged, live);
        return { ...prev, [room]: merged };
      });
    } catch (error) {
      notify(`Không tải được lịch sử: ${String(error)}`);
    } finally {
      if (request === historyRequest.current) setLoadingHistory(false);
    }
  }, [activeRoom, api, notify]);
  useEffect(() => {
    nearBottom.current = true;
    setNewMessages(false);
    setUnread((prev) => ({ ...prev, [activeRoom]: 0 }));
    refreshHistory();
    return () => {
      historyRequest.current++;
    };
  }, [activeRoom, refreshHistory]);
  const roomMessages = messages[activeRoom] || EMPTY_MESSAGES;
  const activity = useMemo(() => roomActivity(roomMessages), [roomMessages]);
  const agentNodes = useMemo<AgentNodeData[]>(
    () =>
      Object.entries(AGENT_NAMES).map(([id, name]) => {
        const live = activity.filter((e) => providerOf(e) === id);
        const latest =
          live.find((e) => messageState(e) !== "queued") ||
          live[0] ||
          [...roomMessages]
            .reverse()
            .find((e) => e.sender.kind !== "user" && providerOf(e) === id);
        const state = latest ? messageState(latest) : "idle";
        const status: AgentStatus = (
          [
            "idle",
            "queued",
            "sending",
            "streaming",
            "completed",
            "cancelled",
          ].includes(state)
            ? state
            : "blocked"
        ) as AgentStatus;
        const stage = latest?.delivery?.progressStage;
        const statusText = status === "sending" && stage
          ? {loading:"Đang tải", preparing:"Đang soạn", sending:"Đang gửi", waiting:"Chờ AI"}[stage]
          : undefined;
        return { id, name, status, statusText };
      }),
    [roomMessages, activity],
  );
  const typingAgents = useMemo(
    () =>
      new Set(
        activity
          .filter((e) => ["sending", "streaming"].includes(messageState(e)))
          .map((e) => AGENT_NAMES[providerOf(e)])
          .filter(Boolean),
      ),
    [roomMessages],
  );
  useLayoutEffect(() => {
    if (!chatRef.current) return;
    const selection = window.getSelection();
    if (
      selection &&
      !selection.isCollapsed &&
      selection.anchorNode &&
      chatRef.current.contains(selection.anchorNode)
    )
      nearBottom.current = false;
    if (nearBottom.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
      setNewMessages(false);
    } else setNewMessages(true);
  }, [roomMessages, activeRoom]);
  useEffect(() => {
    if (garden && nearBottom.current && chatRef.current)
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [garden]);

  async function sendMessage(event?: React.FormEvent) {
    event?.preventDefault();
    const original = (drafts[activeRoom] || "").trim();
    if (!original || sendLock.current) return;
    if (!api) {
      notify("Mở ứng dụng Desktop để kết nối AI.");
      return;
    }
    const room = activeRoom;
    const hasMention =
      /^\s*@(all|team|chatgpt|gemini|codex|antigravity|claude|deepseek)\b/i.test(
        original,
      );
    const text = hasMention ? original : `@${recipient} ${original}`;
    const id = `env_${crypto.randomUUID()}`;
    const envelope: EnvelopeView = {
      id,
      traceId: `trc_${crypto.randomUUID()}`,
      timestamp: Date.now(),
      roomId: room,
      sender: { kind: "user", id: "user_lead", name: "Bạn" },
      recipient: { kind: "room", id: room },
      parts: [{ kind: "text", text }],
      fidelity: "L1_FORMATTED_MARKDOWN",
      status: "pending",
      metadata: { collaborationMode: mode },
    };
    sendLock.current = true;
    setSending(true);
    nearBottom.current = true;
    if (soundEnabledRef.current) playChime("soft");
    skyRef.current?.triggerMeteorShower(2);
    setMessages((prev) => ({
      ...prev,
      [room]: mergeEnvelope(prev[room] || [], {
        ...envelope,
        status: "sending",
      }),
    }));
    setDrafts((prev) => ({ ...prev, [room]: "" }));
    try {
      const result = await api.sendGroupMessage(envelope);
      if (!result?.success)
        throw Error(result?.error || "Chưa gửi được tin nhắn");
      setMessages((prev) => ({
        ...prev,
        [room]: mergeEnvelope(prev[room] || [], {
          ...envelope,
          status: "completed",
        }),
      }));
    } catch (error) {
      setMessages((prev) => ({
        ...prev,
        [room]: mergeEnvelope(prev[room] || [], {
          ...envelope,
          status: "failed",
        }),
      }));
      setDrafts((prev) => ({
        ...prev,
        [room]: prev[room] ? `${original}\n${prev[room]}` : original,
      }));
      notify(`Gửi thất bại: ${String(error)}. Nội dung đã được giữ lại.`);
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }
  async function createTask(event: React.FormEvent) {
    event.preventDefault();
    if (!taskTitle.trim() || !api || taskLocks.current.has("create")) return;
    taskLocks.current.add("create");
    setTaskBusy((prev) => new Set(prev).add("create"));
    try {
      const result = await api.createTask({
        title: taskTitle.trim(),
        roomId: activeRoom,
        status: "pending",
        progress: 0,
        metadata: {
          assignee: taskAgent,
          provider: taskAgent,
          role: taskAgent === "codex" ? "QA_SECURITY" : "IMPLEMENTER",
          createdVia: "workspace",
        },
      });
      if (!result?.success || !result.task?.id)
        throw Error(result?.error || "Không tạo được công việc");
      setTaskTitle("");
      await loadTasks();
      notify("Đã tạo công việc. Chọn Chạy để bắt đầu thực thi.");
    } catch (error) {
      notify(String(error));
    } finally {
      taskLocks.current.delete("create");
      setTaskBusy((prev) => {
        const next = new Set(prev);
        next.delete("create");
        return next;
      });
    }
  }
  async function taskAction(task: TaskItem, action: "run" | "cancel") {
    const lockKey = action === "run" ? task.id : `${task.id}:cancel`;
    if (!api || taskLocks.current.has(lockKey)) return;
    taskLocks.current.add(lockKey);
    setTaskBusy((prev) => new Set(prev).add(lockKey));
    try {
      const result =
        action === "run"
          ? await api.executeTask({ taskId: task.id })
          : await api.cancelTask({ taskId: task.id });
      if (!result?.success)
        throw Error(result?.error || "Không thực hiện được");
      notify(
        action === "cancel"
          ? "Đã gửi yêu cầu dừng đến bộ thực thi."
          : "Đã nhận kết quả thực thi.",
      );
    } catch (error) {
      notify(String(error));
    } finally {
      taskLocks.current.delete(lockKey);
      await loadTasks();
      setTaskBusy((prev) => {
        const next = new Set(prev);
        next.delete(lockKey);
        return next;
      });
    }
  }
  async function cancelRun(runId: string) {
    try {
      const result = await api?.cancelGroupRun({ runId, roomId: activeRoom });
      if (!result?.success)
        throw Error(result?.error || "Không dừng được lượt");
      notify("Đã yêu cầu dừng lượt. Nội dung nhận trước đó được giữ lại.");
    } catch (error) {
      notify(String(error));
    }
  }
  const openThread = useCallback(
    async (envelope: EnvelopeView) => {
      if (!api) return;
      try {
        const result = await api.openGroupThread({
          roomId: envelope.roomId,
          provider: providerOf(envelope),
        });
        if (!result.success) throw Error(result.error);
        setIsBrowserOpen(true);
      } catch (error) {
        notify(String(error));
      }
    },
    [api, notify],
  );
  const groups = useMemo(() => {
    const result = new Map<string, EnvelopeView[]>();
    for (const envelope of roomMessages) {
      if (!showDiagnostics && isDiagnosticEnvelope(envelope)) continue;
      const key = runIdOf(envelope);
      result.set(key, [...(result.get(key) || []), envelope]);
    }
    return [...result.entries()];
  }, [roomMessages, showDiagnostics]);
  const roomTasks = tasks.filter(
    (task) =>
      ((task as TaskItem & { roomId?: string }).roomId || task.room_id) ===
      activeRoom,
  );
  const visibleTasks = roomTasks.filter(
    (task) =>
      (showHistory ||
        task.metadata?.createdVia === "workspace" ||
        isTaskActive(task)) &&
      (!search || task.title.toLowerCase().includes(search.toLowerCase())),
  );
  const decisions = roomMessages.filter((e) => e.delivery?.phase === "summary");
  const roomName = rooms.find((r) => r.id === activeRoom)?.name || activeRoom;
  const draftTargets = commandMentionTargets(drafts[activeRoom] || "");
  const lastMessage = roomMessages[roomMessages.length - 1];
  const lastTurn = lastMessage
    ? roomMessages.filter(e => runIdOf(e) === runIdOf(lastMessage) && e.sender.kind !== "user")
    : EMPTY_MESSAGES;
  const aetherState = activity.length ? "thinking"
    : lastTurn.some(e => ["blocked", "failed", "waiting_input"].includes(messageState(e))) ? "blocked"
    : lastTurn.length > 0 && lastTurn.every(e => messageState(e) === "completed") ? "completed" : "idle";

  const blockedAgents = useMemo(() => {
    return Object.entries(AGENT_NAMES).filter(([provider]) => {
      const tab = browser?.tabs.find((t) => t.providerId === provider);
      if (tab?.authStatus === "LOGIN_REQUIRED") return true;
      const turns = roomMessages.filter((e) => providerOf(e) === provider && e.sender.kind !== "user");
      const latest = turns[turns.length - 1];
      return latest && ["blocked", "failed"].includes(messageState(latest));
    });
  }, [browser, roomMessages]);

  return (
    <div
      className="ub-workspace"
      data-motion={motionEnabled && !pageHidden ? "on" : "off"}
      style={{ "--chat-font-size": `${fontSize}px` } as React.CSSProperties}
    >
      <CosmicSakuraSky ref={skyRef} motionEnabled={motionEnabled && !pageHidden} />
      <header className="ub-topbar">
        <div
          className="ub-brand"
          style={{ cursor: "pointer" }}
          onClick={() => {
            if (soundEnabledRef.current) playChime("soft");
            skyRef.current?.triggerMeteorShower(6);
            skyRef.current?.triggerSakuraBurst(140, 32, 16);
          }}
        >
          <span>U</span>
          <div>
            Union Bot<small>Sakura Galaxy Workspace</small>
          </div>
        </div>
        <div className="ub-top-actions">
          <span className="ub-connection">
            {api ? "Desktop đã kết nối" : "Bản xem trước"}
          </span>
          <button
            title="Gọi mưa sao băng lướt qua bầu trời"
            onClick={() => {
              if (soundEnabledRef.current) playChime("soft");
              skyRef.current?.triggerMeteorShower(6);
            }}
          >
            🌠 Mưa Sao Băng
          </button>
          <button
            title="Thu gọn 2 bên để phóng to khung Chat & ngắm cảnh Vũ trụ Hoa Anh Đào"
            aria-pressed={focusChatMode}
            onClick={() => {
              setFocusChatMode((v) => !v);
              if (!focusChatMode) {
                skyRef.current?.triggerMeteorShower(4);
              }
            }}
          >
            🎯 {focusChatMode ? "Hiện 2 bên" : "Tập trung Chat"}
          </button>
          <button
            title="Đổi mật độ Hoa Anh Đào & Sao Băng"
            onClick={() => {
              const nextLabel = skyRef.current?.cycleDensity() || "Hoa & Sao: Rực rỡ";
              setDensityLabel(nextLabel);
            }}
          >
            🌸 {densityLabel}
          </button>
          <button
            aria-pressed={motionEnabled}
            title={motionEnabled ? "Tắt chuyển động" : "Bật chuyển động"}
            onClick={() => setMotionEnabled((v) => !v)}
          >
            Hiệu ứng
          </button>
          <button onClick={() => setGarden((v) => !v)} aria-pressed={garden}>
            {garden ? "Ẩn đảo 3D" : "Đảo 3D"}
          </button>
          <button
            onClick={() => setIsBrowserOpen((v) => !v)}
            data-testid="toggle-browser-btn"
            aria-expanded={isBrowserOpen}
          >
            Trình duyệt AI
          </button>
          <button
            onClick={() => setInspectorOpen((v) => !v)}
            aria-expanded={inspectorOpen}
          >
            Chi tiết
          </button>
          <button
            title={soundEnabled ? "Tắt âm thanh chuông gió" : "Bật âm thanh chuông gió"}
            aria-pressed={soundEnabled}
            onClick={() => {
              setSoundEnabled((v) => !v);
              if (!soundEnabled) playChime("soft");
            }}
          >
            {soundEnabled ? "🔔" : "🔕"}
          </button>
        </div>
      </header>
      <div className={`ub-shell ${inspectorOpen ? "" : "inspector-hidden"} ${navigationCollapsed ? "nav-collapsed" : ""} ${focusChatMode ? "focus-chat-mode" : ""}`}>
        <nav className="ub-navigation" aria-label="Phòng làm việc">
          <button className="ub-nav-toggle" aria-label={navigationCollapsed ? "Mở rộng thanh phòng" : "Thu gọn thanh phòng"} aria-expanded={!navigationCollapsed} onClick={() => setNavigationCollapsed(v => !v)}>
            <span aria-hidden="true">◫</span><strong>Không gian của bạn</strong>
          </button>
          <p className="ub-eyebrow">Phòng làm việc</p>
          {rooms.map((room) => (
            <button
              key={room.id}
              title={`${room.name} · ${room.description}`}
              aria-label={room.name}
              className={activeRoom === room.id ? "selected" : ""}
              onClick={() => setActiveRoom(room.id)}
              aria-current={activeRoom === room.id ? "page" : undefined}
            >
              <span aria-hidden="true">
                {(
                  {
                    orchestration: "◉",
                    "agent-dev": "◇",
                    "qa-audit": "✓",
                    "review-briefing": "≋",
                  } as Record<string, string>
                )[room.id] || "#"}
              </span>
              <div>
                <strong>{room.name}</strong>
                <small>{room.description}</small>
              </div>
              {unread[room.id] > 0 && <b>{unread[room.id]}</b>}
            </button>
          ))}
          <div className="ub-nav-bottom">
            <p>
              Cùng một yêu cầu.
              <br />
              Rõ người làm, rõ kết quả.
            </p>
            <small>
              Gọi đích danh bằng @tên AI.
              <br />
              Chọn Phản biện để có tổng hợp.
            </small>
          </div>
        </nav>
        <main className="ub-conversation">
          <div className="ub-room-bar">
          <header className="ub-room-header">
            <div>
              <p className="ub-eyebrow">
                #{activeRoom} · Các AI trả lời song song
              </p>
              <h1>{roomName}</h1>
            </div>
            <div className="ub-room-tools">
            <AetherOrb motionEnabled={motionEnabled && !pageHidden} state={aetherState} />
            <details className="ub-view-options">
              <summary>Tùy chọn</summary>
              <div className="ub-font-control">
                <label className="ub-filter">
                  <input
                    type="checkbox"
                    checked={showDiagnostics}
                    onChange={(e) => setShowDiagnostics(e.target.checked)}
                  />
                  Tin kiểm thử
                </label>
                <button
                  aria-label="Giảm cỡ chữ"
                  disabled={fontSize <= 13}
                  onClick={() => setFontSize((v) => Math.max(13, v - 1))}
                >
                  A−
                </button>
                <span>{fontSize}px</span>
                <button
                  aria-label="Tăng cỡ chữ"
                  disabled={fontSize >= 20}
                  onClick={() => setFontSize((v) => Math.min(20, v + 1))}
                >
                  A+
                </button>
              </div>
            </details>
            </div>
          </header>
          <AgentSignalStrip3D
            agents={agentNodes}
            onSelectAgent={selectAgent}
            motionEnabled={motionEnabled}
          />
          </div>
          {activity.length > 0 && (
            <div className="ub-run-status" role="status">
              {activity.filter((e) => messageState(e) !== "queued").length} đang
              xử lý <span>·</span>{" "}
              {activity.filter((e) => messageState(e) === "queued").length} đang
              chờ{" "}
              <button
                onClick={() =>
                  cancelRun(
                    runIdOf(
                      activity.find((e) => messageState(e) !== "queued") ||
                        activity[0],
                    ),
                  )
                }
              >
                Dừng lượt hiện tại
              </button>
            </div>
          )}
          {garden && (
            <section className="ub-garden" aria-label="Đảo mascot">
              <React.Suspense
                fallback={<p className="ub-muted">Đang tải đảo 3D…</p>}
              >
                <Sora3DIsland
                  ref={islandRef}
                  motionEnabled={motionEnabled && !pageHidden}
                  typingAgents={typingAgents}
                  focusedAgent={focusedAgent}
                  onSelectAgent={(id) => {
                    setFocusedAgent(id);
                    setRecipient(id.toLowerCase());
                  }}
                />
              </React.Suspense>
            </section>
          )}
          <div className="ub-chat-region">
            <div
              className="ub-chat-scroll"
              role="region"
              aria-label={`Hội thoại ${roomName}`}
              ref={chatRef}
              onScroll={() => {
                const el = chatRef.current;
                if (el) {
                  nearBottom.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 96;
                  if (nearBottom.current) setNewMessages(false);
                }
              }}
            >
              <div className="ub-feed" ref={feedRef}>
                {loadingHistory && (
                  <p className="ub-muted" role="status">
                    Đang tải lịch sử…
                  </p>
                )}
                {!loadingHistory && groups.length === 0 && (
                  <div className="ub-empty">
                    <span>U</span>
                    <h2>Bắt đầu một cuộc trao đổi</h2>
                    <p>
                      Chọn AI nhận việc, gửi yêu cầu và theo dõi phản hồi tại
                      đây. Bật Phản biện nếu bạn cần các thành viên đối chiếu ý
                      kiến và đưa ra kết luận chung.
                    </p>
                  </div>
                )}
                {groups.map(([runId, envelopes]) => (
                  <section
                    className="ub-run"
                    key={runId}
                    data-testid="workspace-run"
                  >
                    {envelopes.some(
                      (e) =>
                        ["queued", "sending", "streaming"].includes(
                          messageState(e),
                        ) && e.sender.kind === "agent",
                    ) && (
                      <div className="ub-run-toolbar">
                        <span>Lượt đang xử lý</span>
                        <button onClick={() => cancelRun(runId)}>
                          Dừng lượt
                        </button>
                      </div>
                    )}
                    {envelopes.filter(e => !isRunNotice(e)).map((envelope, index, visible) => (
                      <ChatMessage
                        key={envelope.id}
                        envelope={envelope}
                        continuation={index > 0 && visible[index - 1].sender.kind === envelope.sender.kind && providerOf(visible[index - 1]) === providerOf(envelope) && Math.abs(envelope.timestamp - visible[index - 1].timestamp) < 5 * 60_000 && visible[index - 1].delivery?.phase === envelope.delivery?.phase}
                        onReply={selectAgent}
                        onOpenThread={openThread}
                      />
                    ))}
                    <RunNotices envelopes={envelopes.filter(isRunNotice)} onOpenThread={openThread} />
                  </section>
                ))}
              </div>
            </div>
            {newMessages && (
              <button
                className="ub-new-messages"
                onClick={() => {
                  nearBottom.current = true;
                  setNewMessages(false);
                  chatRef.current?.scrollTo({
                    top: chatRef.current.scrollHeight,
                    behavior: "instant",
                  });
                }}
              >
                Có cập nhật mới ↓
              </button>
            )}
          </div>
          {blockedAgents.length > 0 ? (
            <div className="ub-blocked-banner" role="status">
              <span>⚠️ <strong>{blockedAgents.length} AI cần xử lý:</strong> {blockedAgents.map(([_, name]) => name).join(", ")}</span>
              <button
                type="button"
                onClick={() => setIsBrowserOpen(true)}
              >
                ⚡ Mở Trình duyệt để gỡ chặn
              </button>
            </div>
          ) : (
            <div className="ub-blocked-banner all-ok" role="status">
              <span>✓ <strong>Tất cả 6 AI đã kết nối hoàn tất!</strong> Sẵn sàng nhận yêu cầu song song.</span>
            </div>
          )}
          <form className="ub-composer" onSubmit={sendMessage}>
            <div className="ub-composer-controls">
              <label>
                Gửi đến
                <select
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                >
                  {Object.entries(AGENT_NAMES).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                  <option value="all">Cả nhóm · 6 AI</option>
                </select>
              </label>
              <label>
                Chế độ
                <select
                  value={mode}
                  onChange={(e) =>
                    setMode(e.target.value as "direct" | "review")
                  }
                >
                  <option value="direct">Trao đổi trực tiếp</option>
                  <option value="review">Phản biện & tổng hợp</option>
                </select>
              </label>
              <span
                className="ub-mention-chip"
                title="Gọi toàn bộ 6 AI"
                onClick={() => {
                  setDrafts((prev) => ({
                    ...prev,
                    [activeRoom]: "@all " + (prev[activeRoom] || "").replace(/^\s*@\S+\s*/, ""),
                  }));
                  inputRef.current?.focus();
                }}
              >
                @all
              </span>
              <span
                className="ub-mention-chip"
                title="Gọi Antigravity triển khai code"
                onClick={() => {
                  setDrafts((prev) => ({
                    ...prev,
                    [activeRoom]: "@Antigravity " + (prev[activeRoom] || "").replace(/^\s*@\S+\s*/, ""),
                  }));
                  inputRef.current?.focus();
                }}
              >
                @Antigravity
              </span>
              {draftTargets.length > 0 && <span className="ub-tag-targets" aria-live="polite">Gọi: <MemberMentions text={draftTargets.length === 6 ? "@all" : draftTargets.map(id => `@${id}`).join(" ")} /></span>}
            </div>
            <textarea
              ref={inputRef}
              aria-label="Tin nhắn cho AI"
              rows={1}
              value={drafts[activeRoom] || ""}
              onChange={(e) =>
                setDrafts((prev) => ({ ...prev, [activeRoom]: e.target.value }))
              }
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
              }}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  !composing.current &&
                  e.keyCode !== 229
                ) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Bạn muốn các AI cùng giải quyết việc gì?"
            />
            <div className="ub-composer-bottom">
              <small>
                {mode === "review"
                  ? "Phân tích song song → tổng hợp"
                  : "Enter gửi · Shift+Enter xuống dòng"}{" "}
                · @tên để gọi AI
              </small>
              <button
                className="ub-primary"
                type="submit"
                disabled={!api || sending || !(drafts[activeRoom] || "").trim()}
              >
                {sending ? "Đang gửi…" : "Gửi yêu cầu ↑"}
              </button>
            </div>
          </form>
        </main>
        {inspectorOpen && (
          <aside className="ub-inspector" aria-label="Chi tiết công việc">
            <div
              className="ub-tabs"
              role="tablist"
              aria-label="Thông tin ngữ cảnh"
            >
              {(
                [
                  ["members", "Thành viên"],
                  ["tasks", "Công việc"],
                  ["decisions", "Kết luận"],
                ] as const
              ).map(([tab, label]) => (
                <button
                  role="tab"
                  aria-selected={inspectorTab === tab}
                  key={tab}
                  onClick={() => setInspectorTab(tab)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="ub-inspector-body">
              {inspectorTab === "members" && (
                <>
                  <p className="ub-eyebrow">Trong phòng này</p>
                  <h2>Ai đang làm gì?</h2>
                  {Object.entries(AGENT_NAMES).map(([provider, name]) => {
                    const turns = roomMessages.filter(
                      (e) =>
                        providerOf(e) === provider && e.sender.kind !== "user",
                    );
                    const live = activity.filter(
                      (e) => providerOf(e) === provider,
                    );
                    const latest =
                      live.find((e) => messageState(e) !== "queued") ||
                      live[0] ||
                      turns[turns.length - 1];
                    const tab = browser?.tabs.find(
                      (t) => t.providerId === provider,
                    );
                    return (
                      <section className="ub-member-detail" key={provider}>
                        <div>
                          <Avatar provider={provider} />
                          <strong>{name}</strong>
                          {latest && <Badge state={messageState(latest)} />}
                        </div>
                        <p>{AGENTS[name]?.role}</p>
                        <small>
                          {live.length
                            ? `${live.length} lượt đang xử lý hoặc chờ`
                            : latest
                              ? "Trạng thái của lượt gần nhất"
                              : "Chưa nhận yêu cầu trong phòng này"}
                        </small>
                        <small>
                          {["codex", "antigravity"].includes(provider)
                            ? "Kết nối qua adapter Desktop"
                            : tab?.authStatus === "LOGIN_REQUIRED"
                              ? "Cần đăng nhập trong Trình duyệt AI"
                              : "Phiên web · kiểm tra đăng nhập khi gửi"}
                        </small>
                        {["chatgpt", "gemini", "claude", "deepseek"].includes(
                          provider,
                        ) && (
                          <ProviderSessionControls
                            providerId={provider}
                            roomId={activeRoom}
                            tabId={tab?.id}
                            onOpen={() => setIsBrowserOpen(true)}
                          />
                        )}
                        {tab && (
                          <button
                            onClick={async () => {
                              if (!api) return;
                              try {
                                const result = await api.openGroupThread({roomId: activeRoom, provider});
                                if (!result.success) throw Error(result.error || "Không mở được hội thoại của phòng.");
                                setIsBrowserOpen(true);
                              } catch (error) { notify(String(error)); }
                            }}
                          >
                            Mở tab {name} ↗
                          </button>
                        )}
                      </section>
                    );
                  })}
                </>
              )}
              {inspectorTab === "tasks" && (
                <>
                  <p className="ub-eyebrow">Công việc của phòng</p>
                  <h2>{roomTasks.filter(isTaskActive).length} đang thực thi</h2>
                  <form className="ub-task-form" onSubmit={createTask}>
                    <label>
                      Nội dung công việc
                      <textarea
                        required
                        rows={3}
                        value={taskTitle}
                        onChange={(e) => setTaskTitle(e.target.value)}
                        placeholder="Mô tả nhiệm vụ cần thực thi…"
                      />
                    </label>
                    <label>
                      Người thực thi
                      <select
                        value={taskAgent}
                        onChange={(e) => setTaskAgent(e.target.value)}
                      >
                        <option value="codex">Codex</option>
                        <option value="antigravity">Antigravity</option>
                      </select>
                    </label>
                    <button
                      type="submit"
                      disabled={
                        !api || taskBusy.has("create") || !taskTitle.trim()
                      }
                    >
                      Tạo công việc chờ
                    </button>
                    <small>
                      Chọn Chạy trên từng công việc để bắt đầu. AI web nhận yêu
                      cầu qua hội thoại.
                    </small>
                  </form>
                  <label className="ub-filter">
                    <input
                      type="checkbox"
                      checked={showHistory}
                      onChange={(e) => setShowHistory(e.target.checked)}
                    />
                    Hiện cả công việc cũ / kiểm thử ({roomTasks.length})
                  </label>
                  <input
                    aria-label="Tìm công việc"
                    placeholder="Tìm công việc…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {visibleTasks.length === 0 && (
                    <p className="ub-muted">
                      Chưa có công việc phù hợp bộ lọc.
                    </p>
                  )}
                  {visibleTasks.map((task) => {
                    const state = taskState(task);
                    const progress = taskProgress(task);
                    const busy = taskBusy.has(task.id);
                    return (
                      <article className="ub-task" key={task.id}>
                        <Badge state={state} />
                        <h3>{task.title}</h3>
                        <small>
                          {String(
                            task.metadata?.assignee ||
                              task.metadata?.provider ||
                              "Chưa gán",
                          )}
                        </small>
                        {progress !== undefined && (
                          <div className="ub-progress">
                            <progress max="100" value={progress} />
                            <span>{progress}%</span>
                          </div>
                        )}
                        {task.metadata?.error && (
                          <p className="ub-error">{task.metadata.error}</p>
                        )}
                        <div>
                          {[
                            "pending",
                            "failed",
                            "cancelled",
                            "blocked",
                            "waiting_input",
                          ].includes(state) && (
                            <button
                              disabled={busy}
                              onClick={() => taskAction(task, "run")}
                            >
                              {busy
                                ? "Đang xử lý…"
                                : state === "pending"
                                  ? "Chạy"
                                  : "Thử lại"}
                            </button>
                          )}
                          {["pending", "running"].includes(state) && (
                            <button
                              disabled={taskBusy.has(`${task.id}:cancel`)}
                              onClick={() => taskAction(task, "cancel")}
                            >
                              Yêu cầu dừng
                            </button>
                          )}
                        </div>
                        <details>
                          <summary>Mã công việc</summary>
                          <code>{task.id}</code>
                        </details>
                      </article>
                    );
                  })}
                </>
              )}
              {inspectorTab === "decisions" && (
                <>
                  <p className="ub-eyebrow">Kết quả phối hợp</p>
                  <h2>Kết luận chung</h2>
                  {decisions.length === 0 ? (
                    <p className="ub-muted">
                      Chọn chế độ Phản biện & tổng hợp và thu thập từ hai phản
                      hồi. Kết luận sẽ xuất hiện ở đây.
                    </p>
                  ) : (
                    decisions.map((e) => (
                      <section className="ub-decision" key={e.id}>
                        <Badge state={messageState(e)} />
                        <MessageContent
                          text={textOf(e) || "Đang chờ tổng hợp…"}
                        />
                      </section>
                    ))
                  )}
                </>
              )}
            </div>
          </aside>
        )}
      </div>
      <BrowserPanel
        isOpen={isBrowserOpen}
        onClose={() => setIsBrowserOpen(false)}
        activeRoomId={activeRoom}
      />
      {toast && (
        <div className="ub-toast" role="status">
          <span>{toast}</span>
          <button aria-label="Đóng thông báo" onClick={() => setToast("")}>
            ×
          </button>
        </div>
      )}
    </div>
  );
};
