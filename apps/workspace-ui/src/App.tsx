import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar.tsx';
import { Header } from './components/Header.tsx';
import { ChatRoom } from './components/ChatRoom.tsx';
import { AgentInfo, RoomInfo, EnvelopeView } from './types.ts';

declare global {
  interface Window {
    unionBotAPI?: {
      dispatchEnvelope: (envelope: any) => Promise<any>;
      getRoomHistory: (roomId: string) => Promise<any[]>;
      onEnvelopeReceived: (callback: (envelope: any) => void) => () => void;
      isElectron: boolean;
    };
  }
}

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

const INITIAL_DEMO_ENVELOPES: Record<string, EnvelopeView[]> = {
  orchestration: [
    {
      id: 'demo_env_001',
      timestamp: Date.now() - 3600000,
      sender: { id: 'chatgpt_web', name: 'ChatGPT Web', role: 'LEADER', provider: 'chatgpt' },
      roomId: 'orchestration',
      fidelity: 'L1_FORMATTED_MARKDOWN',
      isDemo: true,
      parts: [
        {
          kind: 'text',
          text: 'Directive R05: GO_P1 officially issued. All team members proceed with Wave 2 Desktop & UI Foundation under strict Zero-Cost (0đ) and no-leak policies.',
        },
      ],
    },
    {
      id: 'demo_env_002',
      timestamp: Date.now() - 1800000,
      sender: { id: 'antigravity', name: 'Antigravity', role: 'IMPLEMENTER', provider: 'antigravity' },
      roomId: 'orchestration',
      fidelity: 'L1_FORMATTED_MARKDOWN',
      isDemo: true,
      parts: [
        {
          kind: 'text',
          text: 'Wave 1 security preflight completed. Proceeding with @union-bot/protocol, @union-bot/orchestrator, and Electron single-instance desktop shell.',
        },
        {
          kind: 'code',
          language: 'typescript',
          filename: 'admission-gate.ts',
          code: 'export class AdmissionPolicyGate {\n  public readonly paidApiEnabled: boolean = false;\n  // Denies any paid API or unknown action\n}',
        },
      ],
    },
    {
      id: 'demo_env_003',
      timestamp: Date.now() - 900000,
      sender: { id: 'codex', name: 'Codex', role: 'QA_SECURITY', provider: 'codex' },
      roomId: 'orchestration',
      fidelity: 'L2_STANDALONE_ARTIFACT',
      isDemo: true,
      parts: [
        {
          kind: 'text',
          text: 'Security verification suite executed: 47 unit tests pass 100%, 0 secret leaks detected across 708 files.',
        },
        {
          kind: 'artifact',
          filename: 'verification_summary.json',
          sha256: '7a19283746501928374650192837465019283746501928374650192837465019',
          mimeType: 'application/json',
          sizeBytes: 2048,
        },
      ],
    },
  ],
  'agent-dev': [
    {
      id: 'demo_dev_001',
      timestamp: Date.now() - 600000,
      sender: { id: 'antigravity', name: 'Antigravity', role: 'IMPLEMENTER', provider: 'antigravity' },
      roomId: 'agent-dev',
      fidelity: 'L1_FORMATTED_MARKDOWN',
      isDemo: true,
      parts: [
        {
          kind: 'text',
          text: 'Desktop app scaffolding initiated with Electron 33, contextIsolation: true, sandbox: true, safeOpenExternal URL protection.',
        },
      ],
    },
  ],
  'qa-audit': [
    {
      id: 'demo_qa_001',
      timestamp: Date.now() - 300000,
      sender: { id: 'codex', name: 'Codex', role: 'QA_SECURITY', provider: 'codex' },
      roomId: 'qa-audit',
      fidelity: 'L1_FORMATTED_MARKDOWN',
      isDemo: true,
      parts: [
        {
          kind: 'text',
          text: 'Codex RPC harness hardened with direct argv execution (shell=False) and recursive PII scrubbing.',
        },
        {
          kind: 'action',
          tool: 'scan_secrets',
          status: 'completed',
        },
      ],
    },
  ],
  'review-briefing': [
    {
      id: 'demo_rev_001',
      timestamp: Date.now() - 120000,
      sender: { id: 'chatgpt_web', name: 'ChatGPT Web', role: 'LEADER', provider: 'chatgpt' },
      roomId: 'review-briefing',
      fidelity: 'L0_RAW_TEXT',
      isDemo: true,
      parts: [
        {
          kind: 'text',
          text: 'Standing by for Review Packet P1 R01 dossier and Windows GUI smoke evidence.',
        },
      ],
    },
  ],
};

export const App: React.FC = () => {
  const [activeRoomId, setActiveRoomId] = useState<string>('orchestration');
  const [roomEnvelopes, setRoomEnvelopes] = useState<Record<string, EnvelopeView[]>>(INITIAL_DEMO_ENVELOPES);
  const [isDemoMode, setIsDemoMode] = useState<boolean>(true);

  useEffect(() => {
    if (window.unionBotAPI) {
      setIsDemoMode(false);
      window.unionBotAPI.getRoomHistory(activeRoomId).then((history) => {
        if (history && history.length > 0) {
          setRoomEnvelopes((prev) => ({
            ...prev,
            [activeRoomId]: history,
          }));
        }
      });
    }
  }, [activeRoomId]);

  const activeRoom = INITIAL_ROOMS.find((r) => r.id === activeRoomId);
  const currentEnvelopes = roomEnvelopes[activeRoomId] || [];

  const handleSendMessage = async (text: string) => {
    const newEnvelope: EnvelopeView = {
      id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      sender: {
        id: 'user_local',
        name: 'User (You)',
        role: 'USER',
      },
      roomId: activeRoomId,
      fidelity: 'L0_RAW_TEXT',
      isDemo: isDemoMode,
      parts: [{ kind: 'text', text }],
    };

    if (window.unionBotAPI) {
      try {
        await window.unionBotAPI.dispatchEnvelope(newEnvelope);
      } catch (err) {
        console.error('Failed to dispatch envelope via IPC:', err);
      }
    }

    setRoomEnvelopes((prev) => ({
      ...prev,
      [activeRoomId]: [...(prev[activeRoomId] || []), newEnvelope],
    }));
  };

  return (
    <div className="workspace-layout">
      <Sidebar
        rooms={INITIAL_ROOMS}
        activeRoomId={activeRoomId}
        onSelectRoom={setActiveRoomId}
        agents={INITIAL_AGENTS}
      />
      <main className="main-content">
        <Header room={activeRoom} isDemoMode={isDemoMode} />
        <ChatRoom
          envelopes={currentEnvelopes}
          onSendMessage={handleSendMessage}
        />
      </main>
    </div>
  );
};
