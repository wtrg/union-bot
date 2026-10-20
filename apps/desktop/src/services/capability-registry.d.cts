export interface ProviderCapability {
  id: string;
  name: string;
  role: string;
  provider: string;
  category: 'native_cli' | 'browser_web';
  status: string;
  badge: string;
  costRate: string;
  version: string;
  details: string;
  lastChecked: number;
}

export declare class CapabilityRegistry {
  constructor(options?: any);
  probeProvider(providerId: string): ProviderCapability | null;
  updateWebStatus(providerId: string, params: { url?: string; title?: string; statusCode?: number }): ProviderCapability | null;
  getAllCapabilities(): Record<string, ProviderCapability>;
  toAgentInfoList(): any[];
}
