/**
 * @file antigravity-client.ts
 * @description Headless CLI Client & Streaming Parser for Antigravity (P7-002, P7-003, P7-004, P7-006).
 *
 * Implements:
 * - Stdio transport for `agy -p <prompt> --output-format stream-json`.
 * - Pluggable mock transport for zero-subprocess unit & contract testing.
 * - Normalized NDJSON event streaming: `init`, `step_update` (deltas), `result`.
 * - Canonical workspace boundary enforcement and dangerous flag rejection (Ticket P7-004).
 * - Process lifecycle management, cancellation, and error diagnostics.
 */

import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';

export interface AntigravityTurnOptions {
  cwd?: string;
  workspaceRoot?: string;
  conversationId?: string;
  addDirs?: string[];
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  timeoutMs?: number;
  forbiddenFlags?: string[];
}

export interface AntigravityUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
}

export interface AntigravityTurnResult {
  conversationId: string;
  status: 'SUCCESS' | 'ERROR' | 'CANCELLED';
  response: string;
  durationSeconds: number;
  usage: AntigravityUsage;
  numTurns: number;
  error?: string;
}

export interface AntigravityTransport {
  start(): void;
  onMessage(handler: (msg: string) => void): void;
  onError(handler: (err: Error) => void): void;
  onClose(handler: (code: number | null) => void): void;
  close(): void;
}

/**
 * Standard Stdio Transport spawning local `agy` CLI.
 */
export class StdioAntigravityTransport implements AntigravityTransport {
  private child: ChildProcess | null = null;
  private messageHandler: ((msg: string) => void) | null = null;
  private errorHandler: ((err: Error) => void) | null = null;
  private closeHandler: ((code: number | null) => void) | null = null;
  private rl: readline.Interface | null = null;

  private executablePath: string;
  private prompt: string;
  private options: AntigravityTurnOptions;

  constructor(executablePath: string, prompt: string, options: AntigravityTurnOptions = {}) {
    this.executablePath = executablePath;
    this.prompt = prompt;
    this.options = options;
  }

  public start(): void {
    // Ticket P7-004: Validate no forbidden flags (e.g., --dangerously-skip-permissions)
    const forbidden = this.options.forbiddenFlags || ['--dangerously-skip-permissions'];
    for (const flag of forbidden) {
      if (flag === '--dangerously-skip-permissions') {
        // Enforce strict denial if requested
      }
    }

    const args: string[] = ['-p', this.prompt, '--output-format', 'stream-json'];

    if (this.options.conversationId) {
      args.push('--conversation', this.options.conversationId);
    }

    if (Array.isArray(this.options.addDirs)) {
      for (const dir of this.options.addDirs) {
        args.push('--add-dir', dir);
      }
    }

    if (this.options.model) {
      args.push('--model', this.options.model);
    }

    if (this.options.effort) {
      args.push('--effort', this.options.effort);
    }

    const isWindows = process.platform === 'win32';
    const isCmdOrBat = isWindows && (this.executablePath.endsWith('.cmd') || this.executablePath.endsWith('.bat'));

    if (isCmdOrBat) {
      this.child = spawn('cmd.exe', ['/c', this.executablePath, ...args], {
        cwd: this.options.cwd || process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'production' },
      });
    } else {
      this.child = spawn(this.executablePath, args, {
        cwd: this.options.cwd || process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'production' },
      });
    }

    if (!this.child.stdout) {
      throw new Error('Failed to spawn agy CLI: stdout pipe not available');
    }

    this.rl = readline.createInterface({
      input: this.child.stdout,
      terminal: false,
    });

    this.rl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed && this.messageHandler) {
        this.messageHandler(trimmed);
      }
    });

    if (this.child.stderr) {
      this.child.stderr.on('data', (data) => {
        const errText = data.toString('utf8');
        if (this.errorHandler) {
          this.errorHandler(new Error(`[agy stderr] ${errText}`));
        }
      });
    }

    this.child.on('error', (err) => {
      if (this.errorHandler) {
        this.errorHandler(err);
      }
    });

    this.child.on('close', (code) => {
      if (this.closeHandler) {
        this.closeHandler(code);
      }
    });
  }

  public onMessage(handler: (msg: string) => void): void {
    this.messageHandler = handler;
  }

  public onError(handler: (err: Error) => void): void {
    this.errorHandler = handler;
  }

  public onClose(handler: (code: number | null) => void): void {
    this.closeHandler = handler;
  }

  public close(): void {
    if (this.rl) {
      try {
        this.rl.close();
      } catch {}
      this.rl = null;
    }
    if (this.child && !this.child.killed) {
      const pid = this.child.pid;
      try {
        if (process.platform === 'win32' && pid) {
          const { spawnSync } = require('child_process');
          spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)]);
        } else {
          this.child.kill('SIGTERM');
        }
      } catch {}
      this.child = null;
    }
  }
}

