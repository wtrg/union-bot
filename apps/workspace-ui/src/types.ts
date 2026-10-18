export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  provider: string;
  status: 'active' | 'ready' | 'auth_required' | 'standby';
}

export interface RoomInfo {
  id: string;
  name: string;
  description: string;
  unreadCount?: number;
}

export interface MessagePart {
  kind: 'text' | 'code' | 'artifact' | 'action' | 'status';
  text?: string;
  code?: string;
  language?: string;
  filename?: string;
  sha256?: string;
  mimeType?: string;
  sizeBytes?: number;
  tool?: string;
  status?: string;
  level?: string;
  message?: string;
}

export interface EnvelopeView {
  id: string;
  timestamp: number;
  sender: {
    id: string;
    name: string;
    role?: string;
    provider?: string;
  };
  roomId: string;
  parts: MessagePart[];
  fidelity: string;
  isDemo?: boolean;
}
