/**
 * @file codex-agent.test.ts
 * @description Comprehensive Unit & Contract Test Suite for Native Codex Agent (Phase P6 - Tickets P6-001 through P6-010).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  CodexDiscovery,
  CodexClient,
  MockCodexTransport,
  CodexAdapter,
} from '../src/index.ts';
import { CostGuard } from '../../cost-guard/src/index.ts';
import { ArtifactStore } from '../../artifact-store/src/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '../../..');

describe('Union Bot Phase P6: Native Codex Agent Adapter Suite', () => {
  // P6-001: Discovery & Versioning
  it('P6-001: CodexDiscovery discovers executable or returns helpful instructions without crashing', () => {
    // 1. Default discovery
    const discovery = CodexDiscovery.discover();
    assert.equal(typeof discovery.available, 'boolean');

    if (discovery.available) {
      assert.ok(discovery.executablePath);
      assert.ok(discovery.version);
    } else {
      assert.ok(discovery.error);
      assert.match(discovery.installInstructions || '', /Install Codex via/);
    }

    // 2. Non-existent path returns graceful fail-closed result
    const missingDiscovery = CodexDiscovery.discover('C:\\fake\\nonexistent\\codex_path.exe');
    assert.equal(missingDiscovery.available, false);
    assert.equal(missingDiscovery.error, 'ERR_CODEX_NOT_INSTALLED');
    assert.match(missingDiscovery.installInstructions || '', /Install Codex via|Check file execution permissions/);
  });

  // P6-002: Transport & Handshake
  it('P6-002: CodexClient performs JSON-RPC 2.0 handshake (initialize -> initialized)', async () => {
    const transport = new MockCodexTransport();
    const client = new CodexClient(transport);

    // Prepare initialization promise
    const initPromise = client.initialize('union-bot-test', '1.0.0');

    // Verify initialize request was sent
    assert.equal(transport.sentMessages.length, 1);
    const initReq = JSON.parse(transport.sentMessages[0]);
    assert.equal(initReq.method, 'initialize');
    assert.equal(initReq.params.clientInfo.name, 'union-bot-test');

    // Simulate server response
    transport.simulateServerMessage({
      jsonrpc: '2.0',
      id: initReq.id,
      result: {
        userAgent: 'codex-cli/0.162.1 (Windows 10.0.26200; x86_64)',
        codexHome: 'C:\\Users\\Lenovo\\.codex',
      },
    });

    const res = await initPromise;
    assert.equal(client.isInitialized, true);
    assert.ok(res.userAgent.includes('codex-cli'));

    // Verify initialized notification was sent
    assert.equal(transport.sentMessages.length, 2);
    const initNotif = JSON.parse(transport.sentMessages[1]);
    assert.equal(initNotif.method, 'initialized');
  });

  // P6-003: Thread Management
  it('P6-003: CodexClient starts and manages thread with bidirectional ID tracking', async () => {
    const transport = new MockCodexTransport();
    const client = new CodexClient(transport);
    client.isInitialized = true; // assume initialized

    const threadPromise = client.startThread({ cwd: workspaceRoot });

    const threadReq = JSON.parse(transport.sentMessages[0]);
    assert.equal(threadReq.method, 'thread/start');
    assert.equal(threadReq.params.cwd, workspaceRoot);

    const fakeThreadId = '01a14f60-bb27-7ed2-a5d5-d000ce065a51';
    transport.simulateServerMessage({
      jsonrpc: '2.0',
      id: threadReq.id,
      result: {
        thread: { id: fakeThreadId, status: { type: 'idle' } },
      },
    });

    const threadId = await threadPromise;
    assert.equal(threadId, fakeThreadId);
    assert.equal(client.currentThreadId, fakeThreadId);
  });

  // P6-004: Turn Lifecycle & Event Streaming
  it('P6-004: CodexClient streams deltas and resolves turn with verified completed status', async () => {
    const transport = new MockCodexTransport();
    const client = new CodexClient(transport);
    client.isInitialized = true;
    client.currentThreadId = 'thread_test_001';

    const streamedDeltas: string[] = [];
    const turnPromise = client.runTurn('What is Union Bot?', {
      onDelta: (d) => streamedDeltas.push(d),
    });

    const turnReq = JSON.parse(transport.sentMessages[0]);
    assert.equal(turnReq.method, 'turn/start');
    assert.equal(turnReq.params.input[0].text, 'What is Union Bot?');

    // 1. Simulate turn start response
    const fakeTurnId = 'turn_test_001';
    transport.simulateServerMessage({
      jsonrpc: '2.0',
      id: turnReq.id,
      result: {
        turn: { id: fakeTurnId, status: 'inProgress' },
      },
    });

    // 2. Simulate streaming notifications
    transport.simulateServerMessage({
      jsonrpc: '2.0',
      method: 'item/agentMessage/delta',
      params: { delta: 'Union Bot is ' },
    });
    transport.simulateServerMessage({
      jsonrpc: '2.0',
      method: 'item/agentMessage/delta',
      params: { delta: 'a multi-AI collaboration workspace.' },
    });

    // 3. Simulate turn completion
    transport.simulateServerMessage({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: {
        turn: {
          id: fakeTurnId,
          status: 'completed',
          items: [
            {
              type: 'agentMessage',
              text: 'Union Bot is a multi-AI collaboration workspace.',
            },
          ],
        },
      },
    });

    const result = await turnPromise;
    assert.equal(result.status, 'completed');
    assert.equal(result.text, 'Union Bot is a multi-AI collaboration workspace.');
    assert.equal(streamedDeltas.join(''), 'Union Bot is a multi-AI collaboration workspace.');
  });

  // P6-005: Tool Approval Notifications
  it('P6-005: CodexAdapter intercepts tool approval requests and fails closed on unapproved actions', () => {
    const transport = new MockCodexTransport();
    let approvalDeniedEmitted = false;

    const adapter = new CodexAdapter({
      workspaceRoot,
      transport,
      approvalValidator: (token, command) => {
        if (!token || token.status !== 'APPROVED') {
          return { valid: false, reason: 'Unapproved tool action' };
        }
        return { valid: true };
      },
    });

    adapter.on('approvalDenied', (data) => {
      approvalDeniedEmitted = true;
      assert.equal(data.reason, 'Unapproved tool action');
    });

    // Simulate incoming tool approval notification
    transport.simulateServerMessage({
      jsonrpc: '2.0',
      method: 'item/commandExecution/requestApproval',
      params: {
        command: 'rm -rf /',
        token: { id: 'tok_unapproved', status: 'PENDING' },
      },
    });

    assert.equal(approvalDeniedEmitted, true);
  });

  // P6-006: Cancellation & Transport Close
  it('P6-006: CodexClient cancels turn and cleans up pending requests on close', async () => {
    const transport = new MockCodexTransport();
    const client = new CodexClient(transport);
    client.isInitialized = true;
    client.currentThreadId = 'thread_001';

    // Interrupt turn
    const interruptPromise = client.interruptTurn();
    const interruptReq = JSON.parse(transport.sentMessages[0]);
    assert.equal(interruptReq.method, 'turn/interrupt');

    transport.simulateServerMessage({
      jsonrpc: '2.0',
      id: interruptReq.id,
      result: { ok: true },
    });

    const res = await interruptPromise;
    assert.equal(res.ok, true);

    // Test close cleanup
    client.close();
    assert.equal(client.isInitialized, false);
    assert.equal(transport.isClosed, true);
  });

  // P6-007: Workspace Boundary Scoping
  it('P6-007: CodexAdapter enforces strict workspace containment with path.relative check', () => {
    const transport = new MockCodexTransport();
    const adapter = new CodexAdapter({
      workspaceRoot,
      transport,
    });

    // Safe path within workspace
    const safePath = adapter.verifyWorkspaceBoundary('package.json');
    assert.ok(safePath.includes('package.json'));

    // Traversal attempts must throw ERR_PATH_TRAVERSAL
    assert.throws(
      () => adapter.verifyWorkspaceBoundary('../../Windows/System32/cmd.exe'),
      /ERR_PATH_TRAVERSAL/
    );

    // Same-prefix boundary isolation (e.g. repo vs repo-evil)
    assert.throws(
      () => adapter.verifyWorkspaceBoundary('../' + path.basename(workspaceRoot) + '-evil/file.txt'),
      /ERR_PATH_TRAVERSAL/
    );
  });

  // P6-008: CAS Artifact Capture
  it('P6-008: CodexAdapter captures turn response as CAS artifact with agent provenance', async () => {
    const tempCasDir = path.resolve(__dirname, '.tmp_codex_test_cas');
    if (!fs.existsSync(tempCasDir)) fs.mkdirSync(tempCasDir, { recursive: true });

    const artifactStore = new ArtifactStore(tempCasDir);
    const transport = new MockCodexTransport();

    const adapter = new CodexAdapter({
      workspaceRoot,
      transport,
      artifactStore,
    });

    // Start turn
    const turnPromise = adapter.executeTurn('Synthesize unit test');

    // Wait for initialize request to be sent
    await new Promise((r) => setTimeout(r, 10));
    const initReq = JSON.parse(transport.sentMessages[0]);
    transport.simulateServerMessage({ jsonrpc: '2.0', id: initReq.id, result: { userAgent: 'codex' } });

    // Wait for thread/start request to be sent
    await new Promise((r) => setTimeout(r, 10));
    const threadReq = JSON.parse(transport.sentMessages[2]); // index 1 was 'initialized' notif
    transport.simulateServerMessage({ jsonrpc: '2.0', id: threadReq.id, result: { thread: { id: 'th_001' } } });

    // Wait for turn/start request to be sent
    await new Promise((r) => setTimeout(r, 10));
    const turnReq = JSON.parse(transport.sentMessages[3]);
    transport.simulateServerMessage({ jsonrpc: '2.0', id: turnReq.id, result: { turn: { id: 'turn_001' } } });

    // Complete turn
    transport.simulateServerMessage({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: {
        turn: {
          id: 'turn_001',
          status: 'completed',
          items: [{ type: 'agentMessage', text: '```js\nconst x = 42;\n```' }],
        },
      },
    });

    const result = await turnPromise;
    assert.equal(result.success, true);
    assert.equal(result.provider, 'codex');
    assert.equal(result.artifacts.length, 1);
    assert.ok(result.artifacts[0].sha256);
    assert.equal(result.provenance.originator, 'codex');

    // Verify stored in CAS
    const readBytes = artifactStore.readBytes(result.artifacts[0].sha256);
    assert.equal(readBytes.toString('utf8'), '```js\nconst x = 42;\n```');

    try { fs.rmSync(tempCasDir, { recursive: true, force: true }); } catch {}
  });

  // P6-009: Zero-Cost Policy Enforcement
  it('P6-009: CodexAdapter enforces Zero-Cost $0.00 policy and blocks paid egress', () => {
    const costGuard = new CostGuard({ allowLocalhost: true });
    const transport = new MockCodexTransport();

    const adapter = new CodexAdapter({
      workspaceRoot,
      transport,
      costGuard,
    });

    assert.equal(adapter.discovery.available, true);
    // Cost guard strictly admits local zero-cost processes
    assert.equal(costGuard.isUrlAllowed('http://localhost:8080'), true);
    assert.equal(costGuard.isUrlAllowed('http://127.0.0.1:3000'), true);
    // Paid APIs blocked
    assert.equal(costGuard.isUrlAllowed('https://api.openai.com/v1/chat/completions'), false);
    assert.equal(costGuard.isUrlAllowed('https://api.anthropic.com/v1/messages'), false);
  });

  // P9-R03-003 & P9-R04-003: Authentic Codex QA Verification Suite
  it('P9-R04-003: CodexAdapter executeVerification enforces strict fail-closed validation', () => {
    const costGuard = new CostGuard({ allowLocalhost: true });
    const adapter = new CodexAdapter({ workspaceRoot, costGuard });

    // 1. Rejects empty file list
    assert.throws(
      () => adapter.executeVerification({ files: [] }),
      /ERR_VERIFICATION_NO_FILES/
    );

    // 2. Rejects non-existent file
    assert.throws(
      () => adapter.executeVerification({ files: ['non-existent-file-xyz.ts'] }),
      /ERR_VERIFICATION_FILE_NOT_FOUND/
    );

    // 3. Validates real package.json
    const validRes = adapter.executeVerification({ files: ['package.json'] });
    assert.equal(validRes.success, true);
    assert.equal(validRes.syntaxVerified, true);
    assert.equal(validRes.securityBoundaryVerified, true);
    assert.equal(validRes.zeroCostConfirmed, true);

    // 4. P9-R04-003: Mandatory targetDigest in VERIFY stage fails-closed when omitted
    assert.throws(
      () => adapter.executeVerification({ files: ['package.json'], stage: 'VERIFY' }),
      /ERR_MISSING_TARGET_DIGEST/
    );

    // 5. Rejects mismatched targetDigest
    assert.throws(
      () => adapter.executeVerification({ files: ['package.json'], targetDigest: '0'.repeat(64) }),
      /ERR_DIGEST_MISMATCH/
    );

    // 6. Accepts authentic matching targetDigest
    const expectedDigest = crypto.createHash('sha256').update(fs.readFileSync(path.resolve(workspaceRoot, 'package.json'))).digest('hex');
    const digestRes = adapter.executeVerification({ files: ['package.json'], stage: 'VERIFY', targetDigest: expectedDigest });
    assert.equal(digestRes.success, true);
    assert.equal(digestRes.digestVerified, true);

    // 7. P9-R04-005: Rejects verification when CostGuard is missing fail-closed
    const guardlessAdapter = new CodexAdapter({ workspaceRoot, costGuard: undefined });
    assert.throws(
      () => guardlessAdapter.executeVerification({ files: ['package.json'] }),
      /ERR_COST_GUARD_REQUIRED/
    );

    // 8. Rejects paid API egress when CostGuard allows paid APIs
    const paidCostGuard = new CostGuard();
    (paidCostGuard as any).paidApiEnabled = true;
    const paidAdapter = new CodexAdapter({ workspaceRoot, costGuard: paidCostGuard });
    assert.throws(
      () => paidAdapter.executeVerification({ files: ['package.json'] }),
      /ERR_ZERO_COST_VIOLATION/
    );

    // 8. Rejects corrupt JSON
    const scratchDir = path.join(workspaceRoot, 'scratch/codex-verify-test');
    fs.mkdirSync(scratchDir, { recursive: true });
    try {
      const corruptJson = path.join(scratchDir, 'bad.json');
      fs.writeFileSync(corruptJson, '{ invalid json: true, ', 'utf8');
      assert.throws(
        () => adapter.executeVerification({ files: ['scratch/codex-verify-test/bad.json'], workspaceRoot }),
        /ERR_SYNTAX_VERIFICATION_FAILED/
      );

      // 5. Rejects corrupt JS
      const corruptJs = path.join(scratchDir, 'bad.js');
      fs.writeFileSync(corruptJs, 'function ( { invalid syntax;', 'utf8');
      assert.throws(
        () => adapter.executeVerification({ files: ['scratch/codex-verify-test/bad.js'], workspaceRoot }),
        /ERR_SYNTAX_VERIFICATION_FAILED/
      );
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });
});
