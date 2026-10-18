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
  ContentFidelitySchema,
  ProviderIdentitySchema,
  TaskNodeSchema,
  ApprovalTokenSchema,
  UnionBotErrorCodeSchema,
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

  it('validates artifact message parts with strict SHA256 hex format and content fidelity', () => {
    const validSha = 'a'.repeat(64);
    const artifactPart = MessagePartSchema.parse({
      kind: 'artifact',
      sha256: validSha,
      mimeType: 'image/png',
      filename: 'diagram.png',
      sizeBytes: 1024,
      contentFidelity: 'LOSSLESS_PREVIEW',
      provenance: 'LIVE_WEB',
      transferStatus: 'VERIFIED_TRANSFERRED',
    });
    assert.equal(artifactPart.kind, 'artifact');
    assert.equal(artifactPart.contentFidelity, 'LOSSLESS_PREVIEW');

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
        providerIdentity: {
          provider: 'chatgpt',
          profileId: 'prof_main',
          sessionId: 'sess_123',
          capabilityVersion: '1.0.0',
          authStatus: 'AUTHENTICATED',
          evidenceProvenance: 'LIVE_WEB',
        },
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
    assert.equal(parsed.schemaVersion, '1.0.0');
    assert.equal(parsed.sender.name, 'ChatGPT Web');
    assert.equal(parsed.parts.length, 1);
    assert.equal(parsed.fidelity, 'L1_FORMATTED_MARKDOWN');
    assert.equal(parsed.status, 'acknowledged');
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

  it('validates ContentFidelitySchema distinct from UI FidelityLevelSchema', () => {
    // 6 content preservation tiers
    assert.equal(ContentFidelitySchema.parse('RAW_BINARY'), 'RAW_BINARY');
    assert.equal(ContentFidelitySchema.parse('SEMANTIC_INTERACTIVE'), 'SEMANTIC_INTERACTIVE');
    assert.equal(ContentFidelitySchema.parse('STRUCTURED_DOC'), 'STRUCTURED_DOC');
    assert.equal(ContentFidelitySchema.parse('VECTOR_EMBEDDING'), 'VECTOR_EMBEDDING');
    assert.equal(ContentFidelitySchema.parse('LOSSLESS_EXPORT'), 'LOSSLESS_EXPORT');
    assert.equal(ContentFidelitySchema.parse('LOSSLESS_PREVIEW'), 'LOSSLESS_PREVIEW');
    assert.throws(() => ContentFidelitySchema.parse('L0_RAW_TEXT'));

    // 4 presentation levels
    assert.equal(FidelityLevelSchema.parse('L0_RAW_TEXT'), 'L0_RAW_TEXT');
    assert.throws(() => FidelityLevelSchema.parse('RAW_BINARY'));
  });

  it('validates ProviderIdentitySchema for multi-account 6 AI capability', () => {
    const id = ProviderIdentitySchema.parse({
      provider: 'claude',
      profileId: 'claude-pro-workspace',
      profileName: 'Work Account',
      sessionId: 'sess_claude_001',
      partitionKey: 'persist:claude_work',
      capabilityVersion: '2.0.0',
      authStatus: 'AUTHENTICATED',
      evidenceProvenance: 'LIVE_WEB',
    });
    assert.equal(id.provider, 'claude');
    assert.equal(id.authStatus, 'AUTHENTICATED');
  });

  it('validates TaskNodeSchema for DAG task graph execution', () => {
    const node = TaskNodeSchema.parse({
      taskId: 'task_root_001',
      nodeId: 'node_review_01',
      name: 'Leader Architecture Review',
      dependencies: ['node_intake_00'],
      assignedRole: 'LEADER',
      assignedProvider: 'chatgpt',
      revision: 1,
      attempt: 1,
      correlationId: 'corr_review_123',
      recoveryState: 'PENDING',
    });
    assert.equal(node.nodeId, 'node_review_01');
    assert.equal(node.recoveryState, 'PENDING');
  });

  it('validates ApprovalTokenSchema with SHA256 digest', () => {
    const digest = 'e'.repeat(64);
    const token = ApprovalTokenSchema.parse({
      tokenId: 'tok_appr_001',
      actionType: 'EXEC_CLI',
      payloadDigest: digest,
      origin: 'ui:main-window',
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    assert.equal(token.status, 'PENDING');
    assert.equal(token.payloadDigest, digest);

    assert.throws(() => {
      ApprovalTokenSchema.parse({
        tokenId: 'tok_bad',
        actionType: 'EXEC_CLI',
        payloadDigest: 'not-a-valid-sha256',
        origin: 'ui',
        createdAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
      });
    });
  });

  it('validates UnionBotErrorCodeSchema for structured error taxonomy', () => {
    assert.equal(UnionBotErrorCodeSchema.parse('ERR_UNKNOWN_COST_DENIED'), 'ERR_UNKNOWN_COST_DENIED');
    assert.equal(UnionBotErrorCodeSchema.parse('ERR_UNTRUSTED_SENDER'), 'ERR_UNTRUSTED_SENDER');
    assert.equal(UnionBotErrorCodeSchema.parse('ERR_APPROVAL_EXPIRED'), 'ERR_APPROVAL_EXPIRED');
    assert.throws(() => UnionBotErrorCodeSchema.parse('UNKNOWN_RANDOM_ERROR'));
  });
});
