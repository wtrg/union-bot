import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEnvelope,
  EnvelopeSchema,
  MessagePartSchema,
  AdmissionActionSchema,
  AdmissionDecisionSchema,
  RoleSchema,
  ProviderKindSchema,
  FidelityLevelSchema,
} from '../src/index.ts';

describe('Union Bot Protocol Schemas', () => {
  it('validates role and provider enums', () => {
    assert.equal(RoleSchema.parse('LEADER'), 'LEADER');
    assert.equal(RoleSchema.parse('IMPLEMENTER'), 'IMPLEMENTER');
    assert.throws(() => RoleSchema.parse('INVALID_ROLE'));

    assert.equal(ProviderKindSchema.parse('chatgpt'), 'chatgpt');
    assert.equal(ProviderKindSchema.parse('gemini'), 'gemini');
    assert.throws(() => ProviderKindSchema.parse('unapproved_llm'));
  });

  it('validates text and code message parts', () => {
    const textPart = MessagePartSchema.parse({
      kind: 'text',
      text: 'Hello from Leader',
    });
    assert.equal(textPart.kind, 'text');

    const codePart = MessagePartSchema.parse({
      kind: 'code',
      language: 'typescript',
      content: 'console.log("Union Bot");',
      filename: 'index.ts',
    });
    assert.equal(codePart.kind, 'code');
  });

  it('validates artifact message parts with strict SHA256 hex format', () => {
    const validSha = 'a'.repeat(64);
    const artifactPart = MessagePartSchema.parse({
      kind: 'artifact',
      sha256: validSha,
      mimeType: 'image/png',
      filename: 'diagram.png',
      sizeBytes: 1024,
    });
    assert.equal(artifactPart.kind, 'artifact');

    // Reject non-hex or invalid length sha256
    assert.throws(() => {
      MessagePartSchema.parse({
        kind: 'artifact',
        sha256: 'not-a-valid-sha',
        mimeType: 'text/plain',
        filename: 'test.txt',
        sizeBytes: 10,
      });
    });
  });

  it('creates and parses a valid Envelope', () => {
    const envelope = createEnvelope({
      sender: {
        kind: 'agent',
        id: 'agent_chatgpt_web',
        name: 'ChatGPT Web',
        role: 'LEADER',
        provider: 'chatgpt',
      },
      recipient: {
        kind: 'agent',
        id: 'agent_antigravity',
      },
      roomId: 'room_dev_core',
      fidelity: 'L1_FORMATTED_MARKDOWN',
      parts: [
        {
          kind: 'text',
          text: 'Proceed with Wave 2 Desktop & UI Foundation',
        },
      ],
    });

    const parsed = EnvelopeSchema.parse(envelope);
    assert.equal(parsed.sender.name, 'ChatGPT Web');
    assert.equal(parsed.parts.length, 1);
    assert.equal(parsed.fidelity, 'L1_FORMATTED_MARKDOWN');
  });

  it('rejects envelope with zero parts', () => {
    assert.throws(() => {
      EnvelopeSchema.parse({
        id: 'env_1',
        traceId: 'tr_1',
        timestamp: Date.now(),
        sender: { kind: 'agent', id: '1', name: 'Agent' },
        recipient: { kind: 'room', id: 'room_1' },
        roomId: 'room_1',
        parts: [], // Must have at least 1 part
        fidelity: 'L0_RAW_TEXT',
      });
    });
  });

  it('validates AdmissionAction and AdmissionDecision schemas', () => {
    const action = AdmissionActionSchema.parse({
      actionId: 'act_101',
      actionType: 'READ_WEB_DOM',
      provider: 'chatgpt',
      estimatedCost: 0,
      requestedBy: 'orchestrator_core',
      targetUrl: 'https://chatgpt.com',
    });
    assert.equal(action.actionType, 'READ_WEB_DOM');
    assert.equal(action.estimatedCost, 0);

    const decision = AdmissionDecisionSchema.parse({
      actionId: 'act_101',
      allowed: true,
      reason: 'Approved zero-cost web DOM read',
      policyCode: 'ALLOW_ZERO_COST_WEB',
      timestamp: Date.now(),
    });
    assert.equal(decision.allowed, true);
  });

  it('rejects AdmissionAction when estimatedCost is omitted, missing, or undefined', () => {
    assert.throws(() => {
      AdmissionActionSchema.parse({
        actionId: 'act_missing_cost_001',
        actionType: 'READ_WEB_DOM',
        provider: 'chatgpt',
        requestedBy: 'orchestrator_core',
      });
    });
  });
});
