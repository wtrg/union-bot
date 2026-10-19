/**
 * @file antigravity-agent.test.ts
 * @description Comprehensive Unit Test Suite for Antigravity Native Agent Adapter (Phase P7).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import {
  AntigravityDiscovery,
  AntigravityClient,
  MockAntigravityTransport,
  AntigravityAdapter,
} from '../src/index.ts';
import { CostGuard } from '../../cost-guard/src/index.ts';
import { ArtifactStore } from '../../artifact-store/src/index.ts';

describe('Phase P7: Antigravity Native Agent Adapter Suite', () => {
  it('P7-001: Discovers local agy CLI binary and verifies version or returns structured fallback', () => {
    const discovery = AntigravityDiscovery.discover();
    assert.ok(typeof discovery.available === 'boolean');
    if (discovery.available) {
      assert.ok(discovery.executablePath, 'Executable path must be present if available');
      assert.ok(discovery.version, 'Version must be parsed if available');
      assert.match(discovery.version, /^\d+\.\d+\.\d+/, 'Version must match semver pattern');
      assert.equal(discovery.authStatus, 'FREE_LOCAL');
    } else {
      assert.match(discovery.error || '', /ERR_ANTIGRAVITY_NOT_INSTALLED|ERR_ANTIGRAVITY_EXEC_FAILED/);
      assert.ok(discovery.installInstructions, 'Must provide installation instructions');
    }
  });

  it('P7-001: Gracefully handles non-existent custom executable path fail-closed', () => {
    const fakePath = path.join(os.tmpdir(), 'non_existent_agy_binary_xyz.exe');
    const discovery = AntigravityDiscovery.discover(fakePath);
    assert.equal(discovery.available, false);
    assert.equal(discovery.error, 'ERR_ANTIGRAVITY_NOT_INSTALLED');
    assert.ok(discovery.installInstructions?.includes(fakePath));
  });

  it('P7-004 & P7-R01: Enforces Canonical Workspace Boundary Defense against real filesystem junctions, symlinks, chains, and non-existent targets', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-boundary-test-'));
    const workspace = path.join(tempDir, 'workspace');
    const outside = path.join(tempDir, 'outside');
    const internalDir = path.join(workspace, 'internal');

    fs.mkdirSync(workspace, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.mkdirSync(internalDir, { recursive: true });

    const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';

    try {
      // 1. Valid in-workspace paths
      assert.equal(AntigravityClient.verifyWorkspaceBoundary(workspace, path.join(workspace, 'src/index.ts')), true);
      assert.equal(AntigravityClient.verifyWorkspaceBoundary(workspace, internalDir), true);
      assert.equal(AntigravityClient.verifyWorkspaceBoundary(workspace, path.join(internalDir, 'deep/non_existent.ts')), true);

      // 2. Lexical traversal & same-prefix escapes
      assert.equal(AntigravityClient.verifyWorkspaceBoundary(workspace, workspace + '-evil'), false, 'Same-prefix sibling must be denied');
      assert.equal(AntigravityClient.verifyWorkspaceBoundary(workspace, path.join(workspace, '../outside')), false, '../ traversal must be denied');
      assert.equal(AntigravityClient.verifyWorkspaceBoundary(workspace, outside), false, 'Outside directory must be denied');

      // 3. Junction / Symlink inside workspace -> outside workspace (breakout)
      const escapeLink = path.join(workspace, 'escape-link');
      fs.symlinkSync(outside, escapeLink, symlinkType);
      assert.equal(AntigravityClient.verifyWorkspaceBoundary(workspace, escapeLink), false, 'Symlink escaping to outside must be denied');
      assert.equal(AntigravityClient.verifyWorkspaceBoundary(workspace, path.join(escapeLink, 'nested-file.txt')), false, 'Non-existent file inside escape symlink must be denied');
      assert.equal(AntigravityClient.verifyWorkspaceBoundary(workspace, path.join(escapeLink, 'deep/non_existent/dir')), false, 'Deep non-existent path inside escape symlink must be denied');

      // 4. Symlink chain: link-a -> link-b -> outside
      const linkB = path.join(workspace, 'link-b');
      const linkA = path.join(workspace, 'link-a');
      fs.symlinkSync(outside, linkB, symlinkType);
      fs.symlinkSync(linkB, linkA, symlinkType);
      assert.equal(AntigravityClient.verifyWorkspaceBoundary(workspace, linkA), false, 'Symlink chain escaping to outside must be denied');

      // 5. Valid symlink staying inside workspace (allowed)
      const validLink = path.join(workspace, 'valid-link');
      fs.symlinkSync(internalDir, validLink, symlinkType);
      assert.equal(AntigravityClient.verifyWorkspaceBoundary(workspace, validLink), true, 'Symlink inside workspace must be allowed');
      assert.equal(AntigravityClient.verifyWorkspaceBoundary(workspace, path.join(validLink, 'new-file.txt')), true, 'Non-existent file inside valid symlink must be allowed');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('P7-R01: executeTurn enforces workspaceRoot -> cwd boundary validation', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-exec-boundary-'));
    const workspace = path.join(tempDir, 'workspace');
    const outside = path.join(tempDir, 'outside');
    fs.mkdirSync(workspace, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });

    const client = new AntigravityClient();
    const mockTransport = new MockAntigravityTransport([]);

    try {
      await assert.rejects(
        async () => {
          await client.executeTurn('mock-agy', 'prompt', {
            workspaceRoot: workspace,
            cwd: outside,
          }, mockTransport);
        },
        (err: any) => {
          assert.match(err.message, /ERR_PATH_TRAVERSAL/);
          return true;
        }
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('P7-004: Explicitly rejects --dangerously-skip-permissions fail-closed', async () => {
    const client = new AntigravityClient();
    await assert.rejects(
      async () => {
        await client.executeTurn('agy', 'test prompt', {
          forbiddenFlags: ['--dangerously-skip-permissions'],
        });
      },
      (err: any) => {
        assert.match(err.message, /ERR_FORBIDDEN_FLAG/);
        return true;
      }
    );
  });

  it('P7-002 & P7-003: Streams NDJSON events and reconstructs full turn response from deltas', async () => {
    const mockEvents = [
      JSON.stringify({
        event: 'init',
        conversation_id: 'conv-p7-001',
        init: { cwd: 'C:\\workspace', tools: ['view_file', 'run_command'], permission_mode: 'request-review' },
      }),
      JSON.stringify({
        event: 'step_update',
        step_update: { conversation_id: 'conv-p7-001', step_index: 0, state: 'DONE', step_type: 'user_input' },
      }),
      JSON.stringify({
        event: 'step_update',
        step_update: { conversation_id: 'conv-p7-001', step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Hello ' },
      }),
      JSON.stringify({
        event: 'step_update',
        step_update: { conversation_id: 'conv-p7-001', step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'from Antigravity!' },
      }),
      JSON.stringify({
        event: 'result',
        result: {
          conversation_id: 'conv-p7-001',
          status: 'SUCCESS',
          response: 'Hello from Antigravity!',
          duration_seconds: 1.45,
          num_turns: 1,
          usage: { input_tokens: 1500, output_tokens: 25, thinking_tokens: 10, total_tokens: 1535 },
        },
      }),
    ];

    const mockTransport = new MockAntigravityTransport(mockEvents);
    const client = new AntigravityClient();

    const deltas: string[] = [];
    client.on('delta', (d) => deltas.push(d));

    let sessionInitEmitted = false;
    client.on('session_init', (init) => {
      sessionInitEmitted = true;
      assert.equal(init.conversationId, 'conv-p7-001');
    });

    const result = await client.executeTurn('mock-agy', 'say hello', {}, mockTransport);

    assert.equal(sessionInitEmitted, true);
    assert.deepEqual(deltas, ['Hello ', 'from Antigravity!']);
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.response, 'Hello from Antigravity!');
    assert.equal(result.conversationId, 'conv-p7-001');
    assert.equal(result.usage.totalTokens, 1535);
  });

  it('P7-006: Supports turn cancellation and terminates gracefully', async () => {
    const mockTransport = new MockAntigravityTransport([]);
    const client = new AntigravityClient();

    let cancelledEmitted = false;
    client.on('cancelled', () => {
      cancelledEmitted = true;
    });

    const promise = client.executeTurn('mock-agy', 'slow task', {}, mockTransport);
    client.cancel();

    const result = await promise;
    assert.equal(cancelledEmitted, true);
    assert.equal(client.executing, false);
    assert.ok(result.status === 'SUCCESS' || result.status === 'CANCELLED');
  });

  it('P7-005 & P7-007: Adapter executes turn, preserves zero cost, and registers CAS artifact with provenance', async () => {
    const costGuard = new CostGuard();
    const tempCasDir = path.join(os.tmpdir(), `union-bot-cas-${Date.now()}`);
    fs.mkdirSync(tempCasDir, { recursive: true });
    const artifactStore = new ArtifactStore(tempCasDir);

    const adapter = new AntigravityAdapter(costGuard, artifactStore);

    const mockEvents = [
      JSON.stringify({
        event: 'init',
        conversation_id: 'conv-cas-test',
        init: { cwd: tempCasDir, tools: [] },
      }),
      JSON.stringify({
        event: 'step_update',
        step_update: { conversation_id: 'conv-cas-test', step_index: 1, text_delta: '# Code Generation\n\n```js\nconsole.log(1);\n```' },
      }),
      JSON.stringify({
        event: 'result',
        result: {
          conversation_id: 'conv-cas-test',
          status: 'SUCCESS',
          response: '# Code Generation\n\n```js\nconsole.log(1);\n```',
          duration_seconds: 0.8,
          usage: { input_tokens: 500, output_tokens: 50, thinking_tokens: 0, total_tokens: 550 },
        },
      }),
    ];

    const mockTransport = new MockAntigravityTransport(mockEvents);

    const execResult = await adapter.execute({
      prompt: 'generate js code',
      workspaceRoot: tempCasDir,
      conversationId: 'conv-cas-test',
      mockTransport,
    });

    assert.equal(execResult.success, true);
    assert.equal(execResult.provider, 'antigravity');
    assert.equal(execResult.cost, 0, 'Cost must be exactly $0.00 / 0đ');
    assert.ok(execResult.artifact, 'Artifact must be generated in CAS');
    assert.ok(execResult.artifact.sha256, 'Artifact SHA-256 hash must be recorded');
    assert.ok(execResult.artifact.byteSize > 0, 'Artifact byteSize must be recorded');

    // Clean up
    fs.rmSync(tempCasDir, { recursive: true, force: true });
  });

  it('P7-004 & P7-R01: Adapter rejects out-of-boundary directory fail-closed', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-adapter-boundary-'));
    const safeWorkspace = path.join(tempDir, 'safe-workspace');
    const escapedDir = path.join(tempDir, 'escaped-path');
    fs.mkdirSync(safeWorkspace, { recursive: true });
    fs.mkdirSync(escapedDir, { recursive: true });

    try {
      const adapter = new AntigravityAdapter();
      const result = await adapter.execute({
        prompt: 'test',
        workspaceRoot: safeWorkspace,
        targetDir: escapedDir,
        mockTransport: new MockAntigravityTransport([]),
      });

      assert.equal(result.success, false);
      assert.match(result.error || '', /ERR_PATH_TRAVERSAL/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
