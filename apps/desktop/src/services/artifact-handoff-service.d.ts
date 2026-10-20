export interface HandoffRecord {
  id: string;
  projectId: string;
  goalId?: string | null;
  sourceProvider: string;
  sourceTurnRef?: string | null;
  targetProvider: string;
  sha256: string;
  byteSize: number;
  mimeType: string;
  fidelity: string;
  state: string;
  ackEvidenceRef?: string | null;
  createdAt: string;
}

export declare class ArtifactHandoffService {
  constructor(storageService: any, artifactStore?: any);
  getDb(): any;
  createHandoff(params: {
    projectId?: string;
    goalId?: string;
    sourceProvider: string;
    sourceTurnRef?: string;
    targetProvider: string;
    sha256: string;
    byteSize: number;
    mimeType?: string;
    fidelity?: string;
    filename?: string;
  }): {
    success: boolean;
    handoff?: HandoffRecord;
    handoffId?: string;
    state?: string;
    error?: string;
    code?: string;
  };
  acknowledgeHandoff(params: {
    handoffId: string;
    receiverProvider: string;
    ackEvidenceRef?: string;
  }): {
    success: boolean;
    handoffId?: string;
    state?: string;
    ackEvidenceRef?: string;
    error?: string;
    code?: string;
  };
  rejectHandoff(handoffId: string, reason?: 'CHECKSUM' | 'QUARANTINE', details?: string): boolean;
  getHandoff(id: string): any;
  listHandoffs(projectId?: string, limit?: number): any[];
}