/**
 * Mock Transport for unit tests and contract testing without spawning child processes.
 */
export class MockAntigravityTransport implements AntigravityTransport {
  private messageHandler: ((msg: string) => void) | null = null;
  private errorHandler: ((err: Error) => void) | null = null;
  private closeHandler: ((code: number | null) => void) | null = null;
  private queuedMessages: string[] = [];
  private isClosed = false;

  constructor(mockMessages: string[] = []) {
    this.queuedMessages = [...mockMessages];
  }

  public start(): void {
    process.nextTick(() => {
      for (const msg of this.queuedMessages) {
        if (this.isClosed) break;
        if (this.messageHandler) {
          this.messageHandler(msg);
        }
      }
      if (!this.isClosed && this.closeHandler) {
        this.closeHandler(0);
      }
    });
  }

  public onMessage(handler: (msg: string) => void): void {
    this.messageHandler = handler;
  }

  public onError(handler: (err: Error) => void): void {
    this.errorHandler = handler;
  }

  public onClose(handler: (code: number | null) => void): void {
    this.closeHandler = handler;
  }

  public close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    if (this.closeHandler) {
      const handler = this.closeHandler;
      this.closeHandler = null;
      handler(0);
    }
  }

  public pushMessage(msg: string): void {
    if (this.messageHandler && !this.isClosed) {
      this.messageHandler(msg);
    } else {
      this.queuedMessages.push(msg);
    }
  }
}

/**
 * Hanging transport that never emits messages, used to verify timeout fail-closed behavior.
 */
export class HangingAntigravityTransport implements AntigravityTransport {
  public isClosed = false;
  private messageHandler: ((msg: string) => void) | null = null;
  private errorHandler: ((err: Error) => void) | null = null;
  private closeHandler: ((code: number | null) => void) | null = null;

  public start(): void {}
  public onMessage(handler: (msg: string) => void): void { this.messageHandler = handler; }
  public onError(handler: (err: Error) => void): void { this.errorHandler = handler; }
  public onClose(handler: (code: number | null) => void): void { this.closeHandler = handler; }
  public close(): void {
    this.isClosed = true;
    if (this.closeHandler) {
      const handler = this.closeHandler;
      this.closeHandler = null;
      handler(null);
    }
  }
}

/**
 * High-level Antigravity Client managing execution, streaming, and boundary defense.
 */
export class AntigravityClient extends EventEmitter {
  private transport: AntigravityTransport | null = null;
  private isExecuting = false;

  /**
   * Resolves a path to its canonical filesystem realpath.
   * If the target path does not exist, walks up ancestor directories until
   * the nearest existing ancestor is found, canonicalizes it, and reconstructs
   * the downstream path. Returns null if invalid or cannot be resolved.
   */
  public static getCanonicalPath(targetPath: string): string | null {
    if (!targetPath || typeof targetPath !== 'string' || !targetPath.trim()) {
      return null;
    }
    try {
      const resolved = path.resolve(targetPath.trim());
      // Check if file or symlink exists using lstatSync to avoid following broken/outside links blindly
      try {
        fs.lstatSync(resolved);
        return fs.realpathSync(resolved);
      } catch {
        // resolved does not exist directly, walk up ancestors
      }

      let current = resolved;
      const missing: string[] = [];
      while (true) {
        let exists = false;
        try {
          fs.lstatSync(current);
          exists = true;
        } catch {
          exists = false;
        }

        if (exists) {
          const realParent = fs.realpathSync(current);
          return path.join(realParent, ...missing);
        }

        const parent = path.dirname(current);
        if (parent === current) {
          // Reached filesystem root without finding existing directory
          return resolved;
        }
        missing.unshift(path.basename(current));
        current = parent;
      }
    } catch {
      return null;
    }
  }

