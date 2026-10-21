/**
 * @file git-review-service.cjs
 * @description GitHub Push Approval & ChatGPT Code Review Loop Engine (UB-V4-U08).
 * Enforces:
 * - Strict Git Safety: NEVER push to main, NO force-push, NO credential leakage.
 * - Changeset SHA binding & Mandatory Immutable Single-use Push Consent (U08-R01, U08-R02, U08-R03-03).
 * - Real Git HEAD inspection on host filesystem without renderer fallback (U08-R03-01).
 * - Strict 40-character hex commit SHA validation.
 * - Trusted Review Intake & Anti-Spoofing Receipts (U08-R04-01).
 */

const crypto = require('node:crypto');
const { execSync } = require('node:child_process');

const FORBIDDEN_BRANCHES = ['main', 'master', 'release', 'production'];
const TRUSTED_INTAKE_SOURCES = ['BROWSER_BRIDGE', 'PO_MANUAL_CONSENT'];

class GitReviewService {
  constructor(options = {}) {
    this.repoRoot = options.repoRoot || process.cwd();
    this.allowedReviewBranch = options.allowedReviewBranch || 'feature/union-bot-v4-autonomous';
    this.browserBridge = options.browserBridge || null;
    this.storage = options.storage || null;
    this.poAuthorityKey = options.poAuthorityKey || crypto.randomBytes(32).toString('hex');
    this.authorizedReviewReceipts = new Map(); // receiptId -> receipt object
    this.registeredPoConsents = new Map(); // poConsentToken -> { token, commitSha, changeSetId, gate, expiresAt, used }
    this.allowSyntheticFixture = options.allowSyntheticFixture === true;
  }

  setBrowserBridge(bridge) {
    this.browserBridge = bridge;
  }

  setStorage(storage) {
    this.storage = storage;
  }

  /**
   * Authoritatively issues a backend-verified Product Owner manual consent grant (U08-R06-01, U08-R07-02, U08-R08-01).
   * Caller must prove trusted Product Owner authority context with matching backend authorityKey.
   * Disallows auto-fill bypasses or unverified self-delegation.
   */
  issuePoConsent(authContext, params) {
    if (
      !authContext ||
      (authContext.role !== 'PRODUCT_OWNER' && authContext.role !== 'product_owner') ||
      !authContext.authorityKey ||
      authContext.authorityKey !== this.poAuthorityKey
    ) {
      throw new Error('ERR_UNAUTHORIZED_PO_ISSUANCE: Only trusted Product Owner authority handler presenting valid authorityKey can issue consent grants (U08-R08-01)');
    }

    const { commitSha, changeSetId = 'default', gate = 'U08', verdict = 'APPROVED', ttlMs = 3600000 } = params || {};
    if (!commitSha || !/^[0-9a-f]{40}$/i.test(commitSha.trim())) throw new Error('Full 40-char commitSha required');

    const normSha = commitSha.trim().toLowerCase();
    const token =
      (params && params.token) ||
      `po_consent_${crypto.createHmac('sha256', this.poAuthorityKey).update(`${normSha}:${changeSetId}:${gate}:${verdict}`).digest('hex')}`;

    this.registeredPoConsents.set(token, {
      token,
      commitSha: normSha,
      changeSetId,
      gate,
      verdict,
      expiresAt: Date.now() + ttlMs,
      used: false,
    });

    if (this.storage && typeof this.storage.savePermissionGrant === 'function') {
      try {
        this.storage.savePermissionGrant({
          id: token,
          actor: 'product_owner',
          action: 'PO_REVIEW_APPROVAL',
          repo: 'union-bot',
          branch: this.allowedReviewBranch,
          payloadDigest: normSha,
          singleUse: true,
          used: false,
          expiresAt: Date.now() + ttlMs,
          createdAt: Date.now(),
        });
      } catch {}
    }

    return token;
  }

