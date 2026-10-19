/**
 * Types and interfaces for Union Bot Embedded Chromium & Browser Session Manager
 * Fulfills Phase P4 specification (Master Plan V3 tickets P4-001 to P4-012)
 */

export type ProviderId = 'chatgpt' | 'gemini' | 'claude' | 'deepseek' | 'search' | 'custom';

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