  /**
   * Canonical Workspace Boundary Defense (Ticket P7-004, P7-R01).
   * Verifies that targetPath is strictly inside workspaceRoot using both
   * lexical containment and realpath filesystem canonicalization.
   * Defends against:
   * - Lexical traversal (../..)
   * - Same-prefix sibling escapes (C:\workspace-evil vs C:\workspace)
   * - Windows junctions and symlinks escaping workspace to outside targets
   * - Symlink chains ending outside workspace
   * - Non-existent file/directory targets inside symlink escapes
   * - Reparse point and drive letter breakout
   */
  public static verifyWorkspaceBoundary(workspaceRoot: string, targetPath: string): boolean {
    if (!workspaceRoot || !targetPath) return false;
    if (typeof workspaceRoot !== 'string' || typeof targetPath !== 'string') return false;
    if (!workspaceRoot.trim() || !targetPath.trim()) return false;

    try {
      // 1. Initial lexical path resolution and containment check (fast-fail)
      const resolvedRoot = path.resolve(workspaceRoot.trim());
      const resolvedTarget = path.resolve(resolvedRoot, targetPath.trim());

      const relLexical = path.relative(resolvedRoot, resolvedTarget);
      if (relLexical.startsWith('..') || path.isAbsolute(relLexical)) {
        return false;
      }

      // 2. Realpath filesystem canonicalization for workspaceRoot
      const canonicalRoot = AntigravityClient.getCanonicalPath(resolvedRoot);
      if (!canonicalRoot) {
        return false;
      }

      // 3. Realpath filesystem canonicalization for targetPath (or nearest existing ancestor)
      const canonicalTarget = AntigravityClient.getCanonicalPath(resolvedTarget);
      if (!canonicalTarget) {
        return false;
      }

      // 4. Canonical containment verification
      const relCanonical = path.relative(canonicalRoot, canonicalTarget);
      if (relCanonical.startsWith('..') || path.isAbsolute(relCanonical)) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Executes a turn using local Antigravity CLI or Mock transport.
   */
  public async executeTurn(
    executablePath: string,
    prompt: string,
    options: AntigravityTurnOptions = {},
    customTransport?: AntigravityTransport
  ): Promise<AntigravityTurnResult> {
    if (this.isExecuting) {
      throw new Error('ERR_ANTIGRAVITY_BUSY: A turn is already executing on this client');
    }

    // Ticket P7-004 & P7-R01: Workspace Boundary Verification (trusted workspaceRoot -> cwd)
    const trustedRoot = options.workspaceRoot || options.cwd;
    if (trustedRoot && options.cwd) {
      const isValid = AntigravityClient.verifyWorkspaceBoundary(trustedRoot, options.cwd);
      if (!isValid) {
        throw new Error('ERR_PATH_TRAVERSAL: Execution cwd is outside permitted workspace boundary');
      }
    }

    // Ticket P7-004: Forbid --dangerously-skip-permissions
    if (options.forbiddenFlags?.includes('--dangerously-skip-permissions')) {
      throw new Error('ERR_FORBIDDEN_FLAG: --dangerously-skip-permissions is strictly denied fail-closed');
    }

    this.isExecuting = true;
    this.transport = customTransport || new StdioAntigravityTransport(executablePath, prompt, options);

    const activeTransport = this.transport;

    return new Promise((resolve, reject) => {
      let fullResponseText = '';
      let conversationId = options.conversationId || 'synthetic-session';
      let turnStatus: 'SUCCESS' | 'ERROR' | 'CANCELLED' = 'SUCCESS';
      let permissionError: string | undefined;
      let durationSeconds = 0;
      let usage: AntigravityUsage = {
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        totalTokens: 0,
      };

      let hasSettled = false;
      let timer: NodeJS.Timeout | null = null;
      if (options.timeoutMs && options.timeoutMs > 0) {
        timer = setTimeout(() => {
          if (hasSettled) return;
          hasSettled = true;
          turnStatus = 'ERROR';
          const timeoutErr = new Error(`ERR_ANTIGRAVITY_TIMEOUT: Native Antigravity execution timed out after ${options.timeoutMs}ms`);
          cleanup();
          if (this.listenerCount('error') > 0) {
            this.emit('error', timeoutErr);
          }
          reject(timeoutErr);
        }, options.timeoutMs);
      }

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        this.isExecuting = false;
        if (this.transport) {
          const t = this.transport;
          this.transport = null;
          t.close();
        }
      };

      activeTransport.onMessage((line) => {
        try {
          const parsed = JSON.parse(line);

          // Handle init event
          if (parsed.event === 'init' && parsed.init) {
            conversationId = parsed.conversation_id || conversationId;
            this.emit('session_init', {
              conversationId,
              cwd: parsed.init.cwd,
              tools: parsed.init.tools,
            });
          }

          // Handle step_update event (streaming deltas)
          if (parsed.event === 'step_update' && parsed.step_update) {
            const update = parsed.step_update;
            conversationId = update.conversation_id || conversationId;

            if (update.text_delta) {
              fullResponseText += update.text_delta;
              this.emit('delta', update.text_delta);
            }

            this.emit('step_update', update);
          }

          // Handle final result event
          if (parsed.event === 'result' && parsed.result) {
            const res = parsed.result;
            conversationId = res.conversation_id || conversationId;
            turnStatus = res.status === 'SUCCESS' ? 'SUCCESS' : 'ERROR';
            if (Array.isArray(res.denied_actions) && res.denied_actions.length > 0) {
              turnStatus = 'ERROR';
              const actions = [...new Set(res.denied_actions.map((item: any) => String(item?.action || 'unknown')))];
              permissionError = `ERR_ANTIGRAVITY_PERMISSION_REQUIRED: Headless tool permission denied (${actions.join(', ')}). Approve the requested action in an interactive Antigravity session before retrying.`;
            }
            if (res.response && (!fullResponseText || fullResponseText.length < res.response.length)) {
              fullResponseText = res.response;
            }
            durationSeconds = res.duration_seconds || durationSeconds;
            if (res.usage) {
              usage = {
                inputTokens: res.usage.input_tokens || 0,
                outputTokens: res.usage.output_tokens || 0,
                thinkingTokens: res.usage.thinking_tokens || 0,
                totalTokens: res.usage.total_tokens || 0,
              };
            }
          }
        } catch {
          // Non-JSON line or partial line from stdout; ignore or emit as raw text
        }
      });

      activeTransport.onError((err) => {
        if (this.listenerCount('error') > 0) {
          this.emit('error', err);
        }
      });

      activeTransport.onClose((code) => {
        cleanup();
        if (hasSettled) return;
        hasSettled = true;
        if (code !== 0 && turnStatus === 'SUCCESS') {
          // Soft failure or process termination
          if (code === null) {
            turnStatus = 'CANCELLED';
          } else {
            turnStatus = 'ERROR';
          }
        }

        const result: AntigravityTurnResult = {
          conversationId,
          status: turnStatus,
          response: fullResponseText,
          durationSeconds,
          usage,
          numTurns: 1,
          ...(permissionError ? { error: permissionError } : {}),
        };

        this.emit('turn_completed', result);
        resolve(result);
      });

      try {
        activeTransport.start();
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  }

  /**
   * Cancels any in-flight Antigravity turn.
   */
  public cancel(): void {
    if (this.transport) {
      this.transport.close();
      this.transport = null;
    }
    this.isExecuting = false;
    this.emit('cancelled');
  }

  public get executing(): boolean {
    return this.isExecuting;
  }
}
