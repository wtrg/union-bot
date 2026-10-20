export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  provider: string;
  status: 'active' | 'ready' | 'auth_required' | 'standby' | 'idle' | 'free_local' | 'ready_manual' | 'unavailable_in_session' | 'challenge_required' | string;
  badge?: string;
  details?: string;
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
  kind: 'text' | 'code' | 'artifact' | 'action' | 'status' | 'attachment' | 'diff' | 'test_result';
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
  args?: any;
  output?: any;
  mcpData?: any;
  diff?: string;
  testResult?: {
    passed: boolean;
    suiteName: string;
    total: number;
    passedCount: number;
    failedCount: number;
    durationMs?: number;
  };
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
  canonicalization_version?: number;
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
  workspaceRoot?: string;
  workspace_root?: string;
  created_at?: string;
  updated_at?: string;
  archived?: number;
}

export interface TaskExecutionResult {
  success: boolean;
  output?: string;
  artifactPath?: string;
  digest?: string;
  bytesWritten?: number;
  verifiedByCodex?: boolean;
  verificationEvidence?: any;
  provider?: string;
  role?: string;
  completedAt?: number;
  logs?: string[];
  error?: string;
}

export interface TaskMetadata {
  role?: string;
  provider?: string;
  createdVia?: string;
  startedAt?: number;
  completedAt?: number;
  statusMessage?: string;
  executionResult?: TaskExecutionResult;
  error?: string;
  [key: string]: any;
}

export interface TaskItem {
  id: string;
  title: string;
  name?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'cancel_requested' | 'blocked' | 'waiting_input';
  progress?: number;
  room_id?: string;
  role?: string;
  step?: number;
  retries?: number;
  created_at?: string;
  updated_at?: string;
  updatedAt?: string;
  metadata_json?: string;
  metadata?: TaskMetadata;
}

