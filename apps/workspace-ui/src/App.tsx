import React, { useState, useEffect, useRef } from 'react';
import { Sora3DIsland, Sora3DIslandRef, AGENTS, AGENT_IDS } from './components/Sora3DIsland.tsx';
import { BrowserPanel } from './components/BrowserPanel.tsx';

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
}

export interface RoomDef {
  id: string;
  label: string;
  unread: number;
}

const INITIAL_TASKS: BotTask[] = [
  {
    id: 'TASK-01',
    title: 'Đồng bộ WebSocket 6 AI & tối ưu khung chat 70% Blue',
    agent: 'Codex',
    progress: 78,
    status: 'RUNNING',
  },
  {
    id: 'TASK-02',
    title: 'Tách biệt Khung Đảo 3D & Bảng Tác Vụ không đè nhau',
    agent: 'Antigravity',
    progress: 94,
    status: 'RUNNING',
  },
  {
    id: 'TASK-03',
    title: 'Kiểm thử phản biện chéo & cỡ chữ 12.5px sắc nét',
    agent: 'Claude',
    progress: 68,
    status: 'RUNNING',
  },
  {
    id: 'TASK-04',
    title: 'Tối ưu hàng đợi sự kiện O(1) cho wtrg/union-bot',
    agent: 'DeepSeek',
    progress: 100,
    status: 'DONE',
  },
];

const INITIAL_CHECKLIST: ChecklistItem[] = [
  { id: 'ck-1', text: 'Khung Chat Nhóm 70% màn hình chữ 12.5px gọn đẹp', done: true },
  { id: 'ck-2', text: 'Khung Đảo Hoa Lam 3D riêng biệt không bị che khuất', done: true },
  { id: 'ck-3', text: 'Bảng Tác Vụ & Checklist thu gọn mở rộng 100% 3D', done: true },
  { id: 'ck-4', text: 'Xuất báo cáo benchmark JSON cho wtrg/union-bot', done: false },
];

const INITIAL_ROOMS: RoomDef[] = [
  { id: '#wt-union-general', label: '💙 #wt-union-general', unread: 0 },
  { id: '#code-warroom', label: '⚡ #code-warroom', unread: 1 },
  { id: '#tech-critique', label: '🛡️ #tech-critique', unread: 0 },
];

const SAMPLE_CODE_1 = [
  '```typescript',
  '// Đồng bộ 6 AI & Khung Chat 70% Sora Blue (wtrg/union-bot)',
  'export const soraBlueWorkspace = {',
  '  leftColumn30: { top3dIsland: "52%", bottomTaskDock: "48% (Collapsible)" },',
  '  rightChat70: { fontSize: "12.5px", codeFontSize: "11px", members: 6 }',
  '};',
  '```',
].join('\n');

const INITIAL_ROOM_MESSAGES: Record<string, ChatMessage[]> = {
  '#wt-union-general': [
    {
      id: 'm-101',
      sender: 'ChatGPT',
      time: '01:20',
      taskTag: 'TASK-01',
      text: 'Chào **Commander**! 💙 Mình đã khắc phục hoàn toàn lỗi hiển thị và bố trí lại không gian `wtrg/union-bot` siêu gọn:\n• **Cột Trái (30%)**: Nửa trên là **Đảo Hoa Lam 3D riêng biệt** (không bao giờ bị bảng Task che khuất), nửa dưới là **Bảng Tác Vụ & Tiến Độ Bot**.\n• **Cột Phải (70%)**: Khung trò chuyện nhóm với cỡ chữ **`12.5px`** thanh thoát, hiển thị đầy đủ cả 6 thành viên AI!',
      reactions: { '💙': 9, '⚡': 6, '🚀': 5 },
    },
    {
      id: 'm-102',
      sender: 'Codex',
      time: '01:20',
      taskTag: 'TASK-01',
      text:
        'Báo cáo **[TASK-01]** (78%): Mình đã kết nối trực tiếp Hàng Đợi Tác Vụ với khung chat 70% này! 🦊\n' +
        SAMPLE_CODE_1 +
        '\nKhi bạn bấm nút **`▾ Thu gọn`** ở bảng Tác Vụ bên trái, **Đảo Hoa Lam 3D** sẽ tự động phóng to chiếm trọn 100% cột trái!',
      reactions: { '💙': 8, '✅': 7 },
    },
    {
      id: 'm-103',
      sender: 'Gemini',
      time: '01:21',
      taskTag: 'TASK-02',
      text:
        'Mình và @Antigravity đã căn chỉnh lại Camera 3D ngay chính giữa khung **Đảo Hoa Lam 3D** ✨. Bạn có thể bấm trực tiếp vào từng bé Mochi 3D hoặc thanh 6 AI phía trên để gọi tên và giao việc nhé!',
      reactions: { '💙': 7, '🚀': 4 },
    },
    {
      id: 'm-104',
      sender: 'Claude',
      time: '01:21',
      taskTag: 'TASK-03',
      text:
        'Mình đã kiểm tra **[TASK-03]**: Phông chữ **`12.5px`** (kèm thanh trượt `11px – 15px` trên góc phải) giúp đọc được nhiều tin nhắn và khối code hơn 35% trên màn hình laptop mà vẫn cực kỳ dịu mắt. 🍊',
      reactions: { '💙': 6, '✅': 5 },
    },
  ],
  '#code-warroom': [
    {
      id: 'm-201',
      sender: 'DeepSeek',
      time: '01:18',
      taskTag: 'TASK-04',
      text:
        'Đã hoàn tất **[TASK-04]** (100%)! 🐟 Toàn bộ hàng đợi WebSocket của `wtrg/union-bot` đạt độ trễ trung bình **18ms**.',
      reactions: { '⚡': 6, '✅': 5 },
    },
  ],
  '#tech-critique': [
    {
      id: 'm-301',
      sender: 'Antigravity',
      time: '01:19',
      taskTag: 'TASK-02',
      text:
        'Khung WebGL 3D hiện sử dụng `ResizeObserver` tự động co giãn mượt mà mỗi khi bạn thu gọn hoặc mở rộng bảng Tác Vụ! 💠',
      reactions: { '💙': 5, '🚀': 4 },
    },
  ],
};

