import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sora3DIsland, Sora3DIslandRef, AGENTS, AGENT_IDS } from './components/Sora3DIsland.tsx';
import { BrowserPanel } from './components/BrowserPanel.tsx';
import { EnvelopeView } from './types.ts';

export interface BotTask {
  id: string;
  title: string;
  agent: string;
  progress: number;
  status: 'RUNNING' | 'PAUSED' | 'DONE';
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface ChatMessage {
  id: string;
  sender: string;
  time: string;
  text: string;
  taskTag?: string;
  reactions?: Record<string, number>;
  status?: string;
}

export interface RoomDef {
  id: string;
  label: string;
  unread: number;
}

const DEFAULT_ROOMS: RoomDef[] = [
  { id: 'orchestration', label: '💙 #orchestration (Chung)', unread: 0 },
  { id: 'agent-dev', label: '⚡ #agent-dev (Code)', unread: 0 },
  { id: 'qa-audit', label: '🛡️ #qa-audit (Kiểm thử)', unread: 0 },
  { id: 'review-briefing', label: '📋 #review-briefing (Review)', unread: 0 },
];

const INITIAL_CHECKLIST: ChecklistItem[] = [
  { id: 'ck-1', text: 'Khung Chat Nhóm 70% màn hình chữ 13px thoáng đẹp', done: true },
  { id: 'ck-2', text: 'Khung Đảo Hoa Lam 3D riêng biệt không bị che khuất', done: true },
  { id: 'ck-3', text: 'Bảng Tác Vụ & Checklist thu gọn mở rộng 100% 3D', done: true },
  { id: 'ck-4', text: 'Kết nối trực tiếp Hội Đồng 6 AI qua Electron IPC', done: true },
];

function formatTime(timestamp?: number): string {
  if (!timestamp) return new Date().toTimeString().slice(0, 5);
  const d = new Date(timestamp);
  return d.toTimeString().slice(0, 5);
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function mapSenderToAgentId(sender: any): string {
  if (!sender) return 'ChatGPT';
  if (sender.kind === 'user' || sender.id === 'user_lead' || sender.kind === 'human') {
    return 'Commander';
  }
  const provider = (sender.provider || sender.id || '').toLowerCase();
  if (provider.includes('chatgpt')) return 'ChatGPT';
  if (provider.includes('gemini')) return 'Gemini';
  if (provider.includes('antigravity')) return 'Antigravity';
  if (provider.includes('codex')) return 'Codex';
  if (provider.includes('claude')) return 'Claude';
  if (provider.includes('deepseek')) return 'DeepSeek';
  if (sender.kind === 'system' || sender.id === 'system_router') return 'ChatGPT';
  return 'ChatGPT';
}

function envelopeToChatMessage(env: EnvelopeView): ChatMessage {
  const senderId = mapSenderToAgentId(env.sender);
  const parts = env.parts || [];
  const text = parts
    .map((p) => {
      if (p.text) return p.text;
      if (p.content) return p.content;
      if (p.code) return '```' + (p.language || '') + '\n' + p.code + '\n```';
      if (p.diff) return '```diff\n' + p.diff + '\n```';
      return '';
    })
    .filter(Boolean)
    .join('\n\n');

  const taskMatch = text.match(/\[(TASK-\d+)\]/);
  const envStatus = (env as any).status || env.delivery?.state;

  return {
    id: env.id,
    sender: senderId,
    time: formatTime(env.timestamp),
    text: text || '(Tin nhắn trống)',
    taskTag: taskMatch ? taskMatch[1] : undefined,
    status: envStatus,
    reactions: { '💙': 1 },
  };
}

export const App: React.FC = () => {
  const isDesktop = typeof window !== 'undefined' && Boolean(window.unionBotAPI);
  const islandRef = useRef<Sora3DIslandRef>(null);
  const chatBoxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Layout & Theme State
  const [layoutRatio, setLayoutRatio] = useState<'70' | '85' | '100' | 'garden'>('70');
  const [isDayTheme, setIsDayTheme] = useState<boolean>(false);
  const [chatFontSize, setChatFontSize] = useState<number>(13);
  const [focusedAgent, setFocusedAgent] = useState<string | null>(null);
  const [isMobileTaskOpen, setIsMobileTaskOpen] = useState<boolean>(false);
  const [isBrowserOpen, setIsBrowserOpen] = useState<boolean>(false);
  const [isBridgeModalOpen, setIsBridgeModalOpen] = useState<boolean>(false);
  const [autoParty, setAutoParty] = useState<boolean>(true);

  // Accordion Collapsed States
  const [collapsed, setCollapsed] = useState({
    taskHub: false,
    activeTasks: false,
    checklist: false,
    quickControls: false,
    aiMemberBar: false,
    pinnedTaskBanner: false,
    quickChips: false,
  });

  // Core Data States
  const [rooms, setRooms] = useState<RoomDef[]>(DEFAULT_ROOMS);
  const [activeRoom, setActiveRoom] = useState<string>('orchestration');
  const [roomMessages, setRoomMessages] = useState<Record<string, ChatMessage[]>>({
    orchestration: [
      {
        id: 'welcome-001',
        sender: 'ChatGPT',
        time: formatTime(Date.now()),
        text: 'Chào **Commander**! 💙 Hệ thống **Union Bot** đã sẵn sàng phối hợp.\n• Nhập tin nhắn bất kỳ để thảo luận và giao việc.\n• Gõ `@ChatGPT`, `@Antigravity`, `@Codex`, `@Gemini`, `@Claude`, `@DeepSeek` để gọi đích danh AI.\n• Bấm nút **`🌐 Web AI`** trên thanh tiêu đề để đăng nhập tài khoản ChatGPT / Claude / Gemini Web của bạn.',
        reactions: { '💙': 3 },
      },
    ],
  });

  const [botTasks, setBotTasks] = useState<BotTask[]>([
    {
      id: 'TASK-01',
      title: 'Đồng bộ Hội Đồng 6 AI & Tối ưu bố cục khung chat thoáng đẹp',
      agent: 'Codex',
      progress: 90,
      status: 'RUNNING',
    },
    {
      id: 'TASK-02',
      title: 'Tách biệt Khung Đảo 3D & Bảng Tác Vụ không đè nhau',
      agent: 'Antigravity',
      progress: 100,
      status: 'DONE',
    },
  ]);

  const [checklist, setChecklist] = useState<ChecklistItem[]>(INITIAL_CHECKLIST);
  const [pinnedTaskId, setPinnedTaskId] = useState<string>('TASK-01');

  // Input & Typing States
  const [inputText, setInputText] = useState<string>('');
  const [newTaskTitle, setNewTaskTitle] = useState<string>('');
  const [newTaskAgent, setNewTaskAgent] = useState<string>('Codex');
  const [typingAgents, setTypingAgents] = useState<Set<string>>(new Set());
  const [isSending, setIsSending] = useState<boolean>(false);

  // Toast Notification State
  const [toastText, setToastText] = useState<string | null>(null);
  const toastTimeoutRef = useRef<any>(null);

  const showToast = (text: string) => {
    setToastText(text);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setToastText(null);
    }, 2800);
  };

