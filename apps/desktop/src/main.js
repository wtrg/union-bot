/**
 * @file main.js
 * @description Union Bot Electron Main Process
 * Features:
 * - Single-instance lock
 * - Dynamic userData path (no hardcoded absolute project paths)
 * - Strict contextIsolation & sandbox
 * - SafeOpenExternal & popup denial (action: 'deny')
 * - CostGuard Zero-Cost (0 VND) session interception
 * - Automated GUI smoke test mode (--smoke)
 */

const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { safeOpenExternal, validateExternalUrl } = require('./safe-external.js');
const { CostGuard, installElectronCostGuardInterceptor } = require('./cost-guard.cjs');
const { Orchestrator } = require('./orchestrator.cjs');
const { StorageServiceClient } = require('./storage-service.cjs');

// 1. Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[UnionBot] Another instance is already running. Quitting duplicate instance.');
  app.quit();
  process.exit(0);
}

let mainWindow = null;
const uiDistPath = path.resolve(__dirname, '../../workspace-ui/dist/index.html');
const allowedUiFileUrl = pathToFileURL(uiDistPath).href;
const costGuard = new CostGuard();

// Connect durable SQLite storage under userData (UB-P2-R01-003, P2-T04)
const userDataPath = app.getPath('userData');
const dbFilePath = path.join(userDataPath, 'union_bot.db');
const storage = new StorageServiceClient(dbFilePath);
const orchestrator = new Orchestrator({ costGuard, storage });

