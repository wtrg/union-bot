import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar.tsx';
import { Header } from './components/Header.tsx';
import { ChatRoom } from './components/ChatRoom.tsx';
import { ApprovalInbox } from './components/ApprovalInbox.tsx';
import { TasksInbox } from './components/TasksInbox.tsx';
import { PreferencesModal } from './components/PreferencesModal.tsx';
import { CreateRoomModal } from './components/CreateRoomModal.tsx';
import { CreateProjectModal } from './components/CreateProjectModal.tsx';
import { AgentInfo, RoomInfo, EnvelopeView, AttachmentInfo, MessagePart, ProjectInfo } from './types.ts';

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
  { id: 'chatgpt_web', name: 'ChatGPT Web', role: 'Leader / Architect', provider: 'chatgpt', status: 'ready' },
  { id: 'antigravity', name: 'Antigravity', role: 'Implementer', provider: 'antigravity', status: 'active' },
  { id: 'codex', name: 'Codex', role: 'QA & Security', provider: 'codex', status: 'active' },
  { id: 'gemini_web', name: 'Gemini Web', role: 'Researcher', provider: 'gemini', status: 'ready' },
  { id: 'claude_web', name: 'Claude Web', role: 'Standby Member', provider: 'claude', status: 'auth_required' },
  { id: 'deepseek_web', name: 'DeepSeek Web', role: 'Standby Member', provider: 'deepseek', status: 'auth_required' },
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
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState<number>(0);
  const [isCreateRoomOpen, setIsCreateRoomOpen] = useState<boolean>(false);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState<boolean>(false);
  const [editingProject, setEditingProject] = useState<ProjectInfo | null>(null);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState<boolean>(false);
  const [storageStatus, setStorageStatus] = useState<string>('READY');
  const [storageError, setStorageError] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light' | 'high-contrast'>('dark');

  // Apply theme class to document body (UB-P3-R01-007)
  useEffect(() => {
    if (theme === 'light') {
      document.body.className = 'theme-light';
    } else {
      document.body.className = '';
    }
  }, [theme]);

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
      refreshApprovalsCount();

      const unsubStatus = window.unionBotAPI.onAppStatusChanged((s) => {
        if (s) {
          setStorageStatus(s.status);
          setStorageError(s.error);
        }
      });

      return unsubStatus;
    }
  }, []);

  // Reload rooms whenever selected project changes (UB-P3-R01-002)
  useEffect(() => {
    if (window.unionBotAPI) {
      loadRoomsForProject(selectedProjectId);
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
  const handleCreateProject = async (name: string, description?: string): Promise<boolean> => {
    if (window.unionBotAPI && typeof window.unionBotAPI.createProject === 'function') {
      try {
        const res = await window.unionBotAPI.createProject({ name, description });
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
      const newP: ProjectInfo = { id: `proj_${Date.now()}`, name, description };
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

  const handleSendMessage = async (text: string, attachments?: AttachmentInfo[]): Promise<boolean> => {
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
        agents={INITIAL_AGENTS}
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

      <main className="main-content">
        <Header room={activeRoom} isDemoMode={isDemoMode} />

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

        {activeView === 'tasks' && <TasksInbox />}
      </main>

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