export interface UnionBotAPI {
  isElectron: boolean;
  version: string;
  dispatchEnvelope: (envelope: any) => Promise<{ success: boolean; envelopeId?: string; deduplicated?: boolean; error?: string; code?: string }>;
  getRoomHistory: (roomId: string) => Promise<EnvelopeView[]>;
  getProjects: (options?: { includeArchived?: boolean }) => Promise<ProjectInfo[]>;
  createProject: (payload: { id?: string; name: string; description?: string; workspaceRoot?: string; workspace_root?: string }) => Promise<{ success: boolean; project?: ProjectInfo; error?: string }>;
  selectDirectory?: (options?: { title?: string; defaultPath?: string }) => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>;
  renameProject: (id: string, newName: string) => Promise<{ success: boolean; result?: any; error?: string }>;
  archiveProject: (id: string) => Promise<{ success: boolean; result?: any; error?: string }>;
  deleteProject: (id: string) => Promise<{ success: boolean; result?: any; error?: string }>;
  getRooms: (options?: { projectId?: string } | string) => Promise<RoomInfo[]>;
  createRoom: (roomData: { id: string; name: string; projectId?: string }) => Promise<{ success: boolean; room?: RoomInfo; error?: string }>;
  listTasks: (options?: { status?: string; roomId?: string; limit?: number }) => Promise<TaskItem[]>;
  createTask: (taskData: { title: string; status?: string; progress?: number; roomId?: string; metadata?: any }) => Promise<{ success: boolean; task?: TaskItem; error?: string }>;
  updateTask: (taskId: string, updates: { status?: string; progress?: number; metadata?: any }) => Promise<{ success: boolean; result?: any; error?: string }>;
  executeTask: (payload: { taskId: string; workspaceRoot?: string }) => Promise<{ success: boolean; taskId?: string; status?: TaskItem['status']; executionResult?: TaskExecutionResult; error?: string }>;
  cancelTask: (payload: { taskId: string }) => Promise<{ success: boolean; taskId?: string; status?: TaskItem['status']; error?: string }>;
  onTaskUpdated?: (callback: (data: { taskId: string; status?: TaskItem['status']; progress?: number; error?: string; metadata?: any }) => void) => () => void;
  getStorageDiagnostics: () => Promise<any>;
  listApprovals: (options?: { limit?: number }) => Promise<ApprovalTokenRecord[]>;
  createApprovalToken: (tokenData: any) => Promise<{ success: boolean; token?: ApprovalTokenRecord; error?: string }>;
  computeActionDigest: (input: any) => Promise<{ success: boolean; digest?: string; semanticInput?: any; error?: string }>;
  approveToken: (tokenId: string | { tokenId: string; decisionContext?: any }, decisionContext?: any) => Promise<{ success: boolean; error?: string; code?: string }>;
  rejectApproval: (tokenId: string, reason?: string) => Promise<{ success: boolean; tokenId?: string; error?: string }>;
  saveAttachment: (payload: { filename: string; mimeType?: string; dataBase64?: string; textContent?: string }) => Promise<{ success: boolean; attachment?: AttachmentInfo; error?: string }>;
  // Phase V4: Goal-Driven Multi-Agent API (UB-V4-U01, U02, U03)
  getDiscoveryState?: (projectId: string) => Promise<{ success: boolean; session?: any; facts: RequirementFactInfo[]; questions: OpenQuestionInfo[] }>;
  saveRequirementFact?: (fact: any) => Promise<{ success: boolean; error?: string }>;
  saveOpenQuestion?: (question: any) => Promise<{ success: boolean; error?: string }>;
  resolveOpenQuestion?: (payload: { id: string; resolution: string }) => Promise<{ success: boolean; error?: string }>;
  checkDiscoveryReady?: (discoveryId?: string) => Promise<{ ready: boolean; reason?: string; blockingQuestions?: string[]; briefDigest?: string; factCount?: number; error?: string }>;
  compactDiscoveryContext?: (discoveryId?: string) => Promise<{ facts: any[]; openQuestions: any[]; digest: string; error?: string }>;
  getCapabilities?: () => Promise<{ success: boolean; capabilities?: any; agents?: AgentInfo[]; error?: string }>;
  probeCapability?: (providerId: string) => Promise<{ success: boolean; capability?: any; error?: string }>;
  listGoals?: (projectId: string) => Promise<GoalInfo[]>;
  saveGoal?: (goal: any) => Promise<{ success: boolean; error?: string }>;
  approvePlanRevision?: (payload: any) => Promise<{ success: boolean; error?: string }>;
  listMilestones?: (goalId: string) => Promise<MilestoneInfo[]>;
  listActivityEvents?: (payload: { projectId: string; goalId?: string }) => Promise<ActivityEventInfo[]>;
  readAttachment: (sha256: string) => Promise<{ success: boolean; sha256?: string; dataBase64?: string; sizeBytes?: number; error?: string }>;
  openFileDialog: () => Promise<{ success: boolean; canceled?: boolean; attachment?: AttachmentInfo; error?: string }>;
  exportWorkspace: (options?: any) => Promise<{ success: boolean; exportJson?: string; exportMarkdown?: string; projectCount?: number; roomCount?: number; taskCount?: number; totalEnvelopes?: number; error?: string }>;
  getAppStatus: () => Promise<{ status: string; error: string | null }>;
  onEnvelopeReceived: (callback: (envelope: EnvelopeView) => void) => () => void;
  onAppStatusChanged: (callback: (status: { status: string; error: string | null }) => void) => () => void;

  // Phase P4: Embedded Chromium Browser API
  browserGetState?: () => Promise<BrowserManagerState>;
  browserCreateTab?: (payload: { providerId: string; url?: string; title?: string }) => Promise<{ success: boolean; tab?: BrowserTabInfo; error?: string }>;
  browserCloseTab?: (tabId: string) => Promise<{ success: boolean; nextActiveTabId?: string | null; error?: string }>;
  browserSelectTab?: (tabId: string) => Promise<{ success: boolean }>;
  browserNavigate?: (payload: { tabId?: string; url: string }) => Promise<{ success: boolean; sanitizedUrl?: string; error?: string }>;
  browserPerformAction?: (payload: { tabId?: string; action: string }) => Promise<{ success: boolean; zoomFactor?: number; error?: string }>;
  browserSetBounds?: (bounds: { x: number; y: number; width: number; height: number }) => Promise<{ success: boolean }>;
  browserSetVisibility?: (visible: boolean) => Promise<{ success: boolean; isEffectiveVisible?: boolean }>;
  browserSetModalActive?: (active: boolean) => Promise<{ success: boolean; isEffectiveVisible?: boolean }>;
  browserShareSelection?: (payload: { tabId?: string; selectedText?: string; roomId?: string }) => Promise<{ success: boolean; envelope?: any; error?: string }>;
  onBrowserStateUpdated?: (callback: (state: BrowserManagerState) => void) => () => void;