function createWindow() {
  const isSmoke = process.argv.includes('--smoke');
  const isHeadless = process.argv.includes('--headless');

  // Local storage directories under user data
  const userDataDir = app.getPath('userData');
  const localCasDir = path.join(userDataDir, 'cas-store');
  if (!fs.existsSync(localCasDir)) {
    fs.mkdirSync(localCasDir, { recursive: true });
  }

  // 2. Install CostGuard on defaultSession
  installElectronCostGuardInterceptor(session.defaultSession, costGuard);

  // 3. Create Browser Window
  mainWindow = new BrowserWindow({
    title: 'Union Bot',
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: !isHeadless,
    backgroundColor: '#0a0d14',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
      webSecurity: true,
    },
  });

  // 4. Secure Window Open Handler: Deny all popups & delegate safe external URLs
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    safeOpenExternal(url, shell);
    return { action: 'deny' };
  });

  // 5. Compute allowed Workspace UI path
  const uiDistPath = path.resolve(__dirname, '../../workspace-ui/dist/index.html');
  const allowedUiFileUrl = pathToFileURL(uiDistPath).href;

  // 6. Strictly restrict in-window navigation: ONLY the bundled UI index.html is allowed
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== allowedUiFileUrl) {
      event.preventDefault();
      safeOpenExternal(url, shell);
    }
  });

  // 7. Load Workspace UI
  if (fs.existsSync(uiDistPath)) {
    mainWindow.loadFile(uiDistPath);
  } else {
    // Offline fallback
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
      <!DOCTYPE html>
      <html>
        <head><title>Union Bot (Offline Standby)</title></head>
        <body style="background:#0a0d14;color:#f1f5f9;font-family:sans-serif;padding:40px;">
          <h1>Union Bot — Desktop Workspace</h1>
          <p>Status: Local Core Initialized (Workspace UI not built yet)</p>
          <p>Cost Guard: 0đ Zero-Cost Policy Active</p>
        </body>
      </html>
    `)}`);
  }

  // 7. Handle GUI Smoke Test Mode
  if (isSmoke) {
    console.log('[SmokeTest] Running Union Bot Automated GUI Smoke Test...');

    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        console.log('[SmokeTest] Window loaded successfully.');
        console.log('[SmokeTest] Title:', mainWindow.getTitle());
        console.log('[SmokeTest] UserData directory:', userDataDir);

        // Verify CostGuard blocks paid API
        const testBlocked = !costGuard.isUrlAllowed('https://api.openai.com/v1/chat/completions');
        console.log('[SmokeTest] CostGuard egress check (paid API blocked):', testBlocked);

        // Verify safeOpenExternal denies dangerous schemes
        const schemeCheck = validateExternalUrl('file:///C:/Windows/System32/cmd.exe');
        console.log('[SmokeTest] SafeExternal dangerous scheme blocked:', !schemeCheck.valid);

        // Verify single instance lock active
        console.log('[SmokeTest] Single instance lock held:', gotTheLock);

        // Verify Orchestrator Zero-Cost AdmissionPolicyGate integration
        const admissionCheck = orchestrator.evaluateAction({
          actionId: 'smoke_test_001',
          actionType: 'SEND_PROMPT',
          provider: 'chatgpt',
          estimatedCost: 0,
          requestedBy: 'smoke_runner',
          targetUrl: 'https://chatgpt.com',
        });
        console.log('[SmokeTest] Orchestrator zero-cost admission passed:', admissionCheck.allowed);

        // 5. Verify Real GUI -> IPC envelope dispatch through window.unionBotAPI
        const ipcSendResult = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            if (!window.unionBotAPI) return { error: 'window.unionBotAPI not found' };
            return await window.unionBotAPI.dispatchEnvelope({
              id: 'smoke_gui_env_001',
              traceId: 'smoke_trc_001',
              timestamp: Date.now(),
              sender: { kind: 'user', id: 'smoke_user', name: 'Smoke Tester', role: 'USER' },
              recipient: { kind: 'room', id: 'orchestration' },
              roomId: 'orchestration',
              fidelity: 'L0_RAW_TEXT',
              parts: [{ kind: 'text', text: 'Live GUI smoke test envelope' }]
            });
          })()
        `);
        const ipcSendSuccess = Boolean(ipcSendResult && ipcSendResult.success === true && ipcSendResult.envelopeId === 'smoke_gui_env_001');
        console.log('[SmokeTest] Real GUI IPC send message verified:', ipcSendSuccess);

        // 6. Verify Real GUI -> IPC room history retrieval through window.unionBotAPI
        const historyResult = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            if (!window.unionBotAPI) return [];
            return await window.unionBotAPI.getRoomHistory('orchestration');
          })()
        `);
        const historyVerified = Array.isArray(historyResult) && historyResult.some((e) => e.id === 'smoke_gui_env_001');
        console.log('[SmokeTest] Real GUI IPC get room history verified:', historyVerified);

        // 7. Verify Renderer Anti-Spoofing enforcement via real IPC call
        const spoofAttemptResult = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            if (!window.unionBotAPI) return { error: 'window.unionBotAPI not found' };
            return await window.unionBotAPI.dispatchEnvelope({
              id: 'smoke_spoof_001',
              traceId: 'smoke_trc_spoof',
              timestamp: Date.now(),
              sender: { kind: 'agent', id: 'fake_lead', name: 'Fake Leader', role: 'LEADER' },
              recipient: { kind: 'room', id: 'orchestration' },
              roomId: 'orchestration',
              fidelity: 'L0_RAW_TEXT',
              parts: [{ kind: 'text', text: 'Malicious renderer impersonating leader' }]
            });
          })()
        `);
        const spoofBlocked = Boolean(
          spoofAttemptResult &&
          spoofAttemptResult.success === false &&
          String(spoofAttemptResult.error).includes('Security violation')
        );
        console.log('[SmokeTest] Renderer anti-spoofing enforcement verified:', spoofBlocked);

        const allChecksPassed = Boolean(
          testBlocked &&
          !schemeCheck.valid &&
          gotTheLock &&
          admissionCheck.allowed &&
          ipcSendSuccess &&
          historyVerified &&
          spoofBlocked
        );

        const smokeReport = {
          suite: 'UNION_BOT_ELECTRON_GUI_SMOKE',
          timestamp: new Date().toISOString(),
          windowTitle: mainWindow.getTitle(),
          userDataDir,
          costGuardBlockedPaid: testBlocked,
          safeExternalBlockedDangerous: !schemeCheck.valid,
          singleInstanceLocked: gotTheLock,
          orchestratorAdmissionPassed: admissionCheck.allowed,
          ipcRoundtripVerified: ipcSendSuccess && historyVerified,
          rendererSpoofingBlocked: spoofBlocked,
          result: allChecksPassed ? 'PASS' : 'FAIL',
        };

        const reportDir = path.resolve(__dirname, '../../../reports/capability-evidence');
        if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
        fs.writeFileSync(
          path.join(reportDir, 'ELECTRON_GUI_SMOKE_EVIDENCE.json'),
          JSON.stringify(smokeReport, null, 2),
          'utf-8'
        );

        console.log('[SmokeTest] Evidence written to ELECTRON_GUI_SMOKE_EVIDENCE.json');

        if (!allChecksPassed) {
          console.error('[SmokeTest] One or more assertions FAILED! Exiting with code 1.');
          app.quit();
          process.exit(1);
        }

        console.log('[SmokeTest] Smoke test PASS! All assertions verified cleanly.');
        app.quit();
        process.exit(0);
      } catch (err) {
        console.error('[SmokeTest] Smoke test FAILED:', err);
        app.quit();
        process.exit(1);
      }
    });
  }
}

// Strict senderFrame verification enforcing main Window and exact UI frame URL (UB-P2-R01-008, P2-T13)
function isAuthorizedSenderFrame(event) {
  if (!event || !event.sender || !event.senderFrame) {
    return false;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }
  if (event.sender.id !== mainWindow.webContents.id) {
    return false;
  }
  if (event.senderFrame.parent !== null) {
    return false;
  }
  const frameUrl = event.senderFrame.url;
  if (!frameUrl || frameUrl !== allowedUiFileUrl) {
    return false;
  }
  return true;
}

// IPC Handlers: Strictly routed through Orchestrator with renderer anti-spoofing and origin validation (C03, UB-P2-R01-008)
ipcMain.handle('union-bot:dispatch-envelope', async (event, envelope) => {
  if (!isAuthorizedSenderFrame(event)) {
    return { success: false, error: 'Security violation: Unauthorized IPC sender origin or missing frame (UB-P2-R01-008)' };
  }

  const result = await orchestrator.dispatchEnvelope(envelope, { fromRenderer: true });
  if (!result.success) {
    return { success: false, error: result.error };
  }

  // Broadcast to subscribers
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('union-bot:envelope-received', envelope);
  }
  return { success: true, envelopeId: result.envelopeId, roomId: result.roomId };
});

ipcMain.handle('union-bot:get-room-history', async (event, roomId) => {
  if (!isAuthorizedSenderFrame(event)) {
    return [];
  }
  if (typeof roomId !== 'string') return [];
  return orchestrator.getRoomHistory(roomId);
});

// App Lifecycle
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('second-instance', () => {
  console.log('[UnionBot] Second instance detected. Focusing existing window.');
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  try {
    storage.close();
  } catch {}
});
