/**
 * Types and interfaces for Union Bot Embedded Chromium & Browser Session Manager
 * Fulfills Phase P4 specification (Master Plan V3 tickets P4-001 to P4-012)
 */

export type ProviderId = 'chatgpt' | 'gemini' | 'claude' | 'deepseek' | 'codex' | 'antigravity' | 'search' | 'custom';

export type AuthStatus = 'READY_OR_LANDING' | 'LOGIN_REQUIRED' | 'AUTH_ERROR' | 'UNKNOWN';

export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  partition: string;
  defaultUrl: string;
  approvedOrigin: string;
  authIndicatorHint?: {
    loginPathSubstrings?: string[];
    readyIndicators?: string[];
  };
}

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TabState {
  id: string;
  providerId: ProviderId;
  title: string;
  url: string;
  partition: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  authStatus: AuthStatus;
  crashed: boolean;
  lastError: string | null;
  zoomFactor: number;
  createdAt: number;
}

export type BrowserAction =
  | 'back'
  | 'forward'
  | 'reload'
  | 'stop'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset';

export interface BrowserSharePayload {
  selectedText?: string;
  pageUrl: string;
  pageTitle: string;
  providerId: ProviderId;
  roomId: string;
}

export interface BrowserManagerState {
  tabs: TabState[];
  activeTabId: string | null;
  bounds: BrowserBounds;
  isVisible: boolean;
  isModalActive: boolean;
}

// Phase P9: Web Provider Capabilities & Extensions
export interface WebProviderSession {
  sessionId: string;
  providerId: ProviderId;
  assignedRole: string; // 'LEADER' | 'RESEARCHER' | 'REVIEWER' | 'IMPLEMENTER' | 'TESTER' | 'QA_SECURITY' | 'ARCHITECT'
  partition: string;
  tabId: string;
  sessionNonce: string;
  authStatus: AuthStatus;
  threadId?: string;
  threadUrl?: string;
  isReopenable: boolean;
  createdAt: number;
  lastActive: number;
}

export type ProviderHealthStatus =
  | 'HEALTHY'
  | 'CHALLENGE_REQUIRED'
  | 'LOGIN_REQUIRED'
  | 'QUOTA_EXCEEDED'
  | 'SERVICE_UNAVAILABLE'
  | 'AUTOMATION_DISABLED';

export interface ProviderHealthCheckParams {
  providerId: ProviderId;
  tabId: string;
  url?: string;
  title?: string;
  bodySnippet?: string;
  statusCode?: number;
}

export interface ProviderHealthReport {
  providerId: ProviderId;
  tabId: string;
  status: ProviderHealthStatus;
  errorCode?: string;
  message?: string;
  details?: Record<string, unknown>;
  checkedAt: number;
}

export interface ThreadReference {
  providerId: ProviderId;
  threadId: string | null;
  canonicalUrl: string | null;
  isReopenable: boolean;
}

export interface FileShareOptions {
  tabId?: string;
  filePath: string;
  roomId?: string;
  workspaceRoot: string;
  allowedDownloadsDir?: string;
}

export interface FileShareResult {
  success: boolean;
  sha256?: string;
  sizeBytes?: number;
  mimeType?: string;
  filename?: string;
  envelope?: unknown;
  error?: string;
  code?: string;
}
