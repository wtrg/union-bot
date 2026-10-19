import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { StorageServiceClient } = require('../../../apps/desktop/src/storage-service.cjs');
const { computeCanonicalDigest } = require('../../../apps/desktop/src/canonical-json.cjs');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations, rollbackMigration, CANONICAL_MIGRATION_2_CHECKSUM } = require('../src/migrations.ts');

describe('Union Bot Phase P3: Desktop Workspace UI & Storage Features', () => {
  const testDir = path.join(os.tmpdir(), `union_bot_p3_test_${Date.now()}`);
  const dbPath = path.join(testDir, 'test_p3.db');
  const casDir = path.join(testDir, 'cas-store');
  let storage: any;
  let savedPngBytes: Buffer;
  let savedPdfBytes: Buffer;

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
    savedPngBytes = fakePngBytes;
    const pngSha256 = crypto.createHash('sha256').update(fakePngBytes).digest('hex');
    fs.writeFileSync(path.join(casDir, pngSha256), fakePngBytes);

    // 2. Create simulated PDF attachment
    const fakePdfBytes = Buffer.from('%PDF-1.4 FakePDFContent_' + Date.now());
    savedPdfBytes = fakePdfBytes;
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
    const rawPayloadObj = { action: 'format_disk_simulated', path: '/var/data', riskLevel: 'HIGH', reversible: false };
    const rawPayload = JSON.stringify(rawPayloadObj);
    const payloadDigest = computeCanonicalDigest(rawPayloadObj);

    // 1. Create a pending token with real ActionIntent payload (UB-P3-R02-001)
    const tokenData = {
      tokenId: `tok_p3_${Date.now()}`,
      actionType: 'format_disk_simulated',
      payload: rawPayloadObj,
      payload_json: rawPayload,
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
    assert.ok(token.payload_json, 'payload_json must be stored on token');

    // 2. List approvals (P3-007) and inspect complete details (P3-C01, UB-P3-R02-001)
    const list = await storage.listApprovals(50);
    const target = list.find((t: any) => t.token_id === tokenData.tokenId);
    assert.ok(target, 'Token must appear in approval inbox');
    assert.equal(target.action_type, 'format_disk_simulated');
    assert.equal(target.payload_digest, payloadDigest, 'Immutable digest must match');
    assert.equal(target.workspace_id, 'ws-p3');
    assert.equal(target.room_id, 'p3-testing');
    assert.ok(target.payload_json, 'Canonical payload_json must be present');
    assert.equal(target.payload?.path, '/var/data', 'ActionIntent parameters must be parsed in payload');
    assert.equal(target.payload?.riskLevel, 'HIGH', 'ActionIntent risk parameters must be parsed');

    // 3. Test Rejection from Approval Inbox
    const rejectRes = await storage.rejectToken(tokenData.tokenId, 'Unsafe path requested');
    assert.ok(rejectRes.success);

    // 4. Verify status is REJECTED in SQLite
    const updatedToken = await storage.getApprovalToken(tokenData.tokenId);
    assert.equal(updatedToken.status, 'REJECTED');
    assert.equal(updatedToken.rejection_reason, 'Unsafe path requested');

    // 5. Test another token: Approval path
    const approveActionObj = { action: 'export_data', target: 'workspace' };
    const approveActionDigest = computeCanonicalDigest(approveActionObj);
    const approveTokenData = {
      tokenId: `tok_p3_app_${Date.now()}`,
      actionType: 'export_data',
      payload: approveActionObj,
      payloadDigest: approveActionDigest,
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

  test('UB-P3-R01-002: Project CRUD & Multi-Project Room Isolation in SQLite WAL', async () => {
    // 1. Create two separate projects
    const pAlpha = await storage.createProject('proj-alpha', 'Alpha Project', 'Main engineering stream');
    const pBeta = await storage.createProject('proj-beta', 'Beta Project', 'Security audit stream');
    assert.equal(pAlpha.id, 'proj-alpha');
    assert.equal(pBeta.id, 'proj-beta');

    // 2. Query all active projects
    const allProjects = await storage.getProjects();
    assert.ok(allProjects.some((p: any) => p.id === 'proj-alpha'));
    assert.ok(allProjects.some((p: any) => p.id === 'proj-beta'));

    // 3. Create rooms isolated to respective projects
    await storage.createRoom('room-alpha-1', 'Alpha Discussion', 'proj-alpha');
    await storage.createRoom('room-beta-1', 'Beta Discussion', 'proj-beta');

    // 4. Verify room isolation by project_id
    const alphaRooms = await storage.getRooms('proj-alpha');
    assert.ok(alphaRooms.some((r: any) => r.id === 'room-alpha-1'));
    assert.ok(!alphaRooms.some((r: any) => r.id === 'room-beta-1'), 'Alpha project must not contain Beta rooms');

    const betaRooms = await storage.getRooms('proj-beta');
    assert.ok(betaRooms.some((r: any) => r.id === 'room-beta-1'));
    assert.ok(!betaRooms.some((r: any) => r.id === 'room-alpha-1'), 'Beta project must not contain Alpha rooms');

    // 5. Test Project Rename
    const renameRes = await storage.renameProject('proj-alpha', 'Alpha Project Renamed');
    assert.ok(renameRes);
    const updatedProjects = await storage.getProjects();
    const renamed = updatedProjects.find((p: any) => p.id === 'proj-alpha');
    assert.equal(renamed.name, 'Alpha Project Renamed');

    // 6. Test Project Archive
    await storage.archiveProject('proj-beta');
    const activeAfterArchive = await storage.getProjects(false);
    assert.ok(!activeAfterArchive.some((p: any) => p.id === 'proj-beta'), 'Archived project must be excluded by default');

    const withArchived = await storage.getProjects(true);
    assert.ok(withArchived.some((p: any) => p.id === 'proj-beta'), 'Archived project must be included when requested');
  });

  test('UB-P3-R01-003: Durable Tasks Table in SQLite WAL', async () => {
    // 1. Create durable tasks in SQLite
    const task1 = await storage.createTask('Offline E2E Validation', {
      status: 'pending',
      progress: 0,
      roomId: 'p3-testing',
      metadata: { priority: 'high', role: 'QA_SECURITY' },
    });
    assert.ok(task1 && task1.id);
    assert.equal(task1.title, 'Offline E2E Validation');
    assert.equal(task1.status, 'pending');

    const task2 = await storage.createTask('CAS Byte Fidelity Verification', {
      status: 'running',
      progress: 50,
      roomId: 'p3-testing',
      metadata: { priority: 'critical', role: 'IMPLEMENTER' },
    });
    assert.ok(task2 && task2.id);

    // 2. List tasks from SQLite WAL
    const allTasks = await storage.listTasks();
    assert.ok(allTasks.some((t: any) => t.id === task1.id));
    assert.ok(allTasks.some((t: any) => t.id === task2.id));

    // 3. Filter by status
    const pendingTasks = await storage.listTasks({ status: 'pending' });
    assert.ok(pendingTasks.some((t: any) => t.id === task1.id));
    assert.ok(!pendingTasks.some((t: any) => t.id === task2.id));

    // 4. Update task status & progress
    const updateRes = await storage.updateTask(task1.id, {
      status: 'completed',
      progress: 100,
    });
    assert.ok(updateRes);

    const updatedTasks = await storage.listTasks();
    const completedTask = updatedTasks.find((t: any) => t.id === task1.id);
    assert.equal(completedTask.status, 'completed');
    assert.equal(completedTask.progress, 100);
  });

  test('UB-P3-R01-001 & UB-P3-R01-005: CAS Traversal Defense and Byte-for-Byte Buffer Fidelity', async () => {
    // 1. Path traversal defense simulation:
    const safeRegex = /^[a-f0-9]{64}$/i;
    const maliciousPaths = [
      '../../windows/system32/cmd.exe',
      '..\\..\\boot.ini',
      '/etc/passwd',
      '0123456789abcdef/../../malicious',
      'invalid-sha256-string',
    ];

    for (const badPath of maliciousPaths) {
      assert.equal(safeRegex.test(badPath), false, `Traversal attack '${badPath}' must be rejected by SHA-256 regex`);
    }

    // 2. Byte-for-byte CAS fidelity with authentic binary chunks (PNG header & PDF header)
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
    const pngHash = crypto.createHash('sha256').update(pngMagic).digest('hex');
    assert.equal(safeRegex.test(pngHash), true);

    const targetFile = path.resolve(casDir, pngHash);
    assert.ok(targetFile.startsWith(casDir + path.sep), 'Canonical path must remain inside casDir');
    fs.writeFileSync(targetFile, pngMagic);

    // Read back and compare buffers
    const readBackPng = fs.readFileSync(targetFile);
    assert.equal(Buffer.compare(pngMagic, readBackPng), 0, 'PNG magic bytes must be byte-for-byte identical');

    const pdfMagic = Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
    const pdfHash = crypto.createHash('sha256').update(pdfMagic).digest('hex');
    const targetPdf = path.resolve(casDir, pdfHash);
    fs.writeFileSync(targetPdf, pdfMagic);

    const readBackPdf = fs.readFileSync(targetPdf);
    assert.equal(Buffer.compare(pdfMagic, readBackPdf), 0, 'PDF bytes must be byte-for-byte identical');
  });

  test('P3-C03: Durable Restart Preservation (Close & Reopen preserves rooms, projects, tasks, and envelopes with attachments)', async () => {
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

      // 4. Verify projects survived restart
      const projs = await reopenedStorage.getProjects();
      const projAlpha = projs.find((p: any) => p.id === 'proj-alpha');
      assert.ok(projAlpha, 'Project must survive restart');
      assert.equal(projAlpha.name, 'Alpha Project Renamed');

      // 5. Verify tasks survived restart
      const tasks = await reopenedStorage.listTasks();
      assert.ok(tasks.length >= 2, 'Tasks must survive restart');
      const completedTask = tasks.find((t: any) => t.status === 'completed');
      assert.ok(completedTask, 'Completed task must survive restart');

      // 6. Verify envelopes in 'p3-testing' survived with all attachments AND byte-for-byte fidelity in CAS (UB-P3-R02-004)
      const history = await reopenedStorage.getRoomEnvelopes('p3-testing');
      assert.ok(history.length > 0, 'History must survive restart');
      const envWithAttach = history.find((e: any) => e.parts && e.parts.length === 3);
      assert.ok(envWithAttach, 'Envelope with attachments must survive restart');
      assert.equal(envWithAttach.parts[1].filename, 'architecture.png');
      assert.equal(envWithAttach.parts[2].filename, 'requirements.pdf');

      const reloadedPngBytes = fs.readFileSync(path.join(casDir, envWithAttach.parts[1].sha256));
      const reloadedPdfBytes = fs.readFileSync(path.join(casDir, envWithAttach.parts[2].sha256));
      assert.equal(Buffer.compare(savedPngBytes, reloadedPngBytes), 0, 'PNG attachment bytes must be byte-for-byte identical after restart (UB-P3-R02-004)');
      assert.equal(Buffer.compare(savedPdfBytes, reloadedPdfBytes), 0, 'PDF attachment bytes must be byte-for-byte identical after restart (UB-P3-R02-004)');

      // 7. Verify approval tokens and ActionIntent payloads survived restart (UB-P3-R02-001)
      const reloadedApprovals = await reopenedStorage.listApprovals(50);
      const reloadedToken = reloadedApprovals.find((t: any) => t.action_type === 'format_disk_simulated');
      assert.ok(reloadedToken, 'Approval token must survive restart');
      assert.ok(reloadedToken.payload_json, 'payload_json must survive restart');
      assert.equal(reloadedToken.payload?.path, '/var/data', 'ActionIntent parameters must survive restart');
      // Keep storage active for subsequent tests
      storage = reopenedStorage;
    } catch (err) {
      await reopenedStorage.closeAsync();
      throw err;
    }
  });

  test('P3-R04-F01: Backend rejects token creation when payload does not match supplied payloadDigest', async () => {
    const payloadA = { action: 'write_file', path: 'a.txt', content: 'original' };
    const payloadB = { action: 'write_file', path: 'b.txt', content: 'tampered' };
    const digestA = computeCanonicalDigest(payloadA);

    // Attempt to create token with payload B but digest A -> MUST REJECT
    await assert.rejects(
      async () => {
        await storage.createApprovalToken({
          tokenId: `tok_mismatch_${Date.now()}`,
          actionType: 'write_file',
          payload: payloadB,
          payloadDigest: digestA, // deliberately mismatched!
          origin: 'Test Runner',
          workspaceId: 'ws-p3',
          roomId: 'p3-testing',
        });
      },
      (err: any) => {
        assert.ok(err.message.includes('ERR_PAYLOAD_MISMATCH'), `Expected ERR_PAYLOAD_MISMATCH, got: ${err.message}`);
        return true;
      }
    );
  });

  test('P3-R04-F02: Direct approveToken rejects when stored payload_json does not match stored payload_digest', async () => {
    // 1. Create a legitimate token
    const legitimatePayload = { action: 'delete_file', path: 'delete_me.txt' };
    const legitimateDigest = computeCanonicalDigest(legitimatePayload);
    const tokenId = `tok_tamper_db_${Date.now()}`;
    await storage.createApprovalToken({
      tokenId,
      actionType: 'delete_file',
      payload: legitimatePayload,
      payloadDigest: legitimateDigest,
      origin: 'Test Runner',
      workspaceId: 'ws-p3',
      roomId: 'p3-testing',
    });

    // 2. Directly tamper with the SQLite database row (simulate malicious DB injection or corrupted disk)
    const directDb = new DatabaseSync(dbPath);
    try {
      directDb.prepare("UPDATE approvals SET payload_json = ? WHERE token_id = ?")
        .run(JSON.stringify({ action: 'delete_file', path: 'CRITICAL_SYSTEM_FILE.SYS' }), tokenId);
    } finally {
      directDb.close();
    }

    // 3. Attempt to approve this tampered token directly -> MUST REJECT fail-closed
    await assert.rejects(
      async () => {
        await storage.approveToken(tokenId, {
          id: 'admin-operator',
          role: 'OPERATOR',
          isTrustedContext: true,
        });
      },
      (err: any) => {
        assert.ok(err.message.includes('ERR_PAYLOAD_MISMATCH'), `Expected ERR_PAYLOAD_MISMATCH, got: ${err.message}`);
        return true;
      }
    );
  });

  test('P3-R04-F04: Migration 2 atomic rollback and re-apply cleans up columns and preserves DB integrity', async () => {
    const migDbPath = path.join(testDir, `mig_rollback_test_${Date.now()}.db`);
    const migDb = new DatabaseSync(migDbPath);
    try {
      // 1. Run migrations up to v2
      const upRes = runMigrations(migDb);
      assert.equal(upRes.currentVersion, 2, 'Migration must reach version 2');
      
      // Verify v2 tables and columns exist
      const tablesV2 = migDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r: any) => r.name);
      assert.ok(tablesV2.includes('projects'), 'projects table must exist in v2');
      assert.ok(tablesV2.includes('tasks'), 'tasks table must exist in v2');
      const roomColsV2 = migDb.prepare('PRAGMA table_info(rooms)').all().map((c: any) => c.name);
      assert.ok(roomColsV2.includes('project_id'), 'rooms.project_id must exist in v2');
      const approvalColsV2 = migDb.prepare('PRAGMA table_info(approvals)').all().map((c: any) => c.name);
      assert.ok(approvalColsV2.includes('payload_json'), 'approvals.payload_json must exist in v2');

      // 2. Execute atomic rollback of Migration 2
      const rollbackRes = rollbackMigration(migDb);
      assert.equal(rollbackRes.rolledBackVersion, 2, 'Migration 2 must be rolled back');

      // Verify tracker recorded max version 1
      const versionAfter = migDb.prepare('SELECT MAX(version) as v FROM schema_migrations').get() as { v: number };
      assert.equal(versionAfter.v, 1, 'Version must be rolled back to 1');

      // Verify v2 tables and added columns are cleanly dropped
      const tablesAfter = migDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r: any) => r.name);
      assert.ok(!tablesAfter.includes('projects'), 'projects table must be dropped');
      assert.ok(!tablesAfter.includes('tasks'), 'tasks table must be dropped');

      const roomColsAfter = migDb.prepare('PRAGMA table_info(rooms)').all().map((c: any) => c.name);
      assert.ok(!roomColsAfter.includes('project_id'), 'rooms.project_id must be dropped on rollback');

      const approvalColsAfter = migDb.prepare('PRAGMA table_info(approvals)').all().map((c: any) => c.name);
      assert.ok(!approvalColsAfter.includes('payload_json'), 'approvals.payload_json must be dropped on rollback');

      // 3. Re-apply migration 2 cleanly to version 2
      const reUpRes = runMigrations(migDb);
      assert.equal(reUpRes.currentVersion, 2, 'Migration must cleanly re-apply to version 2');
      assert.equal(reUpRes.appliedCount, 1, 'Exactly 1 migration should be applied');

      const rowsMig = migDb.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version ASC').all() as any[];
      assert.equal(rowsMig[1].version, 2);
      assert.equal(rowsMig[1].checksum, CANONICAL_MIGRATION_2_CHECKSUM, 'Checksum must match canonical migration 2');
    } finally {
      migDb.close();
    }
  });

  test('UB-P3-R04-G01: ActionIntent payload is strictly required for token creation and approval (fail-closed)', async () => {
    // 1. StorageServiceClient: Creation without payload is rejected
    await assert.rejects(
      async () => {
        await storage.createApprovalToken({
          tokenId: `tok_missing_payload_${Date.now()}`,
          actionType: 'delete_system_file',
          payloadDigest: computeCanonicalDigest({ target: 'file' }),
          origin: 'Test Runner',
        });
      },
      (err: any) => {
        assert.ok(err.message.includes('ERR_PAYLOAD_MISMATCH'), `Expected ERR_PAYLOAD_MISMATCH on creation, got: ${err.message}`);
        return true;
      }
    );

    // 2. StorageServiceClient: Creation with null payload is rejected
    await assert.rejects(
      async () => {
        await storage.createApprovalToken({
          tokenId: `tok_null_payload_${Date.now()}`,
          actionType: 'delete_system_file',
          payload: null,
          payloadDigest: computeCanonicalDigest({ target: 'file' }),
          origin: 'Test Runner',
        });
      },
      (err: any) => {
        assert.ok(err.message.includes('ERR_PAYLOAD_MISMATCH'), `Expected ERR_PAYLOAD_MISMATCH on null payload, got: ${err.message}`);
        return true;
      }
    );

    // 3. Approval rejection if stored payload_json is missing/null in DB
    const missingPayloadTokenId = `tok_missing_in_db_${Date.now()}`;
    const directDb = new DatabaseSync(dbPath);
    try {
      const dummyDigest = computeCanonicalDigest({ target: 'unreadable' });
      directDb.prepare(`
        INSERT INTO approvals (token_id, action_type, payload_digest, origin, workspace_id, room_id, status, payload_json, created_at, expires_at)
        VALUES (?, 'format_disk', ?, 'DirectSql', 'ws-test', 'room-test', 'PENDING', NULL, ?, ?)
      `).run(missingPayloadTokenId, dummyDigest, new Date().toISOString(), new Date(Date.now() + 60000).toISOString());
    } finally {
      directDb.close();
    }

    // Attempting to approve must fail-closed with ERR_PAYLOAD_MISMATCH
    await assert.rejects(
      async () => {
        await storage.approveToken(missingPayloadTokenId, {
          id: 'operator-1',
          role: 'OPERATOR',
          isTrustedContext: true,
        });
      },
      (err: any) => {
        assert.ok(err.message.includes('ERR_PAYLOAD_MISMATCH'), `Expected ERR_PAYLOAD_MISMATCH on approve, got: ${err.message}`);
        return true;
      }
    );
  });
});


