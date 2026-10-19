/**
 * @file codex-adapter.ts
 * @description Native Codex Agent Adapter for Union Bot (Phase P6 - Tickets P6-001 through P6-010).
 *
 * Enforces:
 * - P6-001: Local discovery with fail-closed missing executable handling.
 * - P6-002: Spawn `codex app-server --stdio` with JSON-RPC 2.0 handshake.
 * - P6-003: Thread and turn execution with bidirectional ID tracking.
 * - P6-004: Event streaming and completion verification.
 * - P6-005: Human approval token gating for tool executions.
 * - P6-006: Turn cancellation & child process lifecycle management.
 * - P6-007: Strict workspace boundary containment with path.relative check.
 * - P6-008: Artifact extraction and CAS hashing with agent provenance.
 * - P6-009: Strict zero-cost egress preservation ($0.00 / 0đ).
 */

import path from 'node:path';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { CodexDiscovery, type CodexDiscoveryResult } from './codex-discovery.ts';
import {
  CodexClient,
  StdioCodexTransport,
  MockCodexTransport,
  type CodexTransport,
  type CodexTurnResult,
} from './codex-client.ts';
import { CostGuard } from '../../cost-guard/src/index.ts';
import { ArtifactStore } from '../../artifact-store/src/index.ts';

export interface CodexAdapterOptions {
  workspaceRoot: string;
  customExecutablePath?: string;
  transport?: CodexTransport;
  costGuard?: CostGuard;
  artifactStore?: ArtifactStore;
  approvalValidator?: (token: any, command: string) => { valid: boolean; reason?: string };
}

export interface CodexExecutionOptions {
  threadId?: string;
  timeoutMs?: number;
  approvalToken?: any;
  onDelta?: (delta: string) => void;
}

export interface CodexExecutionResult {
  success: boolean;
  provider: 'codex';
  threadId: string;
  turnId: string;
  status: 'completed' | 'failed' | 'interrupted' | 'rejected';
  text: string;
  artifacts: Array<{ sha256: string; path?: string; mimeType?: string }>;
  costEstimate: 0;
  provenance: {
    originator: 'codex';
    workspace: string;
    completedAt: string;
  };
  error?: string;
}

export class CodexAdapter extends EventEmitter {
  public readonly workspaceRoot: string;
  public readonly discovery: CodexDiscoveryResult;
  private client: CodexClient | null = null;
  private costGuard: CostGuard;
  private artifactStore?: ArtifactStore;
  private approvalValidator?: (token: any, command: string) => { valid: boolean; reason?: string };

  constructor(options: CodexAdapterOptions) {
    super();
    if (!options.workspaceRoot || typeof options.workspaceRoot !== 'string') {
      throw new Error('CodexAdapter requires a valid workspaceRoot string');
    }
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.costGuard = options.costGuard || new CostGuard({ allowLocalhost: true });
    this.artifactStore = options.artifactStore;
    this.approvalValidator = options.approvalValidator;

    // 1. Discover local binary (P6-001)
    if (options.transport) {
      this.discovery = {
        available: true,
        executablePath: 'mock-transport',
        version: '0.162.1',
      };
      this.client = new CodexClient(options.transport);
      this.wireClientEvents(this.client);
    } else {
      this.discovery = CodexDiscovery.discover(options.customExecutablePath);
    }
  }

  private wireClientEvents(client: CodexClient): void {
    client.on('delta', (delta, params) => this.emit('delta', delta, params));
    client.on('turnStarted', (params) => this.emit('turnStarted', params));
    client.on('turnCompleted', (turn, params) => this.emit('turnCompleted', turn, params));
    client.on('error', (err) => this.emit('error', err));
    client.on('approvalRequested', (params) => this.handleApprovalRequest(params));
  }

  /**
   * Verifies that target path strictly remains within the approved workspace root (P6-007).
   */
  public verifyWorkspaceBoundary(targetPath: string): string {
    const resolved = path.resolve(this.workspaceRoot, targetPath);
    const rel = path.relative(this.workspaceRoot, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`ERR_PATH_TRAVERSAL: Working directory '${targetPath}' escapes workspace root '${this.workspaceRoot}'`);
    }