  // 1. Synchronize Room History and Listen to Real Envelopes via Electron IPC
  useEffect(() => {
    if (!isDesktop || !window.unionBotAPI) return;

    window.unionBotAPI
      .getRoomHistory(activeRoom)
      .then((history: EnvelopeView[]) => {
        if (Array.isArray(history) && history.length > 0) {
          const mapped = history.map(envelopeToChatMessage);
          setRoomMessages((prev) => ({
            ...prev,
            [activeRoom]: mapped,
          }));
        }
      })
      .catch((err: any) => console.error('[App] getRoomHistory error:', err));

    const unsubscribe = window.unionBotAPI.onEnvelopeReceived((env: EnvelopeView) => {
      if (!env || !env.roomId) return;
      const targetRoom = env.roomId;
      const newMsg = envelopeToChatMessage(env);

      if (newMsg.sender !== 'Commander') {
        const envStatus = (env as any).status || env.delivery?.state;
        const isStreaming = envStatus === 'streaming' || envStatus === 'sending';
        if (isStreaming) {
          setTypingAgents((prev) => new Set(prev).add(newMsg.sender));
        } else {
          setTypingAgents((prev) => {
            const next = new Set(prev);
            next.delete(newMsg.sender);
            return next;
          });
        }
        islandRef.current?.triggerHappyBounce(newMsg.sender, isStreaming ? 'Đang trả lời... ⚡' : 'Đã phản hồi! 💙');
      }

      setRoomMessages((prev) => {
        const list = prev[targetRoom] || [];
        const existingIdx = list.findIndex((m) => m.id === newMsg.id);
        if (existingIdx >= 0) {
          const updated = [...list];
          updated[existingIdx] = newMsg;
          return { ...prev, [targetRoom]: updated };
        }
        return { ...prev, [targetRoom]: [...list, newMsg] };
      });
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [activeRoom, isDesktop]);

  // 2. Load Tasks from SQLite if available
  const loadTasks = useCallback(async () => {
    if (isDesktop && window.unionBotAPI?.listTasks) {
      try {
        const tasks = await window.unionBotAPI.listTasks();
        if (Array.isArray(tasks) && tasks.length > 0) {
          const mappedTasks: BotTask[] = tasks.map((t: any, idx: number) => ({
            id: t.id || `TASK-${String(idx + 1).padStart(2, '0')}`,
            title: t.title || t.name || 'Tác vụ Union Bot',
            agent: t.metadata?.assignee || t.assignee || 'Codex',
            progress: t.status === 'completed' || t.status === 'DONE' ? 100 : t.progress || 35,
            status: t.status === 'completed' || t.status === 'DONE' ? 'DONE' : 'RUNNING',
          }));
          setBotTasks(mappedTasks);
        }
      } catch (err) {
        console.error('[App] listTasks error:', err);
      }
    }
  }, [isDesktop]);

  useEffect(() => {
    loadTasks();
    if (isDesktop && window.unionBotAPI?.onTaskUpdated) {
      const unsub = window.unionBotAPI.onTaskUpdated(() => {
        loadTasks();
      });
      return unsub;
    }
  }, [loadTasks, isDesktop]);

  // Font size synchronization
  const handleFontSizeChange = (val: number) => {
    const clamped = Math.max(11, Math.min(16, Math.round(val * 2) / 2));
    setChatFontSize(clamped);
    document.documentElement.style.setProperty('--chat-font-size', `${clamped}px`);
  };

  useEffect(() => {
    document.documentElement.style.setProperty('--chat-font-size', `${chatFontSize}px`);
  }, []);

  // Protect WebContentsView against modal bleed (Ticket P4-008)
  useEffect(() => {
    if (window.unionBotAPI && typeof window.unionBotAPI.browserSetModalActive === 'function') {
      window.unionBotAPI.browserSetModalActive(isBridgeModalOpen);
    }
  }, [isBridgeModalOpen]);

  // Day/Night Theme toggle
  const toggleTheme = () => {
    const nextDay = !isDayTheme;
    setIsDayTheme(nextDay);
    document.body.classList.toggle('theme-day', nextDay);
    if (islandRef.current) {
      islandRef.current.setDayTheme(nextDay);
    }
    showToast(nextDay ? '☀️ Đã chuyển sang chế độ Sáng Băng Lam!' : '🌙 Đã chuyển sang chế độ Đêm Lam Ngọc!');
  };

  // Section collapse toggle
  const toggleSection = (key: keyof typeof collapsed) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleCollapseAll = () => {
    const nextVal = !collapsed.taskHub;
    setCollapsed({
      taskHub: nextVal,
      activeTasks: nextVal,
      checklist: nextVal,
      quickControls: nextVal,
      aiMemberBar: nextVal,
      pinnedTaskBanner: nextVal,
      quickChips: nextVal,
    });
    showToast(
      nextVal
        ? '▴ Đã thu gọn các bảng phụ — Đảo 3D & Khung Chat mở rộng tối đa!'
        : '▾ Đã mở rộng lại đầy đủ các bảng tác vụ!'
    );
  };

  // Agent Selection / Mentions
  const handleSelectAgent = (agentId: string) => {
    setFocusedAgent(agentId);
    if (islandRef.current) {
      islandRef.current.focusAgent(agentId);
    }
    insertMention(`@${agentId}`);
  };

  const insertMention = (tag: string) => {
    setInputText((prev) => {
      if (prev.includes(tag)) return prev;
      return prev ? `${prev.trim()} ${tag} ` : `${tag} `;
    });
    inputRef.current?.focus();
  };

  const insertCodeTemplate = () => {
    setInputText((prev) => `${prev}\n\`\`\`ts\n// Nhập code tại đây\n\`\`\`\n`);
    inputRef.current?.focus();
  };

  // Pin Task
  const handlePinTask = (taskId: string) => {
    setPinnedTaskId(taskId);
    if (collapsed.pinnedTaskBanner) {
      setCollapsed((prev) => ({ ...prev, pinnedTaskBanner: false }));
    }
    const t = botTasks.find((x) => x.id === taskId);
    if (t && islandRef.current) {
      islandRef.current.triggerHappyBounce(t.agent, `Đang ghim ${t.id}! 📌`);
    }
    showToast(`📌 Đã ghim [${taskId}] lên đầu khung chat!`);
  };

  // Task Actions
  const handleToggleTaskStatus = (taskId: string) => {
    setBotTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        if (t.status === 'DONE') return { ...t, status: 'RUNNING', progress: 30 };
        if (t.status === 'RUNNING') return { ...t, status: 'PAUSED' };
        return { ...t, status: 'RUNNING' };
      })
    );
  };

