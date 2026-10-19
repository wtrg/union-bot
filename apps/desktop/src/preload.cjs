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
}

contextBridge.exposeInMainWorld('unionBotAPI', api);
