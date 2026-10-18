const { app, BrowserWindow, WebContentsView, session, shell } = require('electron');
const path = require('path');

// Safe configuration: disable hardware acceleration if running in headless/CI environments
app.disableHardwareAcceleration();

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Union Bot — Minimal Electron WebContentsView Spike (P0-008)',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Safe navigation handler: open unapproved links in default system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log(`[SafeRoute] Intercepted new-window request to: ${url}`);
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Example WebContentsView setup
  const partitionSession = session.fromPartition('persist:mcb-web-chatgpt');
  const view = new WebContentsView({
    webPreferences: {
      session: partitionSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

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