  const handleCompleteTask = (taskId: string) => {
    setBotTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        return { ...t, status: 'DONE', progress: 100 };
      })
    );
    const t = botTasks.find((x) => x.id === taskId);
    if (t && islandRef.current) {
      islandRef.current.triggerHappyBounce(t.agent, `Hoàn tất ${t.id}! ✅`);
    }
    showToast(`✅ Đã hoàn tất 100% [${taskId}]!`);
  };

  const handleAddNewTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTaskTitle.trim();
    if (!title) return;

    const newId = `TASK-0${botTasks.length + 1}`;
    const newTask: BotTask = {
      id: newId,
      title,
      agent: newTaskAgent,
      progress: 20,
      status: 'RUNNING',
    };

    setBotTasks((prev) => [newTask, ...prev]);
    setPinnedTaskId(newId);
    setNewTaskTitle('');
    showToast(`📋 Đã giao [${newId}] cho @${newTaskAgent}!`);

    if (islandRef.current) {
      islandRef.current.triggerHappyBounce(newTaskAgent, `Nhận ${newId}! 🚀`);
    }

    if (isDesktop && window.unionBotAPI?.createTask) {
      try {
        await window.unionBotAPI.createTask({
          title,
          roomId: activeRoom,
          metadata: { assignee: newTaskAgent },
        });
      } catch (err) {
        console.error('[App] createTask error:', err);
      }
    }
  };

  const handleRunAllTasksBoost = () => {
    setBotTasks((prev) =>
      prev.map((t) => {
        if (t.status === 'DONE') return t;
        const nextProgress = Math.min(100, t.progress + 20);
        return {
          ...t,
          status: nextProgress >= 100 ? 'DONE' : 'RUNNING',
          progress: nextProgress,
        };
      })
    );
    islandRef.current?.triggerAzureGust();
    showToast('⚡ Đã tăng tốc toàn bộ hàng đợi tác vụ AI (+20%)!');
  };

  const handleClearCompletedTasks = () => {
    const beforeCount = botTasks.length;
    const remaining = botTasks.filter((t) => t.status !== 'DONE');
    if (remaining.length === 0) {
      remaining.push({
        id: 'TASK-01',
        title: 'Giám sát điều phối tác vụ Union Bot',
        agent: 'ChatGPT',
        progress: 50,
        status: 'RUNNING',
      });
    }
    setBotTasks(remaining);
    showToast(`🧹 Đã dọn ${Math.max(0, beforeCount - remaining.length)} tác vụ hoàn tất!`);
  };

  const handleToggleChecklist = (ckId: string) => {
    setChecklist((prev) =>
      prev.map((c) => (c.id === ckId ? { ...c, done: !c.done } : c))
    );
  };

  // Reactions
  const handleAddReaction = (msgId: string, emoji: string) => {
    setRoomMessages((prev) => {
      const list = prev[activeRoom] || [];
      const updated = list.map((m) => {
        if (m.id !== msgId) return m;
        const reactions = { ...(m.reactions || {}) };
        reactions[emoji] = (reactions[emoji] || 0) + 1;
        return { ...m, reactions };
      });
      return { ...prev, [activeRoom]: updated };
    });

    const currentMsg = (roomMessages[activeRoom] || []).find((m) => m.id === msgId);
    if (currentMsg?.sender && islandRef.current) {
      islandRef.current.triggerHappyBounce(currentMsg.sender, `Cảm ơn ${emoji}!`);
    }
  };

  // Send Message: REAL ELECTRON IPC DISPATCH
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = inputText.trim();
    if (!text || isSending) return;

    setInputText('');
    setIsSending(true);

    const userMsgId = `env_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const userEnvelope: EnvelopeView = {
      id: userMsgId,
      traceId: `trc_${Date.now()}`,
      timestamp: Date.now(),
      sender: { kind: 'user', id: 'user_lead', name: 'Commander', role: 'USER' },
      recipient: { kind: 'room', id: activeRoom },
      roomId: activeRoom,
      fidelity: 'L1_FORMATTED_MARKDOWN',
      parts: [{ kind: 'text', text }],
    };

    const userChatMsg = envelopeToChatMessage(userEnvelope);
    setRoomMessages((prev) => {
      const list = prev[activeRoom] || [];
      return { ...prev, [activeRoom]: [...list, userChatMsg] };
    });

    AGENT_IDS.forEach((id) => islandRef.current?.triggerHappyBounce(id, 'Nhận lệnh! ⚡'));

    if (isDesktop && window.unionBotAPI?.sendGroupMessage) {
      try {
        const res = await window.unionBotAPI.sendGroupMessage(userEnvelope);
        if (!res || !res.success) {
          const errText = res?.error || 'Lỗi IPC không xác định';
          showToast(`⚠️ ${errText}`);
          setRoomMessages((prev) => ({
            ...prev,
            [activeRoom]: [
              ...(prev[activeRoom] || []),
              {
                id: `sys-err-${Date.now()}`,
                sender: 'ChatGPT',
                time: formatTime(Date.now()),
                text: `⚠️ **[THÔNG BÁO HỆ THỐNG]**: ${errText}\n\n*Gợi ý*: Bấm nút **\`🌐 Web AI\`** trên thanh tiêu đề để kiểm tra hoặc đăng nhập ChatGPT Web / Claude Web, hoặc gõ \`@Antigravity\` để dùng AI local miễn phí.`,
              },
            ],
          }));
        }
      } catch (err: any) {
        console.error('[App] sendGroupMessage exception:', err);
        showToast('⚠️ Lỗi kết nối IPC Main Process');
      } finally {
        setIsSending(false);
      }
    } else {
      setTimeout(() => {
        setRoomMessages((prev) => ({
          ...prev,
          [activeRoom]: [
            ...(prev[activeRoom] || []),
            {
              id: `demo-resp-${Date.now()}`,
              sender: 'ChatGPT',
              time: formatTime(Date.now()),
              text: `💡 **[CHẾ ĐỘ XEM TRƯỚC TRÊN TRÌNH DUYỆT]**\nBạn đang mở giao diện web độc lập (chưa qua Electron). Để kích hoạt AI thật trả lời tự động, hãy chạy lệnh **\`union-bot\`** trong Terminal để khởi động ứng dụng Desktop!`,
            },
          ],
        }));
        setIsSending(false);
      }, 500);
    }
  };

  const handleRollCall = () => {
    showToast('🍡 Cả 6 bé AI đang nhảy điểm danh & đồng bộ Tác Vụ!');
    islandRef.current?.triggerRollCall();

    if (isDesktop && window.unionBotAPI?.sendGroupMessage) {
      const rollEnvelope: EnvelopeView = {
        id: `env_roll_${Date.now()}`,
        traceId: `trc_${Date.now()}`,
        timestamp: Date.now(),
        sender: { kind: 'user', id: 'user_lead', name: 'Commander', role: 'USER' },
        recipient: { kind: 'room', id: activeRoom },
        roomId: activeRoom,
        fidelity: 'L1_FORMATTED_MARKDOWN',
        parts: [{ kind: 'text', text: '@all Điểm danh đội hình và báo cáo trạng thái sẵn sàng!' }],
      };
      window.unionBotAPI.sendGroupMessage(rollEnvelope);
    }
  };

  const handleClearChat = () => {
    setRoomMessages((prev) => ({
      ...prev,
      [activeRoom]: [
        {
          id: `m-clean-${Date.now()}`,
          sender: 'ChatGPT',
          time: formatTime(Date.now()),
          text: `💙 Đã làm mới giao diện phòng **${activeRoom}**! Khung chat 70% cỡ chữ \`${chatFontSize}px\` đã sẵn sàng.`,
          reactions: { '💙': 1 },
        },
      ],
    }));
    showToast('🧹 Đã dọn gọn phòng chat!');
  };

  // Auto-scroll chat
  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [roomMessages, activeRoom]);

  // Periodic random idle chirp
  useEffect(() => {
    const timer = setInterval(() => {
      const randomId = AGENT_IDS[Math.floor(Math.random() * AGENT_IDS.length)];
      const phrases = [
        'Sẵn sàng nhận lệnh! ⚡',
        'Khung chat thoáng đẹp! 💙',
        'wtrg/union-bot 60FPS! 💎',
        'Bấm mình để giao việc! 📋',
      ];
      const pick = phrases[Math.floor(Math.random() * phrases.length)];
      islandRef.current?.triggerHappyBounce(randomId, pick);
    }, 9000);

    return () => clearInterval(timer);
  }, []);

  // HIGH-READABILITY STRUCTURED PROSE FORMATTER
  const renderFormattedText = (raw: string) => {
    const codeBlocks: string[] = [];
    let text = String(raw).replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
      const idx = codeBlocks.length;
      const clean = code.trim();
      const encoded = encodeURIComponent(clean);
      const lineCount = clean.split('\n').length;
      codeBlocks.push(
        `<div class="my-2.5 rounded-xl overflow-hidden border border-sky-400/25 bg-[#050e1f] font-mono text-xs shadow-lg">
          <div class="flex items-center justify-between px-3 py-1 bg-sky-950/60 border-b border-sky-400/20 text-[10px]">
            <div class="flex items-center gap-1.5 font-bold uppercase tracking-wider text-sky-300">
              <span class="w-2 h-2 rounded-full bg-sky-400"></span>
              <span>${lang || 'CODE'}</span>
              <span class="text-sky-400/50 normal-case font-normal font-mono">• ${lineCount} dòng</span>
            </div>
            <button type="button" onclick="navigator.clipboard.writeText(decodeURIComponent('${encoded}')); alert('Đã sao chép đoạn code!');" class="px-2 py-0.5 rounded bg-sky-500/20 hover:bg-sky-500/40 text-sky-200 transition text-[10px] flex items-center gap-1 font-sans">
              📋 Sao chép
            </button>
          </div>
          <pre class="p-3 overflow-x-auto text-[11.5px] leading-relaxed text-sky-100 font-mono"><code>${escapeHtml(clean)}</code></pre>
        </div>`
      );
      return `@@CODE_${idx}@@`;
    });

    text = escapeHtml(text);

    // Blockquotes
    text = text.replace(/^&gt;\s?([\s\S]+?)$/gm, '<div class="chat-blockquote">$1</div>');

    // Bullet points (•, -, *)
    text = text.replace(/^[•\-\*]\s+([\s\S]+?)$/gm, '<div class="chat-list-item"><span class="chat-list-bullet">✦</span><span>$1</span></div>');

    // Numbered lists (1. , 2. )
    text = text.replace(/^(\d+)\.\s+([\s\S]+?)$/gm, '<div class="chat-list-item"><span class="font-mono font-bold text-sky-400 text-xs">$1.</span><span>$2</span></div>');

    // Bold & italic
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold text-white tracking-wide">$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em class="italic text-sky-200">$1</em>');

    // Inline code
    text = text.replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded-md bg-sky-500/15 border border-sky-400/30 font-mono text-[11.5px] text-sky-200 font-medium">$1</code>');

    // Task tag
    text = text.replace(/\[(TASK-\d+)\]/g, `<span class="cursor-pointer inline-flex items-center px-1.5 py-0.5 rounded-md bg-blue-600/30 border border-sky-400/50 font-mono text-[10px] font-bold text-sky-200 hover:bg-blue-600/50">$1</span>`);

    // Mentions
    text = text.replace(/@(TấtCả|ChatGPT|Gemini|Codex|Antigravity|Claude|DeepSeek|all|team)/gi, (m) => {
      return `<span class="cursor-pointer inline-flex items-center px-1.5 py-0.5 rounded-md font-display font-bold text-[11px] bg-sky-500/20 text-sky-300 border border-sky-400/30 hover:bg-sky-500/35">${m}</span>`;
    });

    // Paragraph breaks
    text = text.replace(/\n\n+/g, '</p><p class="mt-2">');
    text = text.replace(/\n/g, '<br/>');

    codeBlocks.forEach((html, idx) => {
      text = text.replace(`@@CODE_${idx}@@`, html);
    });

    return <div className="chat-prose" dangerouslySetInnerHTML={{ __html: `<p>${text}</p>` }} />;
  };

  const activeTaskList = botTasks.filter((t) => t.status !== 'DONE');
  const pinnedTask = botTasks.find((t) => t.id === pinnedTaskId) || botTasks[0];
  const doneChecklistCount = checklist.filter((c) => c.done).length;
  const checklistPercent = Math.round((doneChecklistCount / checklist.length) * 100);
  const currentMessages = roomMessages[activeRoom] || [];

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-between p-2 gap-2 select-none">
      {/* ==================== 1. ULTRA-SLIM TOP BAR (40px) ==================== */}
      <header className="blue-glass rounded-2xl px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => islandRef.current?.triggerAzureGust()}
            title="Bấm để thổi làn gió hoa lam ngọc 3D!"
            className="btn-pop w-7 h-7 rounded-xl bg-gradient-to-tr from-blue-600 to-sky-400 flex items-center justify-center shadow-[0_0_12px_rgba(56,189,248,0.5)] text-xs text-white"
          >
            💎
          </button>
          <div className="flex items-center gap-2">
            <h1 className="font-display font-bold text-xs sm:text-sm tracking-wide text-theme-main">
              WT Union-Bot <span className="text-sky-400">//</span> Sora Blue 3D
            </h1>
            <a
              href="https://github.com/wtrg/union-bot"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-mono bg-sky-500/15 hover:bg-sky-500/30 text-sky-300 border border-sky-400/30 transition"
            >
              wtrg/union-bot
            </a>
          </div>
        </div>

        {/* Layout Ratio Switcher */}
        <div className="flex items-center bg-black/25 p-0.5 rounded-xl border border-sky-400/20">
          <button
            type="button"
            onClick={() => setLayoutRatio('70')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-display font-bold transition ${
              layoutRatio === '70'
                ? 'bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-sm'
                : 'text-theme-sub hover:text-sky-300'
            }`}
          >
            💬 70% Chat (Chuẩn)
          </button>
          <button
            type="button"
            onClick={() => setLayoutRatio('85')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-display font-bold transition ${
              layoutRatio === '85'
                ? 'bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-sm'
                : 'text-theme-sub hover:text-sky-300'
            }`}
          >
            📐 85% Rộng
          </button>
          <button
            type="button"
            onClick={() => setLayoutRatio('100')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-display font-bold transition ${
              layoutRatio === '100'
                ? 'bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-sm'
                : 'text-theme-sub hover:text-sky-300'
            }`}
          >
            🖥️ 100% Chat
          </button>
          <button
            type="button"
            onClick={() => setLayoutRatio('garden')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-display font-bold transition ${
              layoutRatio === 'garden'
                ? 'bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-sm'
                : 'text-theme-sub hover:text-sky-300'
            }`}
          >
            ⛩️ Chỉ 3D
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleCollapseAll}
            className="btn-pop px-2.5 py-1 rounded-xl blue-card text-[11px] font-display font-bold text-sky-300 hover:border-sky-400 flex items-center gap-1"
            title="Thu gọn hoặc mở rộng toàn bộ các bảng phụ"
          >
            <span>{collapsed.taskHub ? '▾' : '▴'}</span>
            <span className="hidden sm:inline">{collapsed.taskHub ? 'Mở rộng phụ' : 'Thu gọn phụ'}</span>
          </button>

          <button
            type="button"
            onClick={() => islandRef.current?.triggerAzureGust()}
            className="btn-pop px-2.5 py-1 rounded-xl blue-card text-[11px] font-display font-bold text-theme-main hover:border-sky-400 flex items-center gap-1"
            title="Thổi gió hoa anh đào xanh 3D"
          >
            <span>🍃</span>
            <span className="hidden xl:inline">Gió Lam</span>
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            className="btn-pop px-2.5 py-1 rounded-xl blue-card text-[11px] font-display font-bold text-theme-main hover:border-sky-400 flex items-center gap-1"
            title="Đổi chế độ Đêm Lam Ngọc / Sáng Băng Lam"
          >
            <span>{isDayTheme ? '☀️' : '🌙'}</span>
            <span className="hidden xl:inline">{isDayTheme ? 'Sáng Lam' : 'Đêm Lam'}</span>
          </button>

          <button
            type="button"
            onClick={() => islandRef.current?.resetCamera()}
            className="btn-pop px-2 py-1 rounded-xl blue-card text-[11px] font-display font-bold text-theme-sub hover:text-sky-400"
            title="Đưa camera 3D về góc toàn cảnh"
          >
            🎥 3D
          </button>

          <button
            type="button"
            onClick={() => setIsBrowserOpen((prev) => !prev)}
            className={`btn-pop px-2.5 py-1 rounded-xl text-[11px] font-display font-bold flex items-center gap-1.5 transition ${
              isBrowserOpen
                ? 'bg-sky-500 text-white shadow-md'
                : 'blue-card text-theme-sub hover:text-sky-300'
            }`}
            title="Bật/tắt Browser panel ChatGPT, Gemini, Claude Web"
          >
            <span>🌐</span>
            <span className="hidden sm:inline">Web AI</span>
          </button>

          <button
            type="button"
            onClick={() => setIsBridgeModalOpen(true)}
            className="btn-pop px-2.5 py-1 rounded-xl bg-blue-600/30 hover:bg-blue-600/50 text-sky-200 border border-sky-400/40 text-[11px] font-display font-bold flex items-center gap-1.5"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
            <span className="hidden sm:inline">Bridge</span>
          </button>
        </div>
      </header>

      {/* ==================== 2. MAIN SPLIT WORKSPACE ==================== */}
      <div className="flex-1 flex items-stretch gap-2 min-h-0 relative">
        {/* ================= LEFT COLUMN: DEDICATED 3D ISLAND + TASK DOCK ================= */}
        <aside
          id="left-column"
          className={`${
            layoutRatio === 'garden'
              ? 'flex w-full'
              : layoutRatio === '100'
              ? 'hidden'
              : layoutRatio === '85'
              ? 'hidden lg:flex lg:w-[18%]'
              : 'hidden lg:flex lg:w-[30%]'
          } ${
            isMobileTaskOpen ? '!flex fixed inset-2 z-40 bg-slate-950/95 p-2 rounded-2xl' : ''
          } flex-col gap-2 min-h-0 transition-all duration-300`}
        >
          {/* TOP HALF: 3D VIEWPORT */}
          <Sora3DIsland
            ref={islandRef}
            onSelectAgent={handleSelectAgent}
            focusedAgent={focusedAgent}
            typingAgents={typingAgents}
            onRestoreLayout={layoutRatio === 'garden' ? () => setLayoutRatio('70') : undefined}
          />

          {/* BOTTOM HALF: TASK & SPRINT DOCK */}
          <div
            id="leftTaskDock"
            className="blue-glass rounded-2xl flex flex-col shrink-0 overflow-hidden transition-all duration-300"
            style={{ maxHeight: collapsed.taskHub ? '38px' : '52%' }}
          >
            {/* Master Accordion Header */}
            <div
              onClick={() => toggleSection('taskHub')}
              className="px-3 py-1.5 bg-gradient-to-r from-blue-900/55 to-sky-900/30 border-b border-sky-400/20 flex items-center justify-between cursor-pointer select-none shrink-0"
            >
              <div className="flex items-center gap-1.5">
                <span className="text-xs">📋</span>
                <span className="font-display font-bold text-[11.5px] text-theme-main">
                  Tác Vụ & Tiến Độ Bot
                </span>
                <span className="px-1.5 py-0.2 rounded-md bg-sky-500/25 border border-sky-400/40 text-[9.5px] font-mono font-bold text-sky-300">
                  {activeTaskList.length} Active
                </span>
              </div>
              <button
                type="button"
                className="px-2 py-0.5 rounded-lg blue-card text-[10px] font-display font-bold text-sky-300 flex items-center gap-1"
              >
                <span>{collapsed.taskHub ? '▸ Mở rộng' : '▾ Thu gọn'}</span>
              </button>
            </div>

            {/* Master Accordion Body */}
            {!collapsed.taskHub && (
              <div id="body-taskHub" className="p-2 overflow-y-auto space-y-1.5 text-xs">
                {/* SUB-ACCORDION 1: HÀNG ĐỢI TÁC VỤ AI */}
                <div className="blue-card rounded-xl overflow-hidden">
                  <div
                    onClick={() => toggleSection('activeTasks')}
                    className="px-2.5 py-1 flex items-center justify-between cursor-pointer bg-white/5 hover:bg-white/10 transition"
                  >
                    <span className="font-display font-bold text-[10.5px] text-sky-300">
                      ⚡ 1. Hàng Đợi Tác Vụ AI
                    </span>
                    <span className="text-[10px] font-mono text-theme-muted">
                      {collapsed.activeTasks ? '▸' : '▾'}
                    </span>
                  </div>

                  {!collapsed.activeTasks && (
                    <div className="p-2 space-y-1.5 border-t border-sky-400/15">
                      <form onSubmit={handleAddNewTask} className="flex items-center gap-1">
                        <input
                          type="text"
                          value={newTaskTitle}
                          onChange={(e) => setNewTaskTitle(e.target.value)}
                          placeholder="+ Nhập tác vụ mới..."
                          className="flex-1 bg-theme-input border border-sky-400/30 rounded-lg px-2 py-1 text-[10.5px] text-theme-main placeholder-sky-300/45 focus:outline-none focus:border-sky-400"
                        />
                        <select
                          value={newTaskAgent}
                          onChange={(e) => setNewTaskAgent(e.target.value)}
                          className="bg-theme-input border border-sky-400/30 rounded-lg px-1 py-1 text-[10px] text-sky-300 font-bold focus:outline-none"
                        >
                          {AGENT_IDS.map((aid) => (
                            <option key={aid} value={aid}>
                              @{aid}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className="btn-pop px-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold shrink-0"
                        >
                          Giao
                        </button>
                      </form>

                      <div className="space-y-1 max-h-32 overflow-y-auto pr-0.5">
                        {botTasks.map((t) => {
                          const ag = AGENTS[t.agent] || AGENTS.Codex;
                          const isDone = t.status === 'DONE';
                          const isPaused = t.status === 'PAUSED';

                          return (
                            <div
                              key={t.id}
                              className="p-1.5 rounded-xl bg-black/25 border border-sky-400/20 hover:border-sky-400/45 transition flex flex-col gap-1"
                            >
                              <div className="flex items-start justify-between gap-1">
                                <div
                                  onClick={() => handlePinTask(t.id)}
                                  className="cursor-pointer flex-1 min-w-0"
                                >
                                  <div className="flex items-center gap-1">
                                    <span className="font-mono text-[9px] px-1 py-0.2 rounded bg-sky-500/20 text-sky-300 font-bold">
                                      {t.id}
                                    </span>
                                    <span
                                      className="text-[9.5px] font-bold"
                                      style={{ color: ag.colorCss }}
                                    >
                                      {ag.emoji} @{ag.name}
                                    </span>
                                  </div>
                                  <div
                                    className={`text-[10.5px] font-display font-bold text-theme-main truncate mt-0.5 ${
                                      isDone ? 'line-through opacity-60' : ''
                                    }`}
                                  >
                                    {t.title}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => handleToggleTaskStatus(t.id)}
                                    className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-sky-500/30 text-[9.5px] font-mono text-sky-200"
                                  >
                                    {isDone ? '✓' : isPaused ? '▶' : '⏸'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleCompleteTask(t.id)}
                                    className="px-1.5 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/40 text-[9.5px] font-mono text-emerald-300"
                                  >
                                    100%
                                  </button>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <div className="flex-1 h-1.5 rounded-full bg-black/40 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-300 ${
                                      isDone
                                        ? 'bg-emerald-400'
                                        : 'bg-gradient-to-r from-blue-500 to-sky-300'
                                    }`}
                                    style={{ width: `${t.progress}%` }}
                                  />
                                </div>
                                <span className="text-[9px] font-mono text-sky-300 font-bold w-7 text-right">
                                  {t.progress}%
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* SUB-ACCORDION 2: CHECKLIST SPRINT */}
                <div className="blue-card rounded-xl overflow-hidden">
                  <div
                    onClick={() => toggleSection('checklist')}
                    className="px-2.5 py-1 flex items-center justify-between cursor-pointer bg-white/5 hover:bg-white/10 transition"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="font-display font-bold text-[10.5px] text-emerald-300">
                        ☑️ 2. Checklist Sprint
                      </span>
                      <span className="text-[9.5px] font-mono text-emerald-400 font-bold">
                        {checklistPercent}%
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-theme-muted">
                      {collapsed.checklist ? '▸' : '▾'}
                    </span>
                  </div>

                  {!collapsed.checklist && (
                    <div className="p-1.5 space-y-0.5 border-t border-sky-400/15">
                      {checklist.map((c) => (
                        <label
                          key={c.id}
                          onClick={() => handleToggleChecklist(c.id)}
                          className="flex items-center gap-2 px-1.5 py-0.5 rounded-lg hover:bg-white/5 cursor-pointer select-none"
                        >
                          <input
                            type="checkbox"
                            checked={c.done}
                            readOnly
                            className="accent-sky-400 rounded pointer-events-none w-3 h-3"
                          />
                          <span
                            className={`text-[10.5px] ${
                              c.done
                                ? 'line-through text-theme-muted opacity-75'
                                : 'text-theme-main font-semibold'
                            }`}
                          >
                            {c.text}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* SUB-ACCORDION 3: LỆNH TÁC VỤ NHANH */}
                <div className="blue-card rounded-xl overflow-hidden">
                  <div
                    onClick={() => toggleSection('quickControls')}
                    className="px-2.5 py-1 flex items-center justify-between cursor-pointer bg-white/5 hover:bg-white/10 transition"
                  >
                    <span className="font-display font-bold text-[10.5px] text-amber-300">
                      🎛️ 3. Lệnh Tác Vụ Nhanh
                    </span>
                    <span className="text-[10px] font-mono text-theme-muted">
                      {collapsed.quickControls ? '▸' : '▾'}
                    </span>
                  </div>

                  {!collapsed.quickControls && (
                    <div className="p-1.5 grid grid-cols-3 gap-1 border-t border-sky-400/15">
                      <button
                        type="button"
                        onClick={handleRunAllTasksBoost}
                        className="btn-pop px-1.5 py-1 rounded-lg bg-blue-600/30 hover:bg-blue-600/50 border border-sky-400/40 text-[9.5px] font-display font-bold text-sky-200 text-center"
                      >
                        ⚡ Chạy Tất Cả
                      </button>
                      <button
                        type="button"
                        onClick={handleRollCall}
                        className="btn-pop px-1.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-400/40 text-[9.5px] font-display font-bold text-emerald-200 text-center"
                      >
                        🙋‍♂️ Điểm Danh 6 AI
                      </button>
                      <button
                        type="button"
                        onClick={handleClearCompletedTasks}
                        className="btn-pop px-1.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/35 border border-rose-400/40 text-[9.5px] font-display font-bold text-rose-200 text-center"
                      >
                        🧹 Dọn Task Xong
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* ================= RIGHT COLUMN: REFINED HIGH-READABILITY CHAT HUB ================= */}
        <main
          id="chat-column"
          className={`${
            layoutRatio === 'garden'
              ? 'hidden'
              : layoutRatio === '100'
              ? 'w-full'
              : layoutRatio === '85'
              ? 'w-full lg:w-[82%]'
              : 'w-full lg:w-[70%]'
          } blue-glass rounded-2xl flex flex-col min-h-0 overflow-hidden transition-all duration-300`}
        >
          {/* 1. SLIM & ELEGANT CHAT HEADER */}
          <div className="px-3 py-1.5 border-b border-sky-400/20 flex flex-col gap-1.5 shrink-0 bg-gradient-to-r from-blue-950/40 via-sky-950/15 to-transparent">
            {/* Row 1: Channels + 6 AI Member Pills + Controls */}
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex items-center gap-1 overflow-x-auto">
                {rooms.map((r) => {
                  const active = r.id === activeRoom;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setActiveRoom(r.id);
                        setRooms((prev) =>
                          prev.map((x) => (x.id === r.id ? { ...x, unread: 0 } : x))
                        );
                      }}
                      className={`btn-pop px-2.5 py-1 rounded-xl text-[11px] font-display font-bold transition flex items-center gap-1 whitespace-nowrap ${
                        active
                          ? 'bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-sm'
                          : 'blue-card text-theme-sub hover:text-sky-300'
                      }`}
                    >
                      <span>{r.label}</span>
                      {r.unread > 0 && (
                        <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-white text-blue-700 font-extrabold">
                          {r.unread}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* 6 AI Member Avatar Pills in Header */}
              <div className="hidden sm:flex items-center gap-1 px-1.5 py-0.5 rounded-xl bg-black/25 border border-sky-400/20 overflow-x-auto">
                {AGENT_IDS.map((id) => {
                  const ag = AGENTS[id];
                  const isFocused = focusedAgent === id;
                  const isTyping = typingAgents.has(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => handleSelectAgent(ag.id)}
                      title={`Bấm để gọi @${ag.name} (${ag.role})`}
                      className={`btn-pop px-2 py-0.5 rounded-lg flex items-center gap-1 text-[10px] font-display font-bold transition ${
                        isFocused
                          ? 'bg-sky-500/25 text-white border border-sky-400/60'
                          : 'text-theme-sub hover:text-sky-200'
                      }`}
                    >
                      <span className="relative flex items-center justify-center">
                        <span>{ag.emoji}</span>
                        {isTyping && (
                          <span
                            className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full animate-ping"
                            style={{ background: ag.colorCss }}
                          />
                        )}
                      </span>
                      <span>{ag.name}</span>
                    </button>
                  );
                })}
              </div>

              {/* Font Size & Tool Toggles */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsMobileTaskOpen((prev) => !prev)}
                  className="lg:hidden px-2 py-0.5 rounded-lg bg-blue-600/30 border border-sky-400/40 text-[10px] font-display font-bold text-sky-200"
                >
                  ⛩️ 3D & Task
                </button>

                <button
                  type="button"
                  onClick={() => toggleSection('pinnedTaskBanner')}
                  className="btn-pop px-2 py-0.5 rounded-lg blue-card text-[10px] font-display font-bold text-theme-sub hover:text-sky-300"
                >
                  <span>{collapsed.pinnedTaskBanner ? '📌 Hiện Task' : '📌 Ghim Task'}</span>
                </button>

                {/* Font Size Controls */}
                <div className="flex items-center gap-1 blue-card px-2 py-0.5 rounded-lg">
                  <button
                    type="button"
                    onClick={() => handleFontSizeChange(chatFontSize - 0.5)}
                    className="text-[10px] font-bold px-1 text-theme-sub hover:text-sky-400"
                    title="Nhỏ chữ (-0.5px)"
                  >
                    -
                  </button>
                  <input
                    type="range"
                    min="11"
                    max="16"
                    step="0.5"
                    value={chatFontSize}
                    onChange={(e) => handleFontSizeChange(parseFloat(e.target.value))}
                    className="w-12 h-1 accent-sky-400 cursor-pointer"
                  />
                  <span className="text-[10px] font-mono text-sky-400 font-bold min-w-[32px] text-center">
                    {chatFontSize}px
                  </span>
                  <button
                    type="button"
                    onClick={() => handleFontSizeChange(chatFontSize + 0.5)}
                    className="text-[10px] font-bold px-1 text-theme-sub hover:text-sky-400"
                    title="To chữ (+0.5px)"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* 2. SLIM PINNED TASK BANNER (ONLY 28PX HEIGHT) */}
            {!collapsed.pinnedTaskBanner && pinnedTask && (
              <div className="px-2.5 py-1 rounded-xl bg-blue-600/15 border border-sky-400/25 flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="px-1.5 py-0.2 rounded bg-sky-500/25 border border-sky-400/40 text-[9px] font-mono font-bold text-sky-200 shrink-0">
                    ĐANG THỰC THI
                  </span>
                  <span className="text-[11px] font-display font-bold text-theme-main truncate">
                    [{pinnedTask.id}] {pinnedTask.title}
                  </span>
                  <span className="text-[10px] font-mono text-sky-300 shrink-0">
                    @{pinnedTask.agent} • {pinnedTask.progress}%
                  </span>
                  <div className="hidden sm:block w-20 h-1.5 rounded-full bg-black/40 overflow-hidden shrink-0">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-sky-300 transition-all duration-300"
                      style={{ width: `${pinnedTask.progress}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setInputText(`@${pinnedTask.agent} Hãy báo cáo chi tiết tiến độ thực thi [${pinnedTask.id}] "${pinnedTask.title}" (${pinnedTask.progress}%)`);
                      inputRef.current?.focus();
                    }}
                    className="btn-pop px-2 py-0.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/40 text-sky-200 border border-sky-400/35 text-[9.5px] font-display font-bold"
                  >
                    📢 Báo cáo
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSection('pinnedTaskBanner')}
                    className="text-theme-muted hover:text-sky-300 text-xs px-1"
                    title="Ẩn thanh ghim"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 3. REFINED HIGH-READABILITY CHAT STREAM */}
          <div
            ref={chatBoxRef}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-3.5 select-text"
          >
            {currentMessages.map((msg) => {
              const ag = AGENTS[msg.sender] || AGENTS.ChatGPT;
              const isUser = msg.sender === 'Commander';
              const reactions = msg.reactions || {};
              const activeReactionEntries = Object.entries(reactions).filter(([_, count]) => count > 0);

              if (isUser) {
                return (
                  <div
                    key={msg.id}
                    className="chat-msg-wrapper msg-bounce-in flex items-start justify-end gap-2.5 group"
                  >
                    {/* Hover action toolbar */}
                    <div className="chat-hover-toolbar flex items-center gap-1 self-center mr-1">
                      <button
                        type="button"
                        onClick={() => handleAddReaction(msg.id, '💙')}
                        className="px-1.5 py-0.5 rounded-lg bg-slate-900/80 hover:bg-sky-900 text-[10px] text-sky-300 border border-sky-400/30 shadow"
                        title="Thả tim 💙"
                      >
                        💙
                      </button>
                    </div>

                    <div className="max-w-[85%] rounded-2xl rounded-tr-sm px-3.5 py-2 shadow-md bg-gradient-to-br from-blue-900/50 via-sky-950/60 to-black/40 border border-sky-400/35">
                      <div className="flex items-center justify-end gap-2 pb-1 mb-1 border-b border-sky-400/20">
                        <span className="text-[10px] font-mono text-sky-400/60">{msg.time}</span>
                        <span className="font-display font-bold text-xs text-sky-300">
                          👑 {ag.name}
                        </span>
                      </div>
                      <div className="text-theme-main">
                        {renderFormattedText(msg.text)}
                      </div>
                    </div>

                    <div className="w-7 h-7 rounded-xl overflow-hidden shrink-0 shadow-md border border-sky-400/40 bg-sky-950/80">
                      <div
                        className="w-full h-full"
                        dangerouslySetInnerHTML={{ __html: ag.svg }}
                      />
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={msg.id}
                  className="chat-msg-wrapper msg-bounce-in flex items-start gap-2.5 p-2 rounded-2xl hover:bg-white/[0.02] transition-colors group"
                >
                  {/* Agent Avatar */}
                  <div
                    onClick={() => handleSelectAgent(ag.id)}
                    title={`Bấm để xem Mochi 3D của ${ag.name}`}
                    className="btn-pop w-8 h-8 rounded-xl overflow-hidden shrink-0 cursor-pointer shadow-md mt-0.5 border"
                    style={{ borderColor: ag.colorCss }}
                  >
                    <div
                      className="w-full h-full"
                      dangerouslySetInnerHTML={{ __html: ag.svg }}
                    />
                  </div>

                  {/* Message Bubble & Content */}
                  <div className="flex-1 min-w-0 max-w-[95%]">
                    {/* Header Row */}
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          onClick={() => handleSelectAgent(ag.id)}
                          className="font-display font-extrabold text-xs cursor-pointer hover:underline tracking-wide"
                          style={{ color: ag.colorCss }}
                        >
                          {ag.emoji} {ag.name}
                        </span>
                        <span className="px-1.5 py-0.2 rounded text-[9.5px] font-display font-semibold bg-white/5 border border-white/10 text-theme-sub">
                          {ag.role}
                        </span>
                        {msg.taskTag && (
                          <span
                            onClick={() => handlePinTask(msg.taskTag!)}
                            className="cursor-pointer px-1.5 py-0.2 rounded-md bg-sky-500/15 border border-sky-400/40 font-mono text-[9.5px] text-sky-300 font-bold hover:bg-sky-500/30"
                          >
                            📌 {msg.taskTag}
                          </span>
                        )}
                        {msg.status === 'streaming' && (
                          <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[9px] font-bold animate-pulse">
                            đang trả lời...
                          </span>
                        )}
                      </div>

                      {/* Right metadata & Hover action toolbar */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <div className="chat-hover-toolbar flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleAddReaction(msg.id, '💙')}
                            className="px-1.5 py-0.5 rounded bg-slate-900/90 hover:bg-sky-900 text-[10px] text-sky-300 border border-sky-400/30 shadow"
                            title="Thả cảm xúc"
                          >
                            + Reaction
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (collapsed.taskHub) toggleSection('taskHub');
                              if (collapsed.activeTasks) toggleSection('activeTasks');
                              setNewTaskAgent(ag.id);
                              setNewTaskTitle(`Giao nhiệm vụ cho @${ag.id}`);
                              showToast(`📋 Nhập tên Task ở cột trái để giao cho @${ag.id}!`);
                            }}
                            className="px-1.5 py-0.5 rounded bg-emerald-950/80 hover:bg-emerald-900 text-[10px] text-emerald-300 border border-emerald-400/30 shadow font-display font-bold"
                          >
                            + Giao Task
                          </button>
                          <button
                            type="button"
                            onClick={() => insertMention(`@${ag.id}`)}
                            className="px-1.5 py-0.5 rounded bg-sky-950/80 hover:bg-sky-900 text-[10px] text-sky-300 border border-sky-400/30 shadow font-display font-bold"
                          >
                            ↩ Trả lời
                          </button>
                        </div>

                        <span className="text-[10px] font-mono text-sky-400/50">{msg.time}</span>
                      </div>
                    </div>

                    {/* Formatted Content Card */}
                    <div
                      className="rounded-2xl rounded-tl-sm px-3.5 py-2.5 shadow-sm"
                      style={{
                        background: ag.cardBg,
                        border: `1px solid ${ag.cardBorder}`,
                        borderLeft: `3px solid ${ag.colorCss}`,
                      }}
                    >
                      {renderFormattedText(msg.text)}

                      {/* Reactions Pills (Only display active reactions > 0) */}
                      {activeReactionEntries.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-2 pt-1.5 border-t border-white/10 flex-wrap">
                          {activeReactionEntries.map(([emo, count]) => (
                            <button
                              key={emo}
                              type="button"
                              onClick={() => handleAddReaction(msg.id, emo)}
                              className="btn-pop px-2 py-0.5 rounded-full text-[10px] bg-sky-950/60 hover:bg-sky-900 border border-sky-400/30 flex items-center gap-1 font-mono text-sky-200"
                            >
                              <span>{emo}</span>
                              <span className="font-bold text-sky-300">{count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 4. ANIMATED TYPING INDICATOR */}
          {typingAgents.size > 0 && (
            <div className="px-4 py-1.5 bg-sky-500/10 border-t border-sky-400/20 flex items-center justify-between text-xs shrink-0">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 dot-1"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 dot-2"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 dot-3"></span>
                </div>
                <span className="font-display font-bold text-sky-300 text-xs">
                  💎{' '}
                  {Array.from(typingAgents)
                    .map((id) => `${AGENTS[id]?.emoji} ${AGENTS[id]?.name}`)
                    .join(', ')}{' '}
                  đang xử lý tác vụ & trả lời...
                </span>
              </div>
              <span className="text-[10px] font-mono text-theme-muted">⚡ Đồng bộ 3D</span>
            </div>
          )}

          {/* 5. SLICK BOTTOM INPUT & QUICK ACTIONS */}
          <div className="p-2.5 bg-black/25 border-t border-sky-400/20 flex flex-col gap-2 shrink-0">
            {/* Quick Chips Row */}
            {!collapsed.quickChips && (
              <div className="flex flex-wrap items-center justify-between gap-1">
                <div className="flex items-center gap-1 overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setInputText('@ChatGPT @Codex Hãy phân tích các công việc cần làm tiếp theo');
                      inputRef.current?.focus();
                    }}
                    className="btn-pop px-2.5 py-0.5 rounded-lg bg-gradient-to-r from-blue-600/40 to-sky-500/40 hover:from-blue-600/60 hover:to-sky-500/60 text-sky-100 border border-sky-400/40 text-[10.5px] font-display font-bold whitespace-nowrap"
                  >
                    ⚡ Thảo Luận Tác Vụ
                  </button>

                  <button
                    type="button"
                    onClick={handleRollCall}
                    className="btn-pop px-2.5 py-0.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-300 border border-emerald-400/40 text-[10.5px] font-display font-bold whitespace-nowrap"
                  >
                    🙋‍♂️ Điểm Danh 6 AI
                  </button>

                  <button
                    type="button"
                    onClick={() => insertMention('@all')}
                    className="btn-pop px-2 py-0.5 rounded-lg blue-card text-[10.5px] font-bold text-sky-300 hover:border-sky-400 whitespace-nowrap"
                  >
                    @all
                  </button>

                  <button
                    type="button"
                    onClick={handleClearChat}
                    className="btn-pop px-2 py-0.5 rounded-lg blue-card text-[10.5px] text-theme-muted hover:text-rose-400 whitespace-nowrap"
                  >
                    🧹 Dọn chat
                  </button>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={autoParty}
                      onChange={(e) => setAutoParty(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-7 h-3.5 bg-white/15 peer-checked:bg-sky-500/60 border border-sky-400/40 rounded-full relative transition">
                      <div className="w-2.5 h-2.5 rounded-full bg-white peer-checked:translate-x-3.5 transition-transform absolute top-0.5 left-0.5 shadow"></div>
                    </div>
                    <span className="text-[10px] font-display font-bold text-theme-sub peer-checked:text-sky-300">
                      Phản biện tự động
                    </span>
                  </label>

                  <button
                    type="button"
                    onClick={() => toggleSection('quickChips')}
                    className="text-[10px] font-mono text-theme-muted hover:text-sky-300 px-1"
                  >
                    ▴ Ẩn
                  </button>
                </div>
              </div>
            )}

            {/* Input Row */}
            <form onSubmit={handleSendMessage} className="flex items-center gap-2">
              {collapsed.quickChips && (
                <button
                  type="button"
                  onClick={() => toggleSection('quickChips')}
                  className="px-2 py-1.5 rounded-xl blue-card text-[10.5px] font-bold text-sky-300 shrink-0"
                >
                  ▾ Phím tắt
                </button>
              )}

              <div className="flex-1 bg-theme-input border border-sky-400/35 focus-within:border-sky-400 rounded-xl px-3 py-1.5 flex items-center gap-2 transition shadow-inner">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="Nhập tin nhắn hoặc giao việc cho AI (@ChatGPT, @Antigravity, @Codex...) — Enter để gửi"
                  className="w-full bg-transparent text-[13px] text-theme-main placeholder-sky-300/45 focus:outline-none resize-none font-sans leading-snug py-0.5"
                />

                <button
                  type="button"
                  onClick={insertCodeTemplate}
                  className="px-2 py-0.5 rounded-lg blue-card text-[10.5px] font-mono text-sky-300 hover:border-sky-400 shrink-0"
                  title="Chèn khối code"
                >
                  {'{ }'} Code
                </button>
              </div>

              <button
                type="submit"
                disabled={isSending}
                className="btn-pop px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-sky-500 hover:from-blue-500 hover:to-sky-400 disabled:opacity-50 text-white font-display font-bold text-xs shadow-[0_4px_14px_rgba(14,165,233,0.45)] flex items-center gap-1.5 shrink-0"
              >
                <span>{isSending ? 'Đang gửi...' : 'Gửi'}</span>
                <span>💙</span>
              </button>
            </form>
          </div>
        </main>
      </div>

      {/* ==================== 3. MODAL: BRIDGE SETTINGS ==================== */}
      {isBridgeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
          <div className="blue-glass w-full max-w-lg rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-sky-400/20 pb-2">
              <div className="flex items-center gap-2">
                <span className="text-base">💎</span>
                <div>
                  <h2 className="font-display font-bold text-xs sm:text-sm text-theme-main">
                    Kết Nối WT Union-Bot Bridge (wtrg/union-bot)
                  </h2>
                  <p className="text-[10.5px] text-theme-sub">
                    Trạng thái kết nối IPC Desktop và phiên làm việc Hội Đồng 6 AI
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsBridgeModalOpen(false)}
                className="px-2 py-0.5 rounded-lg blue-card text-xs font-bold text-theme-sub"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="p-2.5 rounded-xl bg-black/30 border border-sky-400/25 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-theme-sub font-bold">Môi trường:</span>
                  <span className="font-mono text-emerald-400 font-bold">
                    {isDesktop ? 'Electron Desktop (Đã kết nối IPC)' : 'Web Preview (Standalone)'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-theme-sub font-bold">Leader AI mặc định:</span>
                  <span className="text-sky-300 font-bold">ChatGPT Web (Leader / Architect)</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-theme-sub font-bold">Implementer AI:</span>
                  <span className="text-sky-300 font-bold">Antigravity (Local 0đ)</span>
                </div>
              </div>

              <div>
                <label className="block font-display font-bold text-theme-sub mb-1 text-[11px]">
                  Danh sách thành viên AI kích hoạt:
                </label>
                <div className="grid grid-cols-2 gap-1 font-mono text-[10.5px] text-sky-200">
                  <div className="p-1 rounded bg-black/20 border border-sky-400/20">🍵 @ChatGPT (Leader)</div>
                  <div className="p-1 rounded bg-black/20 border border-sky-400/20">💠 @Antigravity (Implementer)</div>
                  <div className="p-1 rounded bg-black/20 border border-sky-400/20">🦊 @Codex (QA / Security)</div>
                  <div className="p-1 rounded bg-black/20 border border-sky-400/20">✨ @Gemini (Research)</div>
                  <div className="p-1 rounded bg-black/20 border border-sky-400/20">🍊 @Claude (Reviewer)</div>
                  <div className="p-1 rounded bg-black/20 border border-sky-400/20">🐟 @DeepSeek (Algorithm)</div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-sky-400/20">
              <button
                type="button"
                onClick={() => setIsBridgeModalOpen(false)}
                className="px-3 py-1 rounded-xl blue-card text-xs font-bold text-theme-sub"
              >
                Đóng
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsBridgeModalOpen(false);
                  setIsBrowserOpen(true);
                  showToast('🌐 Đã mở Browser panel để quản lý tài khoản AI!');
                }}
                className="btn-pop px-3.5 py-1 rounded-xl bg-gradient-to-r from-blue-600 to-sky-500 text-white text-xs font-display font-bold"
              >
                Mở Trình Duyệt Web AI 🌐
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 4. EMBEDDED BROWSER PANEL ==================== */}
      <BrowserPanel
        isOpen={isBrowserOpen}
        onClose={() => setIsBrowserOpen(false)}
        activeRoomId={activeRoom}
      />

      {/* ==================== 5. TOAST NOTIFICATION ==================== */}
      {toastText && (
        <div
          id="sora-toast"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-3.5 py-1.5 rounded-full blue-glass text-xs font-display font-bold text-theme-main shadow-2xl flex items-center gap-2 animate-bounce"
        >
          <span>💎</span>
          <span>{toastText}</span>
        </div>
      )}
    </div>
  );
};
