export interface ContentInspectionResult {
  safe: boolean;
  riskScore: number;
  blocked: boolean;
  flags: Array<{
    type: string;
    pattern?: string;
    severity: string;
    description?: string;
  }>;
}

export interface EgressAuditResult {
  allowed: boolean;
  cost: number;
  currency?: string;
  verifiedZeroCost?: boolean;
  reason?: string;
  error?: string;
}

export interface DatabaseHealthResult {
  healthy: boolean;
  integrityCheck?: string;
  walCheckpoint?: any;
  error?: string;
  checkedAt?: number;
}

export declare class SecurityGuardService {
  constructor(options?: any);
  inspectContent(text: string): ContentInspectionResult;
  sanitizeContent(text: string): string;
  auditEgress(url: string): EgressAuditResult;
  performDatabaseHealthCheck(): DatabaseHealthResult;
  measurePerformance<T>(name: string, fn: () => Promise<T> | T): Promise<{
    success: boolean;
    name: string;
    durationMs: number;
    exceedsThreshold?: boolean;
    result?: T;
    error?: string;
  }>;
  getSecurityMetrics(): {
    totalViolations: number;
    recentViolations: any[];
    totalAuditLogs: number;
    zeroCostEnforced: boolean;
    timestamp: number;
  };
}
