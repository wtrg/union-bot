export declare class WorkflowSupervisor {
  constructor(options?: any);
  getDb(): any;
  acquireLease(goalId: string, workerId?: string): {
    success: boolean;
    goalId?: string;
    leaseToken?: string;
    workerId?: string;
    expiresAt?: number;
    error?: string;
    code?: string;
  };
  renewLease(goalId: string, token: string): {
    success: boolean;
    goalId?: string;
    expiresAt?: number;
    error?: string;
    code?: string;
  };
  releaseLease(goalId: string, token: string): boolean;
  progressNextMilestone(goalId: string, workerId?: string): {
    success: boolean;
    goalCompleted?: boolean;
    message?: string;
    milestone?: any;
    activeMilestones?: any[];
    error?: string;
    code?: string;
  };
  completeMilestone(goalId: string, milestoneId: string, evidenceRef?: string): {
    success: boolean;
    milestoneId?: string;
    state?: string;
    evidenceRefs?: string[];
    error?: string;
  };
  recoverDanglingGoals(projectId?: string): {
    recoveredCount: number;
    activeGoalsCount: number;
  };
  pauseWorkflow(): { success: boolean; state: string };
  resumeWorkflow(): { success: boolean; state: string };
  stopWorkflow(): { success: boolean; state: string };
  getWorkflowStatus(): {
    state: string;
    activeLeasesCount: number;
    activeLeases: any[];
  };
}
