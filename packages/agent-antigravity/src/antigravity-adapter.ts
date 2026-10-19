/**
 * @file antigravity-adapter.ts
 * @description High-level Antigravity Protocol Adapter for Union Bot (Phase P7 - Tickets P7-005, P7-007, P7-008).
 *
 * Integrates:
 * - AntigravityClient stdio execution & mock testing.
 * - CostGuard $0.00 Zero-Cost enforcement.
 * - ArtifactStore Content-Addressable Storage (CAS) with full provenance.
 * - Canonical workspace boundary checking.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { AntigravityDiscovery, type AntigravityDiscoveryResult } from './antigravity-discovery.ts';
import { AntigravityClient, type AntigravityTurnResult, type AntigravityTransport } from './antigravity-client.ts';
import { CostGuard } from '../../cost-guard/src/index.ts';
import { ArtifactStore, type ArtifactFidelity, type ArtifactProvenance } from '../../artifact-store/src/index.ts';

export interface AntigravityExecuteParams {
  prompt: string;
  workspaceRoot: string;
  targetDir?: string;
  customExecutablePath?: string;
  conversationId?: string;
  forbiddenFlags?: string[];
  mockTransport?: AntigravityTransport;
}

export interface AntigravityExecuteResult {
  success: boolean;
  provider: 'antigravity';
  conversationId: string;
  response: string;
  durationSeconds: number;
  cost: number;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  artifact?: {
    sha256: string;
    byteSize: number;
    filename: string;
  };
  error?: string;
}

export class AntigravityAdapter {
  private costGuard: CostGuard;
  private artifactStore: ArtifactStore;
  private client: AntigravityClient;

  constructor(costGuard?: CostGuard, artifactStore?: ArtifactStore) {
    this.costGuard = costGuard || new CostGuard();
    this.artifactStore = artifactStore || new ArtifactStore(path.join(os.tmpdir(), 'union-bot-artifacts'));
    this.client = new AntigravityClient();
  }

  /**
   * Discovers the local Antigravity binary.
   */
  public discover(customPath?: string): AntigravityDiscoveryResult {
    return AntigravityDiscovery.discover(customPath);
  }

  /**
   * Executes a turn under canonical workspace containment and zero-cost policy.
   */
  public async execute(params: AntigravityExecuteParams): Promise<AntigravityExecuteResult> {
    const { prompt, workspaceRoot, targetDir, customExecutablePath, conversationId, forbiddenFlags, mockTransport } = params;

    // 1. Boundary Defense (P7-004)
    const effectiveDir = targetDir || workspaceRoot;
    if (!AntigravityClient.verifyWorkspaceBoundary(workspaceRoot, effectiveDir)) {
      return {
        success: false,
        provider: 'antigravity',
        conversationId: conversationId || 'unassigned',
        response: '',
        durationSeconds: 0,
        cost: 0,
        tokens: { input: 0, output: 0, total: 0 },
        error: `ERR_PATH_TRAVERSAL: Target directory escapes canonical workspace boundary: ${effectiveDir}`,
      };
    }

    // 2. Discover Binary
    const discovery = this.discover(customExecutablePath);
    if (!discovery.available || !discovery.executablePath) {
      if (!mockTransport) {
        return {
          success: false,
          provider: 'antigravity',
          conversationId: conversationId || 'unassigned',
          response: '',
          durationSeconds: 0,
          cost: 0,
          tokens: { input: 0, output: 0, total: 0 },
          error: discovery.error || 'ERR_ANTIGRAVITY_NOT_INSTALLED',
        };
      }
    }

    // 3. Zero-Cost Enforcement (P7-008)
    const isPaidApiAllowed = typeof this.costGuard.isUrlAllowed === 'function'
      ? this.costGuard.isUrlAllowed('https://generativelanguage.googleapis.com')
      : false;
    if (isPaidApiAllowed) {
      return {
        success: false,
        provider: 'antigravity',
        conversationId: conversationId || 'unassigned',
        response: '',
        durationSeconds: 0,
        cost: 0,
        tokens: { input: 0, output: 0, total: 0 },
        error: 'ERR_COST_GUARD_VIOLATION: Paid API egress was not fail-closed',
      };
    }

    // 4. Execute Turn
    const execPath = discovery.executablePath || 'agy';
    try {
      const turnResult: AntigravityTurnResult = await this.client.executeTurn(
        execPath,
        prompt,
        {
          cwd: effectiveDir,
          conversationId,
          forbiddenFlags,
        },
        mockTransport
      );

      // 5. Artifact Provenance & CAS Storage (P7-007)
      let artifactInfo: { sha256: string; byteSize: number; filename: string } | undefined;

      if (turnResult.response && turnResult.response.trim().length > 0) {
        const responseBuffer = Buffer.from(turnResult.response, 'utf8');
        const filename = `antigravity-response-${Date.now()}.md`;
        const fidelity: ArtifactFidelity = 'original_bytes';
        const provenance: ArtifactProvenance = {
          sourceActor: 'antigravity',
          provider: 'antigravity',
          turnId: turnResult.conversationId,
          captureMethod: 'auto_captured',
          timestamp: new Date().toISOString(),
        };

        const stored = this.artifactStore.storeBytes(
          responseBuffer,
          'text/markdown',
          fidelity,
          provenance,
          filename
        );

        artifactInfo = {
          sha256: stored.sha256,
          byteSize: stored.byteSize,
          filename: stored.originalFilename || filename,
        };
      }

      return {
        success: turnResult.status === 'SUCCESS',
        provider: 'antigravity',
        conversationId: turnResult.conversationId,
        response: turnResult.response,
        durationSeconds: turnResult.durationSeconds,
        cost: 0, // Zero Cost
        tokens: {
          input: turnResult.usage.inputTokens,
          output: turnResult.usage.outputTokens,
          total: turnResult.usage.totalTokens,
        },
        artifact: artifactInfo,
        error: turnResult.status !== 'SUCCESS' ? `ANTIGRAVITY_TURN_${turnResult.status}` : undefined,
      };
    } catch (err: any) {
      return {
        success: false,
        provider: 'antigravity',
        conversationId: conversationId || 'unassigned',
        response: '',
        durationSeconds: 0,
        cost: 0,
        tokens: { input: 0, output: 0, total: 0 },
        error: err.message || String(err),
      };
    }
  }

  public cancel(): void {
    this.client.cancel();
  }

  public getClient(): AntigravityClient {
    return this.client;
  }
}
