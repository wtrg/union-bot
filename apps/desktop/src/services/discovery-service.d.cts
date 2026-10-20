export declare class DiscoveryService {
  constructor(storageService: any);
  static parseSlashCommand(rawText: string): {
    isCommand: boolean;
    command?: string;
    args?: string;
    cleanText: string;
    wasEscaped?: boolean;
  };
  getOrCreateDiscoverySession(projectId?: string): any;
  recordFact(
    discoveryId: string,
    projectId: string,
    key: string,
    value: string,
    sourceTurnRef: string,
    confirmedBy?: string | null
  ): { id: string; key: string; value: string; state: string };
  addQuestion(
    discoveryId: string,
    requirementKey: string,
    question: string,
    priority?: string,
    blocking?: boolean
  ): { id: string; duplicate: boolean };
  resolveQuestion(id: string, resolution: string): boolean;
  compactContext(discoveryId: string): {
    facts: any[];
    openQuestions: any[];
    digest: string;
  };
  checkReadyForWork(discoveryId: string): {
    ready: boolean;
    reason?: string;
    blockingQuestions?: string[];
    briefDigest?: string;
    factCount?: number;
  };
}
