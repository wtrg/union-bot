/**
 * @file provider-session.ts
 * @description Authoritative Provider Session & Backend Identity Registry
 * Fulfills Phase P9 architectural requirement (Anti-spoofing, backend identity validation).
 */

import crypto from 'node:crypto';
import type { ProviderId, WebProviderSession, AuthStatus } from './types.ts';

export const DEFAULT_PROVIDER_ROLES: Record<string, string> = {
  chatgpt: 'LEADER',
  gemini: 'RESEARCHER',
  claude: 'REVIEWER',
  deepseek: 'REVIEWER',
  antigravity: 'IMPLEMENTER',
  codex: 'QA_SECURITY',
  search: 'USER',
  custom: 'USER',
};

export class ProviderSessionRegistry {
  private sessionsByTabId: Map<string, WebProviderSession> = new Map();
  private sessionsById: Map<string, WebProviderSession> = new Map();
  private sessionsByProvider: Map<string, WebProviderSession> = new Map();

  /**
   * Creates or registers an authentic backend provider session bound to a specific tab.
   * Generates a cryptographic nonce to prevent renderer session forging.
   */
  public createSession(params: {
    providerId: ProviderId;
    tabId: string;
    partition: string;
    assignedRole?: string;
    authStatus?: AuthStatus;
    threadId?: string;
    threadUrl?: string;
    isReopenable?: boolean;
  }): WebProviderSession {
    const { providerId, tabId, partition } = params;
    const now = Date.now();
    const sessionId = `wps_${providerId}_${crypto.randomBytes(6).toString('hex')}`;
    const sessionNonce = crypto.randomBytes(16).toString('hex');
    const role = params.assignedRole || DEFAULT_PROVIDER_ROLES[providerId] || 'USER';

    const session: WebProviderSession = {
      sessionId,
      providerId,
      assignedRole: role,
      partition,
      tabId,
      sessionNonce,
      authStatus: params.authStatus || 'UNKNOWN',
      threadId: params.threadId,
      threadUrl: params.threadUrl,
      isReopenable: Boolean(params.isReopenable),
      createdAt: now,
      lastActive: now,
    };

    this.sessionsByTabId.set(tabId, session);
    this.sessionsById.set(sessionId, session);
    this.sessionsByProvider.set(providerId, session);

    return session;
  }

  /**
   * Retrieves a session by tab ID
   */
  public getSessionByTab(tabId: string): WebProviderSession | null {
    return this.sessionsByTabId.get(tabId) || null;
  }

  /**
   * Retrieves a session by session ID
   */
  public getSessionById(sessionId: string): WebProviderSession | null {
    return this.sessionsById.get(sessionId) || null;
  }

  /**
   * Retrieves a session by provider ID
   */
  public getSessionByProvider(providerId: string): WebProviderSession | null {
    return this.sessionsByProvider.get(providerId) || null;
  }

  /**
   * Returns all active provider sessions
   */
  public getAllSessions(): WebProviderSession[] {
    return Array.from(this.sessionsById.values());
  }

  /**
   * Verifies that a given session ID and cryptographic nonce match an authentic backend session.
   */
  public verifySessionNonce(sessionId: string, sessionNonce: string): boolean {
    if (!sessionId || !sessionNonce) return false;
    const session = this.sessionsById.get(sessionId);
    if (!session) return false;
    return session.sessionNonce === sessionNonce;
  }

  /**
   * Validates sender identity claiming a role or provider.
   * Denies fail-closed if caller tries to self-declare unauthorized identities.
   */
  public validateSenderIdentity(params: {
    tabId?: string;
    sessionId?: string;
    claimedProvider?: string;
    claimedRole?: string;
  }): { valid: boolean; session?: WebProviderSession; error?: string; code?: string } {
    let session: WebProviderSession | undefined;

    if (params.tabId) {
      session = this.sessionsByTabId.get(params.tabId);
    } else if (params.sessionId) {
      session = this.sessionsById.get(params.sessionId);
    }

    if (!session) {
      return {
        valid: false,
        error: 'ERR_PROVIDER_SESSION_NOT_FOUND: No backend provider session bound to this caller.',
        code: 'ERR_PROVIDER_SESSION_NOT_FOUND',
      };
    }

    // Provider mismatch
    if (params.claimedProvider && params.claimedProvider !== session.providerId) {
      return {
        valid: false,
        error: `ERR_UNAUTHORIZED_ACTION: Claimed provider '${params.claimedProvider}' does not match session provider '${session.providerId}'.`,
        code: 'ERR_UNAUTHORIZED_ACTION',
      };
    }

    // Role mismatch
    if (params.claimedRole && params.claimedRole !== session.assignedRole) {
      return {
        valid: false,
        error: `ERR_ROLE_MISMATCH: Claimed role '${params.claimedRole}' does not match authoritative backend role '${session.assignedRole}'.`,
        code: 'ERR_ROLE_MISMATCH',
      };
    }

    session.lastActive = Date.now();
    return { valid: true, session };
  }

  /**
   * Updates session thread information and active status
   */
  public updateSession(
    sessionId: string,
    updates: Partial<Pick<WebProviderSession, 'authStatus' | 'threadId' | 'threadUrl' | 'isReopenable'>>
  ): WebProviderSession | null {
    const session = this.sessionsById.get(sessionId);
    if (!session) return null;

    Object.assign(session, updates, { lastActive: Date.now() });
    return session;
  }

  /**
   * Removes a session by tab ID
   */
  public removeSessionByTab(tabId: string): boolean {
    const session = this.sessionsByTabId.get(tabId);
    if (!session) return false;

    this.sessionsByTabId.delete(tabId);
    this.sessionsById.delete(session.sessionId);
    if (this.sessionsByProvider.get(session.providerId)?.sessionId === session.sessionId) {
      this.sessionsByProvider.delete(session.providerId);
    }
    return true;
  }

  public clear(): void {
    this.sessionsByTabId.clear();
    this.sessionsById.clear();
    this.sessionsByProvider.clear();
  }
}
