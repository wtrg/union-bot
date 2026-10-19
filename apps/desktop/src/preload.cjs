const { contextBridge, ipcRenderer } = require('electron');

/**
 * Union Bot Secure Preload Bridge
 * Strictly isolates Electron main capabilities from renderer context.
 * Only vetted channels and schemas are accessible.
 */
contextBridge.exposeInMainWorld('unionBotAPI', {
  isElectron: true,
  version: '1.0.0',

  dispatchEnvelope: async (envelope) => {
    return ipcRenderer.invoke('union-bot:dispatch-envelope', envelope);
  },

  getRoomHistory: async (roomId) => {
    return ipcRenderer.invoke('union-bot:get-room-history', roomId);
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
    return ipcRenderer.invoke('union-bot:approve-token', { tokenId, decisionContext });
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

  testKillWorker: async () => {
    return ipcRenderer.invoke('union-bot:test-kill-worker');
  },
});
