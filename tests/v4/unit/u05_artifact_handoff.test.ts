import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
// @ts-ignore
import { ArtifactHandoffService } from '../../../apps/desktop/src/services/artifact-handoff-service.cjs';
import { runMigrations } from '../../../packages/storage/src/migrations.ts';

describe('UB-V4-U05: Artifact Handoff & Multimodal Fidelity', () => {
  function setupTestDb() {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);
    return { nativeDb: db };
  }

  const VALID_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  it('U05-001: creates handoff in READY_FOR_RECEIVER state with valid CAS digest', () => {
    const storage = setupTestDb();
    const service = new ArtifactHandoffService(storage);

    const res = service.createHandoff({
      projectId: 'proj_handoff',
      sourceProvider: 'chatgpt_web',
      sourceTurnRef: 'turn_brief_001',
      targetProvider: 'antigravity',
      sha256: VALID_SHA,
      byteSize: 1024,
      mimeType: 'text/markdown',
      filename: 'spec.md',
    });

    assert.equal(res.success, true);
    assert.ok(res.handoff);
    assert.equal(res.handoff.state, 'READY_FOR_RECEIVER');
    assert.equal(res.handoff.sha256, VALID_SHA);

    // Verify stored in DB
    const stored = service.getHandoff(res.handoff.id);
    assert.ok(stored);
    assert.equal(stored.state, 'READY_FOR_RECEIVER');
    assert.equal(stored.target_provider, 'antigravity');
  });

  it('U05-002: rejects invalid SHA-256 digest format', () => {
    const storage = setupTestDb();
    const service = new ArtifactHandoffService(storage);

    const res = service.createHandoff({
      sourceProvider: 'antigravity',
      targetProvider: 'chatgpt_web',
      sha256: 'invalid_short_hash',
      byteSize: 100,
    });

    assert.equal(res.success, false);
    assert.equal(res.code, 'ERR_INVALID_CHECKSUM');
  });

  it('U05-003: quarantines dangerous executable files immediately', () => {
    const storage = setupTestDb();
    const service = new ArtifactHandoffService(storage);

    const res = service.createHandoff({
      sourceProvider: 'antigravity',
      targetProvider: 'chatgpt_web',
      sha256: VALID_SHA,
      byteSize: 2048,
      mimeType: 'application/x-msdownload',
      filename: 'malicious_payload.exe',
    });

    assert.equal(res.success, false);
    assert.equal(res.code, 'ERR_QUARANTINE_REJECTED');
    assert.equal(res.state, 'REJECTED_QUARANTINE');
    assert.ok(res.handoffId);

    // Verify record exists in DB in quarantined state
    const stored = service.getHandoff(res.handoffId);
    assert.ok(stored);
    assert.equal(stored.state, 'REJECTED_QUARANTINE');
  });

  it('U05-004: acknowledges handoff when verified by target receiver', () => {
    const storage = setupTestDb();
    const service = new ArtifactHandoffService(storage);

    const createRes = service.createHandoff({
      sourceProvider: 'chatgpt_web',
      targetProvider: 'antigravity',
      sha256: VALID_SHA,
      byteSize: 512,
      mimeType: 'application/json',
      filename: 'plan.json',
    });
    assert.equal(createRes.success, true);
    assert.ok(createRes.handoff);
    const handoffId = createRes.handoff.id;

    // Target acknowledges
    const ackRes = service.acknowledgeHandoff({
      handoffId,
      receiverProvider: 'antigravity',
      ackEvidenceRef: 'turn_exec_ack_001',
    });

    assert.equal(ackRes.success, true);
    assert.equal(ackRes.state, 'READ_ACKNOWLEDGED');

    const updated = service.getHandoff(handoffId);
    assert.equal(updated.state, 'READ_ACKNOWLEDGED');
    assert.equal(updated.ack_evidence_ref, 'turn_exec_ack_001');
  });

  it('U05-005: rejects acknowledgment from mismatched receiver', () => {
    const storage = setupTestDb();
    const service = new ArtifactHandoffService(storage);

    const createRes = service.createHandoff({
      sourceProvider: 'chatgpt_web',
      targetProvider: 'antigravity',
      sha256: VALID_SHA,
      byteSize: 512,
    });
    assert.ok(createRes.handoff);
    const handoffId = createRes.handoff.id;

    // Mismatched receiver tries to acknowledge
    const ackRes = service.acknowledgeHandoff({
      handoffId,
      receiverProvider: 'claude_web',
      ackEvidenceRef: 'turn_imposter',
    });

    assert.equal(ackRes.success, false);
    assert.equal(ackRes.code, 'ERR_TARGET_MISMATCH');
  });

  it('U05-006: supports explicit rejection with checksum failure flag', () => {
    const storage = setupTestDb();
    const service = new ArtifactHandoffService(storage);

    const createRes = service.createHandoff({
      sourceProvider: 'chatgpt_web',
      targetProvider: 'antigravity',
      sha256: VALID_SHA,
      byteSize: 512,
    });
    assert.ok(createRes.handoff);
    const handoffId = createRes.handoff.id;

    const rejectRes = service.rejectHandoff(handoffId, 'CHECKSUM', 'Byte length mismatch on disk');
    assert.equal(rejectRes, true);

    const updated = service.getHandoff(handoffId);
    assert.equal(updated.state, 'REJECTED_CHECKSUM');
    assert.equal(updated.ack_evidence_ref, 'Byte length mismatch on disk');
  });
});
