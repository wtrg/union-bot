export interface ControllerLeaseResult {
  success: boolean;
  tabId?: string;
  controllerId?: string;
  leaseToken?: string;
  expiresAt?: number;
  holder?: string;
  error?: string;
  code?: string;
}

export interface DomSnapshotResult {
  snapshotSha256: string;
  snapshot: {
    tabId: string;
    url: string;
    title: string;
    textSnippet: string;
    elementsCount: number;
    interactiveElements: Array<{
      id: string;
      tag: string;
      role: string;
      text: string;
      x: number;
      y: number;
      width: number;
      height: number;
      clickable: boolean;
    }>;
    viewport: { width: number; height: number };
    capturedAt: number;
    sanitized: boolean;
  };
}

export interface BrowserActionResult {
  success: boolean;
  actionType?: string;
  tabId?: string;
  executedAt?: number;
  target?: { x: number; y: number };
  length?: number;
  url?: string;
  key?: string;
  error?: string;
  code?: string;
}

export declare class BrowserUseBridge {
  constructor(options?: any);
  acquireControllerLease(tabId: string, controllerId: string): ControllerLeaseResult;
  renewControllerLease(tabId: string, leaseToken: string): { success: boolean; tabId?: string; expiresAt?: number; error?: string; code?: string };
  releaseControllerLease(tabId: string, leaseToken: string): boolean;
  verifyLease(tabId: string, leaseToken: string): boolean;
  redactSensitiveData(input: string): string;
  createSafeDomSnapshot(params: {
    tabId: string;
    url?: string;
    title?: string;
    rawDomText?: string;
    interactiveElements?: any[];
    viewport?: { width: number; height: number };
  }): DomSnapshotResult;
  executeAction(params: {
    tabId: string;
    leaseToken: string;
    actionType: 'click' | 'fill' | 'navigate' | 'pressKey';
    coordinates?: { x: number; y: number };
    text?: string;
    url?: string;
    viewport?: { width: number; height: number };
  }): BrowserActionResult;
}
