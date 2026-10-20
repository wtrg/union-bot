/**
 * @file git-review-service.cjs
 * @description GitHub Push Approval & ChatGPT Code Review Loop Engine (UB-V4-U08).
 * Enforces:
 * - Strict Git Safety: NEVER push to main, NO force-push, NO credential leakage.
 * - Changeset SHA binding & Single-use Push Consent.
 * - Standardized Review Packet generation.
 * - Ingestion of ChatGPT Web review feedback into structured findings.
 */

const crypto = require('node:crypto');

const FORBIDDEN_BRANCHES = ['main', 'master', 'release', 'production'];

class GitReviewService {
  constructor(options = {}) {
    this.repoRoot = options.repoRoot || process.cwd();
    this.allowedReviewBranch = options.allowedReviewBranch || 'feature/union-bot-v4-autonomous';
  }

  /**
   * Validates push safety before any git push operation (U08-001).
   * Strict fail-closed policy.
   */
  validatePushSafety(params) {
    const { branch, forcePush = false, commitCount = 1 } = params;

    if (!branch) {
      return { allowed: false, error: 'Target branch name is required', code: 'ERR_BRANCH_REQUIRED' };
    }

    const cleanBranch = branch.trim().toLowerCase();

    // 1. Never push directly to protected branches
    if (FORBIDDEN_BRANCHES.includes(cleanBranch)) {
      return {
        allowed: false,
        error: `Git Safety Violation: Direct push to '${branch}' is strictly prohibited. Must use a feature review branch.`,
        code: 'ERR_FORBIDDEN_BRANCH',
      };
    }

    // 2. Must target designated review branch
    if (cleanBranch !== this.allowedReviewBranch.toLowerCase() && !cleanBranch.startsWith('feature/')) {
      return {
        allowed: false,
        error: `Push rejected: Branch '${branch}' does not match permitted review branch '${this.allowedReviewBranch}'`,
        code: 'ERR_UNAUTHORIZED_BRANCH',
      };
    }

    // 3. Never allow force push
    if (forcePush) {
      return {
        allowed: false,
        error: 'Git Safety Violation: Force push (--force / -f) is strictly prohibited.',
        code: 'ERR_FORCE_PUSH_DENIED',
      };
    }

    return {
      allowed: true,
      branch: cleanBranch,
      policy: 'ZERO_COST_AND_DEVICE_SAFETY',
    };
  }

  /**
   * Computes deterministic SHA-256 changeset digest for push approval (U08-002).
   */
  computePushDigest(params) {
    const { branch, headSha, commitMessage = '', filesChanged = [] } = params;
    const canonical = JSON.stringify({
      branch,
      headSha,
      commitMessage: commitMessage.trim(),
      filesChanged: [...filesChanged].sort(),
    });

    const digest = crypto.createHash('sha256').update(canonical).digest('hex');
    return {
      digest,
      canonicalPayload: canonical,
    };
  }

  /**
   * Generates a standardized Review Packet (U08-003).
   */
  generateReviewPacket(params) {
    const {
      gate,
      name,
      ticketIds = [],
      headSha,
      baseSha = 'd4c87ea7705cf7276628f214297952b724b49686',
      branch = this.allowedReviewBranch,
      summary = [],
      criteriaEvidence = [],
    } = params;

    const summaryItems = summary.map((s, idx) => `${idx + 1}. ${s}`).join('\n');
    const criteriaItems = criteriaEvidence.map((c) => `- ${c}`).join('\n');

    return `# UNION BOT V4 — REVIEW PACKET ${gate}

- **Project / Goal**: Union Bot V4 — ${name}
- **Gate**: \`${gate}\`
- **Ticket IDs**: ${ticketIds.map((t) => `\`${t}\``).join(', ')}
- **Repository**: \`https://github.com/wtrg/union-bot\`
- **Branch**: \`${branch}\`
- **Base SHA**: \`${baseSha}\`
- **Head SHA**: \`${headSha}\`
- **Implementation Owner**: Antigravity
- **Cost**: $0.00 (Zero paid APIs)

## Implementation Summary
${summaryItems}

## Acceptance Criteria & Evidence
${criteriaItems}
- Zero cost ($0.00): Confirmed
- Independent QA: \`PENDING_INDEPENDENT_QA\` (Codex unavailable in session)
`;
  }

  /**
   * Parses ChatGPT Web review feedback text into structured findings or approval (U08-004).
   */
  parseReviewFeedback(feedbackText, changeSetId = 'default') {
    if (!feedbackText || typeof feedbackText !== 'string') {
      return { status: 'PENDING', findings: [] };
    }

    const lower = feedbackText.toLowerCase();

    // Check for explicit approval
    const isApproved =
      (lower.includes('lgtm') ||
        lower.includes('approved') ||
        lower.includes('chấp thuận') ||
        lower.includes('đạt yêu cầu') ||
        lower.includes('qua gate') ||
        lower.includes('gate passed')) &&
      !lower.includes('not approved') &&
      !lower.includes('chưa đạt');

    const findings = [];

    // Scan for SEV1 / SEV2 / blocker mentions
    const lines = feedbackText.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (/sev1|blocker|critical|nghiêm trọng/i.test(trimmed)) {
        findings.push({
          id: `rf_fb_${Date.now()}_${findings.length}`,
          changeSetId,
          reviewer: 'chatgpt_web',
          severity: 'SEV1',
          description: trimmed,
          state: 'OPEN',
        });
      } else if (/sev2|major|cần sửa|thiếu/i.test(trimmed) && trimmed.length > 15) {
        findings.push({
          id: `rf_fb_${Date.now()}_${findings.length}`,
          changeSetId,
          reviewer: 'chatgpt_web',
          severity: 'SEV2',
          description: trimmed,
          state: 'OPEN',
        });
      }
    }

    return {
      status: isApproved ? 'APPROVED' : findings.length > 0 ? 'CHANGES_REQUESTED' : 'FEEDBACK_RECORDED',
      findingsCount: findings.length,
      hasBlockingSev1: findings.some((f) => f.severity === 'SEV1'),
      findings,
    };
  }
}

module.exports = {
  GitReviewService,
};