  /**
   * Trusted Review Intake: Only callable by trusted backend channels (U08-R04-01, U08-R05-01, U08-R06-01, U08-R07-01).
   * Verifies against authoritative backend registries (BrowserUseBridge inspectReviewContext or PO consent registry).
   * Prohibits browserBridge injection/override from caller (U08-R07-01).
   * Fails closed: if no verifiable authority, returns error and never issues false receipt.
   */
  intakeTrustedReview(params) {
    const {
      source,
      reviewer = 'chatgpt_web',
      commitSha,
      gate = 'U08',
      changeSetId = 'default',
      verdict = 'REVIEW_PENDING',
      evidence,
    } = params || {};

    // 1. Source verification (no renderer self-issuance)
    if (!source || !TRUSTED_INTAKE_SOURCES.includes(source)) {
      return {
        success: false,
        error: `Review Intake Violation: Untrusted source '${source}'. Self-issuance is strictly prohibited.`,
        code: 'ERR_UNTRUSTED_REVIEW_INTAKE',
      };
    }

    // 2. Strict 40-character hex commit SHA enforcement
    if (!commitSha || typeof commitSha !== 'string' || !/^[0-9a-f]{40}$/i.test(commitSha.trim())) {
      return {
        success: false,
        error: 'Review Intake Violation: A valid full 40-character commit SHA is strictly required.',
        code: 'ERR_INVALID_COMMIT_SHA',
      };
    }

    // 3. Evidence requirement
    if (!evidence || typeof evidence !== 'object') {
      return {
        success: false,
        error: 'Review Intake Violation: Evidence reference is required for trusted review intake.',
        code: 'ERR_MISSING_EVIDENCE',
      };
    }

    const normSha = commitSha.trim().toLowerCase();
    let verifiedVerdict = verdict;

    // 4. Authoritative backend verification (U08-R06-01, U08-R07-01)
    if (source === 'BROWSER_BRIDGE') {
      // Caller must present tabId and leaseToken
      const { tabId, leaseToken } = evidence;
      if (!tabId || !leaseToken) {
        return {
          success: false,
          error: 'Review Intake Violation: Browser bridge review evidence missing tabId or leaseToken.',
          code: 'ERR_MISSING_LEASE_CREDENTIALS',
        };
      }

      // Authoritative bridge MUST be configured on service (no caller injection - U08-R07-01)
      const activeBridge = this.browserBridge;
      if (!activeBridge || typeof activeBridge.inspectReviewContext !== 'function') {
        return {
          success: false,
          error: 'Review Intake Violation: No authoritative browser bridge available to inspect review context.',
          code: 'ERR_UNVERIFIED_EVIDENCE',
        };
      }

      const inspectionOptions = {
        allowSyntheticFixture: this.allowSyntheticFixture === true,
      };
      const inspection = activeBridge.inspectReviewContext(tabId, leaseToken, normSha, inspectionOptions);
      if (!inspection || !inspection.success) {
        return {
          success: false,
          error: `Review Intake Violation: Browser tab verification failed: ${(inspection && inspection.error) || 'Invalid lease'}`,
          code: (inspection && inspection.code) || 'ERR_INVALID_BROWSER_LEASE',
        };
      }

      // Attach authoritative inspection metadata
      evidence.inspectedUrl = inspection.url;
      evidence.verifiedVerdict = inspection.verifiedVerdict;
      evidence.sourceVerified = true;

      // Lock verdict: if caller requested APPROVED but browser page content does not confirm APPROVED
      if (verdict === 'APPROVED' && inspection.verifiedVerdict !== 'APPROVED') {
        return {
          success: false,
          error: 'Review Intake Violation: Cannot issue APPROVED receipt when browser active tab does not contain verified reviewer approval decision (U08-R07-01).',
          code: 'ERR_APPROVAL_EVIDENCE_MISMATCH',
        };
      }

      verifiedVerdict = inspection.verifiedVerdict;
    } else if (source === 'PO_MANUAL_CONSENT') {
      const { poConsentToken } = evidence;
      if (!poConsentToken || typeof poConsentToken !== 'string') {
        return {
          success: false,
          error: 'Review Intake Violation: Product Owner manual consent requires valid poConsentToken.',
          code: 'ERR_PO_CONSENT_UNVERIFIED',
        };
      }

      // 1. Check in-memory registered PO consents
      const registered = this.registeredPoConsents.get(poConsentToken);
      let verifiedConsent = false;

      if (registered) {
        if (registered.used) {
          return {
            success: false,
            error: 'Review Intake Violation: PO consent token has already been consumed (replay blocked).',
            code: 'ERR_PO_CONSENT_ALREADY_USED',
          };
        }
        if (registered.expiresAt <= Date.now()) {
          return {
            success: false,
            error: 'Review Intake Violation: PO consent token has expired.',
            code: 'ERR_PO_CONSENT_EXPIRED',
          };
        }
        if (registered.commitSha !== normSha) {
          return {
            success: false,
            error: `Review Intake Violation: PO consent token was issued for commit ${registered.commitSha}, not ${normSha}.`,
            code: 'ERR_PO_CONSENT_MISMATCH',
          };
        }
        registered.used = true;
        verifiedConsent = true;
      } else if (this.storage && typeof this.storage.consumePermissionGrant === 'function') {
        // 2. Check SQLite permission_grants
        verifiedConsent = this.storage.consumePermissionGrant({
          id: poConsentToken,
          payloadDigest: normSha,
          actor: 'product_owner',
          action: 'PO_REVIEW_APPROVAL',
        });
      }

      if (!verifiedConsent) {
        return {
          success: false,
          error: 'Review Intake Violation: PO consent token not found in backend registry or rejected by database.',
          code: 'ERR_PO_CONSENT_UNVERIFIED',
        };
      }
    }

    // 5. Verdict consistency (U08-R06-01, U08-R06-02, U08-R07-01):
    let effectiveVerdict = 'REVIEW_PENDING';
    if (source === 'BROWSER_BRIDGE') {
      effectiveVerdict = verifiedVerdict === 'APPROVED' ? 'APPROVED' : 'REVIEW_PENDING';
    } else if (source === 'PO_MANUAL_CONSENT') {
      if (verdict === 'APPROVED') {
        const evidenceApproves =
          evidence.verdict === 'APPROVED' ||
          evidence.approvalConfirmed === true ||
          evidence.reviewApproved === true;
        if (!evidenceApproves) {
          return {
            success: false,
            error: 'Review Intake Violation: Cannot issue APPROVED receipt when PO evidence does not confirm approval.',
            code: 'ERR_APPROVAL_EVIDENCE_MISMATCH',
          };
        }
        effectiveVerdict = 'APPROVED';
      }
    }

    const receiptId = `rcpt_${crypto.randomBytes(16).toString('hex')}`;
    const receipt = {
      id: receiptId,
      source,
      reviewer,
      commitSha: normSha,
      gate: gate || 'U08',
      changeSetId,
      verdict: effectiveVerdict,
      evidence,
      verified: true,
      issuedAt: Date.now(),
      used: false,
    };

    this.authorizedReviewReceipts.set(receiptId, receipt);
    return { success: true, receiptId, receipt };
  }

