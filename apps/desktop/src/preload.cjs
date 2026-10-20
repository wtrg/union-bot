const { contextBridge, ipcRenderer } = require('electron');

/**
 * Union Bot Secure Preload Bridge
 * Strictly isolates Electron main capabilities from renderer context.
 * Only vetted channels and schemas are accessible.
 */
const api = {
  isElectron: true,
  version: '1.0.0',

  dispatchEnvelope: async (envelope) => {
    return ipcRenderer.invoke('union-bot:dispatch-envelope', envelope);
  },

  getRoomHistory: async (roomId) => {
    return ipcRenderer.invoke('union-bot:get-room-history', roomId);
  },

  getProjects: async (options) => {
    return ipcRenderer.invoke('union-bot:get-projects', options);
  },

  createProject: async (payload) => {
    return ipcRenderer.invoke('union-bot:create-project', payload);
  },

  renameProject: async (id, newName) => {
    return ipcRenderer.invoke('union-bot:rename-project', { id, newName });
  },

  archiveProject: async (id) => {
    return ipcRenderer.invoke('union-bot:archive-project', id);
  },

  deleteProject: async (id) => {
    return ipcRenderer.invoke('union-bot:delete-project', id);
  },

  getRooms: async (options) => {
    return ipcRenderer.invoke('union-bot:get-rooms', options);
  },

  createRoom: async (roomData) => {
    return ipcRenderer.invoke('union-bot:create-room', roomData);
  },

  listTasks: async (options) => {
    return ipcRenderer.invoke('union-bot:list-tasks', options);
  },

  createTask: async (taskData) => {
    return ipcRenderer.invoke('union-bot:create-task', taskData);
  },

  updateTask: async (taskId, updates) => {
    return ipcRenderer.invoke('union-bot:update-task', { taskId, updates });
  },

  executeTask: async (payload) => {
    return ipcRenderer.invoke('union-bot:task-execute', payload);
  },

  cancelTask: async (payload) => {
    return ipcRenderer.invoke('union-bot:task-cancel', payload);
  },

  onTaskUpdated: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('union-bot:task-updated', subscription);
    return () => {
      ipcRenderer.removeListener('union-bot:task-updated', subscription);
    };
  },

  getStorageDiagnostics: async () => {
    return ipcRenderer.invoke('union-bot:get-storage-diagnostics');
  },

  listApprovals: async (options) => {
    return ipcRenderer.invoke('union-bot:list-approvals', options);
  },

  rejectApproval: async (tokenId, reason) => {
    return ipcRenderer.invoke('union-bot:reject-approval', { tokenId, reason });
  },

  saveAttachment: async (payload) => {
    return ipcRenderer.invoke('union-bot:save-attachment', payload);
  },

  readAttachment: async (sha256) => {
    return ipcRenderer.invoke('union-bot:read-attachment', sha256);
  },

  openFileDialog: async () => {
    return ipcRenderer.invoke('union-bot:open-file-dialog');
  },

  selectDirectory: async (options) => {
    return ipcRenderer.invoke('union-bot:select-directory', options);
  },

  exportWorkspace: async (options) => {
    return ipcRenderer.invoke('union-bot:export-workspace', options);
  },

  getAppStatus: async () => {
    return ipcRenderer.invoke('union-bot:get-app-status');
  },

  createApprovalToken: async (tokenData) => {
    return ipcRenderer.invoke('union-bot:create-approval-token', tokenData);
  },

  computeActionDigest: async (input) => {
    return ipcRenderer.invoke('union-bot:compute-action-digest', input);
  },

  approveToken: async (tokenId, decisionContext) => {
    let payload = {};
    if (typeof tokenId === 'object' && tokenId !== null) {
      payload = {
        tokenId: tokenId.tokenId,
        decisionContext: tokenId.decisionContext || decisionContext,
      };
    } else {
      payload = {
        tokenId,
        decisionContext,
      };
    }
    return ipcRenderer.invoke('union-bot:approve-token', payload);
  },

  getApprovalToken: async (tokenId) => {
    return ipcRenderer.invoke('union-bot:get-approval-token', tokenId);
  },

  onEnvelopeReceived: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, envelope) => callback(envelope);
    ipcRenderer.on('union-bot:envelope-received', subscription);
    return () => {
      ipcRenderer.removeListener('union-bot:envelope-received', subscription);
    };
  },

  onAppStatusChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, status) => callback(status);
    ipcRenderer.on('union-bot:app-status-changed', subscription);
    return () => {
      ipcRenderer.removeListener('union-bot:app-status-changed', subscription);
    };
  },

  // Phase V4: Goal-Driven Multi-Agent API (UB-V4-U01, U02)
  getDiscoveryState: async (projectId) => {
    return ipcRenderer.invoke('union-bot:get-discovery-state', projectId);
  },
  saveRequirementFact: async (fact) => {
    return ipcRenderer.invoke('union-bot:save-requirement-fact', fact);
  },
  saveOpenQuestion: async (question) => {
    return ipcRenderer.invoke('union-bot:save-open-question', question);
  },
  resolveOpenQuestion: async (payload) => {
    return ipcRenderer.invoke('union-bot:resolve-open-question', payload);
  },
  checkDiscoveryReady: async (discoveryId) => {
    return ipcRenderer.invoke('union-bot:check-discovery-ready', discoveryId);
  },
  compactDiscoveryContext: async (discoveryId) => {
    return ipcRenderer.invoke('union-bot:compact-discovery-context', discoveryId);
  },
  getCapabilities: async () => {
    return ipcRenderer.invoke('union-bot:get-capabilities');
  },
  probeCapability: async (providerId) => {
    return ipcRenderer.invoke('union-bot:probe-capability', providerId);
  },
  // Phase V4: Two-Way Conversation Router & Thread Receipts (UB-V4-U04)
  dispatchToProvider: async (payload) => {
    return ipcRenderer.invoke('union-bot:dispatch-to-provider', payload);
  },
  ingestProviderReply: async (payload) => {
    return ipcRenderer.invoke('union-bot:ingest-provider-reply', payload);
  },
  listDeliveryAttempts: async (payload) => {
    return ipcRenderer.invoke('union-bot:list-delivery-attempts', payload);
  },
  listGoals: async (projectId) => {
    return ipcRenderer.invoke('union-bot:list-goals', projectId);
  },
  saveGoal: async (goal) => {
    return ipcRenderer.invoke('union-bot:save-goal', goal);
  },
  approvePlanRevision: async (payload) => {
    return ipcRenderer.invoke('union-bot:approve-plan-revision', payload);
  },
  listMilestones: async (goalId) => {
    return ipcRenderer.invoke('union-bot:list-milestones', goalId);
  },
  listActivityEvents: async (payload) => {
    return ipcRenderer.invoke('union-bot:list-activity-events', payload);
  },

  // Phase P4: Embedded Chromium Browser API
  browserGetState: async () => {
    return ipcRenderer.invoke('union-bot:browser-get-state');
  },
  browserCreateTab: async (payload) => {
    return ipcRenderer.invoke('union-bot:browser-create-tab', payload);
  },
  browserCloseTab: async (tabId) => {
    return ipcRenderer.invoke('union-bot:browser-close-tab', tabId);
  },
  browserSelectTab: async (tabId) => {
    return ipcRenderer.invoke('union-bot:browser-select-tab', tabId);
  },
  browserNavigate: async (payload) => {
    return ipcRenderer.invoke('union-bot:browser-navigate', payload);
  },
  browserPerformAction: async (payload) => {
    return ipcRenderer.invoke('union-bot:browser-action', payload);
  },
  browserSetBounds: async (bounds) => {
    return ipcRenderer.invoke('union-bot:browser-set-bounds', bounds);
  },
  browserSetVisibility: async (visible) => {
    return ipcRenderer.invoke('union-bot:browser-set-visibility', visible);
  },
  browserSetModalActive: async (active) => {
    return ipcRenderer.invoke('union-bot:browser-set-modal-active', active);
  },
  browserShareSelection: async (payload) => {
    return ipcRenderer.invoke('union-bot:browser-share-selection', payload);
  },
  // Phase P9: Provider Sessions, Health, Provenance & Reference APIs
  browserGetSession: async (tabId) => {
    return ipcRenderer.invoke('union-bot:browser-get-session', tabId);
  },
  browserGetAllSessions: async () => {
    return ipcRenderer.invoke('union-bot:browser-get-all-sessions');
  },
  browserCheckHealth: async (tabId) => {
    return ipcRenderer.invoke('union-bot:browser-check-health', tabId);
  },
  browserCaptureReference: async (tabId) => {
    return ipcRenderer.invoke('union-bot:browser-capture-reference', tabId);
  },
  browserShareText: async (payload) => {
    return ipcRenderer.invoke('union-bot:browser-share-text', payload);
  },
  browserShareFile: async (payload) => {
    return ipcRenderer.invoke('union-bot:browser-share-file', payload);
  },
  onBrowserStateUpdated: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, state) => callback(state);
    ipcRenderer.on('union-bot:browser-state-updated', subscription);
    return () => {
      ipcRenderer.removeListener('union-bot:browser-state-updated', subscription);
    };
  },

  // Phase P5: Artifact Store, Previews & Local MCP Host APIs
  artifactSaveAs: async (payload) => {
    return ipcRenderer.invoke('union-bot:artifact-save-as', payload);
  },
  artifactShowInFolder: async (sha256) => {
    return ipcRenderer.invoke('union-bot:artifact-show-in-folder', sha256);
  },
  artifactOpenOriginal: async (sha256) => {
    return ipcRenderer.invoke('union-bot:artifact-open-original', sha256);
  },
  artifactInspect: async (sha256) => {
    return ipcRenderer.invoke('union-bot:artifact-inspect', sha256);
  },
  toolHostExecute: async (payload) => {
    return ipcRenderer.invoke('union-bot:tool-host-execute', payload);
  },
  mcpCall: async (payload) => {
    return ipcRenderer.invoke('union-bot:mcp-call', payload);
  },
  mcpListTools: async () => {
    return ipcRenderer.invoke('union-bot:mcp-list-tools');
  },
  exportTranscriptBundle: async (options) => {
    return ipcRenderer.invoke('union-bot:export-transcript-bundle', options);
  },
  importTranscriptBundle: async (options) => {
    return ipcRenderer.invoke('union-bot:import-transcript-bundle', options);
  },

  // Phase P6: Native Codex Agent API
  codexDiscover: async () => {
    return ipcRenderer.invoke('union-bot:codex-discover');
  },
  codexExecute: async (payload) => {
    return ipcRenderer.invoke('union-bot:codex-execute', payload);
  },
  codexCancel: async () => {
    return ipcRenderer.invoke('union-bot:codex-cancel');
  },
  codexVerifyBoundary: async (targetPath) => {
    return ipcRenderer.invoke('union-bot:codex-verify-boundary', targetPath);
  },
  onCodexDelta: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('union-bot:codex-delta', subscription);
    return () => {
      ipcRenderer.removeListener('union-bot:codex-delta', subscription);
    };
  },
  onCodexTurnCompleted: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('union-bot:codex-turn-completed', subscription);
    return () => {
      ipcRenderer.removeListener('union-bot:codex-turn-completed', subscription);
    };
  },

  // Phase P7: Native Antigravity Agent API
  antigravityDiscover: async () => {
    return ipcRenderer.invoke('union-bot:antigravity-discover');
  },
  antigravityExecute: async (payload) => {
    return ipcRenderer.invoke('union-bot:antigravity-execute', payload);
  },
  antigravityCancel: async () => {
    return ipcRenderer.invoke('union-bot:antigravity-cancel');
  },
  antigravityVerifyBoundary: async (targetPath) => {
    return ipcRenderer.invoke('union-bot:antigravity-verify-boundary', targetPath);
  },
  onAntigravityDelta: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('union-bot:antigravity-delta', subscription);
    return () => {
      ipcRenderer.removeListener('union-bot:antigravity-delta', subscription);
    };
  },
  onAntigravityTurnCompleted: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('union-bot:antigravity-turn-completed', subscription);
    return () => {
      ipcRenderer.removeListener('union-bot:antigravity-turn-completed', subscription);
    };
  },

  // Phase P8: Multi-Agent Task Graph & Consensus API
  taskGraphCreate: async (def) => {
    return ipcRenderer.invoke('union-bot:task-graph-create', def);
  },
  taskGraphStandardPipeline: async (params) => {
    return ipcRenderer.invoke('union-bot:task-graph-standard-pipeline', params);
  },
  taskGraph6AIPipeline: async (params) => {
    return ipcRenderer.invoke('union-bot:task-graph-6ai-pipeline', params);
  },
  taskGraphRun: async (payload) => {
    return ipcRenderer.invoke('union-bot:task-graph-run', payload);
  },
  taskGraphStatus: async (graphId) => {
    return ipcRenderer.invoke('union-bot:task-graph-status', graphId);
  },
  taskGraphSubmitVote: async (payload) => {
    return ipcRenderer.invoke('union-bot:task-graph-submit-vote', payload);
  },
  taskGraphVerifyBoundary: async (targetPath) => {
    return ipcRenderer.invoke('union-bot:task-graph-verify-boundary', targetPath);
  },
  onTaskGraphEvent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('union-bot:task-graph-event', subscription);
    return () => {
      ipcRenderer.removeListener('union-bot:task-graph-event', subscription);
    };
  },
};

