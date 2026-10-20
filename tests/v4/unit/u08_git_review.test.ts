import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore
import { GitReviewService } from '../../../apps/desktop/src/services/git-review-service.cjs';

describe('UB-V4-U08: GitHub Push Approval & ChatGPT Code Review Loop', () => {
  it('U08-001: enforces strict fail-closed Git Safety (prohibits main, prohibits force-push)', () => {
    const service = new GitReviewService({
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
    const service = new GitReviewService();
    const d1 = service.computePushDigest({
      branch: 'feature/union-bot-v4-autonomous',
      headSha: '742588c',
      commitMessage: 'feat(v4-u07): implement WorkflowSupervisor',
      filesChanged: ['apps/desktop/src/main.js', 'package.json'],
    });

    // Order of files should be normalized/sorted deterministically
    const d2 = service.computePushDigest({
      branch: 'feature/union-bot-v4-autonomous',
      headSha: '742588c',
      commitMessage: 'feat(v4-u07): implement WorkflowSupervisor',
      filesChanged: ['package.json', 'apps/desktop/src/main.js'],
    });

    assert.equal(d1.digest, d2.digest);
    assert.equal(typeof d1.digest, 'string');
    assert.equal(d1.digest.length, 64);
  });

  it('U08-003: formats standardized review packets with zero-cost verification and QA status', () => {
    const service = new GitReviewService();
    const packet = service.generateReviewPacket({
      gate: 'U08',
      name: 'GitHub Push Approval & Review Loop',
      ticketIds: ['UB-V4-U08-001', 'UB-V4-U08-002'],
      headSha: 'abc1234',
      baseSha: 'd4c87ea',
      branch: 'feature/union-bot-v4-autonomous',
      summary: ['Fail-closed git safety', 'Standardized review packets'],
      criteriaEvidence: ['No push to main confirmed', 'Unit tests passing'],
    });

    assert.ok(packet.includes('# UNION BOT V4 — REVIEW PACKET U08'));
    assert.ok(packet.includes('`UB-V4-U08-001`'));
    assert.ok(packet.includes('Zero cost ($0.00): Confirmed'));
    assert.ok(packet.includes('`PENDING_INDEPENDENT_QA`'));
  });

  it('U08-004: parses reviewer feedback into approval or actionable findings', () => {
    const service = new GitReviewService();

    // Approved feedback
    const approved = service.parseReviewFeedback('LGTM! Báo cáo rất rõ ràng, đạt yêu cầu qua gate U08.');
    assert.equal(approved.status, 'APPROVED');
    assert.equal(approved.hasBlockingSev1, false);

    // Feedback with SEV1 blocker
    const blocking = service.parseReviewFeedback(
      'Phát hiện lỗi blocker nghiêm trọng: Push safety chưa chặn master.\nCần sửa thêm test case.',
      'cs_123'
    );
    assert.equal(blocking.status, 'CHANGES_REQUESTED');
    assert.equal(blocking.hasBlockingSev1, true);
    assert.ok(blocking.findingsCount >= 1);
    const sev1 = blocking.findings.find((f: any) => f.severity === 'SEV1');
    assert.ok(sev1);
    assert.equal(sev1.changeSetId, 'cs_123');
  });
});
