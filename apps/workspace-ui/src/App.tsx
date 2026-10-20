import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar.tsx';
import { Header } from './components/Header.tsx';
import { ChatRoom } from './components/ChatRoom.tsx';
import { ApprovalInbox } from './components/ApprovalInbox.tsx';
import { TasksInbox } from './components/TasksInbox.tsx';
import { PreferencesModal } from './components/PreferencesModal.tsx';
import { CreateRoomModal } from './components/CreateRoomModal.tsx';
import { CreateProjectModal } from './components/CreateProjectModal.tsx';
import { BrowserPanel } from './components/BrowserPanel.tsx';
import { DiscoveryPanel } from './components/DiscoveryPanel.tsx';
import { AgentInfo, RoomInfo, EnvelopeView, AttachmentInfo, MessagePart, ProjectInfo, RequirementFactInfo, OpenQuestionInfo } from './types.ts';

const INITIAL_PROJECTS: ProjectInfo[] = [
  { id: 'default', name: 'Default Project', description: 'Primary Union Bot collaboration workspace' },
];

const INITIAL_ROOMS: RoomInfo[] = [
  { id: 'orchestration', name: 'orchestration', description: 'Cross-agent coordination & Leader directive tracking' },
  { id: 'agent-dev', name: 'agent-dev', description: 'Antigravity & Codex collaborative implementation stream' },
  { id: 'qa-audit', name: 'qa-audit', description: 'Zero-Cost egress checks, test suites & security scan audit' },
  { id: 'review-briefing', name: 'review-briefing', description: 'Leader review packet preparation & ChatGPT Web sync' },
];

const INITIAL_AGENTS: AgentInfo[] = [
  { id: 'chatgpt_web', name: 'ChatGPT Web', role: 'Leader / Architect', provider: 'chatgpt', status: 'ready_manual', badge: 'READY_MANUAL', details: 'Active web session' },
  { id: 'antigravity', name: 'Antigravity', role: 'Implementer', provider: 'antigravity', status: 'free_local', badge: 'FREE_LOCAL', details: 'Local agy 1.4.2 runner (0đ)' },
  { id: 'codex', name: 'Codex', role: 'QA & Security', provider: 'codex', status: 'unavailable_in_session', badge: 'PENDING_QA', details: 'Pending Independent QA' },
  { id: 'gemini_web', name: 'Gemini Web', role: 'Researcher', provider: 'gemini', status: 'auth_required', badge: 'AUTH_REQUIRED', details: 'Login required' },
  { id: 'claude_web', name: 'Claude Web', role: 'Standby Member', provider: 'claude', status: 'auth_required', badge: 'AUTH_REQUIRED', details: 'Standby' },
  { id: 'deepseek_web', name: 'DeepSeek Web', role: 'Standby Member', provider: 'deepseek', status: 'auth_required', badge: 'AUTH_REQUIRED', details: 'Standby' },
];

const EMPTY_ROOMS: Record<string, EnvelopeView[]> = {
  orchestration: [],
  'agent-dev': [],
  'qa-audit': [],
  'review-briefing': [],
};

const INITIAL_DEMO_ENVELOPES: Record<string, EnvelopeView[]> = {
  orchestration: [
    {
      id: 'demo_env_001',
      traceId: 'trc_demo_001',
      timestamp: Date.now() - 3600000,
      sender: { kind: 'agent', id: 'chatgpt_web', name: 'ChatGPT Web', role: 'LEADER', provider: 'chatgpt' },
      recipient: { kind: 'room', id: 'orchestration' },
      roomId: 'orchestration',
      fidelity: 'L1_FORMATTED_MARKDOWN',
      isDemo: true,
      parts: [
        {
          kind: 'text',
          text: '[OFFLINE MOCK PREVIEW] Directive R07: Phase P2 Gate APPROVED — GO_P3. Zero-Cost 0đ policy enforced.',
        },
      ],
    },
  ],
};

