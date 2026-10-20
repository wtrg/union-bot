import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProviderSessionRegistry,
  DEFAULT_PROVIDER_ROLES,
} from '../src/index.ts';

describe('Phase P9: Provider Session Registry & Anti-Spoofing Tests', () => {
  it('P9-S01: Registers distinct backend sessions for all 6 providers with roles', () => {
    const registry = new ProviderSessionRegistry();

    const cgSession = registry.createSession({
      providerId: 'chatgpt',
      tabId: 'tab_cg_1',
      partition: 'persist:mcb-web-chatgpt',
    });
    assert.equal(cgSession.providerId, 'chatgpt');
    assert.equal(cgSession.assignedRole, 'LEADER');
    assert.ok(cgSession.sessionId.startsWith('wps_chatgpt_'));
    assert.ok(cgSession.sessionNonce.length >= 16);

    const gmSession = registry.createSession({
      providerId: 'gemini',
      tabId: 'tab_gm_1',
      partition: 'persist:mcb-web-gemini',
    });
    assert.equal(gmSession.assignedRole, 'RESEARCHER');

    const clSession = registry.createSession({
      providerId: 'claude',
      tabId: 'tab_cl_1',
      partition: 'persist:mcb-web-claude',
    });
    assert.equal(clSession.assignedRole, 'REVIEWER');

    const dsSession = registry.createSession({
      providerId: 'deepseek',
      tabId: 'tab_ds_1',
      partition: 'persist:mcb-web-deepseek',
    });
    assert.equal(dsSession.assignedRole, 'REVIEWER');

    const agSession = registry.createSession({
      providerId: 'antigravity',
      tabId: 'local_agent_antigravity',
      partition: 'local:antigravity',
    });
    assert.equal(agSession.assignedRole, 'IMPLEMENTER');

    const cxSession = registry.createSession({
      providerId: 'codex',
      tabId: 'local_agent_codex',
      partition: 'local:codex',
    });
    assert.equal(cxSession.assignedRole, 'QA_SECURITY');

    assert.equal(registry.getAllSessions().length, 6);
  });

  it('P9-S02: Lookups session by tabId, sessionId, and providerId', () => {
    const registry = new ProviderSessionRegistry();
    const session = registry.createSession({
      providerId: 'chatgpt',
      tabId: 'tab_test_lookup',
      partition: 'persist:test',
    });

    assert.equal(registry.getSessionByTab('tab_test_lookup')?.sessionId, session.sessionId);
    assert.equal(registry.getSessionById(session.sessionId)?.tabId, 'tab_test_lookup');
    assert.equal(registry.getSessionByProvider('chatgpt')?.sessionId, session.sessionId);
    assert.equal(registry.getSessionByTab('non_existent'), null);
  });

  it('P9-S03: Verifies cryptographic session nonces', () => {
    const registry = new ProviderSessionRegistry();
    const session = registry.createSession({
      providerId: 'claude',
      tabId: 'tab_nonce_test',
      partition: 'persist:test',
    });

    assert.equal(registry.verifySessionNonce(session.sessionId, session.sessionNonce), true);
    assert.equal(registry.verifySessionNonce(session.sessionId, 'wrong_nonce'), false);
    assert.equal(registry.verifySessionNonce('invalid_session_id', session.sessionNonce), false);
  });

  it('P9-S04: Anti-spoofing sender identity validation (Fail-closed)', () => {
    const registry = new ProviderSessionRegistry();
    const session = registry.createSession({
      providerId: 'chatgpt',
      tabId: 'tab_spoof_test',
      partition: 'persist:chatgpt',
      assignedRole: 'LEADER',
    });

    // Valid check
    const validCheck = registry.validateSenderIdentity({
      tabId: 'tab_spoof_test',
      claimedProvider: 'chatgpt',
      claimedRole: 'LEADER',
    });
    assert.equal(validCheck.valid, true);
    assert.equal(validCheck.session?.sessionId, session.sessionId);

    // Mismatched provider
    const providerMismatch = registry.validateSenderIdentity({
      tabId: 'tab_spoof_test',
      claimedProvider: 'claude',
    });
    assert.equal(providerMismatch.valid, false);
    assert.equal(providerMismatch.code, 'ERR_UNAUTHORIZED_ACTION');

    // Mismatched role
    const roleMismatch = registry.validateSenderIdentity({
      tabId: 'tab_spoof_test',
      claimedRole: 'QA_SECURITY',
    });
    assert.equal(roleMismatch.valid, false);
    assert.equal(roleMismatch.code, 'ERR_ROLE_MISMATCH');

    // Non-existent session
    const noSession = registry.validateSenderIdentity({
      tabId: 'tab_unregistered',
    });
    assert.equal(noSession.valid, false);
    assert.equal(noSession.code, 'ERR_PROVIDER_SESSION_NOT_FOUND');
  });

  it('P9-S05: Cleanly removes sessions when tab is closed', () => {
    const registry = new ProviderSessionRegistry();
    const session = registry.createSession({
      providerId: 'deepseek',
      tabId: 'tab_close_me',
      partition: 'persist:test',
    });

    assert.ok(registry.getSessionByTab('tab_close_me'));
    const removed = registry.removeSessionByTab('tab_close_me');
    assert.equal(removed, true);
    assert.equal(registry.getSessionByTab('tab_close_me'), null);
    assert.equal(registry.getSessionById(session.sessionId), null);
  });
});
