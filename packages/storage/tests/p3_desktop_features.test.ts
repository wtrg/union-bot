import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { StorageServiceClient } = require('../../../apps/desktop/src/storage-service.cjs');

describe('Union Bot Phase P3: Desktop Workspace UI & Storage Features', () => {
  const testDir = path.join(os.tmpdir(), `union_bot_p3_test_${Date.now()}`);
  const dbPath = path.join(testDir, 'test_p3.db');
  const casDir = path.join(testDir, 'cas-store');
  let storage: any;

  before(async () => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(casDir, { recursive: true });
    storage = new StorageServiceClient(dbPath);
    await storage.ready;
  });

  after(async () => {
    if (storage) {
      await storage.closeAsync();
    }
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  test('P3-003: Dynamic Room Creation & Querying in SQLite WAL', async () => {
    // 1. Initial rooms should be empty or default
    const initialRooms = await storage.getRooms();
    assert.ok(Array.isArray(initialRooms));

    // 2. Create new room 'p3-testing'
    const newRoom = await storage.createRoom('p3-testing', 'Phase 3 Feature Room');
    assert.equal(newRoom.id, 'p3-testing');
    assert.equal(newRoom.name, 'Phase 3 Feature Room');

    // 3. Query rooms and assert new room exists
    const updatedRooms = await storage.getRooms();
    const found = updatedRooms.find((r: any) => r.id === 'p3-testing');
    assert.ok(found, 'Created room must exist in SQLite rooms table');
    assert.equal(found.name, 'Phase 3 Feature Room');
  });

  test('P3-004 & P3-005: Messages with File Attachments (PNG & PDF) Persisted in SQLite WAL', async () => {
    const roomId = 'p3-testing';

    // 1. Create simulated PNG attachment
    const fakePngBytes = Buffer.from('FakePNGContent_' + Date.now());
    const pngSha256 = crypto.createHash('sha256').update(fakePngBytes).digest('hex');
    fs.writeFileSync(path.join(casDir, pngSha256), fakePngBytes);

    // 2. Create simulated PDF attachment
    const fakePdfBytes = Buffer.from('%PDF-1.4 FakePDFContent_' + Date.now());
    const pdfSha256 = crypto.createHash('sha256').update(fakePdfBytes).digest('hex');
    fs.writeFileSync(path.join(casDir, pdfSha256), fakePdfBytes);

    // 3. Dispatch envelope with both attachments
    const envelope = {
      id: `env_p3_attach_${Date.now()}`,
      traceId: `trc_p3_${Date.now()}`,
      roomId,
      sender: { kind: 'user', id: 'usr_local', name: 'Tester', role: 'USER' },
      recipient: { kind: 'room', id: roomId },
      parts: [
        { kind: 'text', text: 'Here are the design assets (PNG) and specs (PDF).' },
        { kind: 'artifact', filename: 'architecture.png', mimeType: 'image/png', sizeBytes: fakePngBytes.length, sha256: pngSha256 },
        { kind: 'artifact', filename: 'requirements.pdf', mimeType: 'application/pdf', sizeBytes: fakePdfBytes.length, sha256: pdfSha256 },
      ],
      fidelity: 'L2_STANDALONE_ARTIFACT',
      timestamp: Date.now(),
    };

    const res = await storage.insertEnvelope(envelope);
    assert.ok(res.success, 'Envelope with attachments must insert successfully');

    // 4. Query room envelopes and verify attachments survive SQLite roundtrip
    const history = await storage.getRoomEnvelopes(roomId);
    assert.ok(history.length > 0);
    const retrieved = history.find((e: any) => e.id === envelope.id);
    assert.ok(retrieved, 'Envelope must be stored in SQLite');
    assert.equal(retrieved.parts.length, 3);
    assert.equal(retrieved.parts[1].filename, 'architecture.png');
    assert.equal(retrieved.parts[1].sha256, pngSha256);
    assert.equal(retrieved.parts[2].filename, 'requirements.pdf');
    assert.equal(retrieved.parts[2].sha256, pdfSha256);

    // 5. Verify CAS store bytes are authentic
    const readPng = fs.readFileSync(path.join(casDir, pngSha256));
    assert.deepEqual(readPng, fakePngBytes);
    const readPdf = fs.readFileSync(path.join(casDir, pdfSha256));
    assert.deepEqual(readPdf, fakePdfBytes);
  });

  test('P3-007 & P3-C01: Approval Inbox Token Lifecycle (Inspect, Reject, Approve)', async () => {
    const rawPayload = JSON.stringify({ action: 'format_disk_simulated', path: '/var/data' });
    const payloadDigest = crypto.createHash('sha256').update(rawPayload).digest('hex');

    // 1. Create a pending token
    const tokenData = {
      tokenId: `tok_p3_${Date.now()}`,
      actionType: 'format_disk_simulated',
      payloadDigest,
      origin: 'Test Harness',
      workspaceId: 'ws-p3',
      roomId: 'p3-testing',
      actorId: 'agent-dev',
      recipient: 'local-fs',
      status: 'PENDING',
      expiresInMs: 60000,
    };

    const token = await storage.createApprovalToken(tokenData);
    assert.ok(token);
    assert.equal(token.status, 'PENDING');

    // 2. List approvals (P3-007) and inspect complete details (P3-C01)
    const list = await storage.listApprovals(50);
    const target = list.find((t: any) => t.token_id === tokenData.tokenId);
    assert.ok(target, 'Token must appear in approval inbox');
    assert.equal(target.action_type, 'format_disk_simulated');
    assert.equal(target.payload_digest, payloadDigest, 'Immutable digest must match');
    assert.equal(target.workspace_id, 'ws-p3');
    assert.equal(target.room_id, 'p3-testing');

    // 3. Test Rejection from Approval Inbox
    const rejectRes = await storage.rejectToken(tokenData.tokenId, 'Unsafe path requested');
    assert.ok(rejectRes.success);

    // 4. Verify status is REJECTED in SQLite
    const updatedToken = await storage.getApprovalToken(tokenData.tokenId);
    assert.equal(updatedToken.status, 'REJECTED');
    assert.equal(updatedToken.rejection_reason, 'Unsafe path requested');

    // 5. Test another token: Approval path
    const approveTokenData = {
      tokenId: `tok_p3_app_${Date.now()}`,
      actionType: 'export_data',
      payloadDigest,
      origin: 'Renderer UI',
      workspaceId: 'ws-p3',
      roomId: 'p3-testing',
      actorId: 'user',
      status: 'PENDING',
      expiresInMs: 60000,
    };
    await storage.createApprovalToken(approveTokenData);
    const approveRes = await storage.approveToken(approveTokenData.tokenId, {
      id: 'operator-1',
      role: 'OPERATOR',
      isTrustedContext: true,
    });
    assert.ok(approveRes.success);
    const approvedToken = await storage.getApprovalToken(approveTokenData.tokenId);
    assert.equal(approvedToken.status, 'APPROVED');
  });

  test('P3-C03: Durable Restart Preservation (Close & Reopen preserves rooms and envelopes with attachments)', async () => {
    // 1. Close current storage connection
    await storage.closeAsync();

    // 2. Open brand new connection with the exact same DB path
    const reopenedStorage = new StorageServiceClient(dbPath);
    await reopenedStorage.ready;

    try {
      // 3. Verify 'p3-testing' room survived
      const rooms = await reopenedStorage.getRooms();
      const room = rooms.find((r: any) => r.id === 'p3-testing');
      assert.ok(room, 'Room must survive restart');

      // 4. Verify envelopes in 'p3-testing' survived with all attachments
      const history = await reopenedStorage.getRoomEnvelopes('p3-testing');
      assert.ok(history.length > 0, 'History must survive restart');
      const envWithAttach = history.find((e: any) => e.parts && e.parts.length === 3);
      assert.ok(envWithAttach, 'Envelope with attachments must survive restart');
      assert.equal(envWithAttach.parts[1].filename, 'architecture.png');
      assert.equal(envWithAttach.parts[2].filename, 'requirements.pdf');
    } finally {
      await reopenedStorage.closeAsync();
    }
  });
});
