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
});
