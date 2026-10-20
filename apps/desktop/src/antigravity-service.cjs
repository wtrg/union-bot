/**
 * @file antigravity-service.cjs
 * @description Desktop Main Process Service for Native Antigravity Agent (Phase P7).
 *
 * Integrates:
 * - P7-001: Local Antigravity CLI (agy) and version discovery.
 * - P7-002: Headless `agy -p` execution with stream-json delta forwarding.
 * - P7-003: Structured stdout parser & stderr diagnostics.
 * - P7-004: Canonical workspace boundary check with path.relative fail-closed.
 * - P7-005: Turn execution with Zero-Cost enforcement.
 * - P7-006: Turn cancellation & graceful subprocess termination.
 * - P7-007: CAS artifact registration with Antigravity agent provenance.
 * - P7-008: Strict zero-cost egress preservation ($0.00 / 0đ).
 */

const path = require('node:path');
const { EventEmitter } = require('node:events');

let AntigravityModules = null;
function getAntigravityModules() {
  if (AntigravityModules) return AntigravityModules;
  try {
    AntigravityModules = require('@union-bot/agent-antigravity');
  } catch {
    AntigravityModules = require('../../../packages/agent-antigravity/src/agent-antigravity.cjs');
  }
  return AntigravityModules;
}

class AntigravityService extends EventEmitter {
  constructor(workspaceRoot, artifactStore, costGuard) {
    super();
    this.workspaceRoot = path.resolve(workspaceRoot || process.cwd());
    this.artifactStore = artifactStore;
    this.costGuard = costGuard;
    this.adapter = null;
    this.cachedDiscovery = null;
    this.customTransport = null;
  }

  /**
   * Sets or clears a custom transport (e.g. for testing or mock execution).
   */
  setCustomTransport(transport) {
    if (this.adapter) {
      this.adapter.cancel();
      this.adapter = null;
    }
    this.customTransport = transport || null;
  }

  /**
   * Enables a deterministic mock transport for headless testing.
   */
  async enableMockTransport(mockMessages = []) {
    const { MockAntigravityTransport } = getAntigravityModules();
    this.mockMessages = Array.isArray(mockMessages) ? [...mockMessages] : (mockMessages?.messages || []);
    this.setCustomTransport(new MockAntigravityTransport(this.mockMessages));
    return true;
  }

  /**
   * Restores normal discovery and stdio transport.
   */
  disableMockTransport() {
    this.mockMessages = null;
    this.setCustomTransport(null);
    return true;
  }

  /**
   * Lazily loads and caches AntigravityAdapter.
   */
  async getAdapter() {
    if (this.adapter) return this.adapter;
    const { AntigravityAdapter } = getAntigravityModules();
    this.adapter = new AntigravityAdapter(this.costGuard, this.artifactStore);

    const client = this.adapter.getClient();
    client.on('delta', (delta) => this.emit('delta', delta));
    client.on('session_init', (init) => this.emit('session_init', init));
    client.on('step_update', (update) => this.emit('step_update', update));
    client.on('turn_completed', (result) => this.emit('turn_completed', result));
    client.on('error', (err) => {
      if (this.listenerCount('error') > 0) {
        this.emit('error', err);
      }
    });
    return this.adapter;
  }

  /**
   * Discovers local Antigravity executable and version (P7-001).
   */
  async discover() {
    const { AntigravityDiscovery } = getAntigravityModules();
    this.cachedDiscovery = AntigravityDiscovery.discover();
    return this.cachedDiscovery;
  }

  /**
   * Verifies canonical workspace boundary containment (P7-004).
   */
  async verifyWorkspaceBoundary(targetPath) {
    const { AntigravityClient } = getAntigravityModules();
    const isValid = AntigravityClient.verifyWorkspaceBoundary(this.workspaceRoot, targetPath);
    if (!isValid) {
      throw new Error(`ERR_PATH_TRAVERSAL: Working directory '${targetPath}' escapes workspace root '${this.workspaceRoot}'`);
    }
    const resolved = path.resolve(this.workspaceRoot, targetPath);
    return resolved;
  }

  /**
   * Executes a prompt through the native Antigravity agent (P7-002, P7-005, P7-007, P7-008).
   */
  async executePrompt(prompt, options = {}) {
    const adapter = await this.getAdapter();
    const effectiveDir = options.cwd || this.workspaceRoot;

    let transport = this.customTransport;
    if (this.mockMessages && this.mockMessages.length > 0) {
      const { MockAntigravityTransport } = getAntigravityModules();
      transport = new MockAntigravityTransport(this.mockMessages);
    }

    return await adapter.execute({
      prompt,
      workspaceRoot: this.workspaceRoot,
      targetDir: effectiveDir,
      customExecutablePath: options.customExecutablePath,
      conversationId: options.conversationId,
      forbiddenFlags: options.forbiddenFlags,
      mockTransport: transport,
      timeoutMs: options.timeoutMs,
    });
  }

  /**
   * Cancels any in-flight Antigravity turn (P7-006).
   */
  async cancelTurn() {
    if (this.adapter) {
      this.adapter.cancel();
    }
  }

  /**
   * Shuts down Antigravity service and cleans up.
   */
  close() {
    if (this.adapter) {
      this.adapter.cancel();
      this.adapter = null;
    }
  }
}

module.exports = { AntigravityService };