// UB-P2-R06-003 / R07-A03: Strictly isolate test mutation channels.
// Only expose testKillWorker if running inside an explicit dedicated test harness environment.
// Never expose in production builds, packaged apps, or generic --headless launches.
if (process.env.UNION_BOT_E2E_HARNESS === '1' && process.env.NODE_ENV === 'test') {
  api.testKillWorker = async () => {
    return ipcRenderer.invoke('union-bot:test-kill-worker');
  };
  api.testSetConfirmationMode = async (mode) => {
    return ipcRenderer.invoke('union-bot:test-set-confirmation-mode', mode);
  };
  api.testTamperApprovalPayload = async (payload) => {
    return ipcRenderer.invoke('union-bot:test-tamper-approval-payload', payload);
  };
  api.testQueueAttachmentPath = async (filePath) => {
    return ipcRenderer.invoke('union-bot:test-queue-attachment-path', filePath);
  };
  api.testGetExportFiles = async () => {
    return ipcRenderer.invoke('union-bot:test-get-export-files');
  };
  api.testSetBrowserCookie = async (payload) => {
    return ipcRenderer.invoke('union-bot:test-set-browser-cookie', payload);
  };
  api.testGetBrowserCookies = async (partition) => {
    return ipcRenderer.invoke('union-bot:test-get-browser-cookies', partition);
  };
  api.testTriggerTabCrash = async (tabId) => {
    return ipcRenderer.invoke('union-bot:test-trigger-tab-crash', tabId);
  };
  api.testSetStorageShareMode = async (mode) => {
    return ipcRenderer.invoke('union-bot:test-set-storage-share-mode', mode);
  };
  api.testVerifyOAuthPopup = async (providerId) => {
    return ipcRenderer.invoke('union-bot:test-verify-oauth-popup', providerId);
  };
  api.testQueueSavePath = async (filePath) => {
    return ipcRenderer.invoke('union-bot:test-queue-save-path', filePath);
  };
  api.testSetCodexMock = async (options) => {
    return ipcRenderer.invoke('union-bot:test-set-codex-mock', options);
  };
  api.testSetAntigravityMock = async (messages) => {
    return ipcRenderer.invoke('union-bot:test-set-antigravity-mock', messages);
  };
  // P8-R03-004 & P8-R03-005: Strictly isolate task-graph stepping and reviewer registration to test harness
  api.testTaskGraphStep = async (payload) => {
    return ipcRenderer.invoke('union-bot:task-graph-step', payload);
  };
  api.testTaskGraphRegisterReviewer = async (payload) => {
    return ipcRenderer.invoke('union-bot:task-graph-register-reviewer', payload);
  };
  api.taskGraphStep = api.testTaskGraphStep;
  api.taskGraphRegisterReviewer = api.testTaskGraphRegisterReviewer;
  // Phase P9: Provider Health Simulation & Spoofing Test APIs
  api.testSimulateProviderHealth = async (payload) => {
    return ipcRenderer.invoke('union-bot:test-simulate-provider-health', payload);
  };
  api.testSpoofVoterIdentity = async (payload) => {
    return ipcRenderer.invoke('union-bot:test-spoof-voter-identity', payload);
  };
  api.testCreateSession = async (payload) => {
    return ipcRenderer.invoke('union-bot:test-create-session', payload);
  };
  api.testRemoveSession = async (tabId) => {
    return ipcRenderer.invoke('union-bot:test-remove-session', tabId);
  };
}

contextBridge.exposeInMainWorld('unionBotAPI', api);
