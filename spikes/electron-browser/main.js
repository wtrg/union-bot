const { app, BrowserWindow, WebContentsView, session, shell } = require('electron');
const path = require('path');
const { safeOpenExternal, validateExternalUrl } = require('./safe-external.js');

// Safe configuration: disable hardware acceleration if running in headless/CI environments
app.disableHardwareAcceleration();

let mainWindow = null;

function setupSecureView(view, approvedOrigin, parentWindow) {
  // Hardened security preferences
  // sandbox: true, contextIsolation: true, nodeIntegration: false, no privileged preload
  
  // Attach strict setWindowOpenHandler on every WebContentsView
  // Always deny child popup creation; route valid external URLs safely to OS browser
  view.webContents.setWindowOpenHandler(({ url }) => {
    console.log(`[ViewSecurity] Intercepted new-window request from view to: ${url}`);
    safeOpenExternal(url, shell);
    return { action: 'deny' };
  });

  // Strict main-frame navigation guard
  view.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      const parsedTarget = new URL(targetUrl);
      const parsedApproved = new URL(approvedOrigin);
      // If navigating to a different origin/host, prevent in-view navigation and route safely
      if (parsedTarget.hostname !== parsedApproved.hostname) {
        console.log(`[ViewSecurity] Blocked untrusted cross-origin navigation to: ${targetUrl}`);
        event.preventDefault();
        safeOpenExternal(targetUrl, shell);
      }
    } catch {
      event.preventDefault();
    }
  });

  view.webContents.on('will-redirect', (event, targetUrl) => {
    try {
      const parsedTarget = new URL(targetUrl);
      // Deny redirect to dangerous schemes
      if (!['https:', 'http:'].includes(parsedTarget.protocol)) {
        console.warn(`[ViewSecurity] Blocked dangerous redirect to scheme: ${parsedTarget.protocol}`);
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Union Bot — Minimal Electron WebContentsView Spike (P0-008 / UB-P1-SEC-001)',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Hardened window open handler on main window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log(`[MainWindow] Intercepted new-window request to: ${url}`);
    safeOpenExternal(url, shell);
    return { action: 'deny' };
  });

  // Example WebContentsView setup with isolated partition
  const partitionSession = session.fromPartition('persist:mcb-web-chatgpt');
  
  // Attach session network egress filter (Cost Guard defense-in-depth)
  partitionSession.webRequest.onBeforeRequest((details, callback) => {
    const check = validateExternalUrl(details.url, true);
    // Block paid API egress endpoints
    const lower = details.url.toLowerCase();
    if (lower.includes('api.openai.com') || lower.includes('api.anthropic.com') || lower.includes('api.deepseek.com') || lower.includes('generativelanguage.googleapis.com')) {
      console.warn(`[CostGuard-Session] Blocked paid API egress: ${details.url}`);
      callback({ cancel: true });
      return;
    }
    callback({ cancel: false });
  });

  const view = new WebContentsView({
    webPreferences: {
      session: partitionSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  setupSecureView(view, 'https://chatgpt.com', mainWindow);

  mainWindow.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 1200, height: 800 });

  view.webContents.on('did-finish-load', () => {
    console.log('[WebContentsView] Loaded successfully:', view.webContents.getURL());
  });

  view.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.log(`[WebContentsView] Failed to load ${validatedURL}: ${errorCode} - ${errorDescription}`);
  });

  view.webContents.loadURL('https://chatgpt.com');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