export const App: React.FC = () => {
  const isDesktop = typeof window !== 'undefined' && Boolean(window.unionBotAPI);
  const [activeView, setActiveView] = useState<'chat' | 'approvals' | 'tasks'>('chat');
  const [projects, setProjects] = useState<ProjectInfo[]>(INITIAL_PROJECTS);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('default');
  const [rooms, setRooms] = useState<RoomInfo[]>(INITIAL_ROOMS);
  const [activeRoomId, setActiveRoomId] = useState<string>('orchestration');
  const [roomEnvelopes, setRoomEnvelopes] = useState<Record<string, EnvelopeView[]>>(
    isDesktop ? EMPTY_ROOMS : INITIAL_DEMO_ENVELOPES
  );
  const [isDemoMode, setIsDemoMode] = useState<boolean>(!isDesktop);
  const [agents, setAgents] = useState<AgentInfo[]>(INITIAL_AGENTS);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState<number>(0);
  const [isCreateRoomOpen, setIsCreateRoomOpen] = useState<boolean>(false);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState<boolean>(false);
  const [editingProject, setEditingProject] = useState<ProjectInfo | null>(null);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState<boolean>(false);
  const [isBrowserOpen, setIsBrowserOpen] = useState<boolean>(false);
  const [storageStatus, setStorageStatus] = useState<string>('READY');
  const [storageError, setStorageError] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light' | 'high-contrast'>('dark');
  const [workspaceMode, setWorkspaceMode] = useState<'discovery' | 'work'>('discovery');
  const [isDiscoveryOpen, setIsDiscoveryOpen] = useState<boolean>(true);
  const [discoveryFacts, setDiscoveryFacts] = useState<RequirementFactInfo[]>([]);
  const [discoveryQuestions, setDiscoveryQuestions] = useState<OpenQuestionInfo[]>([]);

  // Coordinate modal open state with Electron WebContentsView (P4-008: Modals never covered by web layer)
  const isAnyModalActive = isCreateRoomOpen || isCreateProjectOpen || isPreferencesOpen;
  useEffect(() => {
    if (window.unionBotAPI && typeof window.unionBotAPI.browserSetModalActive === 'function') {
      window.unionBotAPI.browserSetModalActive(isAnyModalActive);
    }
  }, [isAnyModalActive]);

  // Support programmatic browser toggling for tests and UI shortcuts
  useEffect(() => {
    const handleToggleBrowserEvent = (e: any) => {
      if (e && typeof e.detail === 'boolean') {
        setIsBrowserOpen(e.detail);
      } else {
        setIsBrowserOpen((prev) => !prev);
      }
    };
    window.addEventListener('union-bot:toggle-browser', handleToggleBrowserEvent);
    return () => window.removeEventListener('union-bot:toggle-browser', handleToggleBrowserEvent);
  }, []);

  // Apply theme class to document body (UB-P3-R01-007)
  useEffect(() => {
    if (theme === 'light') {
      document.body.className = 'theme-light';
    } else {
      document.body.className = '';
    }
  }, [theme]);

  // Capability truth: dynamically update agent execution status on live task events
  useEffect(() => {
    if (window.unionBotAPI && typeof window.unionBotAPI.onTaskUpdated === 'function') {
      const unsub = window.unionBotAPI.onTaskUpdated((data) => {
        if (data.status === 'running') {
          setAgents((prev) =>
            prev.map((a) => (a.id === 'antigravity' ? { ...a, status: 'active' } : a))
          );
        } else if (
          data.status === 'completed' ||
          data.status === 'failed' ||
          data.status === 'cancelled'
        ) {
          setAgents((prev) =>
            prev.map((a) => (a.id === 'antigravity' ? { ...a, status: 'idle' } : a))
          );
        }
      });
      return unsub;
    }
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const appendOrUpdateEnvelope = (roomId: string, env: EnvelopeView) => {
    setRoomEnvelopes((prev) => {
      const roomList = prev[roomId] || [];
      const existingIdx = roomList.findIndex((item) => item.id === env.id);
      if (existingIdx >= 0) {
        const updated = [...roomList];
        updated[existingIdx] = { ...updated[existingIdx], ...env };
        return { ...prev, [roomId]: updated };
      }
      return { ...prev, [roomId]: [...roomList, env] };
    });
  };

  const refreshApprovalsCount = async () => {
    if (window.unionBotAPI && typeof window.unionBotAPI.listApprovals === 'function') {
      try {
        const list = await window.unionBotAPI.listApprovals({ limit: 100 });
        if (Array.isArray(list)) {
          setPendingApprovalsCount(list.filter((t) => t.status === 'PENDING').length);
        }
      } catch (err) {
        console.warn('[App] Failed to refresh approvals count:', err);
      }
    }
  };

  const loadProjects = async () => {
    if (window.unionBotAPI && typeof window.unionBotAPI.getProjects === 'function') {
      try {
        const projs = await window.unionBotAPI.getProjects();
        if (Array.isArray(projs) && projs.length > 0) {
          setProjects(projs);
          if (!projs.some((p) => p.id === selectedProjectId)) {
            setSelectedProjectId(projs[0].id);
          }
        }
      } catch (err) {
        console.warn('[App] Failed to load projects:', err);
      }
    }
  };

  const loadRoomsForProject = async (projId: string) => {
    if (window.unionBotAPI && typeof window.unionBotAPI.getRooms === 'function') {
      try {
        const loadedRooms = await window.unionBotAPI.getRooms({ projectId: projId });
        if (loadedRooms && loadedRooms.length > 0) {
          setRooms(loadedRooms);
          if (!loadedRooms.some((r) => r.id === activeRoomId)) {
            setActiveRoomId(loadedRooms[0].id);
          }
        } else {
          setRooms([]);
        }
      } catch (err) {
        console.warn('[App] Failed to load rooms for project:', err);
      }
    }
  };

  const loadDiscoveryState = async (projId: string) => {
    if (window.unionBotAPI && typeof window.unionBotAPI.getDiscoveryState === 'function') {
      try {
        const res = await window.unionBotAPI.getDiscoveryState(projId);
        if (res && res.success) {
          setDiscoveryFacts(res.facts || []);
          setDiscoveryQuestions(res.questions || []);
        }
      } catch (err) {
        console.warn('[App] Failed to load discovery state:', err);
      }
    }
  };

  const handleConfirmFact = async (key: string, value: string) => {
    if (window.unionBotAPI && typeof window.unionBotAPI.saveRequirementFact === 'function') {
      await window.unionBotAPI.saveRequirementFact({
        projectId: selectedProjectId,
        key,
        value,
        state: 'CONFIRMED',
        confirmedBy: 'Product Owner',
      });
      await loadDiscoveryState(selectedProjectId);
    } else {
      setDiscoveryFacts((prev) => [
        ...prev,
        {
          id: `fact_${Date.now()}`,
          discoveryId: 'disc_demo',
          projectId: selectedProjectId,
          key,
          value,
          sourceTurnRef: 'user-input',
          confidence: 1.0,
          state: 'CONFIRMED',
          confirmedBy: 'Product Owner',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]);
    }
  };

  const handleResolveQuestion = async (id: string, resolution: string) => {
    if (window.unionBotAPI && typeof window.unionBotAPI.resolveOpenQuestion === 'function') {
      await window.unionBotAPI.resolveOpenQuestion({ id, resolution });
      await loadDiscoveryState(selectedProjectId);
    } else {
      setDiscoveryQuestions((prev) =>
        prev.map((q) => (q.id === id ? { ...q, resolved: true, resolution, resolvedAt: Date.now() } : q))
      );
    }
  };

  const handleSwitchToWork = async () => {
    const openBlocking = discoveryQuestions.filter((q) => !q.resolved && q.blocking);
    if (discoveryFacts.length === 0 || openBlocking.length > 0) {
      alert(`Chưa thể chuyển sang /work: ${openBlocking.length > 0 ? `Còn ${openBlocking.length} câu hỏi quan trọng chưa giải quyết.` : 'Cần ít nhất 1 requirement fact.'}`);
      return;
    }
    setWorkspaceMode('work');
    setIsDiscoveryOpen(false);

    appendOrUpdateEnvelope(activeRoomId, {
      id: `sys_${Date.now()}_work`,
      traceId: `trc_${Date.now()}`,
      timestamp: Date.now(),
      sender: { kind: 'agent', id: 'system_router', name: 'System / Router', role: 'ROUTER' },
      recipient: { kind: 'room', id: activeRoomId },
      roomId: activeRoomId,
      fidelity: 'L1_FORMATTED_MARKDOWN',
      parts: [
        {
          kind: 'text',
          text: `🚀 **[CHẾ ĐỘ THỰC THI /work KÍCH HOẠT]**\n- Yêu cầu đã xác nhận: **${discoveryFacts.length} facts**\n- Câu hỏi tồn đọng: **0 blocking**\n- Sẵn sàng lập kế hoạch & triển khai mã nguồn.`,
        },
      ],
    });
  };

  // 1. Initial Load: Projects, Rooms & Status from SQLite IPC
  useEffect(() => {
    if (window.unionBotAPI) {
      setIsDemoMode(false);

      window.unionBotAPI.getAppStatus().then((res) => {
        if (res) {
          setStorageStatus(res.status);
          setStorageError(res.error);
        }
      });

      loadProjects();
      loadRoomsForProject(selectedProjectId);
      loadDiscoveryState(selectedProjectId);
      refreshApprovalsCount();

      if (typeof window.unionBotAPI.getCapabilities === 'function') {
        window.unionBotAPI.getCapabilities().then((res) => {
          if (res && res.success && Array.isArray(res.agents)) {
            setAgents(res.agents);
          }
        }).catch((err) => {
          console.warn('[App] Failed to load capabilities:', err);
        });
      }

      const unsubStatus = window.unionBotAPI.onAppStatusChanged((s) => {
        if (s) {
          setStorageStatus(s.status);
          setStorageError(s.error);
        }
      });

      return unsubStatus;
    }
  }, []);

  // Reload rooms & discovery whenever selected project changes (UB-P3-R01-002)
  useEffect(() => {
    if (window.unionBotAPI) {
      loadRoomsForProject(selectedProjectId);
      loadDiscoveryState(selectedProjectId);
    }
  }, [selectedProjectId]);

  // Support programmatic room selection / refresh for UI and test harness
  useEffect(() => {
    const handleSelectRoomEvent = (e: any) => {
      const targetRoomId = e?.detail?.roomId || e?.detail;
      if (typeof targetRoomId === 'string' && targetRoomId) {
        if (window.unionBotAPI) {
          loadRoomsForProject(selectedProjectId).then(() => {
            setActiveRoomId(targetRoomId);
            setActiveView('chat');
          });
        } else {
          setActiveRoomId(targetRoomId);
          setActiveView('chat');
        }
      }
    };
    window.addEventListener('union-bot:select-room', handleSelectRoomEvent);
    return () => window.removeEventListener('union-bot:select-room', handleSelectRoomEvent);
  }, [selectedProjectId]);

  // 2. Load Room History when active room changes
  useEffect(() => {
    if (window.unionBotAPI && activeRoomId) {
      window.unionBotAPI.getRoomHistory(activeRoomId).then((history) => {
        setRoomEnvelopes((prev) => ({
          ...prev,
          [activeRoomId]: history || [],
        }));
      });

      const unsubscribe = window.unionBotAPI.onEnvelopeReceived((env: EnvelopeView) => {
        if (env && env.roomId) {
          appendOrUpdateEnvelope(env.roomId, env);
        }
      });

      return unsubscribe;
    }
  }, [activeRoomId]);

  const activeRoom = rooms.find((r) => r.id === activeRoomId) || rooms[0] || { id: 'default', name: 'General' };
  const currentEnvelopes = roomEnvelopes[activeRoomId] || [];

  const handleCreateRoom = async (id: string, name: string): Promise<boolean> => {
    if (window.unionBotAPI && typeof window.unionBotAPI.createRoom === 'function') {
      try {
        const res = await window.unionBotAPI.createRoom({ id, name, projectId: selectedProjectId });
        if (res && res.success && res.room) {
          setRooms((prev) => {
            if (prev.some((r) => r.id === res.room!.id)) return prev;
            return [...prev, res.room!];
          });
          setActiveRoomId(res.room.id);
          setActiveView('chat');
          return true;
        }
        return false;
      } catch (err) {
        console.error('[App] Failed to create room:', err);
        return false;
      }
    } else {
      const newRoom: RoomInfo = { id, name, description: 'Local room' };
      setRooms((prev) => [...prev, newRoom]);
      setActiveRoomId(id);
      setActiveView('chat');
      return true;
    }
  };

  // Project CRUD Handlers (UB-P3-R01-002)
  const handleCreateProject = async (name: string, description?: string, workspaceRoot?: string): Promise<boolean> => {
    if (window.unionBotAPI && typeof window.unionBotAPI.createProject === 'function') {
      try {
        const res = await window.unionBotAPI.createProject({ name, description, workspaceRoot });
        if (res && res.success && res.project) {
          await loadProjects();
          setSelectedProjectId(res.project.id);
          return true;
        }
        return false;
      } catch (err) {
        console.error('[App] Failed to create project:', err);
        return false;
      }
    } else {
      const newP: ProjectInfo = { id: `proj_${Date.now()}`, name, description, workspaceRoot };
      setProjects((prev) => [...prev, newP]);
      setSelectedProjectId(newP.id);
      return true;
    }
  };

  const handleRenameProject = async (id: string, newName: string): Promise<boolean> => {
    if (window.unionBotAPI && typeof window.unionBotAPI.renameProject === 'function') {
      try {
        const res = await window.unionBotAPI.renameProject(id, newName);
        if (res && res.success) {
          await loadProjects();
          return true;
        }
        return false;
      } catch (err) {
        console.error('[App] Failed to rename project:', err);
        return false;
      }
    } else {
      setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name: newName } : p)));
      return true;
    }
  };

  const handleArchiveProject = async (id: string) => {
    if (window.unionBotAPI && typeof window.unionBotAPI.archiveProject === 'function') {
      try {
        const res = await window.unionBotAPI.archiveProject(id);
        if (res && res.success) {
          await loadProjects();
          setSelectedProjectId('default');
        }
      } catch (err) {
        console.error('[App] Failed to archive project:', err);
      }
    } else {
      setProjects((prev) => prev.filter((p) => p.id !== id));
      setSelectedProjectId('default');
    }
  };

  const handleSendMessage = async (rawText: string, attachments?: AttachmentInfo[]): Promise<boolean> => {
    let text = rawText;
    const trimmed = (rawText || '').trim();

    // Check for slash command escaping: //cmd -> literal /cmd
    if (trimmed.startsWith('//')) {
      text = trimmed.slice(1);
    } else if (trimmed.startsWith('/') && (!attachments || attachments.length === 0)) {
      const match = trimmed.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
      if (match) {
        const cmd = match[1].toLowerCase();

        if (cmd === 'chat') {
          setWorkspaceMode('discovery');
          setIsDiscoveryOpen(true);
          appendOrUpdateEnvelope(activeRoomId, {
            id: `sys_${Date.now()}_chat`,
            traceId: `trc_${Date.now()}`,
            timestamp: Date.now(),
            sender: { kind: 'agent', id: 'chatgpt_web', name: 'ChatGPT Web (BA)', role: 'LEADER' },
            recipient: { kind: 'room', id: activeRoomId },
            roomId: activeRoomId,
            fidelity: 'L1_FORMATTED_MARKDOWN',
            parts: [{ kind: 'text', text: '💡 **[CHẾ ĐỘ /chat KÍCH HOẠT]** Đã bật Discovery Ledger. Tôi đang lắng nghe yêu cầu bài toán từ bạn để hoàn thiện đặc tả kỹ thuật trước khi thực thi.' }],
          });
          return true;
        }

        if (cmd === 'work') {
          const openBlocking = discoveryQuestions.filter((q) => !q.resolved && q.blocking);
          if (discoveryFacts.length === 0 || openBlocking.length > 0) {
            appendOrUpdateEnvelope(activeRoomId, {
              id: `sys_${Date.now()}_work_err`,
              traceId: `trc_${Date.now()}`,
              timestamp: Date.now(),
              sender: { kind: 'agent', id: 'system_router', name: 'System / Router', role: 'ROUTER' },
              recipient: { kind: 'room', id: activeRoomId },
              roomId: activeRoomId,
              fidelity: 'L1_FORMATTED_MARKDOWN',
              parts: [{ kind: 'text', text: `⚠️ **[TỪ CHỐI /work] DiscoveryReadyGate:**\n${openBlocking.length > 0 ? `- Còn ${openBlocking.length} câu hỏi quan trọng cần xác nhận.\n` : ''}${discoveryFacts.length === 0 ? '- Chưa có yêu cầu nào được chốt (Confirmed Facts = 0).\n' : ''}Vui lòng tiếp tục thảo luận ở \`/chat\` hoặc xác nhận trong panel bên phải.` }],
            });
            return true;
          }

          setWorkspaceMode('work');
          setIsDiscoveryOpen(false);
          appendOrUpdateEnvelope(activeRoomId, {
            id: `sys_${Date.now()}_work_ok`,
            traceId: `trc_${Date.now()}`,
            timestamp: Date.now(),
            sender: { kind: 'agent', id: 'system_router', name: 'System / Router', role: 'ROUTER' },
            recipient: { kind: 'room', id: activeRoomId },
            roomId: activeRoomId,
            fidelity: 'L1_FORMATTED_MARKDOWN',
            parts: [{ kind: 'text', text: `🚀 **[CHẾ ĐỘ THỰC THI /work KÍCH HOẠT]**\nĐã xác nhận **${discoveryFacts.length} facts**. Sẵn sàng nhận nhiệm vụ hoặc bắt đầu kế hoạch.` }],
          });
          return true;
        }

        if (cmd === 'status') {
          appendOrUpdateEnvelope(activeRoomId, {
            id: `sys_${Date.now()}_status`,
            traceId: `trc_${Date.now()}`,
            timestamp: Date.now(),
            sender: { kind: 'agent', id: 'system_router', name: 'System / Router', role: 'ROUTER' },
            recipient: { kind: 'room', id: activeRoomId },
            roomId: activeRoomId,
            fidelity: 'L1_FORMATTED_MARKDOWN',
            parts: [{
              kind: 'text',
              text: `📊 **[TRẠNG THÁI HỆ THỐNG]**\n- **Chế độ hiện tại:** \`${workspaceMode.toUpperCase()}\`\n- **Dự án:** \`${selectedProjectId}\`\n- **Confirmed Facts:** ${discoveryFacts.filter(f => f.state === 'CONFIRMED').length}\n- **Open Questions:** ${discoveryQuestions.filter(q => !q.resolved).length} (${discoveryQuestions.filter(q => !q.resolved && q.blocking).length} blocking)\n- **Pending Approvals:** ${pendingApprovalsCount}\n- **Chi phí phát sinh:** **0 VNĐ (CostGuard Active)**`,
            }],
          });
          return true;
        }

        if (cmd === 'help') {
          appendOrUpdateEnvelope(activeRoomId, {
            id: `sys_${Date.now()}_help`,
            traceId: `trc_${Date.now()}`,
            timestamp: Date.now(),
            sender: { kind: 'agent', id: 'system_router', name: 'System / Router', role: 'ROUTER' },
            recipient: { kind: 'room', id: activeRoomId },
            roomId: activeRoomId,
            fidelity: 'L1_FORMATTED_MARKDOWN',
            parts: [{
              kind: 'text',
              text: `ℹ️ **[DANH SÁCH LỆNH SLASH V4]**\n- \`/chat\`: Bật chế độ Khám phá & Làm rõ Yêu cầu (Discovery) cùng Business Analyst.\n- \`/work\`: Chuyển sang chế độ Thực thi mục tiêu (yêu cầu vượt qua DiscoveryReadyGate).\n- \`/status\`: Xem tóm tắt hiện trạng dự án, facts và câu hỏi tồn đọng.\n- \`/pause\` / \`/resume\` / \`/stop\`: Điều khiển nhịp độ thực thi.\n- \`/help\`: Hiển thị hướng dẫn này.\n\n*Mẹo:* Gõ \`//lệnh\` để gửi văn bản thông thường không kích hoạt lệnh (ví dụ \`//chat\`).`,
            }],
          });
          return true;
        }

        if (['pause', 'resume', 'stop'].includes(cmd)) {
          appendOrUpdateEnvelope(activeRoomId, {
            id: `sys_${Date.now()}_ctl`,
            traceId: `trc_${Date.now()}`,
            timestamp: Date.now(),
            sender: { kind: 'agent', id: 'system_router', name: 'System / Router', role: 'ROUTER' },
            recipient: { kind: 'room', id: activeRoomId },
            roomId: activeRoomId,
            fidelity: 'L1_FORMATTED_MARKDOWN',
            parts: [{ kind: 'text', text: `⏸️ Lệnh \`/${cmd}\` đã được ghi nhận vào nhật ký điều phối.` }],
          });
          return true;
        }
      }
    }

    const traceId = `trc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const parts: MessagePart[] = [{ kind: 'text', text }];

    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        parts.push({
          kind: 'artifact',
          filename: att.filename,
          sha256: att.sha256,
          mimeType: att.mimeType,
          sizeBytes: att.sizeBytes,
          dataUrl: att.dataUrl,
        });
      }
    }

    const newEnvelope: EnvelopeView = {
      id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      traceId,
      timestamp: Date.now(),
      sender: {
        kind: 'user',
        id: 'user_local',
        name: 'User (You)',
        role: 'USER',
      },
      recipient: {
        kind: 'room',
        id: activeRoomId,
      },
      roomId: activeRoomId,
      fidelity: attachments && attachments.length > 0 ? 'L2_STANDALONE_ARTIFACT' : 'L0_RAW_TEXT',
      isDemo: isDemoMode,
      parts,
    };

    if (window.unionBotAPI) {
      try {
        const dispatchResult = await window.unionBotAPI.dispatchEnvelope(newEnvelope);
        if (!dispatchResult || !dispatchResult.success) {
          console.error('[App] Failed to dispatch envelope via IPC:', dispatchResult?.error);
          alert(`Lỗi lưu trữ / Orchestrator: ${dispatchResult?.error || 'Unknown IPC Error'} (P3-C03: Bản nháp được bảo toàn)`);
          return false;
        }
        appendOrUpdateEnvelope(activeRoomId, newEnvelope);
        return true;
      } catch (err) {
        console.error('[App] IPC exception during dispatch:', err);
        alert('Lỗi kết nối bộ lưu trữ SQLite. Bản nháp tin nhắn được giữ nguyên.');
        return false;
      }
    } else {
      appendOrUpdateEnvelope(activeRoomId, newEnvelope);
      return true;
    }
  };

  return (
    <div className={`workspace-layout ${theme === 'light' ? 'theme-light' : ''}`}>
      {/* Storage Offline Error Alert Banner (P3-C03) */}
      {storageStatus === 'STORAGE_ERROR_BLOCKED' && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, background: 'var(--accent-red)', color: '#fff', padding: '8px 16px', fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between', zIndex: 9999 }}>
          <span>⚠️ Storage Engine Error: {storageError || 'SQLite worker terminated'}. Mutation dispatch is fail-closed.</span>
          <button onClick={() => window.location.reload()} style={{ background: '#fff', color: '#000', border: 'none', borderRadius: 3, padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}>
            Reload Core
          </button>
        </div>
      )}

      <Sidebar
        rooms={rooms}
        activeRoomId={activeRoomId}
        onSelectRoom={setActiveRoomId}
        agents={agents}
        activeView={activeView}
        onSelectView={setActiveView}
        pendingApprovalsCount={pendingApprovalsCount}
        onOpenCreateRoom={() => setIsCreateRoomOpen(true)}
        onOpenPreferences={() => setIsPreferencesOpen(true)}
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelectProject={setSelectedProjectId}
        onOpenCreateProject={() => {
          setEditingProject(null);
          setIsCreateProjectOpen(true);
        }}
        onOpenEditProject={(p) => {
          setEditingProject(p);
          setIsCreateProjectOpen(true);
        }}
        onArchiveProject={handleArchiveProject}
        theme={theme === 'light' ? 'light' : 'dark'}
        onToggleTheme={toggleTheme}
      />

      <div className="workspace-main-area" style={{ display: 'flex', flex: 1, overflow: 'hidden', minWidth: 0, height: '100%' }}>
        <main className="main-content" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Header
            room={activeRoom}
            isDemoMode={isDemoMode}
            isBrowserOpen={isBrowserOpen}
            onToggleBrowser={() => setIsBrowserOpen((prev) => !prev)}
            workspaceMode={workspaceMode}
            isDiscoveryOpen={isDiscoveryOpen}
            onToggleDiscovery={() => setIsDiscoveryOpen((prev) => !prev)}
          />

          {activeView === 'chat' && (
            <ChatRoom
              roomName={activeRoom?.name}
              envelopes={currentEnvelopes}
              onSendMessage={handleSendMessage}
            />
          )}

          {activeView === 'approvals' && (
            <ApprovalInbox onTokenStatusChanged={refreshApprovalsCount} />
          )}

          {activeView === 'tasks' && (
            <TasksInbox
              activeProject={projects.find((p) => p.id === selectedProjectId) || null}
              activeRoomId={activeRoomId}
            />
          )}
        </main>

        {activeView === 'chat' && isDiscoveryOpen && (
          <DiscoveryPanel
            projectId={selectedProjectId}
            facts={discoveryFacts}
            questions={discoveryQuestions}
            onConfirmFact={handleConfirmFact}
            onResolveQuestion={handleResolveQuestion}
            onSwitchToWork={handleSwitchToWork}
          />
        )}

        <BrowserPanel
          isOpen={isBrowserOpen}
          onClose={() => setIsBrowserOpen(false)}
          activeRoomId={activeRoomId}
        />
      </div>

      <CreateRoomModal
        isOpen={isCreateRoomOpen}
        onClose={() => setIsCreateRoomOpen(false)}
        onCreateRoom={handleCreateRoom}
      />

      <CreateProjectModal
        isOpen={isCreateProjectOpen}
        onClose={() => {
          setIsCreateProjectOpen(false);
          setEditingProject(null);
        }}
        onCreateProject={handleCreateProject}
        onRenameProject={handleRenameProject}
        editingProject={editingProject}
      />

      <PreferencesModal
        isOpen={isPreferencesOpen}
        onClose={() => setIsPreferencesOpen(false)}
        theme={theme}
        onThemeChange={setTheme}
      />
    </div>
  );
};