    if (fs.existsSync(resolved)) {
      const realResolved = fs.realpathSync(resolved);
      const realWorkspace = fs.realpathSync(this.workspaceRoot);
      const realRel = path.relative(realWorkspace, realResolved);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        throw new Error(`ERR_PATH_TRAVERSAL: Symlink target '${realResolved}' escapes workspace boundary`);
      }
      return realResolved;
    }

    return resolved;
  }

  /**
   * Initializes Codex client and performs handshake (P6-002).
   */
  public async ensureClient(): Promise<CodexClient> {
    if (this.client) return this.client;

    if (!this.discovery.available || !this.discovery.executablePath) {
      throw new Error(
        this.discovery.error ||
          'Codex executable is not available on this system. Phase P6 operating in documented disabled state.'
      );
    }

    // Verify Zero-Cost Egress constraint (P6-009)
    if (!this.costGuard.isUrlAllowed('http://localhost:8080')) {
      throw new Error('Zero-Cost Policy Violation: Local process communication disallowed');
    }

    const transport = new StdioCodexTransport(this.discovery.executablePath, ['app-server', '--stdio'], this.workspaceRoot);
    transport.start();

    this.client = new CodexClient(transport);
    this.wireClientEvents(this.client);

    await this.client.initialize('union-bot-codex-adapter', '1.0.0');
    return this.client;
  }

  /**
   * Handles tool approval notifications (P6-005).
   */
  private handleApprovalRequest(params: any): void {
    const { command, token } = params || {};
    if (!this.approvalValidator) {
      this.emit('approvalDenied', { reason: 'No approval validator configured in adapter', command });
      return;
    }

    const val = this.approvalValidator(token, command);
    if (!val.valid) {
      this.emit('approvalDenied', { reason: val.reason, command });
    } else {
      this.emit('approvalGranted', { command, token });
    }
  }

  /**
   * Executes a complete turn through the native Codex agent (P6-003, P6-004, P6-008).
   */
  public async executeTurn(prompt: string, options: CodexExecutionOptions = {}): Promise<CodexExecutionResult> {
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error('ERR_INVALID_PROMPT: Prompt must be a non-empty string');
    }

    const client = await this.ensureClient();

    // Ensure active thread scoped to approved workspace (P6-003, P6-007)
    let threadId = options.threadId || client.currentThreadId;
    if (!threadId) {
      this.verifyWorkspaceBoundary(this.workspaceRoot);
      threadId = await client.startThread({
        cwd: this.workspaceRoot,
        approvalPolicy: 'on-request',
      });
    }

    const turnRes: CodexTurnResult = await client.runTurn(prompt.trim(), {
      threadId,
      timeoutMs: options.timeoutMs || 45000,
      onDelta: options.onDelta,
    });

    // Extract artifacts and capture CAS provenance (P6-008)
    const artifacts: Array<{ sha256: string; path?: string; mimeType?: string }> = [];
    if (this.artifactStore && turnRes.text) {
      const turnBuffer = Buffer.from(turnRes.text, 'utf8');
      const meta = this.artifactStore.storeBytes(
        turnBuffer,
        'text/markdown',
        'original_bytes',
        {
          sourceActor: 'codex',
          provider: 'codex',
          turnId: turnRes.turnId,
          captureMethod: 'auto_captured',
          timestamp: new Date().toISOString(),
        },
        `codex_response_${Date.now()}.md`
      );
      artifacts.push({
        sha256: meta.sha256,
        path: meta.storedPath,
        mimeType: 'text/markdown',
      });
    }

    return {
      success: turnRes.status === 'completed',
      provider: 'codex',
      threadId,
      turnId: turnRes.turnId,
      status: turnRes.status,
      text: turnRes.text,
      artifacts,
      costEstimate: 0,
      provenance: {
        originator: 'codex',
        workspace: this.workspaceRoot,
        completedAt: new Date().toISOString(),
      },
      error: turnRes.error,
    };
  }

  /**
   * Cancels active turn (P6-006).
   */
  public async cancelActiveTurn(): Promise<void> {
    if (this.client) {
      await this.client.interruptTurn();
    }
  }

  /**
   * Shuts down Codex process cleanly.
   */
  public close(): void {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }
}