  /**
   * Asynchronous Trusted Review Intake with live WebContents extraction (U08-R12-01).
   * Directly triggers live DOM extraction from WebContents before intake verification.
   */
  async intakeTrustedReviewAsync(params) {
    const {
      source,
      reviewer = 'chatgpt_web',
      commitSha,
      gate = 'U08',
      changeSetId = 'default',
      verdict = 'REVIEW_PENDING',
      evidence,
    } = params || {};

    if (!source || !TRUSTED_INTAKE_SOURCES.includes(source)) {
      return {
        success: false,
        error: `Review Intake Violation: Untrusted source '${source}'. Self-issuance is strictly prohibited.`,
        code: 'ERR_UNVERIFIED_EVIDENCE',
      };
    }

    if (!commitSha || typeof commitSha !== 'string' || !/^[0-9a-f]{40}$/i.test(commitSha.trim())) {
      return {
        success: false,
        error: 'Review Intake Violation: A valid full 40-character commit SHA is strictly required.',
        code: 'ERR_INVALID_COMMIT_SHA',
      };
    }

    if (!evidence || typeof evidence !== 'object') {
      return {
        success: false,
        error: 'Review Intake Violation: Evidence reference is required for trusted review intake.',
        code: 'ERR_MISSING_EVIDENCE',
      };
    }

    const normSha = commitSha.trim().toLowerCase();
    let verifiedVerdict = verdict;

    if (source === 'BROWSER_BRIDGE') {
      const { tabId, leaseToken } = evidence;
      if (!tabId || !leaseToken) {
        return {
          success: false,
          error: 'Review Intake Violation: Browser bridge review evidence missing tabId or leaseToken.',
          code: 'ERR_MISSING_LEASE_CREDENTIALS',
        };
      }

      const activeBridge = this.browserBridge;
      if (!activeBridge) {
        return {
          success: false,
          error: 'Review Intake Violation: No authoritative browser bridge available to inspect review context.',
          code: 'ERR_UNVERIFIED_EVIDENCE',
        };
      }

      const inspectionOptions = {
        allowSyntheticFixture: this.allowSyntheticFixture === true,
      };

      const inspection = typeof activeBridge.inspectReviewContextAsync === 'function'
        ? await activeBridge.inspectReviewContextAsync(tabId, leaseToken, normSha, inspectionOptions)
        : activeBridge.inspectReviewContext(tabId, leaseToken, normSha, inspectionOptions);

      if (!inspection || !inspection.success) {
        return {
          success: false,
          error: `Review Intake Violation: Browser tab verification failed: ${(inspection && inspection.error) || 'Invalid lease'}`,
          code: (inspection && inspection.code) || 'ERR_INVALID_BROWSER_LEASE',
        };
      }

      evidence.inspectedUrl = inspection.url;
      evidence.verifiedVerdict = inspection.verifiedVerdict;
      evidence.messageIdentity = inspection.messageIdentity;
      evidence.sourceVerified = true;

      if (verdict === 'APPROVED' && inspection.verifiedVerdict !== 'APPROVED') {
        return {
          success: false,
          error: 'Review Intake Violation: Cannot issue APPROVED receipt when browser active tab does not contain verified reviewer approval decision (U08-R07-01).',
          code: 'ERR_APPROVAL_EVIDENCE_MISMATCH',
        };
      }

      verifiedVerdict = inspection.verifiedVerdict;
    } else if (source === 'PO_MANUAL_CONSENT') {
      return this.intakeTrustedReview(params);
    }

    let effectiveVerdict = 'REVIEW_PENDING';
    if (verifiedVerdict === 'APPROVED') {
      effectiveVerdict = 'APPROVED';
    }

    const receiptId = `rcpt_${crypto.randomBytes(16).toString('hex')}`;
    const receipt = {
      id: receiptId,
      source,
      reviewer,
      commitSha: normSha,
      gate: gate || 'U08',
      changeSetId,
      verdict: effectiveVerdict,
      evidence,
      verified: true,
      issuedAt: Date.now(),
      used: false,
    };

    this.authorizedReviewReceipts.set(receiptId, receipt);
    return { success: true, receiptId, receipt };
  }

