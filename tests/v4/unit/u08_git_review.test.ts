import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
// @ts-ignore
import { GitReviewService } from '../../../apps/desktop/src/services/git-review-service.cjs';
import { StorageEngine } from '../../../packages/storage/src/storage-engine.ts';

describe('UB-V4-U08: GitHub Push Approval & ChatGPT Code Review Loop', () => {
  it('U08-001: enforces strict fail-closed Git Safety (prohibits main, prohibits force-push)', () => {
    const service: any = new GitReviewService({
      allowedReviewBranch: 'feature/union-bot-v4-autonomous',
    });

    // Attempting push to main -> denied
    const pushMain = service.validatePushSafety({ branch: 'main' });
    assert.equal(pushMain.allowed, false);
    assert.equal(pushMain.code, 'ERR_FORBIDDEN_BRANCH');

    // Attempting push to master -> denied
    const pushMaster = service.validatePushSafety({ branch: 'master' });
    assert.equal(pushMaster.allowed, false);
    assert.equal(pushMaster.code, 'ERR_FORBIDDEN_BRANCH');

    // Attempting force push to review branch -> denied
    const forcePush = service.validatePushSafety({
      branch: 'feature/union-bot-v4-autonomous',
      forcePush: true,
    });
    assert.equal(forcePush.allowed, false);
    assert.equal(forcePush.code, 'ERR_FORCE_PUSH_DENIED');

    // Missing branch -> denied
    const emptyBranch = service.validatePushSafety({ branch: '' });
    assert.equal(emptyBranch.allowed, false);
    assert.equal(emptyBranch.code, 'ERR_BRANCH_REQUIRED');

    // Valid review branch without force push -> allowed
    const validPush = service.validatePushSafety({
      branch: 'feature/union-bot-v4-autonomous',
      forcePush: false,
    });
    assert.equal(validPush.allowed, true);
    assert.equal(validPush.branch, 'feature/union-bot-v4-autonomous');
  });

  it('U08-002: computes deterministic changeset digest for push approval', () => {
    const service: any = new GitReviewService();
    const d1 = service.computePushDigest({
      branch: 'feature/union-bot-v4-autonomous',
      headSha: '7051ff78de8cc657d76319f1d094e1ba3734ff7b',
      commitMessage: 'feat(v4-u07): implement WorkflowSupervisor',
      filesChanged: ['apps/desktop/src/main.js', 'package.json'],
    });

    // Order of files should be normalized/sorted deterministically
    const d2 = service.computePushDigest({
      branch: 'feature/union-bot-v4-autonomous',
      headSha: '7051ff78de8cc657d76319f1d094e1ba3734ff7b',
      commitMessage: 'feat(v4-u07): implement WorkflowSupervisor',
      filesChanged: ['package.json', 'apps/desktop/src/main.js'],
    });

    assert.equal(d1.digest, d2.digest);
    assert.equal(typeof d1.digest, 'string');
    assert.equal(d1.digest.length, 64);
  });

  it('U08-003: formats standardized review packets with zero-cost verification and QA status', () => {
    const service: any = new GitReviewService();
    const packet = service.generateReviewPacket({
      gate: 'U08',
      name: 'GitHub Push Approval & Review Loop',
      ticketIds: ['UB-V4-U08-001', 'UB-V4-U08-002'],
      headSha: '7051ff78de8cc657d76319f1d094e1ba3734ff7b',
      baseSha: '3f6210937b764e06bb115ebd1f0538962a4a9470',
      branch: 'feature/union-bot-v4-autonomous',
      summary: ['Fail-closed git safety', 'Standardized review packets'],
      criteriaEvidence: ['No push to main confirmed', 'Unit tests passing'],
    });

    assert.ok(packet.includes('# UNION BOT V4 — REVIEW PACKET U08'));
    assert.ok(packet.includes('`UB-V4-U08-001`'));
    assert.ok(packet.includes('`ZERO_COST_MANDATE`'));
    assert.ok(packet.includes('`COST_VERIFIED_LOCAL_EXECUTION`'));
    assert.ok(packet.includes('`PENDING_INDEPENDENT_QA`'));
  });

  it('U08-004 & U08-R04-01: enforces trusted review intake and anti-replay receipt consumption', () => {
    const service: any = new GitReviewService();
    const fullCommitSha = '7051ff78de8cc657d76319f1d094e1ba3734ff7b';

    // 1. Untrusted source attempting self-issuance -> strictly rejected (U08-R04-01)
    const selfIssue = service.intakeTrustedReview({
      source: 'RENDERER_UNTRUSTED',
      commitSha: fullCommitSha,
      evidence: { threadId: 'thread_123' },
    });
    assert.equal(selfIssue.success, false);
    assert.equal(selfIssue.code, 'ERR_UNTRUSTED_REVIEW_INTAKE');

    // 2. Truncated or invalid commit SHA -> rejected (must be full 40-char hex)
    const invalidSha = service.intakeTrustedReview({
      source: 'BROWSER_BRIDGE',
      commitSha: '7051ff7', // short SHA disallowed
      evidence: { threadId: 'thread_123' },
    });
    assert.equal(invalidSha.success, false);
    assert.equal(invalidSha.code, 'ERR_INVALID_COMMIT_SHA');

    // 3. Trusted review intake from verified BROWSER_BRIDGE -> success
    const validIntake = service.intakeTrustedReview({
      source: 'BROWSER_BRIDGE',
      reviewer: 'chatgpt_web',
      commitSha: fullCommitSha,
      gate: 'U08',
      changeSetId: 'cs_123',
      evidence: { threadId: 'thread_123', url: 'https://chatgpt.com/c/6ad64b63' },
    });
    assert.equal(validIntake.success, true);
    assert.ok(validIntake.receiptId.startsWith('rcpt_'));

    // 4. Raw text containing "LGTM" without receiptId -> status is strictly FEEDBACK_RECORDED (no fake approval)
    const unverified = service.parseReviewFeedback('LGTM! Báo cáo rất rõ ràng, đạt yêu cầu qua gate U08.');
    assert.equal(unverified.status, 'FEEDBACK_RECORDED');
    assert.equal(unverified.verifiedProvenance, false);

    // 5. Verified receipt with matching full 40-character commit SHA -> valid APPROVED
    const verified = service.parseReviewFeedback({
      feedbackText: 'LGTM! Báo cáo rất rõ ràng, đạt yêu cầu qua gate U08.',
      changeSetId: 'cs_123',
      receiptId: validIntake.receiptId,
      expectedCommitSha: fullCommitSha,
    });
    assert.equal(verified.status, 'APPROVED');
    assert.equal(verified.verifiedProvenance, true);
    assert.equal(verified.hasBlockingSev1, false);

    // 6. Anti-replay: Attempting to use the same receiptId a second time -> rejected
    const replayReceipt = service.parseReviewFeedback({
      feedbackText: 'LGTM! Báo cáo rất rõ ràng, đạt yêu cầu qua gate U08.',
      changeSetId: 'cs_123',
      receiptId: validIntake.receiptId,
      expectedCommitSha: fullCommitSha,
    });
    assert.equal(replayReceipt.status, 'CHANGES_REQUESTED');
    assert.equal(replayReceipt.code, 'ERR_RECEIPT_ALREADY_USED');

    // 7. Forged receiptId -> rejected
    const forged = service.parseReviewFeedback({
      feedbackText: 'LGTM! Gate passed.',
      changeSetId: 'cs_123',
      receiptId: 'rcpt_forged_fake_token_1234567890',
      expectedCommitSha: fullCommitSha,
    });
    assert.equal(forged.status, 'CHANGES_REQUESTED');
    assert.equal(forged.code, 'ERR_INVALID_REVIEW_RECEIPT');
  });

  // --- REGRESSION SUITE: ChatGPT Web Reviewer Findings (U08-R01 to U08-R05, R03-01..03, R04-01) ---

  it('U08-R01: blocks push to protected branches via refspec and argv injection', () => {
    const service: any = new GitReviewService();

    // 1. Refspec targeting main
    const r1 = service.validatePushSafety({ refspec: 'HEAD:refs/heads/main' });
    assert.equal(r1.allowed, false);
    assert.equal(r1.code, 'ERR_FORBIDDEN_BRANCH');

    // 2. Short refspec targeting master
    const r2 = service.validatePushSafety({ refspec: 'feature/my-feat:master' });
    assert.equal(r2.allowed, false);
    assert.equal(r2.code, 'ERR_FORBIDDEN_BRANCH');

    // 3. Force push refspec (+prefix)
    const r3 = service.validatePushSafety({ refspec: '+refs/heads/feature/union-bot-v4-autonomous' });
    assert.equal(r3.allowed, false);
    assert.equal(r3.code, 'ERR_FORCE_PUSH_DENIED');

    // 4. Force push refspec (+main)
    const r4 = service.validatePushSafety({ refspec: '+main' });
    assert.equal(r4.allowed, false);
    assert.equal(r4.code, 'ERR_FORCE_PUSH_DENIED');

    // 5. Valid feature refspec
    const r5 = service.validatePushSafety({ refspec: 'HEAD:feature/union-bot-v4-autonomous' });
    assert.equal(r5.allowed, true);
    assert.equal(r5.branch, 'feature/union-bot-v4-autonomous');

    // 6. Argv inspection: -f flag blocked
    const a1 = service.validatePushArgv(['origin', 'feature/union-bot-v4-autonomous', '-f']);
    assert.equal(a1.allowed, false);
    assert.equal(a1.code, 'ERR_FORCE_PUSH_DENIED');

    // 7. Argv inspection: --mirror blocked
    const a2 = service.validatePushArgv(['--mirror', 'origin']);
    assert.equal(a2.allowed, false);
    assert.equal(a2.code, 'ERR_FORCE_PUSH_DENIED');

    // 8. Argv inspection: positional argument targeting main blocked
    const a3 = service.validatePushArgv(['origin', 'refs/heads/main']);
    assert.equal(a3.allowed, false);
    assert.equal(a3.code, 'ERR_FORBIDDEN_BRANCH');
  });

  it('U08-R02 & U08-R03-01/03: strict 40-char Git HEAD inspection and fail-closed PermissionGrant', () => {
    const service: any = new GitReviewService();
    const storage = new StorageEngine();
    const now = Date.now();

    const pushDigest = '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff';
    const actualHead = service.getActualGitHead() || '7051ff78de8cc657d76319f1d094e1ba3734ff7b';

    // 1. Missing expectedHead or short expectedHead -> strictly denied (U08-R03-01, full 40-char required)
    const shortExpHead = service.validatePushExecution({
      branch: 'feature/union-bot-v4-autonomous',
      expectedHead: '7051ff7',
      permissionGrantId: 'grant-test-1',
      pushDigest,
      storage,
    });
    assert.equal(shortExpHead.allowed, false);
    assert.equal(shortExpHead.code, 'ERR_INVALID_EXPECTED_HEAD');

    // 2. Unreadable host Git HEAD -> fail-closed (U08-R03-01)
    const unreadableService: any = new GitReviewService({ repoRoot: 'C:\\NonExistent_Corrupted_Dir_123' });
    const unreadableHead = unreadableService.validatePushExecution({
      branch: 'feature/union-bot-v4-autonomous',
      expectedHead: actualHead,
      permissionGrantId: 'grant-test-1',
      pushDigest,
      storage,
    });
    assert.equal(unreadableHead.allowed, false);
    assert.equal(unreadableHead.code, 'ERR_GIT_HEAD_UNREADABLE');

    // 3. TOCTOU Head mismatch -> denied (U08-R03-01)
    const toctou = service.validatePushExecution({
      branch: 'feature/union-bot-v4-autonomous',
      expectedHead: '0000000000000000000000000000000000000000',
      permissionGrantId: 'grant-test-1',
      pushDigest,
      storage,
    });
    assert.equal(toctou.allowed, false);
    assert.equal(toctou.code, 'ERR_HEAD_MISMATCH');

    // 4. Missing grant -> strictly forbidden (Blocker 1)
    const noGrant = service.validatePushExecution({
      branch: 'feature/union-bot-v4-autonomous',
      expectedHead: actualHead,
      pushDigest,
      storage,
    });
    assert.equal(noGrant.allowed, false);
    assert.equal(noGrant.code, 'ERR_GRANT_REQUIRED');

    // 5. Save grant with full authority binding
    storage.savePermissionGrant({
      id: 'grant-u08-1',
      actor: 'antigravity',
      action: 'GIT_PUSH',
      repo: 'wtrg/union-bot',
      branch: 'feature/union-bot-v4-autonomous',
      payloadDigest: pushDigest,
      singleUse: true,
      used: false,
      expiresAt: now + 60000,
      createdAt: now,
    });

    // 6. Grant Immutability check: Attempt to overwrite existing grant must fail
    assert.throws(() => {
      storage.savePermissionGrant({
        id: 'grant-u08-1',
        actor: 'attacker',
        action: 'GIT_PUSH',
        repo: 'wtrg/union-bot',
        branch: 'feature/union-bot-v4-autonomous',
        payloadDigest: pushDigest,
        singleUse: true,
        used: false,
        expiresAt: now + 60000,
        createdAt: now,
      });
    });

    // 7. Legacy consume without constraints on GIT_PUSH is rejected (U08-R03-03)
    const legacyConsume = storage.consumePermissionGrant('grant-u08-1', pushDigest);
    assert.equal(legacyConsume, false);

    // 8. Authority constraint mismatch: wrong actor -> denied
    const wrongActor = service.validatePushExecution({
      branch: 'feature/union-bot-v4-autonomous',
      expectedHead: actualHead,
      permissionGrantId: 'grant-u08-1',
      pushDigest,
      storage,
      actor: 'unauthorized_agent',
    });
    assert.equal(wrongActor.allowed, false);
    assert.equal(wrongActor.code, 'ERR_PERMISSION_GRANT_INVALID');

    // 9. Successful execution consumes grant atomically
    const execValid = service.validatePushExecution({
      branch: 'feature/union-bot-v4-autonomous',
      expectedHead: actualHead,
      permissionGrantId: 'grant-u08-1',
      pushDigest,
      storage,
      actor: 'antigravity',
      repo: 'wtrg/union-bot',
    });
    assert.equal(execValid.allowed, true);
    assert.equal(execValid.grantConsumed, true);

    // 10. Replay attack: attempt to use the same grant again -> denied
    const execReplay = service.validatePushExecution({
      branch: 'feature/union-bot-v4-autonomous',
      expectedHead: actualHead,
      permissionGrantId: 'grant-u08-1',
      pushDigest,
      storage,
      actor: 'antigravity',
      repo: 'wtrg/union-bot',
    });
    assert.equal(execReplay.allowed, false);
    assert.equal(execReplay.code, 'ERR_PERMISSION_GRANT_INVALID');

    storage.close();
  });

  it('U08-R03: fail-closed feedback parsing when text contains both approved and changes_requested', () => {
    const service: any = new GitReviewService();
    const fullCommitSha = '7051ff78de8cc657d76319f1d094e1ba3734ff7b';
    const intake = service.intakeTrustedReview({
      source: 'BROWSER_BRIDGE',
      reviewer: 'chatgpt_web',
      commitSha: fullCommitSha,
      gate: 'U08',
      evidence: { threadId: 'thread_123' },
    });

    // Text mentioning LGTM or approved in the context of changes requested
    const conflicting = `
    Kính gửi Antigravity,
    Kết luận sơ bộ: CHANGES_REQUESTED — FIX_REQUIRED.
    Trước đó gate U07 đã APPROVED và LGTM. Nhưng hiện tại có 2 blocker nghiêm trọng:
    U08-R01: SEV1 git-review-service.cjs:24: validatePushSafety chưa kiểm tra refspec.
    Cần sửa gấp trước khi merge.
    `;

    const parsed = service.parseReviewFeedback({
      feedbackText: conflicting,
      changeSetId: 'cs_conflict',
      receiptId: intake.receiptId,
      expectedCommitSha: fullCommitSha,
    });
    assert.equal(parsed.status, 'CHANGES_REQUESTED');
    assert.equal(parsed.hasBlockingSev1, true);
    assert.ok(parsed.findingsCount >= 1);
  });

  it('U08-R04: idempotent feedback ingestion and SQLite persistence across database reloads', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ub-u08-test-'));
    const dbPath = path.join(tempDir, 'review-test.sqlite');

    try {
      const storage1 = new StorageEngine({ filename: dbPath });
      const service: any = new GitReviewService();

      const reviewerFeedback = `
      CHANGES_REQUESTED — FIX_REQUIRED
      U08-R01: SEV1 git-review-service.cjs:25: refspec targets forbidden branch.
      U08-R02: SEV2 main.js:5750: missing database ingestion for review findings.
      `;

      // 1. Ingest first time
      const res1 = service.ingestFeedbackAndPersist({
        storage: storage1,
        feedbackText: reviewerFeedback,
        changeSetId: 'cs_live_1',
        reviewer: 'chatgpt_web',
      });

      assert.equal(res1.status, 'CHANGES_REQUESTED');
      assert.equal(res1.insertedCount, 2);
      assert.equal(res1.duplicateCount, 0);

      // Verify in SQLite
      const findings1 = storage1.getReviewFindings('cs_live_1');
      assert.equal(findings1.length, 2);
      assert.equal(findings1[0].severity, 'SEV1');
      assert.equal(findings1[0].file, 'git-review-service.cjs');
      assert.equal(findings1[0].line, 25);
      assert.equal(findings1[1].severity, 'SEV2');
      assert.equal(findings1[1].file, 'main.js');

      // 2. Ingest same feedback a second time (Idempotent replay)
      const res2 = service.ingestFeedbackAndPersist({
        storage: storage1,
        feedbackText: reviewerFeedback,
        changeSetId: 'cs_live_1',
        reviewer: 'chatgpt_web',
      });

      assert.equal(res2.insertedCount, 0);
      assert.equal(res2.duplicateCount, 2);

      // Row count in database should still be strictly 2 (no duplicate rows)
      const findingsRecheck = storage1.getReviewFindings('cs_live_1');
      assert.equal(findingsRecheck.length, 2);

      // 3. Close database and reload with a fresh StorageEngine instance
      const storage2 = new StorageEngine({ filename: dbPath });
      const reloadedFindings = storage2.getReviewFindings('cs_live_1');

      assert.equal(reloadedFindings.length, 2);
      assert.equal(reloadedFindings[0].state, 'OPEN');
      assert.equal(reloadedFindings[0].severity, 'SEV1');
      assert.equal(reloadedFindings[0].description.includes('refspec targets forbidden branch'), true);

      // Update state to VERIFIED_FIXED
      const updated = storage2.updateReviewFindingState(reloadedFindings[0].id, 'VERIFIED_FIXED');
      assert.equal(updated, true);

      const openFindings = storage2.getReviewFindings('cs_live_1', 'OPEN');
      assert.equal(openFindings.length, 1);
      const fixedFindings = storage2.getReviewFindings('cs_live_1', 'VERIFIED_FIXED');
      assert.equal(fixedFindings.length, 1);

      storage1.close();
      storage2.close();
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Safe temp ignore on locked Windows handles
      }
    }
  });
});
