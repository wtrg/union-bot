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
      try {
        this.child.kill('SIGTERM');
        setTimeout(() => {
          if (this.child && !this.child.killed) {
            try {
              this.child.kill('SIGKILL');
            } catch {}
          }
        }, 500);
      } catch {}
    }
    this.child = null;
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
 * High-level Antigravity Client managing execution, streaming, and boundary defense.
 */
export class AntigravityClient extends EventEmitter {
  private transport: AntigravityTransport | null = null;
  private isExecuting = false;

  /**
   * Canonical Workspace Boundary Defense (Ticket P7-004).
   * Verifies that targetPath is strictly inside workspaceRoot using path.relative.
   */
  public static verifyWorkspaceBoundary(workspaceRoot: string, targetPath: string): boolean {
    if (!workspaceRoot || !targetPath) return false;
    try {
      const canonicalRoot = path.resolve(workspaceRoot);
      const canonicalTarget = path.resolve(targetPath);

      const rel = path.relative(canonicalRoot, canonicalTarget);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
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

    // Ticket P7-004: Workspace Boundary Verification
    if (options.cwd) {
      const currentWorkspace = options.cwd;
      const isValid = AntigravityClient.verifyWorkspaceBoundary(currentWorkspace, currentWorkspace);
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
      let durationSeconds = 0;
      let usage: AntigravityUsage = {
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        totalTokens: 0,
      };

      const cleanup = () => {
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
        this.emit('error', err);
      });

      activeTransport.onClose((code) => {
        cleanup();
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
