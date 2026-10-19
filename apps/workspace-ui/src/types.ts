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
  description?: string;
  unreadCount?: number;
  created_at?: string;
  updated_at?: string;
}

export interface AttachmentInfo {
  filename: string;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  casPath?: string;
  dataUrl?: string;
}

export interface MessagePart {
  kind: 'text' | 'code' | 'artifact' | 'action' | 'status' | 'attachment';
  text?: string;
  code?: string;
  content?: string;
  language?: string;
  filename?: string;
  sha256?: string;
  mimeType?: string;
  sizeBytes?: number;
  dataUrl?: string;
  tool?: string;
  status?: string;
  level?: string;
  message?: string;
}

export interface EnvelopeView {
  id: string;
  traceId: string;
  timestamp: number;
  sender: {
    kind: 'user' | 'agent' | 'system';
    id: string;
    name: string;
    role?: string;
    provider?: string;
  };
  recipient: {
    kind: 'room' | 'agent' | 'all';
    id: string;
  };
  roomId: string;
  parts: MessagePart[];
  fidelity: string;
  isDemo?: boolean;
}

export interface ApprovalTokenRecord {
  token_id: string;
  action_type: string;
  payload_digest: string;
  payload_json?: string;
  payload?: any;
  origin: string;
  workspace_id?: string;
  room_id?: string;
  actor_id?: string;
  recipient?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONSUMED' | 'EXPIRED';
  created_at: string;
  expires_at: string;
  approver_id?: string;
  approved_at?: string;
  rejected_at?: string;
  rejection_reason?: string;
  consumed_at?: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
  archived?: number;
}

export interface TaskItem {
  id: string;
  title: string;
  name?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number;
  room_id?: string;
  role?: string;
  step?: number;
  retries?: number;
  created_at?: string;
  updated_at?: string;
  updatedAt?: string;
  metadata_json?: string;
  metadata?: any;
}

export interface UnionBotAPI {
  isElectron: boolean;
  version: string;
  dispatchEnvelope: (envelope: any) => Promise<{ success: boolean; envelopeId?: string; deduplicated?: boolean; error?: string; code?: string }>;
  getRoomHistory: (roomId: string) => Promise<EnvelopeView[]>;
  getProjects: (options?: { includeArchived?: boolean }) => Promise<ProjectInfo[]>;
  createProject: (payload: { id?: string; name: string; description?: string }) => Promise<{ success: boolean; project?: ProjectInfo; error?: string }>;
  renameProject: (id: string, newName: string) => Promise<{ success: boolean; result?: any; error?: string }>;
  archiveProject: (id: string) => Promise<{ success: boolean; result?: any; error?: string }>;
  deleteProject: (id: string) => Promise<{ success: boolean; result?: any; error?: string }>;
  getRooms: (options?: { projectId?: string } | string) => Promise<RoomInfo[]>;
  createRoom: (roomData: { id: string; name: string; projectId?: string }) => Promise<{ success: boolean; room?: RoomInfo; error?: string }>;
  listTasks: (options?: { status?: string; roomId?: string; limit?: number }) => Promise<TaskItem[]>;
  createTask: (taskData: { title: string; status?: string; progress?: number; roomId?: string; metadata?: any }) => Promise<{ success: boolean; task?: TaskItem; error?: string }>;
  updateTask: (taskId: string, updates: { status?: string; progress?: number; metadata?: any }) => Promise<{ success: boolean; result?: any; error?: string }>;
  getStorageDiagnostics: () => Promise<any>;
  listApprovals: (options?: { limit?: number }) => Promise<ApprovalTokenRecord[]>;
  createApprovalToken: (tokenData: any) => Promise<{ success: boolean; token?: ApprovalTokenRecord; error?: string }>;
  computeActionDigest: (input: any) => Promise<{ success: boolean; digest?: string; semanticInput?: any; error?: string }>;
  approveToken: (tokenId: string | { tokenId: string; decisionContext?: any }, decisionContext?: any) => Promise<{ success: boolean; error?: string; code?: string }>;
  rejectApproval: (tokenId: string, reason?: string) => Promise<{ success: boolean; tokenId?: string; error?: string }>;
  saveAttachment: (payload: { filename: string; mimeType?: string; dataBase64?: string; textContent?: string }) => Promise<{ success: boolean; attachment?: AttachmentInfo; error?: string }>;
  readAttachment: (sha256: string) => Promise<{ success: boolean; sha256?: string; dataBase64?: string; sizeBytes?: number; error?: string }>;
  openFileDialog: () => Promise<{ success: boolean; canceled?: boolean; attachment?: AttachmentInfo; error?: string }>;
  exportWorkspace: (options?: any) => Promise<{ success: boolean; exportJson?: string; exportMarkdown?: string; projectCount?: number; roomCount?: number; taskCount?: number; totalEnvelopes?: number; error?: string }>;
  getAppStatus: () => Promise<{ status: string; error: string | null }>;
  onEnvelopeReceived: (callback: (envelope: EnvelopeView) => void) => () => void;
  onAppStatusChanged: (callback: (status: { status: string; error: string | null }) => void) => () => void;
  testKillWorker?: () => Promise<any>;
  testSetConfirmationMode?: (mode: string) => Promise<any>;
}

declare global {
  interface Window {
    unionBotAPI?: UnionBotAPI;
  }
}
