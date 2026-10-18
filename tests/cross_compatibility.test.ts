/**
 * @file tests/cross_compatibility.test.ts
 * @description Verifies 100% schema parity and behavior compatibility between
 * canonical TypeScript packages (@union-bot/protocol, @union-bot/orchestrator)
 * and the Electron Desktop CommonJS bundle (apps/desktop/src/orchestrator.cjs).
 * 
 * Prevents architectural drift between TypeScript monorepo and Electron desktop runtime.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Canonical TypeScript monorepo modules
import {
  EnvelopeSchema as CanonicalEnvelopeSchema,
  AdmissionActionSchema as CanonicalAdmissionActionSchema,
  RoleSchema as CanonicalRoleSchema,
  SenderKindSchema as CanonicalSenderKindSchema,
  RecipientKindSchema as CanonicalRecipientKindSchema,
  FidelityLevelSchema as CanonicalFidelityLevelSchema,
  ProviderKindSchema as CanonicalProviderKindSchema,
} from '../packages/protocol/src/schemas.ts';
import { AdmissionPolicyGate as CanonicalAdmissionGate } from '../packages/orchestrator/src/admission-gate.ts';

// Desktop CommonJS bundle
const require = createRequire(import.meta.url);
const {
  EnvelopeSchema: DesktopEnvelopeSchema,
  AdmissionActionSchema: DesktopAdmissionActionSchema,
  RoleSchema: DesktopRoleSchema,
  SenderKindSchema: DesktopSenderKindSchema,
  RecipientKindSchema: DesktopRecipientKindSchema,
  FidelityLevelSchema: DesktopFidelityLevelSchema,
  ProviderKindSchema: DesktopProviderKindSchema,
  AdmissionPolicyGate: DesktopAdmissionGate,
  Orchestrator: DesktopOrchestrator,
} = require('../apps/desktop/src/orchestrator.cjs');

describe('Monorepo TS vs Desktop CJS Cross-Compatibility & Parity Suite', () => {
  it('enum schemas have identical allowed values', () => {
    // 1. RoleSchema parity
    assert.deepEqual(
      CanonicalRoleSchema.options.slice().sort(),
      DesktopRoleSchema.options.slice().sort(),
      'RoleSchema options must match exactly'
    );

    // 2. SenderKindSchema parity
    assert.deepEqual(
      CanonicalSenderKindSchema.options.slice().sort(),
      DesktopSenderKindSchema.options.slice().sort(),
      'SenderKindSchema options must match exactly'
    );

    // 3. RecipientKindSchema parity
    assert.deepEqual(
      CanonicalRecipientKindSchema.options.slice().sort(),
      DesktopRecipientKindSchema.options.slice().sort(),
      'RecipientKindSchema options must match exactly'
    );

    // 4. FidelityLevelSchema parity
    assert.deepEqual(
      CanonicalFidelityLevelSchema.options.slice().sort(),
      DesktopFidelityLevelSchema.options.slice().sort(),
      'FidelityLevelSchema options must match exactly'
    );

    // 5. ProviderKindSchema parity
    assert.deepEqual(
      CanonicalProviderKindSchema.options.slice().sort(),
      DesktopProviderKindSchema.options.slice().sort(),
      'ProviderKindSchema options must match exactly'
    );
  });

  it('EnvelopeSchema parity across valid and invalid test vectors', () => {
    const testVectors = [
      // Vector 1: Valid minimal text envelope
      {
        payload: {
          id: 'env_compat_001',
          traceId: 'trc_compat_001',
          timestamp: 1729000000000,
          sender: { kind: 'user', id: 'usr_1', name: 'User', role: 'USER' },
          recipient: { kind: 'room', id: 'orchestration' },
          roomId: 'orchestration',
          fidelity: 'L0_RAW_TEXT',
          parts: [{ kind: 'text', text: 'Hello compatibility!' }],
        },
        shouldPass: true,
      },
      // Vector 2: Missing traceId
      {
        payload: {
          id: 'env_compat_002',
          timestamp: 1729000000000,
          sender: { kind: 'user', id: 'usr_1', name: 'User' },
          recipient: { kind: 'room', id: 'orchestration' },
          roomId: 'orchestration',
          fidelity: 'L0_RAW_TEXT',
          parts: [{ kind: 'text', text: 'Missing traceId' }],
        },
        shouldPass: false,
      },
      // Vector 3: Missing recipient
      {
        payload: {
          id: 'env_compat_003',
          traceId: 'trc_compat_003',
          timestamp: 1729000000000,
          sender: { kind: 'user', id: 'usr_1', name: 'User' },
          roomId: 'orchestration',
          fidelity: 'L0_RAW_TEXT',
          parts: [{ kind: 'text', text: 'Missing recipient' }],
        },
        shouldPass: false,
      },
      // Vector 4: Missing sender.kind
      {
        payload: {
          id: 'env_compat_004',
          traceId: 'trc_compat_004',
          timestamp: 1729000000000,
          sender: { id: 'usr_1', name: 'User' },
          recipient: { kind: 'room', id: 'orchestration' },
          roomId: 'orchestration',
          fidelity: 'L0_RAW_TEXT',
          parts: [{ kind: 'text', text: 'Missing sender.kind' }],
        },
        shouldPass: false,
      },
      // Vector 5: Empty parts array
      {
        payload: {
          id: 'env_compat_005',
          traceId: 'trc_compat_005',
          timestamp: 1729000000000,
          sender: { kind: 'user', id: 'usr_1', name: 'User' },
          recipient: { kind: 'room', id: 'orchestration' },
          roomId: 'orchestration',
          fidelity: 'L0_RAW_TEXT',
          parts: [],
        },
        shouldPass: false,
      },
      // Vector 6: Valid artifact part
      {
        payload: {
          id: 'env_compat_006',
          traceId: 'trc_compat_006',
          timestamp: 1729000000000,
          sender: { kind: 'agent', id: 'codex', name: 'Codex', role: 'QA_SECURITY', provider: 'codex' },
          recipient: { kind: 'room', id: 'orchestration' },
          roomId: 'orchestration',
          fidelity: 'L2_STANDALONE_ARTIFACT',
          parts: [{
            kind: 'artifact',
            filename: 'test.json',
            sha256: 'a'.repeat(64),
            mimeType: 'application/json',
            sizeBytes: 1024,
          }],
        },
        shouldPass: true,
      },
      // Vector 7: Invalid SHA256 in artifact part
      {
        payload: {
          id: 'env_compat_007',
          traceId: 'trc_compat_007',
          timestamp: 1729000000000,
          sender: { kind: 'agent', id: 'codex', name: 'Codex' },
          recipient: { kind: 'room', id: 'orchestration' },
          roomId: 'orchestration',
          fidelity: 'L2_STANDALONE_ARTIFACT',
          parts: [{
            kind: 'artifact',
            filename: 'test.json',
            sha256: 'not_a_valid_hex',
            mimeType: 'application/json',
            sizeBytes: 1024,
          }],
        },
        shouldPass: false,
      },
    ];

    for (const [idx, vector] of testVectors.entries()) {
      const canonicalResult = CanonicalEnvelopeSchema.safeParse(vector.payload);
      const desktopResult = DesktopEnvelopeSchema.safeParse(vector.payload);

      assert.equal(
        canonicalResult.success,
        vector.shouldPass,
        `Vector ${idx} canonical parse must match expected: ${vector.shouldPass}`
      );
      assert.equal(
        desktopResult.success,
        vector.shouldPass,
        `Vector ${idx} desktop parse must match expected: ${vector.shouldPass}`
      );
      assert.equal(
        canonicalResult.success,
        desktopResult.success,
        `Vector ${idx} canonical and desktop parses must have 100% parity`
      );
    }
  });

  it('AdmissionPolicyGate parity across action cost policies', () => {
    const canonicalGate = new CanonicalAdmissionGate();
    const desktopGate = new DesktopAdmissionGate();

    const actionVectors = [
      // 1. Explicit zero-cost web DOM read
      {
        action: {
          actionId: 'act_compat_001',
          actionType: 'READ_WEB_DOM',
          provider: 'chatgpt',
          estimatedCost: 0,
          requestedBy: 'user_1',
          targetUrl: 'https://chatgpt.com',
        },
        expectedAllowed: true,
        expectedPolicy: 'ALLOW_ZERO_COST',
      },
      // 2. Missing estimatedCost => DENY_UNKNOWN_COST
      {
        action: {
          actionId: 'act_compat_002',
          actionType: 'READ_WEB_DOM',
          provider: 'chatgpt',
          requestedBy: 'user_1',
        },
        expectedAllowed: false,
        expectedPolicy: 'DENY_UNKNOWN_COST',
      },
      // 3. Paid action with paid_api_enabled: false => DENY_PAID_API_DISABLED
      {
        action: {
          actionId: 'act_compat_003',
          actionType: 'SEND_PROMPT',
          provider: 'chatgpt',
          estimatedCost: 0.05,
          requestedBy: 'user_1',
        },
        expectedAllowed: false,
        expectedPolicy: 'DENY_PAID_API_DISABLED',
      },
      // 4. Undefined estimatedCost => DENY_UNKNOWN_COST
      {
        action: {
          actionId: 'act_compat_004',
          actionType: 'SEND_PROMPT',
          provider: 'chatgpt',
          estimatedCost: undefined,
          requestedBy: 'user_1',
        },
        expectedAllowed: false,
        expectedPolicy: 'DENY_UNKNOWN_COST',
      },
    ];

    for (const [idx, vector] of actionVectors.entries()) {
      const canonicalDec = canonicalGate.evaluate(vector.action);
      const desktopDec = desktopGate.evaluate(vector.action);

      assert.equal(
        canonicalDec.allowed,
        vector.expectedAllowed,
        `Action ${idx} canonical allowed must be ${vector.expectedAllowed}`
      );
      assert.equal(
        desktopDec.allowed,
        vector.expectedAllowed,
        `Action ${idx} desktop allowed must be ${vector.expectedAllowed}`
      );
      assert.equal(
        canonicalDec.policyCode,
        vector.expectedPolicy,
        `Action ${idx} canonical policyCode must be ${vector.expectedPolicy}`
      );
      assert.equal(
        desktopDec.policyCode,
        vector.expectedPolicy,
        `Action ${idx} desktop policyCode must be ${vector.expectedPolicy}`
      );
    }
  });
});