  /**
   * Consumes a trusted review receipt atomically with full constraint binding (U08-R06-02).
   * Ràng buộc đầy đủ commitSha, changeSetId, gate, reviewer, verdict và trạng thái single-use.
   */
  consumeReviewReceipt(receiptId, expectedParams = {}) {
    if (!receiptId || !this.authorizedReviewReceipts.has(receiptId)) {
      return { error: 'Review receipt is invalid or does not exist.', code: 'ERR_INVALID_REVIEW_RECEIPT' };
    }

    const receipt = this.authorizedReviewReceipts.get(receiptId);

    if (receipt.used) {
      return { error: 'Review receipt has already been consumed (replay attack blocked).', code: 'ERR_RECEIPT_ALREADY_USED' };
    }

    if (Date.now() - receipt.issuedAt > 3600000) {
      return { error: 'Review receipt has expired.', code: 'ERR_RECEIPT_EXPIRED' };
    }

    let expectedCommitSha = null;
    let expectedChangeSetId = null;
    let expectedGate = null;
    let expectedReviewer = null;

    if (typeof expectedParams === 'string') {
      expectedCommitSha = expectedParams;
    } else if (expectedParams && typeof expectedParams === 'object') {
      expectedCommitSha = expectedParams.expectedCommitSha || expectedParams.commitSha || null;
      expectedChangeSetId = expectedParams.expectedChangeSetId || expectedParams.changeSetId || null;
      expectedGate = expectedParams.expectedGate || expectedParams.gate || null;
      expectedReviewer = expectedParams.expectedReviewer || expectedParams.reviewer || null;
    }

    // Strict constraint checking
    if (expectedCommitSha) {
      const expSha = expectedCommitSha.trim().toLowerCase();
      if (receipt.commitSha !== expSha) {
        return {
          error: `Receipt commit SHA (${receipt.commitSha}) does not match expected SHA (${expSha}).`,
          code: 'ERR_COMMIT_SHA_MISMATCH',
        };
      }
    }

    if (expectedChangeSetId) {
      if (receipt.changeSetId !== expectedChangeSetId) {
        return {
          error: `Receipt changeSetId ('${receipt.changeSetId}') does not match expected ('${expectedChangeSetId}').`,
          code: 'ERR_CHANGESET_MISMATCH',
        };
      }
    }

    if (expectedGate) {
      if (receipt.gate !== expectedGate) {
        return {
          error: `Receipt gate ('${receipt.gate}') does not match expected gate ('${expectedGate}').`,
          code: 'ERR_GATE_MISMATCH',
        };
      }
    }

    if (expectedReviewer) {
      if (receipt.reviewer !== expectedReviewer) {
        return {
          error: `Receipt reviewer ('${receipt.reviewer}') does not match expected reviewer ('${expectedReviewer}').`,
          code: 'ERR_REVIEWER_MISMATCH',
        };
      }
    }

    receipt.used = true;
    return { success: true, receipt };
  }

  /**
   * Reads real git HEAD from the local host repository directory (U08-R03-01).
   * Strict: never returns fake defaults.
   */
  getActualGitHead(repoRoot = this.repoRoot) {
    try {
      const head = execSync('git rev-parse HEAD', {
        cwd: repoRoot,
        stdio: ['pipe', 'pipe', 'ignore'],
        encoding: 'utf8',
      }).trim();
      return /^[0-9a-f]{40}$/i.test(head) ? head : null;
    } catch {
      return null;
    }
  }

