/**
 * @file codex-client.ts
 * @description JSON-RPC 2.0 Client & Transport for Codex App Server (P6-002 through P6-006).
 *
 * Implements:
 * - Stdio transport for `codex app-server --stdio`.
 * - Pluggable mock transport for zero-subprocess unit & contract testing.
 * - Full handshake: `initialize` -> `initialized`.
 * - Multi-turn lifecycle: `thread/start`, `turn/start`, `turn/interrupt`.
 * - Event streaming: `turn/started`, `item/started`, `item/agentMessage/delta`, `item/completed`, `turn/completed`.
 * - Tool approval notification interception and fail-closed resolution.
 */

import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface CodexTransport {
  send(message: string): void;
  onMessage(handler: (msg: string) => void): void;
  onError(handler: (err: Error) => void): void;
  onClose(handler: (code: number | null) => void): void;
  close(): void;
}

/**
 * Standard Stdio Transport using ChildProcess.
 */
export class StdioCodexTransport implements CodexTransport {
  private child: ChildProcess | null = null;
  private messageHandler: ((msg: string) => void) | null = null;
  private errorHandler: ((err: Error) => void) | null = null;
  private closeHandler: ((code: number | null) => void) | null = null;
  private rl: readline.Interface | null = null;

  private executablePath: string;
  private args: string[];
  private cwd?: string;

  constructor(executablePath: string, args: string[] = ['app-server', '--stdio'], cwd?: string) {
    this.executablePath = executablePath;
    this.args = args;
    this.cwd = cwd;
  }

  public start(): void {
    const isWindows = process.platform === 'win32';
    const isCmdOrPs1 = isWindows && (this.executablePath.endsWith('.cmd') || this.executablePath.endsWith('.bat') || this.executablePath.endsWith('.ps1'));

    if (isCmdOrPs1) {
      this.child = spawn('cmd.exe', ['/c', this.executablePath, ...this.args], {
        cwd: this.cwd || process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'production' },
      });
    } else {
      this.child = spawn(this.executablePath, this.args, {
        cwd: this.cwd || process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'production' },
      });
    }

    if (!this.child.stdout || !this.child.stdin) {
      throw new Error('Failed to spawn Codex app-server: stdio pipes not available');
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

    this.child.on('error', (err) => {
      if (this.errorHandler) this.errorHandler(err);
    });

    this.child.on('close', (code) => {
      if (this.closeHandler) this.closeHandler(code);
    });
  }

  public send(message: string): void {
    if (!this.child || !this.child.stdin || this.child.stdin.destroyed) {
      throw new Error('Cannot send message: transport is closed or child process terminated');
    }
    this.child.stdin.write(message + '\n');
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
      this.rl.close();
      this.rl = null;
    }
    if (this.child) {
      try {
        this.child.kill('SIGTERM');
      } catch {}
      this.child = null;
    }
  }
}

/**
 * Mock Transport for deterministic unit & contract testing without spawning subprocesses.
 */
export class MockCodexTransport implements CodexTransport {
  private messageHandler: ((msg: string) => void) | null = null;
  private errorHandler: ((err: Error) => void) | null = null;
  private closeHandler: ((code: number | null) => void) | null = null;
  public sentMessages: string[] = [];
  public isClosed = false;

  public send(message: string): void {
    if (this.isClosed) throw new Error('Transport is closed');
    this.sentMessages.push(message);
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
    this.isClosed = true;
    if (this.closeHandler) this.closeHandler(0);
  }

  /**
   * Helper for tests to simulate incoming server JSON-RPC messages.
   */
  public simulateServerMessage(payload: any): void {
    if (this.messageHandler) {
      this.messageHandler(JSON.stringify(payload));
    }
  }
}

export interface CodexTurnResult {
  turnId: string;
  status: 'completed' | 'failed' | 'interrupted' | 'rejected';
  text: string;
  items: any[];
  error?: string;
  durationMs?: number;
}

