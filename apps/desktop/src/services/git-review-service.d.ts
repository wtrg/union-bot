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
  }): string;
  parseReviewFeedback(feedbackText: string, changeSetId?: string): {
    status: 'APPROVED' | 'CHANGES_REQUESTED' | 'FEEDBACK_RECORDED' | 'PENDING';
    findingsCount: number;
    hasBlockingSev1: boolean;
    findings: any[];
  };
}