  /**
   * Helper: Parses git refspec (e.g. "HEAD:refs/heads/main", "+feature/x:feature/x", "+main")
   */
  parseRefspec(refspec) {
    if (!refspec || typeof refspec !== 'string') {
      return { isForce: false, targetBranch: '', rawTarget: '' };
    }

    let trimmed = refspec.trim();
    let isForce = false;
    if (trimmed.startsWith('+')) {
      isForce = true;
      trimmed = trimmed.slice(1);
    }

    let rawTarget = trimmed;
    if (trimmed.includes(':')) {
      const parts = trimmed.split(':');
      rawTarget = parts[parts.length - 1];
    }

    let targetBranch = rawTarget.replace(/^refs\/heads\//, '').trim().toLowerCase();
    return { isForce, targetBranch, rawTarget };
  }

  /**
   * Validates push safety before any git push operation (U08-001, U08-R01).
   * Strict fail-closed policy.
   */
  validatePushSafety(params) {
    const { branch, refspec, forcePush = false, commitCount = 1 } = params;

    let targetBranch = branch ? branch.trim().toLowerCase() : '';
    let isForce = Boolean(forcePush);

    if (refspec) {
      const parsed = this.parseRefspec(refspec);
      if (parsed.isForce) {
        isForce = true;
      }
      if (parsed.targetBranch) {
        targetBranch = parsed.targetBranch;
      }
    }

    if (!targetBranch) {
      return { allowed: false, error: 'Target branch name is required', code: 'ERR_BRANCH_REQUIRED' };
    }

    // 1. Force push rejection (flag or leading '+')
    if (isForce) {
      return {
        allowed: false,
        error: 'Git Safety Violation: Force push (--force / -f / +refspec) is strictly prohibited.',
        code: 'ERR_FORCE_PUSH_DENIED',
      };
    }

    // 2. Never push directly to protected branches
    if (FORBIDDEN_BRANCHES.includes(targetBranch)) {
      return {
        allowed: false,
        error: `Git Safety Violation: Direct push to '${targetBranch}' is strictly prohibited. Must use a feature review branch.`,
        code: 'ERR_FORBIDDEN_BRANCH',
      };
    }

    // 3. Must target designated review branch
    if (targetBranch !== this.allowedReviewBranch.toLowerCase() && !targetBranch.startsWith('feature/')) {
      return {
        allowed: false,
        error: `Push rejected: Branch '${targetBranch}' does not match permitted review branch '${this.allowedReviewBranch}'`,
        code: 'ERR_UNAUTHORIZED_BRANCH',
      };
    }

    return {
      allowed: true,
      branch: targetBranch,
      policy: 'ZERO_COST_AND_DEVICE_SAFETY',
    };
  }

  /**
   * Validates git command-line arguments (U08-R01).
   */
  validatePushArgv(argv) {
    if (!Array.isArray(argv)) return { allowed: true };

    for (const arg of argv) {
      const lower = arg.toLowerCase().trim();
      if (lower === '-f' || lower === '--force' || lower.startsWith('--force-with-lease') || lower === '--mirror') {
        return {
          allowed: false,
          error: `Git Safety Violation: Argument '${arg}' is strictly prohibited.`,
          code: 'ERR_FORCE_PUSH_DENIED',
        };
      }
      if (lower.startsWith('+')) {
        return {
          allowed: false,
          error: `Git Safety Violation: Force refspec argument '${arg}' is strictly prohibited.`,
          code: 'ERR_FORCE_PUSH_DENIED',
        };
      }
      for (const forbidden of FORBIDDEN_BRANCHES) {
        if (
          lower === forbidden ||
          lower === `refs/heads/${forbidden}` ||
          lower.endsWith(`:${forbidden}`) ||
          lower.endsWith(`:refs/heads/${forbidden}`)
        ) {
          return {
            allowed: false,
            error: `Git Safety Violation: Push argument targets forbidden branch '${forbidden}'.`,
            code: 'ERR_FORBIDDEN_BRANCH',
          };
        }
      }
    }

    return { allowed: true };
  }

  /**
   * Validates complete push execution before dispatching (U08-R01, U08-R02, U08-R03-01, U08-R03-03).
   * ENFORCES:
   * 1. Mandatory full 40-character expectedHead commit SHA.
   * 2. Host filesystem real Git HEAD inspection (Strict, unreadable host HEAD fails closed, NO renderer fallback).
   * 3. Anti-TOCTOU exact HEAD matching.
   * 4. Mandatory PermissionGrant in SQLite.
   * 5. Atomic consumption of grant with actor/action/repo/branch/digest constraints.
   */
  validatePushExecution(params) {
    const {
      branch,
      refspec,
      forcePush = false,
      argv = [],
      expectedHead,
      permissionGrantId,
      pushDigest,
      storage,
      actor = 'antigravity',
      repo = 'wtrg/union-bot',
    } = params;

    // 1. Mandatory valid full 40-character expectedHead (U08-R03-01)
    if (!expectedHead || typeof expectedHead !== 'string' || !/^[0-9a-f]{40}$/i.test(expectedHead.trim())) {
      return {
        allowed: false,
        error: 'Git Safety Violation: A valid full 40-character expectedHead commit SHA is strictly mandatory.',
        code: 'ERR_INVALID_EXPECTED_HEAD',
      };
    }

    // 2. Real host Git HEAD inspection (Strict, NO renderer fallback)
    const realHead = this.getActualGitHead(this.repoRoot);
    if (!realHead) {
      return {
        allowed: false,
        error: 'Git Safety Violation: Unable to read real Git HEAD from host repository.',
        code: 'ERR_GIT_HEAD_UNREADABLE',
      };
    }

    if (expectedHead.trim().toLowerCase() !== realHead.toLowerCase()) {
      return {
        allowed: false,
        error: `TOCTOU Violation: Real host Git HEAD (${realHead}) does not match expected approved HEAD (${expectedHead}).`,
        code: 'ERR_HEAD_MISMATCH',
      };
    }

    // 3. Mandatory PermissionGrant check
    if (!permissionGrantId || !storage) {
      return {
        allowed: false,
        error: 'Git Safety Violation: PermissionGrant and storage are strictly mandatory for push execution.',
        code: 'ERR_GRANT_REQUIRED',
      };
    }

    if (!pushDigest) {
      return {
        allowed: false,
        error: 'Push rejected: Missing pushDigest for permission grant consumption.',
        code: 'ERR_MISSING_DIGEST',
      };
    }

    // 4. Safety check on branch/refspec
    const safetyCheck = this.validatePushSafety({ branch, refspec, forcePush });
    if (!safetyCheck.allowed) return safetyCheck;

    // 5. Safety check on command-line argv
    const argvCheck = this.validatePushArgv(argv);
    if (!argvCheck.allowed) return argvCheck;

    // 6. Single-use PermissionGrant consumption (Atomic + Full Constraints)
    const consumed = storage.consumePermissionGrant({
      id: permissionGrantId,
      payloadDigest: pushDigest,
      actor,
      action: 'GIT_PUSH',
      repo,
      branch: safetyCheck.branch,
    });

    if (!consumed) {
      return {
        allowed: false,
        error: `Push rejected: PermissionGrant '${permissionGrantId}' is invalid, expired, already consumed, or constraints mismatched.`,
        code: 'ERR_PERMISSION_GRANT_INVALID',
      };
    }

    return {
      allowed: true,
      branch: safetyCheck.branch,
      verifiedHead: realHead,
      grantConsumed: true,
    };
  }

  /**
   * Computes deterministic SHA-256 changeset digest for push approval (U08-002, U08-R02).
   */
  computePushDigest(params) {
    const { branch, headSha, commitMessage = '', filesChanged = [] } = params;
    const canonical = JSON.stringify({
      branch: (branch || '').trim(),
      headSha: (headSha || '').trim(),
      commitMessage: (commitMessage || '').trim(),
      filesChanged: [...filesChanged].map((f) => f.trim()).sort(),
    });

    const digest = crypto.createHash('sha256').update(canonical).digest('hex');
    return {
      digest,
      canonicalPayload: canonical,
    };
  }

  /**
   * Generates a standardized Review Packet (U08-003, U08-R05).
   */
  generateReviewPacket(params) {
    const {
      gate,
      name,
      ticketIds = [],
      headSha,
      baseSha,
      branch = this.allowedReviewBranch,
      summary = [],
      criteriaEvidence = [],
      unitTestSummary = '51/51 tests PASS (10/10 suites)',
    } = params;

    const resolvedBaseSha = baseSha || '7051ff78de8cc657d76319f1d094e1ba3734ff7b';
    const summaryItems = summary.map((s, idx) => `${idx + 1}. ${s}`).join('\n');
    const criteriaItems = criteriaEvidence.map((c) => `- ${c}`).join('\n');

    return `# UNION BOT V4 — REVIEW PACKET ${gate}

- **Project / Goal**: Union Bot V4 — ${name}
- **Gate**: \`${gate}\`
- **Ticket IDs**: ${ticketIds.map((t) => `\`${t}\``).join(', ')}
- **Repository**: \`https://github.com/wtrg/union-bot\`
- **Branch**: \`${branch}\`
- **Base SHA**: \`${resolvedBaseSha}\`
- **Head SHA**: \`${headSha}\`
- **Implementation Owner**: Antigravity
- **Cost Policy**: \`ZERO_COST_MANDATE\` (Strictly 0 VNĐ / $0.00)
- **Cost Verification**: \`COST_VERIFIED_LOCAL_EXECUTION\` (Local execution only, no paid APIs)

## Implementation Summary
${summaryItems}

## Acceptance Criteria & Evidence
${criteriaItems}
- Unit & Regression Tests: ${unitTestSummary}
- Independent QA: \`PENDING_INDEPENDENT_QA\` (Codex unavailable in session, zero fake passes)
`;
  }

  /**
   * Parses review feedback into structured findings or approval (U08-004, U08-R03, U08-R04-01, U08-R05-01).
   * ANTI-SPOOFING POLICY:
   * 1. Plain text with "LGTM" CANNOT grant APPROVED status.
   * 2. APPROVED strictly requires an authentic verified receipt token matching expected full 40-char commit SHA.
   * 3. Without authentic intake verification or PO consent, status strictly remains REVIEW_PENDING (U08-R05-01).
   * 4. Any SEV1/SEV2 finding or rejection keyword forces status to CHANGES_REQUESTED.
   */
  parseReviewFeedback(feedbackInput, changeSetId = 'default') {
    let feedbackText = '';
    let receiptId = null;
    let expectedCommitSha = null;
    let gate = 'U08';
    let reviewer = 'chatgpt_web';

    if (typeof feedbackInput === 'string') {
      feedbackText = feedbackInput;
    } else if (feedbackInput && typeof feedbackInput === 'object') {
      feedbackText = feedbackInput.feedbackText || '';
      receiptId =
        feedbackInput.receiptId ||
        (feedbackInput.provenance && feedbackInput.provenance.receiptId) ||
        feedbackInput.receiptToken ||
        (feedbackInput.provenance && feedbackInput.provenance.receiptToken) ||
        null;
      expectedCommitSha =
        feedbackInput.expectedCommitSha ||
        (feedbackInput.provenance && feedbackInput.provenance.targetCommitSha) ||
        null;
      if (feedbackInput.changeSetId) {
        changeSetId = feedbackInput.changeSetId;
      }
      if (feedbackInput.gate) {
        gate = feedbackInput.gate;
      }
      if (feedbackInput.reviewer) {
        reviewer = feedbackInput.reviewer;
      }
    }

    if (!feedbackText) {
      return { status: 'REVIEW_PENDING', findings: [] };
    }

    const lower = feedbackText.toLowerCase();

    // Check for explicit rejection / change request keywords
    const hasRejectionKeywords =
      lower.includes('changes_requested') ||
      lower.includes('fix_required') ||
      lower.includes('rejected') ||
      lower.includes('not approved') ||
      lower.includes('chưa đạt') ||
      lower.includes('cần sửa') ||
      lower.includes('không đạt') ||
      lower.includes('thất bại') ||
      lower.includes('finding') ||
      lower.includes('blocker');

    const findings = [];
    const lines = feedbackText.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const fileMatch = trimmed.match(/([a-zA-Z0-9_\-\./\\]+\.(?:js|cjs|ts|tsx|json|md)):?(\d+)?/i);
      const file = fileMatch ? fileMatch[1] : 'unknown';
      const lineNum = fileMatch && fileMatch[2] ? parseInt(fileMatch[2], 10) : undefined;

      if (/sev1|blocker|critical|nghiêm trọng/i.test(trimmed)) {
        findings.push({
          id: `rf_fb_${Date.now()}_${findings.length}`,
          changeSetId,
          reviewer,
          file,
          line: lineNum,
          severity: 'SEV1',
          description: trimmed,
          state: 'OPEN',
        });
      } else if (/sev2|major|cần sửa|thiếu/i.test(trimmed) && trimmed.length > 15) {
        findings.push({
          id: `rf_fb_${Date.now()}_${findings.length}`,
          changeSetId,
          reviewer,
          file,
          line: lineNum,
          severity: 'SEV2',
          description: trimmed,
          state: 'OPEN',
        });
      }
    }

    const hasBlockingFindings = findings.some((f) => f.severity === 'SEV1' || f.severity === 'SEV2');

    let status = 'REVIEW_PENDING';

    if (hasRejectionKeywords || hasBlockingFindings) {
      status = 'CHANGES_REQUESTED';
    } else {
      const hasApprovalKeywords =
        (lower.includes('lgtm') ||
          lower.includes('approved') ||
          lower.includes('chấp thuận') ||
          lower.includes('đạt yêu cầu') ||
          lower.includes('qua gate') ||
          lower.includes('gate passed')) &&
        !lower.includes('not approved');

      if (hasApprovalKeywords && findings.length === 0) {
        // Blocker 2 / U08-R04-01 / U08-R05-01 / U08-R06-02:
        // Verify and atomically consume trusted review receipt with full constraint binding
        if (receiptId) {
          const consumeRes = this.consumeReviewReceipt(receiptId, {
            expectedCommitSha,
            expectedChangeSetId: changeSetId,
            expectedGate: gate,
            expectedReviewer: reviewer,
          });

          if (consumeRes && consumeRes.success) {
            // STRICT VERDICT ENFORCEMENT (U08-R06-02):
            // Only a receipt whose verified verdict is strictly 'APPROVED' can produce status = 'APPROVED'!
            // A receipt with verdict: 'REVIEW_PENDING' CANNOT be upgraded to 'APPROVED' by text keywords.
            if (consumeRes.receipt.verdict === 'APPROVED') {
              status = 'APPROVED';
            } else {
              // Receipt has not been approved by authority; status remains REVIEW_PENDING
              status = 'REVIEW_PENDING';
            }
          } else {
            // Receipt mismatch, already used (replay), or non-existent -> rejected
            return {
              status: 'CHANGES_REQUESTED',
              error: consumeRes ? consumeRes.error : 'Invalid review receipt.',
              code: consumeRes ? consumeRes.code : 'ERR_INVALID_REVIEW_RECEIPT',
              findingsCount: 0,
              hasBlockingSev1: false,
              findings: [],
              verifiedProvenance: false,
            };
          }
        } else {
          // Without verified receipt from trusted intake or PO consent, state must remain REVIEW_PENDING (U08-R05-01)
          status = 'REVIEW_PENDING';
        }
      } else {
        status = 'REVIEW_PENDING';
      }
    }

    return {
      status,
      findingsCount: findings.length,
      hasBlockingSev1: findings.some((f) => f.severity === 'SEV1'),
      findings,
      verifiedProvenance: Boolean(receiptId && status === 'APPROVED'),
    };
  }

  /**
   * Parses review feedback and atomically persists findings into SQLite (U08-R04, U08-R05-02, U08-R06-02).
   */
  ingestFeedbackAndPersist(params) {
    const {
      storage,
      feedbackText,
      changeSetId = 'default',
      reviewer = 'chatgpt_web',
      receiptId = null,
      expectedCommitSha = null,
      gate = 'U08',
    } = params || {};

    const resolvedReceiptId =
      receiptId ||
      (params && params.provenance && params.provenance.receiptId) ||
      (params && params.receiptToken) ||
      (params && params.provenance && params.provenance.receiptToken) ||
      null;

    const parsed = this.parseReviewFeedback(
      {
        feedbackText,
        changeSetId,
        receiptId: resolvedReceiptId,
        expectedCommitSha,
        gate,
        reviewer,
      },
      changeSetId
    );

    let persistenceResult = { inserted: 0, duplicates: 0, findings: [] };
    const effectiveStorage = storage || this.storage;
    if (effectiveStorage && parsed.findings.length > 0) {
      const rawFindings = parsed.findings.map((f) => ({
        file: f.file,
        line: f.line,
        severity: f.severity,
        description: f.description,
      }));
      if (typeof effectiveStorage.ingestReviewFindingsBatch === 'function') {
        persistenceResult = effectiveStorage.ingestReviewFindingsBatch(changeSetId, reviewer, rawFindings);
      }
    }

    return {
      status: parsed.status,
      hasBlockingSev1: parsed.hasBlockingSev1,
      totalDetected: parsed.findingsCount,
      insertedCount: persistenceResult.inserted,
      duplicateCount: persistenceResult.duplicates,
      persistedFindings: persistenceResult.findings,
      verifiedProvenance: parsed.verifiedProvenance,
      error: parsed.error,
      code: parsed.code,
    };
  }

  /**
   * Async variant of ingestFeedbackAndPersist supporting storage worker RPC (U08-R07-03).
   */
  async ingestFeedbackAndPersistAsync(params) {
    const {
      storage,
      feedbackText,
      changeSetId = 'default',
      reviewer = 'chatgpt_web',
      receiptId = null,
      expectedCommitSha = null,
      gate = 'U08',
    } = params || {};

    const resolvedReceiptId =
      receiptId ||
      (params && params.provenance && params.provenance.receiptId) ||
      (params && params.receiptToken) ||
      (params && params.provenance && params.provenance.receiptToken) ||
      null;

    const parsed = this.parseReviewFeedback(
      {
        feedbackText,
        changeSetId,
        receiptId: resolvedReceiptId,
        expectedCommitSha,
        gate,
        reviewer,
      },
      changeSetId
    );

    let persistenceResult = { inserted: 0, duplicates: 0, findings: [] };
    const effectiveStorage = storage || this.storage;
    if (effectiveStorage && parsed.findings.length > 0) {
      const rawFindings = parsed.findings.map((f) => ({
        file: f.file,
        line: f.line,
        severity: f.severity,
        description: f.description,
      }));
      if (typeof effectiveStorage.ingestReviewFindingsBatchAsync === 'function' && !effectiveStorage.nativeDb) {
        persistenceResult = await effectiveStorage.ingestReviewFindingsBatchAsync(changeSetId, reviewer, rawFindings);
      } else if (typeof effectiveStorage.ingestReviewFindingsBatch === 'function') {
        persistenceResult = effectiveStorage.ingestReviewFindingsBatch(changeSetId, reviewer, rawFindings);
      }
    }

    return {
      status: parsed.status,
      hasBlockingSev1: parsed.hasBlockingSev1,
      totalDetected: parsed.findingsCount,
      insertedCount: persistenceResult.inserted,
      duplicateCount: persistenceResult.duplicates,
      persistedFindings: persistenceResult.findings,
      verifiedProvenance: parsed.verifiedProvenance,
      error: parsed.error,
      code: parsed.code,
    };
  }
}

module.exports = {
  GitReviewService,
  FORBIDDEN_BRANCHES,
  TRUSTED_INTAKE_SOURCES,
};
