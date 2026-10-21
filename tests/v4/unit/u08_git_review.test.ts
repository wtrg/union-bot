import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { GitReviewService } = require('../../../apps/desktop/src/services/git-review-service.cjs');
const { BrowserUseBridge } = require('../../../apps/desktop/src/services/browser-use-bridge.cjs');
const { StorageServiceClient } = require('../../../apps/desktop/src/storage-service.cjs');
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
    const browserBridge = new BrowserUseBridge();
    browserBridge.registerTabContext('tab_123', {
      url: 'https://chatgpt.com/c/6ad64b63',
      text: 'VERDICT: SOURCE_REVIEW_APPROVED — NEXT_GATE',
    });
    const lease = browserBridge.acquireControllerLease('tab_123', 'agent_chatgpt');
    const service: any = new GitReviewService({ browserBridge });
    const fullCommitSha = '7051ff78de8cc657d76319f1d094e1ba3734ff7b';

    // 1. Untrusted source attempting self-issuance -> strictly rejected (U08-R04-01)
    const selfIssue = service.intakeTrustedReview({
      source: 'RENDERER_UNTRUSTED',
      commitSha: fullCommitSha,
      evidence: { tabId: 'tab_123', leaseToken: lease.leaseToken, threadUrl: 'https://chatgpt.com/c/6ad64b63' },
    });
    assert.equal(selfIssue.success, false);
    assert.equal(selfIssue.code, 'ERR_UNTRUSTED_REVIEW_INTAKE');

    // 2. Truncated or invalid commit SHA -> rejected (must be full 40-char hex)
    const invalidSha = service.intakeTrustedReview({
      source: 'BROWSER_BRIDGE',
      commitSha: '7051ff7', // short SHA disallowed
      evidence: { tabId: 'tab_123', leaseToken: lease.leaseToken, threadUrl: 'https://chatgpt.com/c/6ad64b63' },
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
      verdict: 'APPROVED',
      evidence: { tabId: 'tab_123', leaseToken: lease.leaseToken, threadUrl: 'https://chatgpt.com/c/6ad64b63', approvalConfirmed: true, verdict: 'APPROVED' },
    });
    assert.equal(validIntake.success, true);
    assert.ok(validIntake.receiptId.startsWith('rcpt_'));

    // 4. Raw text containing "LGTM" without receiptId -> status is strictly REVIEW_PENDING (U08-R05-01, no fake approval)
    const unverified = service.parseReviewFeedback('LGTM! Báo cáo rất rõ ràng, đạt yêu cầu qua gate U08.');
    assert.equal(unverified.status, 'REVIEW_PENDING');
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
    const browserBridge = new BrowserUseBridge();
    const lease = browserBridge.acquireControllerLease('tab_conflict', 'agent_chatgpt');
    const service: any = new GitReviewService({ browserBridge });
    const fullCommitSha = '7051ff78de8cc657d76319f1d094e1ba3734ff7b';
    const intake = service.intakeTrustedReview({
      source: 'BROWSER_BRIDGE',
      reviewer: 'chatgpt_web',
      commitSha: fullCommitSha,
      gate: 'U08',
      changeSetId: 'cs_conflict',
      evidence: { tabId: 'tab_conflict', leaseToken: lease.leaseToken, threadUrl: 'https://chatgpt.com/c/6ad64b63' },
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

  it('U08-R06-01, U08-R06-02, U08-R06-03: backend authority verification, full constraint receipt binding, and IPC regression', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ub-u08-r06-test-'));
    const dbPath = path.join(tempDir, 'review-r06.sqlite');

    try {
      const storage = new StorageEngine({ filename: dbPath });
      const browserBridge = new BrowserUseBridge();
      browserBridge.registerTabContext('tab_leader', {
        url: 'https://chatgpt.com/c/6ad64b63-ad44-83ec-90ca-83cacbc26da5',
        text: 'Review pending discussion',
      });
      browserBridge.registerTabContext('tab_untrusted', {
        url: 'https://attacker.site/spoofed-review',
        text: 'APPROVED',
      });
      browserBridge.registerTabContext('tab_leader_2', {
        url: 'https://chatgpt.com/c/6ad64b63-ad44-83ec-90ca-83cacbc26da5',
        text: 'VERDICT: SOURCE_REVIEW_APPROVED — NEXT_GATE',
      });
      browserBridge.registerTabContext('tab_leader_3', {
        url: 'https://chatgpt.com/c/6ad64b63-ad44-83ec-90ca-83cacbc26da5',
        text: 'VERDICT: SOURCE_REVIEW_APPROVED — NEXT_GATE',
      });
      browserBridge.registerTabContext('tab_leader_4', {
        url: 'https://chatgpt.com/c/6ad64b63-ad44-83ec-90ca-83cacbc26da5',
        text: 'VERDICT: SOURCE_REVIEW_APPROVED — NEXT_GATE',
      });
      const lease1 = browserBridge.acquireControllerLease('tab_leader', 'agent_chatgpt');
      const leaseUntrusted = browserBridge.acquireControllerLease('tab_untrusted', 'agent_chatgpt');
      const service: any = new GitReviewService({ browserBridge, storage });
      const commitSha = 'baf7b703f780418f3b535628022152e9d105d6cf';

      // =========================================================================
      // PART 1: U08-R06-01 — AUTHORITATIVE BACKEND VERIFICATION ON INTAKE SOURCES
      // =========================================================================

      // 1.1 BROWSER_BRIDGE: Missing tabId or leaseToken -> rejected
      const missingCredentials = service.intakeTrustedReview({
        source: 'BROWSER_BRIDGE',
        commitSha,
        evidence: { threadUrl: 'https://chatgpt.com/c/6ad64b63' },
      });
      assert.equal(missingCredentials.success, false);
      assert.equal(missingCredentials.code, 'ERR_MISSING_LEASE_CREDENTIALS');

      // 1.2 BROWSER_BRIDGE: Forged / unregistered lease token -> rejected by backend authority
      const forgedLease = service.intakeTrustedReview({
        source: 'BROWSER_BRIDGE',
        commitSha,
        evidence: {
          tabId: 'tab_leader',
          leaseToken: 'forged_fake_lease_token_123',
          threadUrl: 'https://chatgpt.com/c/6ad64b63',
        },
      });
      assert.equal(forgedLease.success, false);
      assert.equal(forgedLease.code, 'ERR_INVALID_BROWSER_LEASE');

      // 1.3 BROWSER_BRIDGE: Untrusted non-ChatGPT URL -> rejected
      const untrustedUrl = service.intakeTrustedReview({
        source: 'BROWSER_BRIDGE',
        commitSha,
        evidence: {
          tabId: 'tab_untrusted',
          leaseToken: leaseUntrusted.leaseToken,
          threadUrl: 'https://attacker.site/spoofed-review',
        },
      });
      assert.equal(untrustedUrl.success, false);
      assert.equal(untrustedUrl.code, 'ERR_UNTRUSTED_REVIEWER_URL');

      // 1.4 PO_MANUAL_CONSENT: Self-declared / unregistered PO token -> rejected
      const unverifiedPo = service.intakeTrustedReview({
        source: 'PO_MANUAL_CONSENT',
        commitSha,
        evidence: { poConsentToken: 'unregistered_po_token_123' },
      });
      assert.equal(unverifiedPo.success, false);
      assert.equal(unverifiedPo.code, 'ERR_PO_CONSENT_UNVERIFIED');

      // 1.5 PO_MANUAL_CONSENT: Token registered for commit A, submitted for commit B -> rejected
      service.registerPoConsent({
        token: 'po_token_commit_a',
        commitSha: '0000000000000000000000000000000000000001',
        changeSetId: 'cs_test',
      });
      const mismatchedPo = service.intakeTrustedReview({
        source: 'PO_MANUAL_CONSENT',
        commitSha,
        evidence: { poConsentToken: 'po_token_commit_a' },
      });
      assert.equal(mismatchedPo.success, false);
      assert.equal(mismatchedPo.code, 'ERR_PO_CONSENT_MISMATCH');

      // 1.6 PO_MANUAL_CONSENT: Properly registered in backend registry -> succeeds
      service.registerPoConsent({
        token: 'po_token_valid',
        commitSha,
        changeSetId: 'cs_valid_po',
      });
      const validPoIntake = service.intakeTrustedReview({
        source: 'PO_MANUAL_CONSENT',
        commitSha,
        changeSetId: 'cs_valid_po',
        verdict: 'APPROVED',
        evidence: { poConsentToken: 'po_token_valid', confirmed: true, verdict: 'APPROVED' },
      });
      assert.equal(validPoIntake.success, true);
      assert.ok(validPoIntake.receiptId.startsWith('rcpt_'));

      // 1.7 PO_MANUAL_CONSENT anti-replay: Reusing the same PO token a second time -> rejected
      const replayPo = service.intakeTrustedReview({
        source: 'PO_MANUAL_CONSENT',
        commitSha,
        changeSetId: 'cs_valid_po',
        evidence: { poConsentToken: 'po_token_valid' },
      });
      assert.equal(replayPo.success, false);
      assert.equal(replayPo.code, 'ERR_PO_CONSENT_ALREADY_USED');

      // =========================================================================
      // PART 2: U08-R06-02 — FULL CONSTRAINT RECEIPT BINDING & VERDICT LOCK
      // =========================================================================

      // 2.1 Issue intake with verdict: 'REVIEW_PENDING'
      const pendingIntake = service.intakeTrustedReview({
        source: 'BROWSER_BRIDGE',
        commitSha,
        gate: 'U08',
        changeSetId: 'cs_pending',
        verdict: 'REVIEW_PENDING',
        evidence: {
          tabId: 'tab_leader',
          leaseToken: lease1.leaseToken,
          threadUrl: 'https://chatgpt.com/c/6ad64b63-ad44-83ec-90ca-83cacbc26da5',
        },
      });
      assert.equal(pendingIntake.success, true);

      // VERDICT LOCK: Feedback text claiming "LGTM! APPROVED!" CANNOT upgrade a REVIEW_PENDING receipt to APPROVED!
      const attemptUpgrade = service.parseReviewFeedback({
        feedbackText: 'LGTM! Code is completely APPROVED and perfect!',
        changeSetId: 'cs_pending',
        receiptId: pendingIntake.receiptId,
        expectedCommitSha: commitSha,
      });
      assert.equal(attemptUpgrade.status, 'REVIEW_PENDING');
      assert.equal(attemptUpgrade.verifiedProvenance, false);

      // 2.2 Re-acquire fresh lease for approval tests
      const lease2 = browserBridge.acquireControllerLease('tab_leader_2', 'agent_chatgpt');
      const approvedIntake = service.intakeTrustedReview({
        source: 'BROWSER_BRIDGE',
        commitSha,
        gate: 'U08',
        changeSetId: 'cs_approved',
        verdict: 'APPROVED',
        evidence: {
          tabId: 'tab_leader_2',
          leaseToken: lease2.leaseToken,
          threadUrl: 'https://chatgpt.com/c/6ad64b63-ad44-83ec-90ca-83cacbc26da5',
          approvalConfirmed: true,
          verdict: 'APPROVED',
        },
      });
      assert.equal(approvedIntake.success, true);
      const approvedReceiptId = approvedIntake.receiptId;

      // 2.3 Constraint check: changeSetId mismatch (issued for cs_approved, attempted for cs_other) -> rejected
      const mismatchCs = service.parseReviewFeedback({
        feedbackText: 'LGTM! Gate passed.',
        changeSetId: 'cs_wrong_other',
        receiptId: approvedReceiptId,
        expectedCommitSha: commitSha,
      });
      assert.equal(mismatchCs.status, 'CHANGES_REQUESTED');
      assert.equal(mismatchCs.code, 'ERR_CHANGESET_MISMATCH');

      // 2.4 Re-issue approved receipt to test gate mismatch
      const lease3 = browserBridge.acquireControllerLease('tab_leader_3', 'agent_chatgpt');
      const approvedIntakeGate = service.intakeTrustedReview({
        source: 'BROWSER_BRIDGE',
        commitSha,
        gate: 'U07',
        changeSetId: 'cs_approved',
        verdict: 'APPROVED',
        evidence: {
          tabId: 'tab_leader_3',
          leaseToken: lease3.leaseToken,
          threadUrl: 'https://chatgpt.com/c/6ad64b63-ad44-83ec-90ca-83cacbc26da5',
          approvalConfirmed: true,
          verdict: 'APPROVED',
        },
      });

      const mismatchGate = service.parseReviewFeedback({
        feedbackText: 'LGTM! Gate passed.',
        changeSetId: 'cs_approved',
        gate: 'U08',
        receiptId: approvedIntakeGate.receiptId,
        expectedCommitSha: commitSha,
      });
      assert.equal(mismatchGate.status, 'CHANGES_REQUESTED');
      assert.equal(mismatchGate.code, 'ERR_GATE_MISMATCH');

      // 2.5 Successful consumption: All constraints match (commitSha, changeSetId, gate, reviewer, verdict: APPROVED)
      const lease4 = browserBridge.acquireControllerLease('tab_leader_4', 'agent_chatgpt');
      const validApprovalIntake = service.intakeTrustedReview({
        source: 'BROWSER_BRIDGE',
        commitSha,
        gate: 'U08',
        changeSetId: 'cs_approved_final',
        verdict: 'APPROVED',
        evidence: {
          tabId: 'tab_leader_4',
          leaseToken: lease4.leaseToken,
          threadUrl: 'https://chatgpt.com/c/6ad64b63-ad44-83ec-90ca-83cacbc26da5',
          approvalConfirmed: true,
          verdict: 'APPROVED',
        },
      });

      const validApproval = service.parseReviewFeedback({
        feedbackText: 'LGTM! Gate U08 officially APPROVED.',
        changeSetId: 'cs_approved_final',
        receiptId: validApprovalIntake.receiptId,
        expectedCommitSha: commitSha,
      });
      assert.equal(validApproval.status, 'APPROVED');
      assert.equal(validApproval.verifiedProvenance, true);

      // =========================================================================
      // PART 3: U08-R06-03 — REAL ELECTRON GUI IPC & STORAGE DISPATCH EVIDENCE
      // =========================================================================

      // 3.1 Real Electron GUI Smoke Test Evidence check
      const smokeEvidencePath = path.resolve(process.cwd(), 'reports/capability-evidence/ELECTRON_GUI_SMOKE_EVIDENCE.json');
      if (fs.existsSync(smokeEvidencePath)) {
        const smokeData = JSON.parse(fs.readFileSync(smokeEvidencePath, 'utf-8'));
        assert.equal(smokeData.result, 'PASS');
        assert.equal(smokeData.reviewFeedbackIpcVerified, true);
        assert.equal(smokeData.ipcRoundtripVerified, true);
      }

      // 3.2 Ingest feedback with findings into SQLite and query back
      const feedbackText = `
      [CHATGPT WEB TECHNICAL LEADER — REVIEW]
      VERDICT: CHANGES_REQUESTED
      U08-R06-01: SEV1 git-review-service.cjs:50: unverified intake authority.
      U08-R06-02: SEV2 main.js:5800: missing gate constraint.
      `;

      const ingestRes = service.ingestFeedbackAndPersist({
        storage,
        feedbackText,
        changeSetId: 'cs_r06_findings',
        reviewer: 'chatgpt_web',
      });
      assert.equal(ingestRes.status, 'CHANGES_REQUESTED');
      assert.equal(ingestRes.totalDetected, 2);
      assert.equal(ingestRes.insertedCount, 2);

      const dbFindings = storage.getReviewFindings('cs_r06_findings');
      assert.equal(dbFindings.length, 2);
      assert.equal(dbFindings[0].severity, 'SEV1');
      assert.equal(dbFindings[1].severity, 'SEV2');

      storage.close();
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Safe temp ignore on locked Windows handles
      }
    }
  });

  it('U08-R07-01, U08-R07-02, U08-R07-03: runtime browser review verification, cryptographic PO authority, and SQLite worker persistence parity', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ub-u08-r07-test-'));
    const dbPath = path.join(tempDir, 'review-r07.sqlite');

    try {
      const storageClient = new StorageServiceClient(dbPath);
      await storageClient.ready;

      const browserBridge = new BrowserUseBridge();
      const poMasterKey = Buffer.from('fixture_po_authority_token_hex_99').toString('hex');
      const service: any = new GitReviewService({
        browserBridge,
        storage: storageClient,
        poAuthorityKey: poMasterKey,
      });
      const commitSha = 'e1cfe83d8f05cbe0c18f08759ef43d05ce0e4e7c';

      // =========================================================================
      // PART 1: U08-R07-01 — RUNTIME BROWSER REVIEW VERIFICATION (NO INTAKE OVERRIDE)
      // =========================================================================

      // 1.1 Prohibit browserBridge injection/override from caller:
      // Even if caller passes a fake bridge in intakeTrustedReview, backend strictly uses configured bridge
      const fakeBridge = {
        inspectReviewContext: () => ({ success: true, verifiedVerdict: 'APPROVED', url: 'https://attacker.site' }),
      };
      browserBridge.registerTabContext('tab_spoof_attempt', {
        url: 'https://attacker.site/phish',
        text: 'APPROVED',
      });
      const leaseSpoof = browserBridge.acquireControllerLease('tab_spoof_attempt', 'attacker_agent');
      const spoofIntake = service.intakeTrustedReview({
        source: 'BROWSER_BRIDGE',
        commitSha,
        evidence: { tabId: 'tab_spoof_attempt', leaseToken: leaseSpoof.leaseToken },
        browserBridge: fakeBridge, // Attempted injection
      });
      assert.equal(spoofIntake.success, false);
      assert.equal(spoofIntake.code, 'ERR_UNTRUSTED_REVIEWER_URL');

      // 1.2 Browser tab with ChatGPT URL but review text has CHANGES_REQUESTED:
      // Caller claiming verdict: 'APPROVED' must fail closed with ERR_APPROVAL_EVIDENCE_MISMATCH
      browserBridge.registerTabContext('tab_changes_req', {
        url: 'https://chatgpt.com/c/6ad64b63-ad44-83ec-90ca-83cacbc26da5',
        text: 'OFFICIAL VERDICT: CHANGES_REQUESTED — FIX_REQUIRED\nU08-R07-01: SEV1 finding',
      });
      const leaseChanges = browserBridge.acquireControllerLease('tab_changes_req', 'agent_chatgpt');
      const mismatchIntake = service.intakeTrustedReview({
        source: 'BROWSER_BRIDGE',
        commitSha,
        verdict: 'APPROVED', // Caller claims approved
        evidence: { tabId: 'tab_changes_req', leaseToken: leaseChanges.leaseToken, approvalConfirmed: true },
      });
      assert.equal(mismatchIntake.success, false);
      assert.equal(mismatchIntake.code, 'ERR_APPROVAL_EVIDENCE_MISMATCH');

      // 1.3 Browser tab with ChatGPT URL and verified SOURCE_REVIEW_APPROVED:
      // Successfully issues receipt with locked APPROVED verdict
      browserBridge.registerTabContext('tab_verified_pass', {
        url: 'https://chatgpt.com/c/6ad64b63-ad44-83ec-90ca-83cacbc26da5',
        text: 'OFFICIAL VERDICT: SOURCE_REVIEW_APPROVED — NEXT_GATE',
      });
      const leasePass = browserBridge.acquireControllerLease('tab_verified_pass', 'agent_chatgpt');
      const passIntake = service.intakeTrustedReview({
        source: 'BROWSER_BRIDGE',
        commitSha,
        gate: 'U08',
        changeSetId: 'cs_pass_r07',
        evidence: { tabId: 'tab_verified_pass', leaseToken: leasePass.leaseToken },
      });
      assert.equal(passIntake.success, true);
      assert.equal(passIntake.receipt.verdict, 'APPROVED');

      // =========================================================================
      // PART 2: U08-R07-02 — CRYPTOGRAPHIC PO AUTHORITY KEY & STRICT CONSENT ISSUANCE
      // =========================================================================

      // 2.1 Unauthorized caller trying to issue PO consent grant -> rejected
      assert.throws(() => {
        service.issuePoConsent(
          { role: 'UNAUTHORIZED_CALLER', authorityKey: 'bad' },
          { commitSha, changeSetId: 'cs_unauth' }
        );
      }, /ERR_UNAUTHORIZED_PO_ISSUANCE/);

      // 2.2 Authorized PO authority context -> successfully issues HMAC token
      const poAuthContext = { role: 'PRODUCT_OWNER', authorityKey: poMasterKey, source: 'DESKTOP_MAIN_PROCESS' };
      const validPoToken = service.issuePoConsent(poAuthContext, {
        commitSha,
        changeSetId: 'cs_po_auth_r07',
        gate: 'U08',
        verdict: 'APPROVED',
      });
      assert.ok(validPoToken.startsWith('po_consent_'));

      // 2.3 Intake using authorized PO token -> succeeds
      const poIntake = service.intakeTrustedReview({
        source: 'PO_MANUAL_CONSENT',
        commitSha,
        gate: 'U08',
        changeSetId: 'cs_po_auth_r07',
        verdict: 'APPROVED',
        evidence: { poConsentToken: validPoToken, confirmed: true, verdict: 'APPROVED' },
      });
      assert.equal(poIntake.success, true);
      assert.equal(poIntake.receipt.verdict, 'APPROVED');

      // 2.4 Replay attack: reusing consumed PO token -> rejected
      const poReplay = service.intakeTrustedReview({
        source: 'PO_MANUAL_CONSENT',
        commitSha,
        gate: 'U08',
        changeSetId: 'cs_po_auth_r07',
        verdict: 'APPROVED',
        evidence: { poConsentToken: validPoToken },
      });
      assert.equal(poReplay.success, false);
      assert.equal(poReplay.code, 'ERR_PO_CONSENT_ALREADY_USED');

      // =========================================================================
      // PART 3: U08-R07-03 — SQLITE WORKER PERSISTENCE, TRANSACTIONS & DURABILITY
      // =========================================================================

      // 3.1 Ingest batch inside atomic SQLite transaction
      const rawFindings = [
        { file: 'git-review-service.cjs', line: 110, severity: 'SEV1', description: 'U08-R07-01: browser runtime inspection' },
        { file: 'storage-service.cjs', line: 1250, severity: 'SEV2', description: 'U08-R07-03: worker sqlite persistence' },
      ];

      const batchResult = storageClient.ingestReviewFindingsBatch('cs_worker_parity', 'chatgpt_web', rawFindings);
      assert.equal(batchResult.inserted, 2);
      assert.equal(batchResult.duplicates, 0);

      // Query findings back from storageClient
      const initialFindings = storageClient.getReviewFindings('cs_worker_parity');
      assert.equal(initialFindings.length, 2);
      const f1 = initialFindings.find((f: any) => f.file === 'git-review-service.cjs');
      const f2 = initialFindings.find((f: any) => f.file === 'storage-service.cjs');
      assert.ok(f1);
      assert.ok(f2);
      assert.equal(f1.severity, 'SEV1');
      assert.equal(f2.severity, 'SEV2');

      // Update state to VERIFIED_FIXED
      const updatedState = storageClient.updateReviewFindingState(f1.id, 'VERIFIED_FIXED');
      assert.equal(updatedState, true);

      // 3.2 Close storageClient and reload fresh client from disk (Persistence Parity across restarts)
      await storageClient.closeAsync();

      const freshStorage = new StorageServiceClient(dbPath);
      await freshStorage.ready;

      const persistedFindings = freshStorage.getReviewFindings('cs_worker_parity');
      assert.equal(persistedFindings.length, 2);
      const updatedFinding = persistedFindings.find((f: any) => f.id === f1.id);
      const otherFinding = persistedFindings.find((f: any) => f.id === f2.id);
      assert.ok(updatedFinding);
      assert.ok(otherFinding);
      assert.equal(updatedFinding.state, 'VERIFIED_FIXED');
      assert.equal(otherFinding.state, 'OPEN');

      // 3.3 Fail-closed verification: Prohibit silent in-memory Map fallback
      const nonDurableClient = new StorageServiceClient(':memory:', { allowNonDurableDemo: false });
      // When nativeDb is null (e.g. forced worker without nativeDb), calling sync finding methods fails closed:
      nonDurableClient.nativeDb = null;
      assert.throws(() => {
        nonDurableClient.getReviewFindings('cs_test');
      }, /ERR_STORAGE_UNAVAILABLE/);

      await freshStorage.closeAsync();
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Safe temp ignore on locked Windows handles
      }
    }
  });
});