  // Phase P5: Artifacts, Previews, Tool Host & MCP
  artifactSaveAs?: (payload: { sha256: string; suggestedName?: string }) => Promise<{ success: boolean; savedPath?: string; error?: string; canceled?: boolean }>;
  artifactShowInFolder?: (sha256: string) => Promise<{ success: boolean; path?: string; error?: string }>;
  artifactOpenOriginal?: (sha256: string) => Promise<{ success: boolean; path?: string; error?: string }>;
  artifactInspect?: (sha256: string) => Promise<{ success: boolean; artifact?: any; error?: string }>;
  toolHostExecute?: (payload: { command: string; args?: any[] }) => Promise<any>;
  mcpCall?: (payload: { toolName: string; args?: any }) => Promise<any>;
  mcpListTools?: () => Promise<{ success: boolean; tools: any[] }>;
  exportTranscriptBundle?: (options?: { roomId?: string; includeArtifacts?: boolean }) => Promise<any>;
  importTranscriptBundle?: (options?: { bundleDir: string; targetRoomId?: string }) => Promise<any>;

  testKillWorker?: () => Promise<any>;
  testSetConfirmationMode?: (mode: string) => Promise<any>;
  testTamperApprovalPayload?: (payload: any) => Promise<any>;
  testQueueAttachmentPath?: (filePath: string) => Promise<any>;
  testQueueSavePath?: (filePath: string) => Promise<any>;
  testGetExportFiles?: () => Promise<any>;
  testSetBrowserCookie?: (payload: any) => Promise<any>;
  testGetBrowserCookies?: (partition: string) => Promise<any>;
  testTriggerTabCrash?: (tabId?: string) => Promise<any>;
}

export interface BrowserTabInfo {
  id: string;
  providerId: 'chatgpt' | 'gemini' | 'claude' | 'deepseek' | 'search' | 'custom';
  title: string;
  url: string;
  partition: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  authStatus: 'READY_OR_LANDING' | 'LOGIN_REQUIRED' | 'AUTH_ERROR' | 'UNKNOWN';
  crashed: boolean;
  lastError: string | null;
  zoomFactor: number;
}

export interface BrowserManagerState {
  tabs: BrowserTabInfo[];
  activeTabId: string | null;
  bounds: { x: number; y: number; width: number; height: number };
  isVisible: boolean;
  isModalActive: boolean;
}

export interface RequirementFactInfo {
  id: string;
  discoveryId: string;
  projectId: string;
  key: string;
  value: string;
  sourceTurnRef: string;
  confidence: number;
  state: 'PROPOSED' | 'CONFIRMED' | 'REJECTED' | 'SUPERSEDED';
  confirmedBy?: string;
  createdAt: number;
  updatedAt: number;
}

export interface OpenQuestionInfo {
  id: string;
  discoveryId: string;
  requirementKey: string;
  question: string;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  blocking: boolean;
  resolved: boolean;
  resolution?: string;
  askedAt: number;
  resolvedAt?: number;
}

export interface GoalInfo {
  id: string;
  projectId: string;
  title: string;
  description: string;
  activePlanRevision: number;
  state: 'DRAFT' | 'DISCOVERY' | 'READY_FOR_PLAN' | 'PLAN_REVIEW' | 'AWAITING_OWNER_APPROVAL' | 'APPROVED' | 'RUNNING' | 'PAUSED_SAFE' | 'VERIFYING' | 'COMPLETED_VERIFIED' | 'BLOCKED' | 'CANCELLED';
  ownerApprovalRef?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MilestoneInfo {
  id: string;
  goalId: string;
  planRevision: number;
  order: number;
  title: string;
  dependsOn: string[];
  state: 'PENDING' | 'READY' | 'RUNNING' | 'VERIFYING' | 'VERIFIED' | 'BLOCKED' | 'FAILED';
  evidenceRefs: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ActivityEventInfo {
  id: string;
  projectId: string;
  goalId?: string;
  kind: string;
  summary: string;
  actor: { provider: string; role: string };
  source?: { eventId?: string; commitSHA?: string; threadRef?: string };
  references: string[];
  receiptState: 'UNVERIFIED' | 'ACKED' | 'VERIFIED';
  createdAt: number;
}

declare global {
  interface Window {
    unionBotAPI?: UnionBotAPI;
  }
}
