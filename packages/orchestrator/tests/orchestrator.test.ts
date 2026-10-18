import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AdmissionPolicyGate, Orchestrator } from '../src/index.ts';
import { createEnvelope } from '../../protocol/src/index.ts';
import { ArtifactStore } from '../../artifact-store/src/index.ts';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('AdmissionPolicyGate & Orchestrator Zero-Cost (0đ) Policy', () => {
  it('strictly defaults paidApiEnabled to false', () => {
    const gate = new AdmissionPolicyGate();
    assert.equal(gate.paidApiEnabled, false);
  });

  it('permits zero-cost web DOM read or prompt action', () => {
    const gate = new AdmissionPolicyGate();
    const decision = gate.evaluate({
      actionId: 'act_web_001',
      actionType: 'READ_WEB_DOM',
      provider: 'chatgpt',
      estimatedCost: 0,
      requestedBy: 'user_session',
      targetUrl: 'https://chatgpt.com',
    });

    assert.equal(decision.allowed, true);
    assert.equal(decision.policyCode, 'ALLOW_ZERO_COST');
  });

  it('strictly DENIES any action with estimatedCost > 0 when paid APIs are disabled', () => {
    const gate = new AdmissionPolicyGate();
    const decision = gate.evaluate({
      actionId: 'act_paid_001',
      actionType: 'SEND_PROMPT',
      provider: 'chatgpt',
      estimatedCost: 0.05,
      requestedBy: 'rogue_subagent',
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.policyCode, 'DENY_PAID_API_DISABLED');
    assert.match(decision.reason, /Zero-Cost \(0đ\) violation/);
  });

  it('strictly DENIES UNKNOWN_ACTION type', () => {
    const gate = new AdmissionPolicyGate();
    const decision = gate.evaluate({
      actionId: 'act_unknown_001',
      actionType: 'UNKNOWN_ACTION',
      provider: 'system',
      estimatedCost: 0,
      requestedBy: 'test_runner',
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.policyCode, 'DENY_UNKNOWN_ACTION');
  });

  it('strictly DENIES actions targeting forbidden paid API egress endpoints', () => {
    const gate = new AdmissionPolicyGate();
    const decision = gate.evaluate({
      actionId: 'act_egress_001',
      actionType: 'SEND_PROMPT',
      provider: 'chatgpt',
      estimatedCost: 0,
      requestedBy: 'test_runner',
      targetUrl: 'https://api.openai.com/v1/chat/completions',
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.policyCode, 'DENY_EGRESS_BLOCKED');
    assert.match(decision.reason, /Egress boundary violation/);
  });

  it('dispatches valid envelope into room history via Orchestrator', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'union-orch-test-'));
    const store = new ArtifactStore(tempDir);
    const orch = new Orchestrator({ artifactStore: store });

    const env = createEnvelope({
      sender: { kind: 'agent', id: 'ag_gemini', name: 'Gemini Web', role: 'RESEARCHER', provider: 'gemini' },
      recipient: { kind: 'room', id: 'room_dev' },
      roomId: 'room_dev',
      parts: [{ kind: 'text', text: 'Analysis completed.' }],
      fidelity: 'L1_FORMATTED_MARKDOWN',
    });

    const result = await orch.dispatchEnvelope(env);
    assert.equal(result.success, true);
    assert.equal(result.roomId, 'room_dev');

    const history = orch.getRoomHistory('room_dev');
    assert.equal(history.length, 1);
    assert.equal(history[0].parts[0].kind, 'text');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects malformed envelope gracefully', async () => {
    const orch = new Orchestrator();
    const result = await orch.dispatchEnvelope({
      id: 'bad_env',
      roomId: 'room_1',
      // missing sender, recipient, parts, fidelity
    });

    assert.equal(result.success, false);
    assert.match(result.error!, /Envelope schema validation error/);
  });

  it('strictly DENIES any action where estimatedCost is omitted, undefined or unknown (DENY_UNKNOWN_COST)', () => {
    const gate = new AdmissionPolicyGate();
    const decision = gate.evaluate({
      actionId: 'act_unknown_cost_001',
      actionType: 'READ_WEB_DOM',
      provider: 'chatgpt',
      requestedBy: 'user_session',
      targetUrl: 'https://chatgpt.com',
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.policyCode, 'DENY_UNKNOWN_COST');
    assert.match(decision.reason, /estimatedCost is undefined, missing, or unknown/);
  });

  it('persists dispatched envelopes to SQLite StorageEngine and EventStore (P2-003, P2-004)', async () => {
    const { StorageEngine } = await import('../../storage/src/index.ts');
    const storage = new StorageEngine({ wal: false });
    const orch = new Orchestrator({ storage });

    const envelope = createEnvelope({
      id: 'env_persist_1',
      sender: { kind: 'user', id: 'usr_test', name: 'User', role: 'USER' },
      recipient: { kind: 'room', id: 'orchestration' },
      roomId: 'orchestration',
      parts: [{ kind: 'text', text: 'Persistent message' }],
    });

    const result = await orch.dispatchEnvelope(envelope);
    assert.equal(result.success, true);

    const stored = storage.getEnvelope('env_persist_1');
    assert.ok(stored);
    assert.equal(stored.id, 'env_persist_1');

    const history = orch.getRoomHistory('orchestration');
    assert.equal(history.length, 1);
    assert.equal(history[0].id, 'env_persist_1');
  });

  it('enforces renderer anti-spoofing and blocks forged roles (C03)', async () => {
    const orch = new Orchestrator();

    // 1. Attacker tries to dispatch as agent
    const fakeAgentEnv = createEnvelope({
      sender: { kind: 'agent', id: 'ag_fake', name: 'Fake Agent', role: 'LEADER' },
      recipient: { kind: 'room', id: 'general' },
      roomId: 'general',
      parts: [{ kind: 'text', text: 'Impersonating Leader' }],
    });

    const res1 = await orch.dispatchEnvelope(fakeAgentEnv, { isFromRenderer: true });
    assert.equal(res1.success, false);
    assert.match(res1.error!, /renderer can only dispatch as sender\.kind === "user"/);

    // 2. Attacker claims sender.kind === 'user' but role === 'ORCHESTRATOR'
    const fakeRoleEnv = createEnvelope({
      sender: { kind: 'user', id: 'usr_fake', name: 'Attacker', role: 'ORCHESTRATOR' as any },
      recipient: { kind: 'room', id: 'general' },
      roomId: 'general',
      parts: [{ kind: 'text', text: 'Impersonating Orchestrator' }],
    });

    const res2 = await orch.dispatchEnvelope(fakeRoleEnv, { isFromRenderer: true });
    assert.equal(res2.success, false);
    assert.match(res2.error!, /renderer can only dispatch as role === "USER"/);
  });

  it('rejects untrusted action payloads from renderer without approval tokens (C02, P2-006)', async () => {
    const { StorageEngine, ApprovalGateManager } = await import('../../storage/src/index.ts');
    const storage = new StorageEngine({ wal: false });
    const approvalGate = new ApprovalGateManager(storage);
    const orch = new Orchestrator({ storage, approvalGate });

    // 1. Renderer claims action status='completed'
    const completedActionEnv = createEnvelope({
      id: 'env_act_1',
      sender: { kind: 'user', id: 'u1', name: 'User', role: 'USER' },
      recipient: { kind: 'room', id: 'general' },
      roomId: 'general',
      parts: [
        {
          kind: 'action',
          tool: 'exec_dangerous_tool',
          callId: 'c1',
          status: 'completed',
          input: { cmd: 'delete' },
        },
      ],
    });

    const res1 = await orch.dispatchEnvelope(completedActionEnv, { isFromRenderer: true });
    assert.equal(res1.success, false);
    assert.match(res1.error!, /renderer cannot claim action status="completed"/);

    // 2. Renderer submits action without approval token
    const unapprovedActionEnv = createEnvelope({
      id: 'env_act_2',
      sender: { kind: 'user', id: 'u1', name: 'User', role: 'USER' },
      recipient: { kind: 'room', id: 'general' },
      roomId: 'general',
      parts: [
        {
          kind: 'action',
          tool: 'exec_cli',
          callId: 'c2',
          status: 'requested',
          input: { cmd: 'test' },
        },
      ],
    });

    const res2 = await orch.dispatchEnvelope(unapprovedActionEnv, { isFromRenderer: true });
    assert.equal(res2.success, false);
    assert.match(res2.error!, /requires a valid approvalTokenId/);

    // 3. Renderer submits action with valid approval token
    const actionInput = { url: 'https://chatgpt.com', estimatedCost: 0 };
    const token = approvalGate.createToken({
      actionType: 'read_web',
      payload: actionInput,
      origin: 'ui:test',
    });

    const approvedActionEnv = createEnvelope({
      id: 'env_act_3',
      sender: { kind: 'user', id: 'u1', name: 'User', role: 'USER' },
      recipient: { kind: 'room', id: 'general' },
      roomId: 'general',
      parts: [
        {
          kind: 'action',
          tool: 'read_web',
          callId: 'c3',
          status: 'requested',
          input: actionInput,
          approvalTokenId: token.tokenId,
        },
      ],
    });

    const res3 = await orch.dispatchEnvelope(approvedActionEnv, { isFromRenderer: true });
    assert.equal(res3.success, true);
  });

  it('guarantees idempotency deduplication across duplicate sends (P2-005, C01, C05)', async () => {
    const { StorageEngine, IdempotencyManager } = await import('../../storage/src/index.ts');
    const storage = new StorageEngine({ wal: false });
    const idempotency = new IdempotencyManager(storage);
    const orch = new Orchestrator({ storage, idempotency });

    const env = createEnvelope({
      id: 'env_idemp_unique',
      sender: { kind: 'user', id: 'u1', name: 'User', role: 'USER' },
      recipient: { kind: 'room', id: 'general' },
      roomId: 'general',
      parts: [{ kind: 'text', text: 'Hello once' }],
    });

    // First send
    const res1 = await orch.dispatchEnvelope(env);
    assert.equal(res1.success, true);

    // Second send with same ID
    const res2 = await orch.dispatchEnvelope(env);
    assert.equal(res2.success, true);

    // History must contain only ONE instance of the message
    const history = orch.getRoomHistory('general');
    const occurrences = history.filter((e) => e.id === 'env_idemp_unique');
    assert.equal(occurrences.length, 1);
  });
});

