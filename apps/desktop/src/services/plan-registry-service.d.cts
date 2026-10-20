export interface GoalRecord {
  id: string;
  projectId: string;
  title: string;
  description: string;
  activePlanRevision: number;
  state: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlanRevisionRecord {
  id: string;
  goalId: string;
  revision: number;
  discoveryDigest: string;
  documentSha256: string;
  status: string;
  milestonesCount: number;
  createdAt: string;
}

export declare class PlanRegistryService {
  constructor(storageService: any);
  getDb(): any;
  createGoal(params: { projectId?: string; title: string; description?: string }): GoalRecord;
  createPlanRevision(params: {
    goalId: string;
    discoveryDigest: string;
    planMarkdown?: string;
    milestones?: Array<{ title: string; dependsOn?: string[]; orderIdx?: number }>;
  }): PlanRevisionRecord;
  recordReviewFinding(params: {
    changeSetId: string;
    reviewer?: string;
    file?: string;
    line?: number | null;
    severity?: string;
    description: string;
    reproduction?: string | null;
  }): any;
  resolveReviewFinding(id: string): boolean;
  approvePlanRevision(goalId: string, revision: number, approvalRef?: string): {
    success: boolean;
    goalId?: string;
    revision?: number;
    status?: string;
    approvedAt?: string;
    approvalRef?: string;
    error?: string;
    code?: string;
    blockingFindings?: any[];
  };
  updateMilestoneState(milestoneId: string, state: string, evidenceRef?: string | null): boolean;
  listMilestones(goalId: string, revision?: number | null): any[];
  listReviewFindings(changeSetId: string, state?: string | null): any[];
}
