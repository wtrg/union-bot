export interface PushSafetyValidation {
  allowed: boolean;
  branch?: string;
  policy?: string;
  error?: string;
  code?: string;
}

export declare class GitReviewService {
  constructor(options?: any);
  validatePushSafety(params: { branch: string; forcePush?: boolean; commitCount?: number }): PushSafetyValidation;
  validatePushArgv(argv: string[]): { allowed: boolean; error?: string; code?: string };
  validatePushExecution(params: any): { allowed: boolean; branch?: string; verifiedHead?: string; grantConsumed?: boolean; error?: string; code?: string };
  computePushDigest(params: {
    branch: string;
    headSha: string;
    commitMessage?: string;
    filesChanged?: string[];
  }): { digest: string; canonicalPayload: string };
  generateReviewPacket(params: {
    gate: string;
    name: string;
    ticketIds?: string[];
    headSha: string;
    baseSha?: string;
    branch?: string;
    summary?: string[];
    criteriaEvidence?: string[];
    unitTestSummary?: string;
  }): string;
  intakeTrustedReview(params: {
    source: string;
    reviewer?: string;
    commitSha: string;
    gate?: string;
    changeSetId?: string;
    verdict?: string;
    evidence: any;
  }): {
    success: boolean;
    receiptId?: string;
    receipt?: any;
    error?: string;
    code?: string;
  };
  consumeReviewReceipt(
    receiptId: string,
    expectedCommitSha?: string | null
  ): {
    success?: boolean;
    receipt?: any;
    error?: string;
    code?: string;
  };
  parseReviewFeedback(
    feedbackInput:
      | string
      | {
          feedbackText: string;
          changeSetId?: string;
          receiptId?: string;
          receiptToken?: string;
          expectedCommitSha?: string;
          provenance?: any;
        },
    changeSetId?: string
  ): {
    status: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_PENDING' | 'FEEDBACK_RECORDED';
    findingsCount: number;
    hasBlockingSev1: boolean;
    findings: any[];
    verifiedProvenance?: boolean;
    error?: string;
    code?: string;
  };
  ingestFeedbackAndPersist(params: {
    storage?: any;
    feedbackText?: string;
    changeSetId?: string;
    reviewer?: string;
    receiptId?: string | null;
    receiptToken?: string | null;
    expectedCommitSha?: string | null;
  }): {
    status: string;
    hasBlockingSev1: boolean;
    totalDetected: number;
    insertedCount: number;
    duplicateCount: number;
    persistedFindings: any[];
    verifiedProvenance: boolean;
  };
}
