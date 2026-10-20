export interface DeliveryAttemptRecord {
  attemptId: string;
  messageId: string;
  projectId: string;
  targetProvider: string;
  correlationId: string;
  watermark: number;
  sentAt: string;
  state: string;
}

export interface ThreadReceipt {
  attemptId: string;
  correlationId: string;
  messageId: string;
  targetProvider: string;
  sentAt: string;
  ackAt: string;
  latencyMs: number;
  responseRef: string | null;
  verified: boolean;
}

export declare class ConversationRouter {
  constructor(storageService: any, options?: any);
  getDb(): any;
  dispatchToProvider(params: {
    messageId: string;
    projectId?: string;
    targetProvider?: string;
    correlationId?: string;
    watermark?: number;
  }): DeliveryAttemptRecord;
  ingestProviderReply(params: {
    correlationId: string;
    responseRef?: string;
    watermark?: number;
    replyPayload?: any;
  }): {
    success: boolean;
    receipt?: ThreadReceipt;
    error?: string;
    code?: string;
  };
  markAttemptFailed(correlationId: string, reason?: string): boolean;
  getAttempt(correlationId: string): any;
  listAttempts(projectId?: string, limit?: number): any[];
}