export class CodexClient extends EventEmitter {
  private nextId = 1;
  private pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: Error) => void; timeout: NodeJS.Timeout }>();
  public isInitialized = false;
  public currentThreadId: string | null = null;
  public currentTurnId: string | null = null;
  public activeTurnStatus: 'idle' | 'in_progress' | 'completed' | 'failed' | 'interrupted' = 'idle';

  private transport: CodexTransport;

  constructor(transport: CodexTransport) {
    super();
    this.transport = transport;
    this.setupTransportListeners();
  }

  private setupTransportListeners(): void {
    this.transport.onMessage((rawMsg: string) => {
      try {
        const parsed = JSON.parse(rawMsg);
        this.handleIncomingMessage(parsed);
      } catch (err: any) {
        this.emit('protocolError', `Invalid JSON received: ${rawMsg}`);
      }
    });

    this.transport.onError((err) => {
      this.emit('error', err);
    });

    this.transport.onClose((code) => {
      this.isInitialized = false;
      this.activeTurnStatus = 'interrupted';
      // Reject any pending requests
      for (const [id, req] of this.pendingRequests.entries()) {
        clearTimeout(req.timeout);
        req.reject(new Error(`Codex process exited with code ${code} while waiting for response`));
      }
      this.pendingRequests.clear();
      this.emit('close', code);
    });
  }

  private handleIncomingMessage(msg: any): void {
    // 1. Response to a pending request
    if (typeof msg.id === 'number' && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      clearTimeout(pending.timeout);

      if (msg.error) {
        pending.reject(new Error(`JSON-RPC Error [${msg.error.code}]: ${msg.error.message}`));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // 2. Server notifications
    if (msg.method) {
      this.handleServerNotification(msg.method, msg.params);
    }
  }

  private handleServerNotification(method: string, params: any): void {
    this.emit('notification', { method, params });

    switch (method) {
      case 'turn/started': {
        this.activeTurnStatus = 'in_progress';
        if (params?.turn?.id) this.currentTurnId = params.turn.id;
        this.emit('turnStarted', params);
        break;
      }
      case 'item/started': {
        this.emit('itemStarted', params);
        break;
      }
      case 'item/agentMessage/delta': {
        const delta = params?.delta || '';
        this.emit('delta', delta, params);
        break;
      }
      case 'item/completed': {
        this.emit('itemCompleted', params?.item, params);
        break;
      }
      case 'turn/completed': {
        const status = params?.turn?.status || 'completed';
        this.activeTurnStatus = status === 'completed' ? 'completed' : 'failed';
        this.emit('turnCompleted', params?.turn, params);
        break;
      }
      case 'item/commandExecution/requestApproval': {
        this.emit('approvalRequested', params);
        break;
      }
      default:
        break;
    }
  }

  public request<T = any>(method: string, params: any = {}, timeoutMs = 30000): Promise<T> {
    const id = this.nextId++;
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request '${method}' timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout });
      try {
        this.transport.send(JSON.stringify(req));
      } catch (err: any) {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  public notify(method: string, params: any = {}): void {
    const notif: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this.transport.send(JSON.stringify(notif));
  }

  /**
   * Initializes session with Codex app-server (P6-002).
   */
  public async initialize(clientName = 'union-bot-agent', clientVersion = '1.0.0'): Promise<any> {
    const res = await this.request('initialize', {
      clientInfo: {
        name: clientName,
        version: clientVersion,
      },
    });
    this.notify('initialized', {});
    this.isInitialized = true;
    return res;
  }

  /**
   * Starts a new conversation thread on Codex (P6-003).
   */
  public async startThread(options: { cwd?: string; approvalPolicy?: string } = {}): Promise<string> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    const res = await this.request('thread/start', {
      cwd: options.cwd || process.cwd(),
      approvalPolicy: options.approvalPolicy || 'on-request',
    });

    const threadId = res?.thread?.id || res?.sessionId;
    if (!threadId) {
      throw new Error('Codex thread/start failed to return thread ID');
    }
    this.currentThreadId = threadId;
    return threadId;
  }

  /**
   * Executes a turn on Codex and waits for completion (P6-003, P6-004).
   */
  public async runTurn(
    prompt: string,
    options: { threadId?: string; timeoutMs?: number; onDelta?: (delta: string) => void } = {}
  ): Promise<CodexTurnResult> {
    const threadId = options.threadId || this.currentThreadId;
    if (!threadId) {
      throw new Error('No active thread. Call startThread() first.');
    }

    const timeoutMs = options.timeoutMs || 45000;
    let accumulatedText = '';
    const completedItems: any[] = [];

    return new Promise<CodexTurnResult>((resolve, reject) => {
      let isDone = false;

      const deltaListener = (delta: string) => {
        accumulatedText += delta;
        if (options.onDelta) options.onDelta(delta);
      };

      const itemListener = (item: any) => {
        if (item) {
          completedItems.push(item);
          if (item.type === 'agentMessage' && item.text && !accumulatedText) {
            accumulatedText = item.text;
          }
        }
      };

      const turnCompletedListener = (turn: any) => {
        if (isDone) return;
        isDone = true;
        cleanup();

        const status = turn?.status || 'completed';
        const finalItems = turn?.items || completedItems;
        const agentItem = finalItems.find((i: any) => i.type === 'agentMessage');
        const finalText = agentItem?.text || accumulatedText;

        resolve({
          turnId: turn?.id || this.currentTurnId || 'turn_completed',
          status,
          text: finalText,
          items: finalItems,
          error: turn?.error,
          durationMs: turn?.durationMs,
        });
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.removeListener('delta', deltaListener);
        this.removeListener('itemCompleted', itemListener);
        this.removeListener('turnCompleted', turnCompletedListener);
      };

      const timer = setTimeout(() => {
        if (isDone) return;
        isDone = true;
        cleanup();
        reject(new Error(`Turn execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.on('delta', deltaListener);
      this.on('itemCompleted', itemListener);
      this.on('turnCompleted', turnCompletedListener);

      // Start the turn
      this.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: prompt }],
      }).then((res) => {
        if (res?.turn?.id) {
          this.currentTurnId = res.turn.id;
        }
      }).catch((err) => {
        if (isDone) return;
        isDone = true;
        cleanup();
        reject(err);
      });
    });
  }

  /**
   * Interrupts/cancels an active turn (P6-006).
   */
  public async interruptTurn(threadId?: string, turnId?: string): Promise<any> {
    const targetThread = threadId || this.currentThreadId;
    const targetTurn = turnId || this.currentTurnId;
    if (!targetThread) throw new Error('No active thread to interrupt');

    return await this.request('turn/interrupt', {
      threadId: targetThread,
      turnId: targetTurn,
    });
  }

  /**
   * Closes the client and terminates underlying transport.
   */
  public close(): void {
    this.transport.close();
    this.isInitialized = false;
    this.activeTurnStatus = 'idle';
  }
}
