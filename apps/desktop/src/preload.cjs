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

  getRooms: async () => {
    return ipcRenderer.invoke('union-bot:get-rooms');
  },

  createRoom: async (roomData) => {
    return ipcRenderer.invoke('union-bot:create-room', roomData);
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
}

contextBridge.exposeInMainWorld('unionBotAPI', api);