function currentTimeShort(): string {
  return new Date().toTimeString().slice(0, 5);
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export const App: React.FC = () => {
  const islandRef = useRef<Sora3DIslandRef>(null);
  const chatBoxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Layout & Theme State
  const [layoutRatio, setLayoutRatio] = useState<'70' | '85' | '100' | 'garden'>('70');
  const [isDayTheme, setIsDayTheme] = useState<boolean>(false);
  const [chatFontSize, setChatFontSize] = useState<number>(12.5);
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
  const [rooms, setRooms] = useState<RoomDef[]>(INITIAL_ROOMS);
  const [activeRoom, setActiveRoom] = useState<string>('#wt-union-general');
  const [roomMessages, setRoomMessages] = useState<Record<string, ChatMessage[]>>(INITIAL_ROOM_MESSAGES);
  const [botTasks, setBotTasks] = useState<BotTask[]>(INITIAL_TASKS);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(INITIAL_CHECKLIST);
  const [pinnedTaskId, setPinnedTaskId] = useState<string>('TASK-01');

  // Input & Typing States
  const [inputText, setInputText] = useState<string>('');
  const [newTaskTitle, setNewTaskTitle] = useState<string>('');
  const [newTaskAgent, setNewTaskAgent] = useState<string>('Codex');
  const [typingAgents, setTypingAgents] = useState<Set<string>>(new Set());

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

  // Font size synchronization
  const handleFontSizeChange = (val: number) => {
    const clamped = Math.max(11, Math.min(15, Math.round(val * 2) / 2));
    setChatFontSize(clamped);
    document.documentElement.style.setProperty('--chat-font-size', `${clamped}px`);
  };

  useEffect(() => {
    document.documentElement.style.setProperty('--chat-font-size', `${chatFontSize}px`);
  }, []);

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
    setInputText((prev) => `${prev}\n\`\`\`json\n{"task": "${pinnedTaskId}", "chat_width": "70%", "font": "${chatFontSize}px"}\n\`\`\`\n`);
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

  const handleAddNewTask = (e: React.FormEvent) => {
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

    pushMessage(
      activeRoom,
      {
        id: `m-task-${Date.now()}`,
        sender: newTaskAgent,
        time: currentTimeShort(),
        taskTag: newId,
        text: `Đã nhận tác vụ mới **[${newId}]**: *"${title}"*! 💙 Mình đang khởi chạy tiến trình thực thi ngay bây giờ (20% -> 100%).`,
        reactions: { '💙': 4, '🚀': 3 },
      },
      `Đang chạy ${newId}! ⚡`
    );
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
        id: 'TASK-05',
        title: 'Giám sát định kỳ hệ thống wtrg/union-bot',
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

  // Message Sending
  const pushMessage = (roomId: string, msg: ChatMessage, shortSpeech?: string) => {
    setRoomMessages((prev) => {
      const list = prev[roomId] || [];
      return { ...prev, [roomId]: [...list, msg] };
    });

    if (msg.sender !== 'Commander' && islandRef.current) {
      islandRef.current.triggerHappyBounce(msg.sender, shortSpeech || 'Đã báo cáo! 💙');
    }

    if (roomId !== activeRoom) {
      setRooms((prev) =>
        prev.map((r) => (r.id === roomId ? { ...r, unread: r.unread + 1 } : r))
      );
    }
  };

  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = inputText.trim();
    if (!text) return;
    setInputText('');

    pushMessage(activeRoom, {
      id: `m-${Date.now()}`,
      sender: 'Commander',
      time: currentTimeShort(),
      text,
      reactions: { '💙': 3, '⚡': 2 },
    });

    // Determine responders
    const mentioned = AGENT_IDS.filter((id) =>
      text.toLowerCase().includes(`@${id.toLowerCase()}`)
    );
    const isAll = text.toLowerCase().includes('@tấtcả') || text.toLowerCase().includes('@all');

    let chosen: string[] = [];
    if (isAll) {
      chosen = [...AGENT_IDS];
    } else if (mentioned.length > 0) {
      chosen = [...mentioned];
      if (autoParty && chosen.length === 1) {
        const others = AGENT_IDS.filter((k) => !chosen.includes(k));
        chosen.push(others[Math.floor(Math.random() * others.length)]);
      }
    } else {
      chosen = autoParty ? ['ChatGPT', 'Codex', 'Gemini'] : [AGENT_IDS[Math.floor(Math.random() * AGENT_IDS.length)]];
    }

    scheduleCohortReplies(text, Array.from(new Set(chosen)), activeRoom, pinnedTaskId);
  };

  const scheduleCohortReplies = (
    prompt: string,
    agents: string[],
    room: string,
    taskTag: string
  ) => {
    agents.forEach((id, idx) => {
      setTimeout(() => {
        setTypingAgents((prev) => new Set(prev).add(id));
        islandRef.current?.triggerHappyBounce(id, 'Đang xử lý... ⚡');
      }, idx * 380);

      setTimeout(() => {
        setTypingAgents((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });

        const reply = buildAgentReply(id, prompt, idx, agents, taskTag);
        pushMessage(
          room,
          {
            id: `m-${Date.now()}-${idx}`,
            sender: id,
            time: currentTimeShort(),
            taskTag: taskTag || 'TASK-01',
            text: reply.text,
            reactions: { '💙': 3 + Math.floor(Math.random() * 4), '✅': 2 },
          },
          reply.shortSpeech
        );
      }, 900 + idx * 1050);
    });
  };

  const buildAgentReply = (
    agentId: string,
    prompt: string,
    idx: number,
    cohort: string[],
    taskTag: string
  ): { text: string; shortSpeech: string } => {
    const clean = prompt.replace(/@\S+/g, '').trim() || 'điều phối tác vụ wtrg/union-bot';
    const prev = idx > 0 ? cohort[idx - 1] : null;
    const tag = taskTag || 'TASK-01';

    const codeSnippet = [
      '```typescript',
      `export async function runUnionTask(id = "${tag}") {`,
      '  return { id, status: "VERIFIED_60FPS", chatFont: "12.5px" };',
      '}',
      '```',
    ].join('\n');

    const replies: Record<string, { text: string; shortSpeech: string }> = {
      ChatGPT: {
        shortSpeech: `Điều phối ${tag}! 🍵`,
        text: `Đã cập nhật vào **[${tag}]**! 💙 Về yêu cầu **"${clean}"**, mình đã phân bổ luồng cho @Codex thực thi mã nguồn và @Claude kiểm tra chéo.`,
      },
      Gemini: {
        shortSpeech: 'Đồng bộ 60FPS! ✨',
        text: `${prev ? `Đồng ý với @${prev}! ✨ ` : ''}Mình vừa đồng bộ dữ liệu thời gian thực cho **"${clean}"** thuộc **[${tag}]**. Khung 3D bên trái và Khung Chat 70% bên phải hiện chạy song song cực mượt!`,
      },
      Codex: {
        shortSpeech: 'Code chạy mượt! 🦊',
        text: `Shiba Tia Chớp báo cáo **[${tag}]**! 🦊 Mình đã cập nhật module xử lý cho **"${clean}"**:\n${codeSnippet}\nTiến độ task bên cột trái vừa được cộng thêm % tự động!`,
      },
      Antigravity: {
        shortSpeech: 'Đảo Lam Ngọc 3D! 💠',
        text: `Mỗi khi **[${tag}]** có cập nhật mới về **"${clean}"**, mình lại kích hoạt sóng năng lượng Xanh Dương từ 6 anh em Mochi bay lên **Cây Đào Pha Lê 3D**! 💠`,
      },
      Claude: {
        shortSpeech: 'Đã duyệt an toàn! 🍊',
        text: `${prev ? `Xác nhận bổ sung cho @${prev}: ` : ''}Đã kiểm duyệt bảo mật cho **"${clean}"** (**[${tag}]**) 🍊. Cỡ chữ \`12.5px\` và các bảng thu gọn hoạt động hoàn hảo.`,
      },
      DeepSeek: {
        shortSpeech: 'Tối ưu O(1)! 🐟',
        text: `Cá Koi Đại Dương báo cáo **[${tag}]**: Luồng xử lý **"${clean}"** đạt hiệu suất tối đa, độ trễ toàn mạng chỉ **18ms**! 🐟`,
      },
    };

    return replies[agentId] || replies.ChatGPT;
  };

  const handleCouncilDebate = () => {
    showToast('⚡ Kích hoạt phiên thảo luận & rà soát Tác Vụ giữa 4 AI!');
    handleRunAllTasksBoost();
    scheduleCohortReplies(
      'Rà soát tiến độ Hàng Đợi Tác Vụ & tối ưu khung chat 70% Blue',
      ['ChatGPT', 'Codex', 'Gemini', 'Claude'],
      activeRoom,
      pinnedTaskId
    );
  };

  const handleRollCall = () => {
    showToast('🍡 Cả 6 bé AI đang nhảy điểm danh & đồng bộ Tác Vụ!');
    islandRef.current?.triggerRollCall();

    setTimeout(() => {
      pushMessage(
        activeRoom,
        {
          id: `m-roll-${Date.now()}`,
          sender: 'ChatGPT',
          time: currentTimeShort(),
          taskTag: pinnedTaskId,
          text:
            '**🍡 ĐIỂM DANH ĐỘI HÌNH 6 AI & TRẠNG THÁI TÁC VỤ (`wtrg/union-bot`)**:\n• 🍵 **ChatGPT** — Điều phối chung & Checklist Sprint\n• ✨ **Gemini** — Đồng bộ WebSocket & Telemetry\n• 🦊 **Codex** — Thực thi **[TASK-01]** (Khung chat 70% Blue)\n• 💠 **Antigravity** — Đồ họa Đảo Lam Ngọc 3D (**[TASK-02]**)\n• 🍊 **Claude** — Phản biện & Kiểm thử (**[TASK-03]**)\n• 🐟 **DeepSeek** — Tối ưu hàng đợi O(1) (**[TASK-04]** Hoàn tất)',
          reactions: { '💙': 11, '⚡': 8, '✅': 7 },
        },
        'Đủ 6 thành viên! 💙'
      );
    }, 800);
  };

  const handleClearChat = () => {
    setRoomMessages((prev) => ({
      ...prev,
      [activeRoom]: [
        {
          id: `m-clean-${Date.now()}`,
          sender: 'ChatGPT',
          time: currentTimeShort(),
          taskTag: pinnedTaskId,
          text: `💙 Đã làm mới phòng **${activeRoom}**! Khung chat 70% cỡ chữ \`12.5px\` đã sẵn sàng.`,
          reactions: { '💙': 4, '✅': 3 },
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
        'Task chạy mượt! ⚡',
        'Chat 70% chữ 12.5px! 💙',
        'wtrg/union-bot 60FPS! 💎',
        'Bấm mình để giao việc! 📋',
      ];
      const pick = phrases[Math.floor(Math.random() * phrases.length)];
      islandRef.current?.triggerHappyBounce(randomId, pick);
    }, 6200);

    return () => clearInterval(timer);
  }, []);

  // Format message text with markdown code blocks, bold, task links, mentions
  const renderFormattedText = (raw: string) => {
    const codeBlocks: string[] = [];
    let text = String(raw).replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
      const idx = codeBlocks.length;
      const clean = code.trim();
      const encoded = encodeURIComponent(clean);
      codeBlocks.push(
        `<div class="my-1.5 rounded-xl overflow-hidden border border-sky-400/30 bg-[#040B1A]/95 font-mono text-[11px] text-sky-100 shadow-inner">
          <div class="flex items-center justify-between px-2.5 py-0.5 bg-sky-500/10 border-b border-sky-400/20 text-[9.5px]">
            <span class="text-sky-300 font-bold uppercase">💎 ${lang || 'CODE'}</span>
            <button type="button" onclick="navigator.clipboard.writeText(decodeURIComponent('${encoded}')); alert('Đã sao chép!');" class="px-2 py-0.5 rounded bg-sky-500/20 hover:bg-sky-500/40 text-sky-200 transition text-[9.5px]">📋 Sao chép</button>
          </div>
          <pre class="py-1.5 px-2.5 overflow-x-auto text-[11px] text-sky-200 leading-relaxed"><code>${escapeHtml(clean)}</code></pre>
        </div>`
      );
      return `@@CODE_${idx}@@`;
    });

    text = escapeHtml(text);
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-extrabold text-sky-300">$1</strong>');
    text = text.replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-400/30 font-mono text-[11px] text-sky-300 font-semibold">$1</code>');
    text = text.replace(/\[(TASK-\d+)\]/g, `<span class="cursor-pointer px-1.5 py-0.5 rounded bg-blue-600/30 border border-sky-400/50 font-mono text-[9.5px] font-bold text-sky-200 hover:bg-blue-600/50">$1</span>`);
    text = text.replace(/@(TấtCả|ChatGPT|Gemini|Codex|Antigravity|Claude|DeepSeek)/g, (_, name) => {
      const ag = AGENTS[name];
      const col = ag ? ag.colorCss : '#38BDF8';
      return `<span class="cursor-pointer px-1.5 py-0.2 rounded-md font-display font-bold text-[10.5px]" style="background:${col}22; color:${col}; border:1px solid ${col}66">@${name}</span>`;
    });

    text = text.replace(/\n/g, '<br/>');
    codeBlocks.forEach((html, idx) => {
      text = text.replace(`@@CODE_${idx}@@`, html);
    });

    return <div dangerouslySetInnerHTML={{ __html: text }} />;
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
        {/* Brand & Repo Link */}
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

        {/* Layout Ratio Switcher (Default: 70% Chat) */}
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

        {/* Right Action Buttons */}
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

      {/* ==================== 2. MAIN SPLIT WORKSPACE (30% LEFT + 70% RIGHT) ==================== */}
      <div className="flex-1 flex items-stretch gap-2 min-h-0 relative">
        {/* ================= LEFT COLUMN: DEDICATED 3D ISLAND + COLLAPSIBLE TASK DOCK ================= */}
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
          {/* TOP HALF: DEDICATED 3D SORA BLUE SAKURA ISLAND VIEWPORT */}
          <Sora3DIsland
            ref={islandRef}
            onSelectAgent={handleSelectAgent}
            focusedAgent={focusedAgent}
            typingAgents={typingAgents}
            onRestoreLayout={layoutRatio === 'garden' ? () => setLayoutRatio('70') : undefined}
          />

          {/* BOTTOM HALF: COLLAPSIBLE TASK & SPRINT DOCK */}
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
                <span
                  id="task-counter-badge"
                  className="px-1.5 py-0.2 rounded-md bg-sky-500/25 border border-sky-400/40 text-[9.5px] font-mono font-bold text-sky-300"
                >
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
                      {/* Quick Add Task Form */}
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

                      {/* Dynamic Active Tasks List */}
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

        {/* ================= RIGHT COLUMN: COMPACT 12.5PX GROUP CHAT HUB ================= */}
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
          {/* 1. COMPACT CHAT HEADER + COLLAPSIBLE 6 AI BAR */}
          <div className="px-3 pt-2 pb-1.5 border-b border-sky-400/20 flex flex-col gap-1.5 shrink-0 bg-gradient-to-r from-blue-950/45 via-sky-950/20 to-transparent">
            {/* Top Row: Channel Tabs + Collapse Toggles + Font Size Slider */}
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
                      className={`btn-pop px-2.5 py-0.5 rounded-xl text-[11px] font-display font-bold transition flex items-center gap-1 whitespace-nowrap ${
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
                  onClick={() => toggleSection('aiMemberBar')}
                  className="btn-pop px-2 py-0.5 rounded-lg blue-card text-[10px] font-display font-bold text-sky-300 hover:border-sky-400"
                >
                  <span>{collapsed.aiMemberBar ? '▾ Mở rộng 6 AI' : '▴ Thu gọn 6 AI'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => toggleSection('pinnedTaskBanner')}
                  className="btn-pop px-2 py-0.5 rounded-lg blue-card text-[10px] font-display font-bold text-theme-sub hover:text-sky-300"
                >
                  <span>{collapsed.pinnedTaskBanner ? '📌 Hiện Task' : '📌 Ghim Task'}</span>
                </button>

                {/* Font Size Controls (11px - 15px, default 12.5px) */}
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
                    max="15"
                    step="0.5"
                    value={chatFontSize}
                    onChange={(e) => handleFontSizeChange(parseFloat(e.target.value))}
                    className="w-14 h-1 accent-sky-400 cursor-pointer"
                  />
                  <span className="text-[10px] font-mono text-sky-400 font-bold min-w-[34px] text-center">
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

            {/* COLLAPSIBLE 6 AI MOCHI STRIP */}
            {collapsed.aiMemberBar ? (
              <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                {AGENT_IDS.map((id) => {
                  const ag = AGENTS[id];
                  const isFocused = focusedAgent === id;
                  const isTyping = typingAgents.has(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => handleSelectAgent(ag.id)}
                      className="btn-pop px-2 py-0.5 rounded-full blue-card flex items-center gap-1.5 shrink-0 text-[10px] font-display font-bold"
                      style={{
                        borderColor: isFocused ? ag.colorCss : 'var(--glass-border)',
                      }}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${isTyping ? 'animate-ping' : ''}`}
                        style={{ background: ag.colorCss }}
                      />
                      <span>
                        {ag.emoji} {ag.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                {AGENT_IDS.map((id) => {
                  const ag = AGENTS[id];
                  const isFocused = focusedAgent === id;
                  const isTyping = typingAgents.has(id);

                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => handleSelectAgent(ag.id)}
                      title={`Bấm để gọi @${ag.name} (${ag.role}) và ngắm Mochi 3D`}
                      className="btn-pop blue-card rounded-xl px-2 py-1 flex items-center gap-1.5 text-left relative overflow-hidden"
                      style={{
                        borderColor: isFocused ? ag.colorCss : 'var(--glass-border)',
                      }}
                    >
                      <div className="relative w-5 h-5 rounded-lg overflow-hidden shrink-0">
                        <div
                          className="w-full h-full"
                          dangerouslySetInnerHTML={{ __html: ag.svg }}
                        />
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full border border-slate-900 ${
                            isTyping ? 'animate-ping' : ''
                          }`}
                          style={{ background: ag.colorCss }}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[10.5px] font-display font-bold text-theme-main truncate leading-tight">
                          {ag.name}
                        </div>
                        <div className="text-[9px] text-theme-muted truncate leading-tight">
                          {isTyping ? 'đang gõ...' : ag.role}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 2. COLLAPSIBLE PINNED ACTIVE TASK BANNER */}
          {!collapsed.pinnedTaskBanner && pinnedTask && (
            <div className="px-3 py-1 bg-blue-600/15 border-b border-sky-400/20 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="px-1.5 py-0.5 rounded bg-sky-500/30 border border-sky-400/50 text-[9px] font-mono font-bold text-sky-200 shrink-0">
                  ĐANG THỰC THI
                </span>
                <span className="text-[11px] font-display font-bold text-theme-main truncate">
                  [{pinnedTask.id}] {pinnedTask.title}
                </span>
                <span className="text-[10px] font-mono text-sky-300 shrink-0">
                  @{pinnedTask.agent} • {pinnedTask.progress}%
                </span>
                <div className="hidden sm:block w-24 h-1.5 rounded-full bg-black/40 overflow-hidden shrink-0">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-sky-300 transition-all duration-300"
                    style={{ width: `${pinnedTask.progress}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    scheduleCohortReplies(
                      `Báo cáo tiến độ [${pinnedTask.id}] ${pinnedTask.title} (${pinnedTask.progress}%)`,
                      [pinnedTask.agent, 'ChatGPT', 'Claude'],
                      activeRoom,
                      pinnedTask.id
                    )
                  }
                  className="btn-pop px-2 py-0.5 rounded-md bg-sky-500/25 hover:bg-sky-500/40 text-sky-200 border border-sky-400/40 text-[10px] font-display font-bold"
                >
                  📢 Báo cáo vào Chat
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

          {/* 3. SPACIOUS 70% CHAT MESSAGE STREAM (12.5px COMPACT FONT) */}
          <div
            ref={chatBoxRef}
            className="flex-1 overflow-y-auto px-3.5 py-2.5 space-y-2 select-text"
          >
            {currentMessages.map((msg) => {
              const ag = AGENTS[msg.sender] || AGENTS.ChatGPT;
              const isUser = msg.sender === 'Commander';
              const reactions = msg.reactions || { '💙': 2, '⚡': 1 };

              if (isUser) {
                return (
                  <div key={msg.id} className="msg-bounce-in flex items-start justify-end gap-2">
                    <div
                      className="max-w-[85%] rounded-2xl rounded-tr-sm px-3 py-1.5 shadow-md"
                      style={{
                        background: ag.cardBg,
                        border: `1px solid ${ag.cardBorder}`,
                      }}
                    >
                      <div className="flex items-center justify-end gap-2 pb-0.5 mb-1 border-b border-sky-400/20">
                        <span className="text-[9.5px] font-mono text-theme-muted">{msg.time}</span>
                        <span className="font-display font-semibold text-[11.5px] text-sky-300">
                          👑 {ag.name}
                        </span>
                      </div>
                      <div className="chat-text-body text-theme-main">
                        {renderFormattedText(msg.text)}
                      </div>
                    </div>
                    <div className="w-6 h-6 rounded-lg overflow-hidden shrink-0 shadow-md">
                      <div
                        className="w-full h-full"
                        dangerouslySetInnerHTML={{ __html: ag.svg }}
                      />
                    </div>
                  </div>
                );
              }

              return (
                <div key={msg.id} className="msg-bounce-in flex items-start gap-2">
                  <div
                    onClick={() => handleSelectAgent(ag.id)}
                    title={`Bấm để xem Mochi 3D của ${ag.name}`}
                    className="btn-pop w-6 h-6 rounded-lg overflow-hidden shrink-0 cursor-pointer shadow-md mt-0.5"
                  >
                    <div
                      className="w-full h-full"
                      dangerouslySetInnerHTML={{ __html: ag.svg }}
                    />
                  </div>
                  <div
                    className="flex-1 max-w-[94%] rounded-2xl rounded-tl-sm px-3 py-1.5 shadow-md"
                    style={{
                      background: ag.cardBg,
                      border: `1px solid ${ag.cardBorder}`,
                      borderLeft: `3px solid ${ag.colorCss}`,
                    }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1 pb-0.5 mb-1 border-b border-white/10">
                      <div className="flex items-center gap-1.5">
                        <span
                          onClick={() => handleSelectAgent(ag.id)}
                          className="font-display font-bold text-[11.5px] cursor-pointer hover:underline"
                          style={{ color: ag.colorCss }}
                        >
                          {ag.emoji} {ag.name}
                        </span>
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-display font-bold blue-card text-theme-sub">
                          {ag.role}
                        </span>
                        {msg.taskTag && (
                          <span
                            onClick={() => handlePinTask(msg.taskTag!)}
                            className="cursor-pointer px-1.5 py-0.2 rounded bg-sky-500/20 border border-sky-400/40 font-mono text-[9px] text-sky-300 font-bold"
                          >
                            📌 {msg.taskTag}
                          </span>
                        )}
                      </div>
                      <span className="text-[9.5px] font-mono text-theme-muted">{msg.time}</span>
                    </div>

                    <div className="chat-text-body text-theme-main">
                      {renderFormattedText(msg.text)}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-1 mt-1 pt-1 border-t border-white/10">
                      <div className="flex items-center gap-1 flex-wrap">
                        {['💙', '⚡', '🚀', '✅'].map((emo) => {
                          const count = reactions[emo] || 0;
                          return (
                            <button
                              key={emo}
                              type="button"
                              onClick={() => handleAddReaction(msg.id, emo)}
                              className={`btn-pop px-1.5 py-0.2 rounded-full text-[9.5px] blue-card hover:border-sky-400 flex items-center gap-1 ${
                                count > 0 ? 'opacity-100' : 'opacity-60'
                              }`}
                            >
                              <span>{emo}</span>
                              <span className="font-bold text-sky-300">{count}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            if (collapsed.taskHub) toggleSection('taskHub');
                            if (collapsed.activeTasks) toggleSection('activeTasks');
                            setNewTaskAgent(ag.id);
                            setNewTaskTitle(`Tối ưu module union-bot cùng @${ag.id}`);
                            showToast(`📋 Nhập tên Task ở cột trái để giao cho @${ag.id}!`);
                          }}
                          className="px-1.5 py-0.2 rounded blue-card text-[9.5px] font-display font-bold text-emerald-300 hover:border-emerald-400 transition"
                        >
                          + Giao Task
                        </button>
                        <button
                          type="button"
                          onClick={() => insertMention(`@${ag.id}`)}
                          className="px-1.5 py-0.2 rounded blue-card text-[9.5px] font-display font-bold text-theme-sub hover:text-sky-300 transition"
                        >
                          ↩ Trả lời
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 4. ANIMATED TYPING BAR */}
          {typingAgents.size > 0 && (
            <div className="px-3.5 py-1 bg-sky-500/10 border-t border-sky-400/20 flex items-center justify-between text-[10.5px] shrink-0">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 dot-1"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 dot-2"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 dot-3"></span>
                </div>
                <span className="font-display font-bold text-sky-300 text-[10.5px]">
                  💎{' '}
                  {Array.from(typingAgents)
                    .map((id) => `${AGENTS[id]?.emoji} ${AGENTS[id]?.name}`)
                    .join(', ')}{' '}
                  đang xử lý tác vụ & gõ phản hồi...
                </span>
              </div>
              <span className="text-[9.5px] font-mono text-theme-muted">⚡ Đồng bộ 3D</span>
            </div>
          )}

          {/* 5. COMPACT BOTTOM INPUT & COLLAPSIBLE QUICK CHIPS */}
          <div className="p-2 bg-black/20 border-t border-sky-400/20 flex flex-col gap-1.5 shrink-0">
            {/* Collapsible Quick Action Chips */}
            {!collapsed.quickChips && (
              <div className="flex flex-wrap items-center justify-between gap-1">
                <div className="flex items-center gap-1 overflow-x-auto">
                  <button
                    type="button"
                    onClick={handleCouncilDebate}
                    className="btn-pop px-2 py-0.5 rounded-lg bg-gradient-to-r from-blue-600/40 to-sky-500/40 hover:from-blue-600/60 hover:to-sky-500/60 text-sky-100 border border-sky-400/40 text-[10px] font-display font-bold whitespace-nowrap"
                  >
                    ⚡ Thảo Luận Tác Vụ
                  </button>

                  <button
                    type="button"
                    onClick={handleRollCall}
                    className="btn-pop px-2 py-0.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-300 border border-emerald-400/40 text-[10px] font-display font-bold whitespace-nowrap"
                  >
                    🙋‍♂️ Điểm Danh 6 AI
                  </button>

                  <button
                    type="button"
                    onClick={() => insertMention('@TấtCả')}
                    className="btn-pop px-2 py-0.5 rounded-lg blue-card text-[10px] font-bold text-sky-300 hover:border-sky-400 whitespace-nowrap"
                  >
                    @TấtCả
                  </button>

                  <button
                    type="button"
                    onClick={handleClearChat}
                    className="btn-pop px-2 py-0.5 rounded-lg blue-card text-[10px] text-theme-muted hover:text-rose-400 whitespace-nowrap"
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
            <form onSubmit={handleSendMessage} className="flex items-center gap-1.5">
              {collapsed.quickChips && (
                <button
                  type="button"
                  onClick={() => toggleSection('quickChips')}
                  className="px-2 py-1 rounded-xl blue-card text-[10px] font-bold text-sky-300 shrink-0"
                >
                  ▾ Phím tắt
                </button>
              )}

              <div className="flex-1 bg-theme-input border border-sky-400/35 focus-within:border-sky-400 rounded-xl px-2.5 py-1 flex items-center gap-2 transition shadow-inner">
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
                  placeholder="Nhập tin nhắn hoặc giao task cho 6 AI (@Codex, @Gemini, @ChatGPT...) — Enter để gửi"
                  className="w-full bg-transparent text-[12.5px] text-theme-main placeholder-sky-300/45 focus:outline-none resize-none font-sans leading-snug py-0.5"
                />

                <button
                  type="button"
                  onClick={insertCodeTemplate}
                  className="px-2 py-0.5 rounded-lg blue-card text-[10px] font-mono text-sky-300 hover:border-sky-400 shrink-0"
                >
                  {'{ }'} Code
                </button>
              </div>

              <button
                type="submit"
                className="btn-pop px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-sky-500 hover:from-blue-500 hover:to-sky-400 text-white font-display font-bold text-xs shadow-[0_4px_14px_rgba(14,165,233,0.45)] flex items-center gap-1 shrink-0"
              >
                <span>Gửi</span>
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
                    Đồng bộ WebSocket thời gian thực với 6 AI & Hàng Đợi Tác Vụ
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
              <div>
                <label className="block font-display font-bold text-theme-sub mb-1 text-[11px]">
                  WebSocket Group Chat & Task Endpoint
                </label>
                <input
                  type="text"
                  defaultValue="ws://localhost:8080/union-chat"
                  className="w-full bg-theme-input border border-sky-400/30 rounded-xl px-3 py-1.5 font-mono text-[11px] text-theme-main focus:outline-none focus:border-sky-400"
                />
              </div>
              <div>
                <label className="block font-display font-bold text-theme-sub mb-1 text-[11px]">
                  Cấu hình JSON Hội Đồng 6 AI
                </label>
                <textarea
                  rows={4}
                  spellCheck="false"
                  defaultValue={`{\n  "repo": "wtrg/union-bot",\n  "theme": "sora-blue-70-chat",\n  "chat_font_size": "12.5px",\n  "members": ["ChatGPT", "Gemini", "Codex", "Antigravity", "Claude", "DeepSeek"]\n}`}
                  className="w-full bg-theme-input border border-sky-400/30 rounded-xl p-2.5 font-mono text-[11px] text-sky-300 focus:outline-none select-text"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-sky-400/20">
              <button
                type="button"
                onClick={() => setIsBridgeModalOpen(false)}
                className="px-3 py-1 rounded-xl blue-card text-xs font-bold text-theme-sub"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsBridgeModalOpen(false);
                  islandRef.current?.triggerAzureGust();
                  showToast('💙 Đã lưu cấu hình kết nối WT Union-Bot Bridge!');
                }}
                className="btn-pop px-3.5 py-1 rounded-xl bg-gradient-to-r from-blue-600 to-sky-500 text-white text-xs font-display font-bold"
              >
                Lưu & Đồng Bộ 💙
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
