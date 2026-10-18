/**
 * @file auth-check.cjs
 * @description Production IPC senderFrame authorization verification for Union Bot Electron desktop.
 * Enforces:
 * - Event and senderFrame must be defined
 * - MainWindow must not be destroyed
 * - Sender webContents ID must match mainWindow webContents ID exactly
 * - Must be top-level frame (senderFrame.parent === null, denying iframes)
 * - Frame URL must match allowedUiFileUrl exactly (denying navigated / data: / javascript: URLs)
 * (UB-P2-R01-008, UB-P2-R02-006, R03-E11)
 */

function normalizeUrl(urlStr) {
  if (typeof urlStr !== 'string') return '';
  if (process.platform === 'win32' && urlStr.startsWith('file:///')) {
    return urlStr.replace(/^file:\/\/\/([a-zA-Z]):/, (_, drive) => `file:///${drive.toUpperCase()}:`);
  }
  return urlStr;
}

function isAuthorizedSenderFrame(event, mainWindow, allowedUiFileUrl) {
  if (!event || !event.sender || !event.senderFrame) {
    return false;
  }
  if (!mainWindow || (typeof mainWindow.isDestroyed === 'function' && mainWindow.isDestroyed())) {
    return false;
  }
  if (!mainWindow.webContents || event.sender.id !== mainWindow.webContents.id) {
    return false;
  }
  if (event.senderFrame.parent !== null) {
    return false;
  }
  const frameUrl = normalizeUrl(event.senderFrame.url);
  const targetUrl = normalizeUrl(allowedUiFileUrl);
  if (!frameUrl || frameUrl !== targetUrl) {
    return false;
  }
  return true;
}

module.exports = { isAuthorizedSenderFrame, normalizeUrl };

