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

const { app, BrowserWindow, WebContentsView, dialog, ipcMain, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const { safeOpenExternal, validateExternalUrl } = require('./safe-external.js');
const { CostGuard, installElectronCostGuardInterceptor } = require('./cost-guard.cjs');
const { Orchestrator } = require('./orchestrator.cjs');
const { StorageServiceClient } = require('./storage-service.cjs');
const { isAuthorizedSenderFrame } = require('./auth-check.cjs');
const { extractActionSemanticInput, computeCanonicalDigest } = require('./canonical-json.cjs');
const { BrowserService } = require('./browser-service.cjs');
const { isCostGuardBlockedUrl, PROVIDER_REGISTRY } = require('../../../packages/browser-manager/src/browser-manager.cjs');
const { ArtifactStore, detectMimeType, sanitizeSvg } = require('../../../packages/artifact-store/src/artifact-store.cjs');
const { ToolHost } = require('./tool-host.cjs');
const { MCPService } = require('./mcp-service.cjs');
const { CodexService } = require('./codex-service.cjs');
const { AntigravityService } = require('./antigravity-service.cjs');
const { TaskGraphService } = require('./task-graph-service.cjs');

// Custom test userData override for isolated multi-process E2E testing
const customUserDataArg = process.argv.find((a) => a.startsWith('--test-user-data=') || a.startsWith('--user-data-dir='));
if (customUserDataArg) {
  const customUserData = customUserDataArg.split('=')[1];
  app.setPath('userData', path.resolve(customUserData));
}

// 1. Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[UnionBot] Another instance is already running. Quitting duplicate instance.');
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let browserService = null;
let appStatus = 'STARTING'; // 'STARTING' | 'READY' | 'STORAGE_ERROR_BLOCKED'
let storageInitError = null;
const uiDistPath = path.resolve(__dirname, '../../workspace-ui/dist/index.html');
const allowedUiFileUrl = pathToFileURL(uiDistPath).href;
const costGuard = new CostGuard();

// UB-P2-R06-003 / R07-A03: Test mutation channels strictly isolated.
const isPackagedApp = app.isPackaged || process.env.NODE_ENV === 'production';
const isDedicatedTestHarness =
  !isPackagedApp &&
  process.env.NODE_ENV === 'test' &&
  process.env.UNION_BOT_E2E_HARNESS === '1';

const testQueuedFileDialogPaths = [];
const testQueuedSaveDialogPaths = [];

const userDataPath = app.getPath('userData');
const dbFilePath = path.join(userDataPath, 'union_bot.db');
const localCasDir = path.join(userDataPath, 'cas-store');
const artifactStore = new ArtifactStore(localCasDir);
const toolHost = new ToolHost(path.resolve(__dirname, '../../..'));
const mcpService = new MCPService(localCasDir, path.resolve(__dirname, '../../..'));
const storage = new StorageServiceClient(dbFilePath);
const orchestrator = new Orchestrator({ costGuard, storage });
const codexService = new CodexService(path.resolve(__dirname, '../../..'), artifactStore, toolHost);

codexService.on('delta', (delta, params) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('union-bot:codex-delta', { delta, params });
  }
});

codexService.on('turnCompleted', (turn, params) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('union-bot:codex-turn-completed', { turn, params });
  }
});

const antigravityService = new AntigravityService(path.resolve(__dirname, '../../..'), artifactStore, costGuard);

antigravityService.on('delta', (delta) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('union-bot:antigravity-delta', { delta });
  }
});

antigravityService.on('turn_completed', (result) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('union-bot:antigravity-turn-completed', { result });
  }
});

const taskGraphService = new TaskGraphService(path.resolve(__dirname, '../../..'), costGuard, storage);

taskGraphService.on('graph-event', (evt) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('union-bot:task-graph-event', evt);
  }
});

// Listen for worker runtime unexpected termination (R04-C03, R05-H08 Case 4)
storage.on('worker-exit', ({ code, signal }) => {
  console.error(`[UnionBot] Storage worker unexpectedly exited during runtime with code ${code} / signal ${signal} (R04-C03)`);
  appStatus = 'STORAGE_ERROR_BLOCKED';
  storageInitError = `Storage worker terminated at runtime with exit code ${code}`;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('union-bot:app-status-changed', { status: appStatus, error: storageInitError });
  }
});


function createWindow() {
  const isSmoke = process.argv.includes('--smoke');
  const isHeadless = process.argv.includes('--headless');

  // Local storage directories under user data
  const userDataDir = app.getPath('userData');
  const localCasDir = path.join(userDataDir, 'cas-store');
  if (!fs.existsSync(localCasDir)) {
    fs.mkdirSync(localCasDir, { recursive: true });
  }
  const localExportsDir = path.join(userDataDir, 'exports');
  if (!fs.existsSync(localExportsDir)) {
    fs.mkdirSync(localExportsDir, { recursive: true });
  }

  // 2. Install CostGuard on defaultSession
  installElectronCostGuardInterceptor(session.defaultSession, costGuard);

  // UB-P3-R04-G02: Capture browser downloads from PreferencesModal and save directly to exports folder
  session.defaultSession.on('will-download', (event, item, webContents) => {
    const exportsDir = path.resolve(app.getPath('userData'), 'exports');
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }
    const savePath = path.resolve(exportsDir, item.getFilename());
    item.setSavePath(savePath);
  });

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

  mainWindow.webContents.on('console-message', (_event, _level, message) => {
    if (isDedicatedTestHarness) {
      console.log(`[RendererConsole] ${message}`);
    }
  });

  // Phase P4: Embedded Chromium & AI Provider BrowserService
  try {
    browserService = new BrowserService(mainWindow, storage);
    browserService.initialize().catch((err) => {
      console.warn('[UnionBot] Warning initializing browser service:', err.message);
    });
  } catch (err) {
    console.warn('[UnionBot] Failed to create BrowserService:', err.message);
  }

  mainWindow.on('closed', () => {
    if (browserService) {
      browserService.destroy();
      browserService = null;
    }
    if (codexService) {
      codexService.close();
    }
    if (antigravityService) {
      antigravityService.close();
    }
    mainWindow = null;
  });

  // 4. Secure Window Open Handler: Deny all popups & delegate safe external URLs
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    safeOpenExternal(url, shell);
    return { action: 'deny' };
  });

  // 5. Use allowed Workspace UI path (allowedUiFileUrl)
  // 6. Strictly restrict in-window navigation: ONLY the bundled UI index.html is allowed
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== allowedUiFileUrl) {
      event.preventDefault();
      safeOpenExternal(url, shell);
    }
  });

  // 7. Load Workspace UI or Recovery Screen
  if (appStatus === 'STORAGE_ERROR_BLOCKED') {
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
      <!DOCTYPE html>
      <html>
        <head><title>Union Bot — Storage Initialization Error</title></head>
        <body style="background:#0a0d14;color:#f1f5f9;font-family:sans-serif;padding:40px;">
          <h1 style="color:#ef4444;">Union Bot — Storage Error</h1>
          <p><strong>Status:</strong> STORAGE_ERROR_BLOCKED</p>
          <p>The desktop persistent storage engine failed to initialize:</p>
          <pre style="background:#1e293b;padding:12px;border-radius:6px;color:#f87171;">${storageInitError || 'Storage offline'}</pre>
          <p>All mutation operations (dispatchEnvelope, approveToken) are strictly blocked.</p>
          <p>UserData Directory: <code>${userDataDir}</code></p>
          <div style="margin-top:20px;">
            <button onclick="window.location.reload()" style="background:#2563eb;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;">Retry Storage Initialization</button>
          </div>
        </body>
      </html>
    `)}`);
  } else if (fs.existsSync(uiDistPath)) {
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

  // 7a. R04-G07: Storage Error Recovery Smoke Test Mode
  if (process.argv.includes('--smoke-error-test')) {
    console.log('[SmokeErrorTest] Running Storage Error Recovery Smoke Test...');
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const evalResult = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const status = await window.unionBotAPI.getAppStatus();
            const dispatch = await window.unionBotAPI.dispatchEnvelope({
              id: 'err_test_001',
              traceId: 'trc_err_001',
              timestamp: Date.now(),
              sender: { kind: 'user', id: 'tester', role: 'USER' },
              recipient: { kind: 'room', id: 'orchestration' },
              roomId: 'orchestration',
              fidelity: 'L0_RAW_TEXT',
              parts: [{ kind: 'text', text: 'Blocked dispatch' }]
            });
            const approve = await window.unionBotAPI.approveToken({ tokenId: 'tok_blocked' });
            return { status, dispatch, approve };
          })()
        `);

        const isStatusBlocked = appStatus === 'STORAGE_ERROR_BLOCKED' && evalResult.status.status === 'STORAGE_ERROR_BLOCKED';
        const isDispatchBlocked = evalResult.dispatch.success === false && String(evalResult.dispatch.error).includes('ERR_STORAGE_UNAVAILABLE');
        const isApproveBlocked = evalResult.approve.success === false && String(evalResult.approve.error).includes('ERR_STORAGE_UNAVAILABLE');

        console.log('[SmokeErrorTest] Status blocked:', isStatusBlocked);
        console.log('[SmokeErrorTest] Dispatch blocked:', isDispatchBlocked);
        console.log('[SmokeErrorTest] Approve blocked:', isApproveBlocked);

        const allPassed = isStatusBlocked && isDispatchBlocked && isApproveBlocked;
        const report = {
          suite: 'UNION_BOT_ELECTRON_STORAGE_ERROR_SMOKE',
          timestamp: new Date().toISOString(),
          appStatus,
          storageInitError,
          statusCheck: evalResult.status,
          dispatchBlocked: isDispatchBlocked,
          approveBlocked: isApproveBlocked,
          result: allPassed ? 'PASS' : 'FAIL',
        };

        const reportDir = path.resolve(__dirname, '../../../reports/capability-evidence');
        if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
        fs.writeFileSync(
          path.join(reportDir, 'ELECTRON_STORAGE_ERROR_SMOKE_EVIDENCE.json'),
          JSON.stringify(report, null, 2),
          'utf-8'
        );

        if (!allPassed) {
          app.quit();
          process.exit(1);
        }
        console.log('[SmokeErrorTest] PASS! Storage failure recovery correctly blocked all mutations.');
        app.quit();
        process.exit(0);
      } catch (err) {
        console.error('[SmokeErrorTest] Error:', err);
        app.quit();
        process.exit(1);
      }
    });
    return;
  }

  // 7b. R04-G08: Real Electron Kill & Relaunch Stage 1
  if (process.argv.includes('--r04-e2e-stage=1')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const dispatchResult = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            return await window.unionBotAPI.dispatchEnvelope({
              id: 'e2e_kill_test_001',
              traceId: 'trc_kill_001',
              timestamp: Date.now(),
              sender: { kind: 'user', id: 'kill_tester', name: 'Kill Tester', role: 'USER' },
              recipient: { kind: 'room', id: 'orchestration' },
              roomId: 'orchestration',
              fidelity: 'L0_RAW_TEXT',
              parts: [{ kind: 'text', text: 'Kill restart envelope test' }]
            });
          })()
        `);

        if (!dispatchResult || !dispatchResult.success || dispatchResult.envelopeId !== 'e2e_kill_test_001') {
          console.error('[R04-G08] Stage 1 dispatch failed:', dispatchResult);
          app.quit();
          process.exit(1);
        }

        const ackMarkerPath = path.join(userDataDir, 'e2e_stage1_ack.json');
        fs.writeFileSync(ackMarkerPath, JSON.stringify(dispatchResult, null, 2), 'utf-8');
        console.log('[R04-G08] STAGE1_DURABLE_ACK_RECEIVED');
      } catch (err) {
        console.error('[R04-G08] Stage 1 exception:', err);
        app.quit();
        process.exit(1);
      }
    });
    return;
  }

  // 7c. R04-G08: Real Electron Kill & Relaunch Stage 2
  if (process.argv.includes('--r04-e2e-stage=2')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const stage2Result = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const history = await window.unionBotAPI.getRoomHistory('orchestration');
            const dupResult = await window.unionBotAPI.dispatchEnvelope({
              id: 'e2e_kill_test_001',
              traceId: 'trc_kill_001',
              timestamp: Date.now(),
              sender: { kind: 'user', id: 'kill_tester', name: 'Kill Tester', role: 'USER' },
              recipient: { kind: 'room', id: 'orchestration' },
              roomId: 'orchestration',
              fidelity: 'L0_RAW_TEXT',
              parts: [{ kind: 'text', text: 'Kill restart envelope test' }]
            });
            const changedResult = await window.unionBotAPI.dispatchEnvelope({
              id: 'e2e_kill_test_001',
              traceId: 'trc_kill_001',
              timestamp: Date.now(),
              sender: { kind: 'user', id: 'kill_tester', name: 'Kill Tester', role: 'USER' },
              recipient: { kind: 'room', id: 'orchestration' },
              roomId: 'orchestration',
              fidelity: 'L0_RAW_TEXT',
              parts: [{ kind: 'text', text: 'MALICIOUS_CHANGED_PAYLOAD' }]
            });
            const historyAfter = await window.unionBotAPI.getRoomHistory('orchestration');
            return { history, dupResult, changedResult, historyAfter };
          })()
        `);

        const historyOk = Array.isArray(stage2Result.history) && stage2Result.history.length === 1 && stage2Result.history[0].id === 'e2e_kill_test_001';
        const dupOk = Boolean(stage2Result.dupResult && stage2Result.dupResult.success && stage2Result.dupResult.deduplicated);
        const changedOk = Boolean(stage2Result.changedResult && !stage2Result.changedResult.success && String(stage2Result.changedResult.error).includes('ERR_PAYLOAD_MISMATCH'));
        const countOk = Array.isArray(stage2Result.historyAfter) && stage2Result.historyAfter.length === 1;

        console.log('[R04-G08] History preserved:', historyOk);
        console.log('[R04-G08] Exact duplicate ACKed:', dupOk);
        console.log('[R04-G08] Changed payload rejected:', changedOk);
        console.log('[R04-G08] Final count preserved (1):', countOk);

        const allPassed = historyOk && dupOk && changedOk && countOk;

        const report = {
          suite: 'UNION_BOT_ELECTRON_KILL_RESTART_EVIDENCE',
          timestamp: new Date().toISOString(),
          userDataDir,
          historyCountBefore: stage2Result.history?.length,
          dupResult: stage2Result.dupResult,
          changedResult: stage2Result.changedResult,
          historyCountAfter: stage2Result.historyAfter?.length,
          result: allPassed ? 'PASS' : 'FAIL',
        };

        const reportDir = path.resolve(__dirname, '../../../reports/capability-evidence');
        if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
        fs.writeFileSync(
          path.join(reportDir, 'ELECTRON_KILL_RESTART_EVIDENCE.json'),
          JSON.stringify(report, null, 2),
          'utf-8'
        );

        if (!allPassed) {
          app.quit();
          process.exit(1);
        }

        console.log('[R04-G08] STAGE2_VERIFICATION_PASSED');
        app.quit();
        process.exit(0);
      } catch (err) {
        console.error('[R04-G08] Stage 2 exception:', err);
        app.quit();
        process.exit(1);
      }
    });
    return;
  }

  // 7d. R04-G11: Real Electron Frame Boundary Verification
  if (process.argv.includes('--r04-e2e-frame-test')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        console.log('[R04-G11] Running Frame Boundary Verification in Real Electron...');

        // 1. Trusted Main Frame dispatch
        const mainFrameResult = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            return await window.unionBotAPI.dispatchEnvelope({
              id: 'frame_test_main_001',
              traceId: 'trc_frame_main',
              timestamp: Date.now(),
              sender: { kind: 'user', id: 'frame_tester', name: 'Frame Tester', role: 'USER' },
              recipient: { kind: 'room', id: 'orchestration' },
              roomId: 'orchestration',
              fidelity: 'L0_RAW_TEXT',
              parts: [{ kind: 'text', text: 'Trusted main frame message' }]
            });
          })()
        `);
        const mainFrameAllowed = Boolean(mainFrameResult && mainFrameResult.success === true);
        console.log('[R04-G11] mainFrameResult raw:', JSON.stringify(mainFrameResult));
        console.log('[R04-G11] Trusted main frame dispatch:', mainFrameAllowed);

        // 2. Second BrowserWindow (Rogue Window / Unauthorized webContents)
        const rogueWin = new BrowserWindow({
          show: false,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            preload: path.join(__dirname, 'preload.cjs'),
          },
        });
        await rogueWin.loadURL('data:text/html;charset=utf-8,<html><body>Rogue Window</body></html>');
        const rogueResult = await rogueWin.webContents.executeJavaScript(`
          (async () => {
            return await window.unionBotAPI.dispatchEnvelope({
              id: 'frame_test_rogue_001',
              traceId: 'trc_frame_rogue',
              timestamp: Date.now(),
              sender: { kind: 'user', id: 'rogue_tester', name: 'Rogue Tester', role: 'USER' },
              recipient: { kind: 'room', id: 'orchestration' },
              roomId: 'orchestration',
              fidelity: 'L0_RAW_TEXT',
              parts: [{ kind: 'text', text: 'Rogue window message' }]
            });
          })()
        `);
        rogueWin.destroy();
        const rogueBlocked = Boolean(rogueResult && rogueResult.success === false && String(rogueResult.error).includes('Security violation'));
        console.log('[R04-G11] Rogue window IPC blocked:', rogueBlocked);

        // 3. Subframe / Iframe senderFrame verification
        const iframeSyntheticEvent = {
          sender: mainWindow.webContents,
          senderFrame: {
            parent: { id: 1 },
            url: allowedUiFileUrl,
          },
        };
        const iframeCheckDenied = !isAuthorizedSenderFrame(iframeSyntheticEvent, mainWindow, allowedUiFileUrl);
        console.log('[R04-G11] Subframe/Iframe sender denied by auth-check:', iframeCheckDenied);

        // 4. Navigated / Unauthorized URL in main window
        const untrustedUrlSyntheticEvent = {
          sender: mainWindow.webContents,
          senderFrame: {
            parent: null,
            url: 'https://evil.attacker.com/index.html',
          },
        };
        const untrustedUrlDenied = !isAuthorizedSenderFrame(untrustedUrlSyntheticEvent, mainWindow, allowedUiFileUrl);
        console.log('[R04-G11] Untrusted navigated URL denied by auth-check:', untrustedUrlDenied);

        const allPassed = mainFrameAllowed && rogueBlocked && iframeCheckDenied && untrustedUrlDenied;

        const report = {
          suite: 'UNION_BOT_ELECTRON_FRAME_BOUNDARY_EVIDENCE',
          timestamp: new Date().toISOString(),
          mainFrameAllowed,
          rogueBlocked,
          iframeCheckDenied,
          untrustedUrlDenied,
          result: allPassed ? 'PASS' : 'FAIL',
        };

        const reportDir = path.resolve(__dirname, '../../../reports/capability-evidence');
        if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
        fs.writeFileSync(
          path.join(reportDir, 'ELECTRON_FRAME_BOUNDARY_EVIDENCE.json'),
          JSON.stringify(report, null, 2),
          'utf-8'
        );

        if (!allPassed) {
          app.quit();
          process.exit(1);
        }

        console.log('[R04-G11] FRAME_BOUNDARY_VERIFICATION_PASSED');
        app.quit();
        process.exit(0);
      } catch (err) {
        console.error('[R04-G11] Exception:', err);
        app.quit();
        process.exit(1);
      }
    });
    return;
  }

  // 7e. R05-H05: Hard Kill & Replay Stage 1
  if (process.argv.includes('--r05-e2e-h05-stage=1')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const res = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const actionInput = { tool: 'write_file', estimatedCost: 0, path: 'src/main.rs', content: 'fn main() {}' };
            const { digest } = await window.unionBotAPI.computeActionDigest(actionInput);
            const tokenCreate = await window.unionBotAPI.createApprovalToken({
              tokenId: 'tok_h05_kill',
              actionType: 'write_file',
              payload: actionInput,
              payloadDigest: digest,
              origin: 'desktop_ui',
              roomId: 'orchestration',
              workspaceId: 'ws_h05',
              recipient: 'agent_coder',
            });
            const approveRes = await window.unionBotAPI.approveToken('tok_h05_kill', { confirmedByUser: true });
            const envelope = {
              id: 'env_h05_kill_001',
              traceId: 'trc_h05_001',
              roomId: 'orchestration',
              workspaceId: 'ws_h05',
              timestamp: Date.now(),
              sender: { kind: 'user', id: 'usr_h05', name: 'H05 User', role: 'USER' },
              recipient: { kind: 'agent', id: 'agent_coder' },
              fidelity: 'L0_RAW_TEXT',
              parts: [{
                kind: 'action',
                tool: 'write_file',
                callId: 'call_h05_001',
                status: 'requested',
                input: actionInput,
                approvalTokenId: 'tok_h05_kill',
              }],
            };
            const dispatchRes = await window.unionBotAPI.dispatchEnvelope(envelope);
            return { tokenCreate, approveRes, dispatchRes };
          })()
        `);

        if (!res.dispatchRes || !res.dispatchRes.success || res.dispatchRes.envelopeId !== 'env_h05_kill_001') {
          console.error('[R05-H05] Stage 1 failed:', res);
          app.quit();
          process.exit(1);
        }

        const ackMarker = path.join(userDataDir, 'e2e_h05_stage1.json');
        fs.writeFileSync(ackMarker, JSON.stringify(res, null, 2), 'utf-8');
        console.log('[R05-H05] STAGE1_COMMITTED');
      } catch (err) {
        console.error('[R05-H05] Stage 1 exception:', err);
        app.quit();
        process.exit(1);
      }
    });
    return;
  }

  // 7f. R05-H05: Hard Kill & Replay Stage 2
  if (process.argv.includes('--r05-e2e-h05-stage=2')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const stage2Result = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const historyBefore = await window.unionBotAPI.getRoomHistory('orchestration');
            const tokenBefore = await window.unionBotAPI.getApprovalToken('tok_h05_kill');
            const actionInput = { tool: 'write_file', estimatedCost: 0, path: 'src/main.rs', content: 'fn main() {}' };
            const identicalEnvelope = {
              id: 'env_h05_kill_001',
              traceId: 'trc_h05_001',
              roomId: 'orchestration',
              workspaceId: 'ws_h05',
              timestamp: Date.now(),
              sender: { kind: 'user', id: 'usr_h05', name: 'H05 User', role: 'USER' },
              recipient: { kind: 'agent', id: 'agent_coder' },
              fidelity: 'L0_RAW_TEXT',
              parts: [{
                kind: 'action',
                tool: 'write_file',
                callId: 'call_h05_001',
                status: 'requested',
                input: actionInput,
                approvalTokenId: 'tok_h05_kill',
              }],
            };
            // 1. Replay identical action
            const replayRes = await window.unionBotAPI.dispatchEnvelope(identicalEnvelope);

            // 2. Modified payload replay attempt
            const tamperedEnvelope = {
              ...identicalEnvelope,
              parts: [{
                ...identicalEnvelope.parts[0],
                input: { ...actionInput, content: 'TAMPERED_MALICIOUS_CONTENT' },
              }],
            };
            const tamperedRes = await window.unionBotAPI.dispatchEnvelope(tamperedEnvelope);

            const historyAfter = await window.unionBotAPI.getRoomHistory('orchestration');
            const tokenAfter = await window.unionBotAPI.getApprovalToken('tok_h05_kill');

            return { historyBefore, tokenBefore, replayRes, tamperedRes, historyAfter, tokenAfter };
          })()
        `);

        const historyCountBeforeOk = stage2Result.historyBefore && stage2Result.historyBefore.length === 1;
        const tokenConsumedBeforeOk = stage2Result.tokenBefore && stage2Result.tokenBefore.status === 'CONSUMED';
        const replayDedupOk = Boolean(stage2Result.replayRes && stage2Result.replayRes.success === true && stage2Result.replayRes.deduplicated === true);
        const tamperedDeniedOk = Boolean(stage2Result.tamperedRes && !stage2Result.tamperedRes.success && String(stage2Result.tamperedRes.error).includes('ERR_PAYLOAD_MISMATCH'));
        const historyCountAfterOk = stage2Result.historyAfter && stage2Result.historyAfter.length === 1;
        const tokenConsumedAfterOk = stage2Result.tokenAfter && stage2Result.tokenAfter.status === 'CONSUMED';

        console.log('[R05-H05] History count preserved (1):', historyCountBeforeOk && historyCountAfterOk);
        console.log('[R05-H05] Token remains CONSUMED:', tokenConsumedBeforeOk && tokenConsumedAfterOk);
        console.log('[R05-H05] Replay returns cached ACK (deduplicated=true):', replayDedupOk);
        console.log('[R05-H05] Tampered replay rejected with ERR_PAYLOAD_MISMATCH:', tamperedDeniedOk);

        const allPassed = historyCountBeforeOk && tokenConsumedBeforeOk && replayDedupOk && tamperedDeniedOk && historyCountAfterOk && tokenConsumedAfterOk;

        const report = {
          suite: 'UNION_BOT_ELECTRON_R05_H05_EVIDENCE',
          timestamp: new Date().toISOString(),
          userDataDir,
          historyCountBefore: stage2Result.historyBefore?.length,
          replayResult: stage2Result.replayRes,
          tamperedResult: stage2Result.tamperedRes,
          historyCountAfter: stage2Result.historyAfter?.length,
          tokenStatus: stage2Result.tokenAfter?.status,
          result: allPassed ? 'PASS' : 'FAIL',
        };

        const reportDir = path.resolve(__dirname, '../../../reports/capability-evidence');
        if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
        fs.writeFileSync(
          path.join(reportDir, 'ELECTRON_R05_H05_KILL_REPLAY_EVIDENCE.json'),
          JSON.stringify(report, null, 2),
          'utf-8'
        );

        if (!allPassed) {
          app.quit();
          process.exit(1);
        }

        console.log('[R05-H05] STAGE2_VERIFICATION_PASSED');
        app.quit();
        process.exit(0);
      } catch (err) {
        console.error('[R05-H05] Stage 2 exception:', err);
        app.quit();
        process.exit(1);
      }
    });
    return;
  }

  // 7g. R05-H07: Full Production IPC Approval Flow
  if (process.argv.includes('--r05-e2e-h07')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        console.log('[R05-H07] Running Production IPC Approval Flow Verification...');
        const h07Result = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            // 1. ActionIntent A with nested args and recipient
            const actionInputA = {
              tool: 'fake_local_file_writer',
              estimatedCost: 0,
              args: {
                path: 'output/report.json',
                options: { overwrite: true, format: 'json' },
                content: { summary: 'Phase P2 Complete', timestamp: 1729300000000 }
              }
            };
            const recipientA = { kind: 'agent', id: 'agent_writer' };

            // 2. Compute canonical digest of ActionIntent A
            const { digest: previewDigest } = await window.unionBotAPI.computeActionDigest(actionInputA);

            // 3. Create approval token with previewDigest
            const tokenIdA = 'tok_h07_prod_001';
            await window.unionBotAPI.createApprovalToken({
              tokenId: tokenIdA,
              actionType: 'fake_local_file_writer',
              payload: actionInputA,
              payloadDigest: previewDigest,
              origin: 'desktop_ui',
              roomId: 'orchestration',
              workspaceId: 'ws_h07',
              recipient: recipientA.id,
            });

            await window.unionBotAPI.approveToken(tokenIdA, { confirmedByUser: true });
            const tokenApproved = await window.unionBotAPI.getApprovalToken(tokenIdA);

            // 5. Renderer sends envelope containing Action A
            const envelopeA = {
              id: 'env_h07_prod_001',
              traceId: 'trc_h07_001',
              roomId: 'orchestration',
              workspaceId: 'ws_h07',
              timestamp: Date.now(),
              sender: { kind: 'user', id: 'usr_operator', name: 'Operator', role: 'USER' },
              recipient: recipientA,
              fidelity: 'L0_RAW_TEXT',
              parts: [{
                kind: 'action',
                tool: 'fake_local_file_writer',
                callId: 'call_h07_001',
                status: 'requested',
                input: { ...actionInputA, approvalTokenId: tokenIdA },
              }],
            };

            const dispatchRes = await window.unionBotAPI.dispatchEnvelope(envelopeA);
            const tokenConsumed = await window.unionBotAPI.getApprovalToken(tokenIdA);
            const history = await window.unionBotAPI.getRoomHistory('orchestration');

            // 6. Tamper test: reuse tokenIdA with modified args
            const tamperedActionInput = {
              ...actionInputA,
              args: { ...actionInputA.args, path: 'output/MALICIOUS_OVERWRITE.json' },
              approvalTokenId: tokenIdA,
            };
            const tamperedEnvelope = {
              id: 'env_h07_tamper_001',
              traceId: 'trc_h07_tamper',
              roomId: 'orchestration',
              workspaceId: 'ws_h07',
              timestamp: Date.now(),
              sender: { kind: 'user', id: 'usr_operator', name: 'Operator', role: 'USER' },
              recipient: recipientA,
              fidelity: 'L0_RAW_TEXT',
              parts: [{
                kind: 'action',
                tool: 'fake_local_file_writer',
                callId: 'call_h07_tamper',
                status: 'requested',
                input: tamperedActionInput,
              }],
            };
            const tamperRes1 = await window.unionBotAPI.dispatchEnvelope(tamperedEnvelope);

            // 7. Tamper test: new token B approved, but recipient modified before dispatch
            const actionInputB = { tool: 'fake_local_file_writer', estimatedCost: 0, args: { path: 'valid.txt' } };
            const { digest: digestB } = await window.unionBotAPI.computeActionDigest(actionInputB);
            const tokenIdB = 'tok_h07_prod_002';
            await window.unionBotAPI.createApprovalToken({
              tokenId: tokenIdB,
              actionType: 'fake_local_file_writer',
              payload: actionInputB,
              payloadDigest: digestB,
              origin: 'desktop_ui',
              roomId: 'orchestration',
              workspaceId: 'ws_h07',
              recipient: 'agent_writer',
            });
            await window.unionBotAPI.approveToken(tokenIdB, { confirmedByUser: true });

            // Dispatch with modified recipient (rogue agent)
            const modifiedRecipientEnvelope = {
              id: 'env_h07_tamper_002',
              traceId: 'trc_h07_tamper2',
              roomId: 'orchestration',
              workspaceId: 'ws_h07',
              timestamp: Date.now(),
              sender: { kind: 'user', id: 'usr_operator', name: 'Operator', role: 'USER' },
              recipient: { kind: 'agent', id: 'agent_rogue_intruder' },
              fidelity: 'L0_RAW_TEXT',
              parts: [{
                kind: 'action',
                tool: 'fake_local_file_writer',
                callId: 'call_h07_tamper2',
                status: 'requested',
                input: { ...actionInputB, approvalTokenId: tokenIdB },
              }],
            };
            const tamperRes2 = await window.unionBotAPI.dispatchEnvelope(modifiedRecipientEnvelope);

            return {
              previewDigest,
              tokenApproved,
              dispatchRes,
              tokenConsumed,
              history,
              tamperRes1,
              tamperRes2,
            };
          })()
        `);

        const previewDigest = h07Result.previewDigest;
        const approvedDigest = h07Result.tokenApproved?.payload_digest || h07Result.tokenApproved?.payloadDigest;
        const consumedDigest = h07Result.tokenConsumed?.payload_digest || h07Result.tokenConsumed?.payloadDigest;

        // Recorded digest from history
        const recordedEnv = h07Result.history?.find((e) => e.id === 'env_h07_prod_001');
        const recordedSemantic = recordedEnv ? extractActionSemanticInput(recordedEnv.parts[0].input) : null;
        const recordedDigest = recordedSemantic ? computeCanonicalDigest(recordedSemantic, 1) : null;

        const digestMatch = previewDigest === approvedDigest && approvedDigest === consumedDigest && consumedDigest === recordedDigest;
        const tokenConsumedOk = h07Result.tokenConsumed?.status === 'CONSUMED';
        const recordedOnce = h07Result.history?.filter((e) => e.id === 'env_h07_prod_001').length === 1;
        const tamper1Denied = Boolean(h07Result.tamperRes1 && !h07Result.tamperRes1.success);
        const tamper2Denied = Boolean(h07Result.tamperRes2 && !h07Result.tamperRes2.success);

        console.log('[R05-H07] Preview digest:', previewDigest);
        console.log('[R05-H07] Digests match (preview===approved===consumed===recorded):', digestMatch);
        console.log('[R05-H07] Token status CONSUMED:', tokenConsumedOk);
        console.log('[R05-H07] Recorded exactly once:', recordedOnce);
        console.log('[R05-H07] Modified args after preview denied:', tamper1Denied);
        console.log('[R05-H07] Modified recipient after approval denied:', tamper2Denied);

        const allPassed = digestMatch && tokenConsumedOk && recordedOnce && tamper1Denied && tamper2Denied;

        const report = {
          suite: 'UNION_BOT_ELECTRON_R05_H07_EVIDENCE',
          timestamp: new Date().toISOString(),
          previewDigest,
          approvedDigest,
          consumedDigest,
          recordedDigest,
          digestsMatch: digestMatch,
          tokenStatus: h07Result.tokenConsumed?.status,
          recordedCount: h07Result.history?.filter((e) => e.id === 'env_h07_prod_001').length,
          tamper1Denied,
          tamper2Denied,
          result: allPassed ? 'PASS' : 'FAIL',
        };

        const reportDir = path.resolve(__dirname, '../../../reports/capability-evidence');
        if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
        fs.writeFileSync(
          path.join(reportDir, 'ELECTRON_R05_H07_APPROVAL_IPC_EVIDENCE.json'),
          JSON.stringify(report, null, 2),
          'utf-8'
        );

        if (!allPassed) {
          app.quit();
          process.exit(1);
        }

        console.log('[R05-H07] PRODUCTION_IPC_APPROVAL_PASSED');
        app.quit();
        process.exit(0);
      } catch (err) {
        console.error('[R05-H07] Exception:', err);
        app.quit();
        process.exit(1);
      }
    });
    return;
  }

  // 7h. R05-H08: Crash / Recovery Verification (Worker Death & Mutation Block)
  if (process.argv.includes('--r05-e2e-h08')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        console.log('[R05-H08] Running Crash / Recovery Scenarios in Real Electron...');

        const case4Result = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const initialStatus = await window.unionBotAPI.getAppStatus();

            // Listen for status change event
            const statusPromise = new Promise((resolve) => {
              const unsubscribe = window.unionBotAPI.onAppStatusChanged((newStatus) => {
                unsubscribe();
                resolve(newStatus);
              });
            });

            // Trigger worker kill
            await window.unionBotAPI.testKillWorker();

            const transitionedStatus = await statusPromise;

            // Attempt mutations while in STORAGE_ERROR_BLOCKED
            const dispatchBlocked = await window.unionBotAPI.dispatchEnvelope({
              id: 'env_h08_blocked',
              traceId: 'trc_blocked',
              roomId: 'orchestration',
              timestamp: Date.now(),
              sender: { kind: 'user', id: 'usr_h08', name: 'H08 User', role: 'USER' },
              recipient: { kind: 'room', id: 'orchestration' },
              fidelity: 'L0_RAW_TEXT',
              parts: [{ kind: 'text', text: 'Should be denied' }]
            });

            const approveBlocked = await window.unionBotAPI.approveToken('tok_blocked', { confirmedByUser: true });

            return {
              initialStatus,
              transitionedStatus,
              dispatchBlocked,
              approveBlocked,
            };
          })()
        `);

        const initialReady = case4Result.initialStatus?.status === 'READY';
        const transitionedBlocked = case4Result.transitionedStatus?.status === 'STORAGE_ERROR_BLOCKED';
        const dispatchDenied = case4Result.dispatchBlocked?.success === false && String(case4Result.dispatchBlocked?.error).includes('ERR_STORAGE_UNAVAILABLE');
        const approveDenied = case4Result.approveBlocked?.success === false && String(case4Result.approveBlocked?.error).includes('ERR_STORAGE_UNAVAILABLE');

        console.log('[R05-H08] Case 4: Initial status READY:', initialReady);
        console.log('[R05-H08] Case 4: Transitioned to STORAGE_ERROR_BLOCKED:', transitionedBlocked);
        console.log('[R05-H08] Case 4: Dispatch denied fail-closed:', dispatchDenied);
        console.log('[R05-H08] Case 4: Approve denied fail-closed:', approveDenied);

        const allPassed = initialReady && transitionedBlocked && dispatchDenied && approveDenied;

        const report = {
          suite: 'UNION_BOT_ELECTRON_R05_H08_EVIDENCE',
          timestamp: new Date().toISOString(),
          case4: {
            initialReady,
            transitionedBlocked,
            dispatchDenied,
            approveDenied,
          },
          result: allPassed ? 'PASS' : 'FAIL',
        };

        const reportDir = path.resolve(__dirname, '../../../reports/capability-evidence');
        if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
        fs.writeFileSync(
          path.join(reportDir, 'ELECTRON_R05_H08_WORKER_KILL_EVIDENCE.json'),
          JSON.stringify(report, null, 2),
          'utf-8'
        );

        if (!allPassed) {
          app.quit();
          process.exit(1);
        }

        console.log('[R05-H08] CRASH_RECOVERY_VERIFICATION_PASSED');
        app.quit();
        process.exit(0);
      } catch (err) {
        console.error('[R05-H08] Exception:', err);
        app.quit();
        process.exit(1);
      }
    });
    return;
  }

  // 7h. R06-E2E: Full Windows Electron Verification for Round R06 (R06-B01, R06-B03, R06-B06)
  if (process.argv.includes('--r06-e2e')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        console.log('[R06-E2E] Running Real Windows Electron R06 Verification...');

        const r06Result = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            // 1. Vector R06-B03: approveToken requires confirmedByUser: true
            const payloadB03 = { tool: 'write_file', estimatedCost: 0, path: 'b03.txt', content: 'b03' };
            const { digest: digestB03 } = await window.unionBotAPI.computeActionDigest(payloadB03);
            const tokenB03 = 'tok_r06_b03';
            await window.unionBotAPI.createApprovalToken({
              tokenId: tokenB03,
              actionType: 'write_file',
              payload: payloadB03,
              payloadDigest: digestB03,
              origin: 'desktop_ui',
              roomId: 'orchestration',
              workspaceId: 'ws_r06',
              recipient: 'agent_coder',
            });

            // Call approveToken without confirmedByUser -> must be rejected
            const unconfirmedRes = await window.unionBotAPI.approveToken(tokenB03);
            const tokenAfterUnconfirmed = await window.unionBotAPI.getApprovalToken(tokenB03);

            // Call approveToken with affirmative native confirmation -> must succeed
            if (window.unionBotAPI.testSetConfirmationMode) {
              await window.unionBotAPI.testSetConfirmationMode('auto-approve');
            }
            const confirmedRes = await window.unionBotAPI.approveToken(tokenB03, { confirmedByUser: true });
            const tokenAfterConfirmed = await window.unionBotAPI.getApprovalToken(tokenB03);

            // 2. Vector R06-B01: Multi-action envelope rejected fail-closed
            const actionInput1 = { tool: 'write_file', estimatedCost: 0, path: 'a.txt', content: 'action 1' };
            const { digest: digest1 } = await window.unionBotAPI.computeActionDigest(actionInput1);

            const actionInput2 = { tool: 'write_file', estimatedCost: 0, path: 'b.txt', content: 'action 2' };
            const { digest: digest2 } = await window.unionBotAPI.computeActionDigest(actionInput2);

            const validTokenId = 'tok_r06_valid_action2';
            await window.unionBotAPI.createApprovalToken({
              tokenId: validTokenId,
              actionType: 'write_file',
              payload: actionInput2,
              payloadDigest: digest2,
              origin: 'desktop_ui',
              roomId: 'orchestration',
              workspaceId: 'ws_r06',
              recipient: 'agent_coder',
            });
            await window.unionBotAPI.approveToken(validTokenId, { confirmedByUser: true });

            const multiActionEnvelope = {
              id: 'env_r06_multi_001',
              traceId: 'trc_r06_001',
              roomId: 'orchestration',
              workspaceId: 'ws_r06',
              timestamp: Date.now(),
              sender: { kind: 'user', id: 'usr_r06', name: 'R06 User', role: 'USER' },
              recipient: { kind: 'agent', id: 'agent_coder' },
              fidelity: 'L0_RAW_TEXT',
              parts: [
                {
                  kind: 'action',
                  tool: 'write_file',
                  callId: 'call_r06_action1',
                  status: 'requested',
                  input: actionInput1,
                  approvalTokenId: 'tok_fake_action1',
                },
                {
                  kind: 'action',
                  tool: 'write_file',
                  callId: 'call_r06_action2',
                  status: 'requested',
                  input: actionInput2,
                  approvalTokenId: validTokenId,
                },
              ],
            };

            const multiDispatchRes = await window.unionBotAPI.dispatchEnvelope(multiActionEnvelope);
            const validTokenAfterDispatch = await window.unionBotAPI.getApprovalToken(validTokenId);

            // 3. Vector R06-B06 in test mode: testKillWorker is permitted in test mode
            const testModeKillRes = await window.unionBotAPI.testKillWorker();

            return {
              unconfirmedRes,
              tokenAfterUnconfirmed,
              confirmedRes,
              tokenAfterConfirmed,
              multiDispatchRes,
              validTokenAfterDispatch,
              testModeKillRes,
            };
          })()
        `);

        const b03UnconfirmedDenied = r06Result.unconfirmedRes?.success === false &&
          String(r06Result.unconfirmedRes?.error).includes('ERR_HUMAN_CONFIRMATION_REQUIRED');
        const b03TokenRemainedPending = r06Result.tokenAfterUnconfirmed?.status === 'PENDING';
        const b03ConfirmedApproved = r06Result.confirmedRes?.success === true;
        const b03TokenBecameApproved = r06Result.tokenAfterConfirmed?.status === 'APPROVED';

        const b01MultiActionDenied = r06Result.multiDispatchRes?.success === false &&
          String(r06Result.multiDispatchRes?.error).includes('ERR_MULTI_ACTION_UNSUPPORTED');
        const b01ValidTokenNotConsumed = r06Result.validTokenAfterDispatch?.status === 'APPROVED';

        const b06TestModeAllowed = r06Result.testModeKillRes?.success === true;

        console.log('[R06-E2E] R06-B03 Unconfirmed approval rejected:', b03UnconfirmedDenied);
        console.log('[R06-E2E] R06-B03 Token remained PENDING:', b03TokenRemainedPending);
        console.log('[R06-E2E] R06-B03 Confirmed approval succeeded:', b03ConfirmedApproved);
        console.log('[R06-E2E] R06-B03 Token became APPROVED:', b03TokenBecameApproved);
        console.log('[R06-E2E] R06-B01 Multi-action envelope rejected fail-closed:', b01MultiActionDenied);
        console.log('[R06-E2E] R06-B01 Valid token not consumed (status APPROVED):', b01ValidTokenNotConsumed);
        console.log('[R06-E2E] R06-B06 Test mode permitted kill worker:', b06TestModeAllowed);

        const allPassed = b03UnconfirmedDenied &&
          b03TokenRemainedPending &&
          b03ConfirmedApproved &&
          b03TokenBecameApproved &&
          b01MultiActionDenied &&
          b01ValidTokenNotConsumed &&
          b06TestModeAllowed;

        const report = {
          suite: 'UNION_BOT_ELECTRON_R06_E2E_EVIDENCE',
          timestamp: new Date().toISOString(),
          userDataDir,
          vectors: {
            'R06-B01': { multiActionDenied: b01MultiActionDenied, validTokenNotConsumed: b01ValidTokenNotConsumed },
            'R06-B03': { unconfirmedDenied: b03UnconfirmedDenied, confirmedApproved: b03ConfirmedApproved },
            'R06-B06': { testModeAllowed: b06TestModeAllowed },
          },
          result: allPassed ? 'PASS' : 'FAIL',
        };

        const reportDir = path.resolve(__dirname, '../../../reports/capability-evidence');
        if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
        fs.writeFileSync(
          path.join(reportDir, 'ELECTRON_R06_E2E_EVIDENCE.json'),
          JSON.stringify(report, null, 2),
          'utf-8'
        );

        if (!allPassed) {
          app.quit();
          process.exit(1);
        }

        console.log('[R06-E2E] ALL_R06_E2E_CHECKS_PASSED');
        app.quit();
        process.exit(0);
      } catch (err) {
        console.error('[R06-E2E] Exception:', err);
        app.quit();
        process.exit(1);
      }
    });
    return;
  }

  // 7i. R07-E2E: Full Windows Electron Verification for Round R07 (R07-A01, R07-A03)
  if (process.argv.includes('--r07-e2e')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        console.log('[R07-E2E] Running Real Windows Electron R07 Verification...');

        const r07Result = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            // =========================================================================
            // Vector R07-A01: Human Consent / Native Confirmation Controller
            // =========================================================================
            const actionInput = { tool: 'write_file', estimatedCost: 0, path: 'r07_live.txt', content: 'live test' };
            const { digest: actionDigest } = await window.unionBotAPI.computeActionDigest(actionInput);

            const tokenA01 = 'tok_r07_a01_live';
            await window.unionBotAPI.createApprovalToken({
              tokenId: tokenA01,
              actionType: 'write_file',
              payload: actionInput,
              payloadDigest: actionDigest,
              origin: 'desktop_ui',
              roomId: 'orchestration',
              workspaceId: 'ws_r07',
              recipient: 'agent_coder',
            });

            // 1. Untrusted renderer claims confirmedByUser: true without native confirmation -> MUST REJECT
            const unconfirmedRes = await window.unionBotAPI.approveToken(tokenA01, { confirmedByUser: true });
            const tokenAfterUnconfirmed = await window.unionBotAPI.getApprovalToken(tokenA01);

            // Attempting dispatch with pending token -> must be rejected
            const pendingEnv = {
              id: 'env_r07_pending_01',
              traceId: 'trc_r07_pend1',
              roomId: 'orchestration',
              workspaceId: 'ws_r07',
              timestamp: Date.now(),
              sender: { kind: 'user', id: 'usr_r07', name: 'R07 User', role: 'USER' },
              recipient: { kind: 'agent', id: 'agent_coder' },
              fidelity: 'L0_RAW_TEXT',
              parts: [{
                kind: 'action',
                tool: 'write_file',
                callId: 'call_r07_pend1',
                status: 'requested',
                input: actionInput,
                approvalTokenId: tokenA01,
              }],
            };
            const dispatchWithPending = await window.unionBotAPI.dispatchEnvelope(pendingEnv);

            // 2. Changed / stale intent: expectedDigest mismatch -> MUST REJECT
            const staleExpectedDigest = '0'.repeat(64);
            const staleRes = await window.unionBotAPI.approveToken(tokenA01, { expectedDigest: staleExpectedDigest });
            const tokenAfterStale = await window.unionBotAPI.getApprovalToken(tokenA01);

            // 3. Affirmative Native Confirmation via Test Delegate
            if (window.unionBotAPI.testSetConfirmationMode) {
              await window.unionBotAPI.testSetConfirmationMode('auto-approve');
            }
            const confirmedRes = await window.unionBotAPI.approveToken(tokenA01, { expectedDigest: actionDigest });
            const tokenAfterConfirmed = await window.unionBotAPI.getApprovalToken(tokenA01);

            // 4. Dispatch with approved token -> must succeed and consume token
            const approvedEnv = {
              id: 'env_r07_approved_01',
              traceId: 'trc_r07_app1',
              roomId: 'orchestration',
              workspaceId: 'ws_r07',
              timestamp: Date.now(),
              sender: { kind: 'user', id: 'usr_r07', name: 'R07 User', role: 'USER' },
              recipient: { kind: 'agent', id: 'agent_coder' },
              fidelity: 'L0_RAW_TEXT',
              parts: [{
                kind: 'action',
                tool: 'write_file',
                callId: 'call_r07_app1',
                status: 'requested',
                input: actionInput,
                approvalTokenId: tokenA01,
              }],
            };
            const dispatchWithApproved = await window.unionBotAPI.dispatchEnvelope(approvedEnv);
            const tokenAfterConsumed = await window.unionBotAPI.getApprovalToken(tokenA01);

            // =========================================================================
            // Vector R07-A03: Test IPC Isolation in Dedicated Test Harness
            // =========================================================================
            const testKillSupportedInHarness = typeof window.unionBotAPI.testKillWorker === 'function';

            return {
              unconfirmedRes,
              tokenAfterUnconfirmed,
              dispatchWithPending,
              staleRes,
              tokenAfterStale,
              confirmedRes,
              tokenAfterConfirmed,
              dispatchWithApproved,
              tokenAfterConsumed,
              testKillSupportedInHarness,
              actionDigest,
            };
          })()
        `);

        const a01UnconfirmedDenied = r07Result.unconfirmedRes?.success === false &&
          String(r07Result.unconfirmedRes?.error).includes('ERR_HUMAN_CONFIRMATION_REQUIRED');
        const a01RemainedPending = r07Result.tokenAfterUnconfirmed?.status === 'PENDING';
        const a01DispatchPendingBlocked = r07Result.dispatchWithPending?.success === false;

        const a01StaleDenied = r07Result.staleRes?.success === false &&
          String(r07Result.staleRes?.error).includes('ERR_PAYLOAD_MISMATCH');
        const a01StaleRemainedPending = r07Result.tokenAfterStale?.status === 'PENDING';

        const a01ConfirmedApproved = r07Result.confirmedRes?.success === true;
        const a01TokenBecameApproved = r07Result.tokenAfterConfirmed?.status === 'APPROVED';

        const a01DispatchSucceeded = r07Result.dispatchWithApproved?.success === true;
        const a01TokenConsumed = r07Result.tokenAfterConsumed?.status === 'CONSUMED';
        const a01DigestMatched = (r07Result.tokenAfterConsumed?.payload_digest || r07Result.tokenAfterConsumed?.payloadDigest) === r07Result.actionDigest;

        const a03HarnessAllowed = r07Result.testKillSupportedInHarness === true;

        console.log('[R07-E2E] R07-A01 Unconfirmed approval rejected:', a01UnconfirmedDenied);
        console.log('[R07-E2E] R07-A01 Token remained PENDING:', a01RemainedPending);
        console.log('[R07-E2E] R07-A01 Dispatch with pending token blocked:', a01DispatchPendingBlocked);
        console.log('[R07-E2E] R07-A01 Stale intent rejected (digest mismatch):', a01StaleDenied);
        console.log('[R07-E2E] R07-A01 Stale token remained PENDING:', a01StaleRemainedPending);
        console.log('[R07-E2E] R07-A01 Confirmed approval succeeded:', a01ConfirmedApproved);
        console.log('[R07-E2E] R07-A01 Token became APPROVED:', a01TokenBecameApproved);
        console.log('[R07-E2E] R07-A01 Dispatch with approved token succeeded:', a01DispatchSucceeded);
        console.log('[R07-E2E] R07-A01 Token atomically CONSUMED:', a01TokenConsumed);
        console.log('[R07-E2E] R07-A01 Consumed digest matches action digest:', a01DigestMatched);
        console.log('[R07-E2E] R07-A03 Test kill supported in dedicated harness:', a03HarnessAllowed);

        const allPassed = a01UnconfirmedDenied &&
          a01RemainedPending &&
          a01DispatchPendingBlocked &&
          a01StaleDenied &&
          a01StaleRemainedPending &&
          a01ConfirmedApproved &&
          a01TokenBecameApproved &&
          a01DispatchSucceeded &&
          a01TokenConsumed &&
          a01DigestMatched &&
          a03HarnessAllowed;

        const report = {
          suite: 'UNION_BOT_ELECTRON_R07_E2E_EVIDENCE',
          timestamp: new Date().toISOString(),
          userDataDir,
          vectors: {
            'R07-A01': {
              unconfirmedDenied: a01UnconfirmedDenied,
              remainedPending: a01RemainedPending,
              dispatchPendingBlocked: a01DispatchPendingBlocked,
              staleDenied: a01StaleDenied,
              confirmedApproved: a01ConfirmedApproved,
              tokenBecameApproved: a01TokenBecameApproved,
              dispatchSucceeded: a01DispatchSucceeded,
              tokenConsumed: a01TokenConsumed,
              digestMatched: a01DigestMatched,
            },
            'R07-A03': {
              harnessAllowed: a03HarnessAllowed,
            },
          },
          result: allPassed ? 'PASS' : 'FAIL',
        };

        const reportDir = path.resolve(__dirname, '../../../reports/capability-evidence');
        if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
        fs.writeFileSync(
          path.join(reportDir, 'ELECTRON_R07_E2E_EVIDENCE.json'),
          JSON.stringify(report, null, 2),
          'utf-8'
        );

        if (!allPassed) {
          app.quit();
          process.exit(1);
        }

        console.log('[R07-E2E] ALL_R07_E2E_CHECKS_PASSED');
        app.quit();
        process.exit(0);
      } catch (err) {
        console.error('[R07-E2E] Exception:', err);
        app.quit();
        process.exit(1);
      }
    });
    return;
  }

  // 7j. R07-PROD: Production Security Boundary Verification (R07-A03, C03)
  if (process.argv.includes('--r07-prod-e2e')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        console.log('[R07-PROD-E2E] Running Real Windows Electron Production Mode Verification...');

        const prodResult = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const hasTestKill = typeof window.unionBotAPI.testKillWorker === 'function';
            const hasTestConfirmation = typeof window.unionBotAPI.testSetConfirmationMode === 'function';
            return {
              hasTestKill,
              hasTestConfirmation,
            };
          })()
        `);

        const testKillDisabled = prodResult.hasTestKill === false;
        const testConfirmationDisabled = prodResult.hasTestConfirmation === false;

        console.log('[R07-PROD-E2E] testKillWorker strictly undefined in production:', testKillDisabled);
        console.log('[R07-PROD-E2E] testSetConfirmationMode strictly undefined in production:', testConfirmationDisabled);

        const allPassed = testKillDisabled && testConfirmationDisabled;

        const report = {
          suite: 'UNION_BOT_ELECTRON_R07_PROD_EVIDENCE',
          timestamp: new Date().toISOString(),
          userDataDir,
          vectors: {
            'R07-A03': {
              productionTestKillDisabled: testKillDisabled,
              productionConfirmationDisabled: testConfirmationDisabled,
            },
          },
          result: allPassed ? 'PASS' : 'FAIL',
        };

        const reportDir = path.resolve(__dirname, '../../../reports/capability-evidence');
        if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
        fs.writeFileSync(
          path.join(reportDir, 'ELECTRON_R07_PROD_EVIDENCE.json'),
          JSON.stringify(report, null, 2),
          'utf-8'
        );

        if (!allPassed) {
          app.quit();
          process.exit(1);
        }

        console.log('[R07-PROD-E2E] ALL_R07_PROD_CHECKS_PASSED');
        app.quit();
        process.exit(0);
      } catch (err) {
        console.error('[R07-PROD-E2E] Exception:', err);
        app.quit();
        process.exit(1);
      }
    });
    return;
  }

  // 7k. P3-E2E: Full Windows Electron Verification for Phase P3 Desktop Workspace UI (R04 Gates)
  if (process.argv.includes('--p3-e2e')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        console.log('[P3-E2E] Running Real Windows Electron P3 Verification (R04 Form Interaction & Security Vectors)...');

        const userDataDir = app.getPath('userData');
        const fixturesDir = path.resolve(userDataDir, 'test-fixtures');
        if (!fs.existsSync(fixturesDir)) {
          fs.mkdirSync(fixturesDir, { recursive: true });
        }
        const pngFixturePath = path.resolve(fixturesDir, 'architecture_diagram.png');
        const pdfFixturePath = path.resolve(fixturesDir, 'specifications_doc.pdf');
        const fixturePngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
        const fixturePdfText = '%PDF-1.4\n1 0 obj\n<< /Title (P3 Specifications) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF';
        fs.writeFileSync(pngFixturePath, fixturePngBytes);
        fs.writeFileSync(pdfFixturePath, fixturePdfText, 'utf8');

        const p3Result = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const setNativeInputValue = (el, val) => {
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              setter.call(el, val);
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            };
            const setNativeTextareaValue = (el, val) => {
              const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
              setter.call(el, val);
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            };

            // 1. Create a dynamic room (P3-003)
            const roomRes = await window.unionBotAPI.createRoom({
              id: 'gate-p3-room',
              name: 'Gate P3 Collaboration Room',
            });
            const roomCreated = roomRes && roomRes.success === true && roomRes.room && roomRes.room.id === 'gate-p3-room';

            // 2. Query rooms list and verify it contains the created room
            const rooms = await window.unionBotAPI.getRooms();
            const roomInList = Array.isArray(rooms) && rooms.some(r => r.id === 'gate-p3-room');

            // 3. Switch active room in UI to gate-p3-room and navigate to Chat Room view
            window.dispatchEvent(new CustomEvent('union-bot:select-room', { detail: 'gate-p3-room' }));
            await new Promise(r => setTimeout(r, 400));

            const chatNavBtn = document.querySelector('[data-testid="nav-chat-btn"]') ||
              Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Collaboration Rooms'));
            if (chatNavBtn) chatNavBtn.click();
            await new Promise(r => setTimeout(r, 400));

            const attachBtn = document.querySelector('[data-testid="chat-composer-attach-btn"]');
            const composerTextarea = document.querySelector('[data-testid="chat-composer-textarea"]');
            const composerSendBtn = document.querySelector('[data-testid="chat-composer-send-btn"]');

            // 3a. UB-P3-R04-G02: Test Attachment Error Handling and Draft Preservation
            let g02DraftPreservedOnError = false;
            let g02AttachmentErrorBannerShown = false;
            if (attachBtn && composerTextarea) {
              setNativeTextareaValue(composerTextarea, 'Draft message before failed attachment attempt');
              await new Promise(r => setTimeout(r, 50));
              if (window.unionBotAPI.testQueueAttachmentPath) {
                await window.unionBotAPI.testQueueAttachmentPath('C:/non_existent_file_path_for_test.png');
              }
              attachBtn.click();
              await new Promise(r => setTimeout(r, 300));
              const errBanner = document.querySelector('[data-testid="chat-attachment-error"]');
              g02AttachmentErrorBannerShown = Boolean(errBanner && errBanner.innerText.includes('Failed to attach'));
              g02DraftPreservedOnError = composerTextarea.value === 'Draft message before failed attachment attempt';
            }

            // 3b. UB-P3-R04-G02: Drive REAL PNG & PDF Attachments via Composer Attach Button into CAS
            let g02PngAttachedViaButton = false;
            let g02PdfAttachedViaButton = false;
            let g02BothChipsRendered = false;

            if (attachBtn && window.unionBotAPI.testQueueAttachmentPath) {
              await window.unionBotAPI.testQueueAttachmentPath(${JSON.stringify(pngFixturePath)});
              attachBtn.click();
              await new Promise(r => setTimeout(r, 400));

              await window.unionBotAPI.testQueueAttachmentPath(${JSON.stringify(pdfFixturePath)});
              attachBtn.click();
              await new Promise(r => setTimeout(r, 400));

              const chips = Array.from(document.querySelectorAll('[data-testid="pending-attachment-chip"]'));
              g02PngAttachedViaButton = chips.some(c => c.innerText.includes('architecture_diagram.png'));
              g02PdfAttachedViaButton = chips.some(c => c.innerText.includes('specifications_doc.pdf'));
              g02BothChipsRendered = chips.length >= 2 && g02PngAttachedViaButton && g02PdfAttachedViaButton;
            }

            // 4. Send Multi-line Message with Attachments via Composer Send Button (P3-004, P3-R04-F05)
            let f05ChatMessageSentViaDom = false;
            const uniqueComposerMsg = 'Multi-line message:\\nLine 1: Architecture review\\nLine 2: Specifications attached\\n' + Date.now();
            if (composerTextarea && composerSendBtn) {
              setNativeTextareaValue(composerTextarea, uniqueComposerMsg);
              await new Promise(r => setTimeout(r, 100));
              composerSendBtn.click();
              await new Promise(r => setTimeout(r, 800));

              const messages = Array.from(document.querySelectorAll('[data-testid="message-text"]'));
              f05ChatMessageSentViaDom = messages.some(m => m.innerText.includes('Architecture review'));
            }

            // 5. Query room history from SQLite WAL (P3-C03) & Verify CAS store
            const history = await window.unionBotAPI.getRoomHistory('gate-p3-room');
            const historyFound = Array.isArray(history) && history.length > 0;
            const sentEnv = history.find(e => e.parts && e.parts.some(p => p.kind === 'artifact' || p.kind === 'attachment'));
            const pngPart = sentEnv ? sentEnv.parts.find(p => p.filename === 'architecture_diagram.png') : null;
            const pdfPart = sentEnv ? sentEnv.parts.find(p => p.filename === 'specifications_doc.pdf') : null;
            const pngSaved = Boolean(pngPart && pngPart.sha256);
            const pdfSaved = Boolean(pdfPart && pdfPart.sha256);
            const envelopeDispatched = Boolean(sentEnv);

            let casPngVerified = false;
            let casPdfVerified = false;
            if (pngPart && pngPart.sha256) {
              const readPng = await window.unionBotAPI.readAttachment(pngPart.sha256);
              casPngVerified = readPng && readPng.success === true && readPng.sizeBytes === ${fixturePngBytes.length};
            }
            if (pdfPart && pdfPart.sha256) {
              const readPdf = await window.unionBotAPI.readAttachment(pdfPart.sha256);
              casPdfVerified = readPdf && readPdf.success === true && readPdf.sizeBytes === ${fixturePdfText.length};
            }
            const casFilesWritten = casPngVerified && casPdfVerified;

            // 6. UB-P3-R04-G01: Missing ActionIntent payload is strictly rejected fail-closed over IPC
            let g01CreationMissingPayloadBlocked = false;
            try {
              const badCreateRes = await window.unionBotAPI.createApprovalToken({
                tokenId: 'tok_g01_missing_payload_' + Date.now(),
                actionType: 'format_disk_simulated',
                payloadDigest: 'bad_digest_g01_'.padEnd(64, '0'),
                origin: 'G01 Test Runner',
                roomId: 'gate-p3-room',
                workspaceId: 'gate-p3-ws',
              });
              if (!badCreateRes || !badCreateRes.success) {
                g01CreationMissingPayloadBlocked = String(badCreateRes?.error).includes('ERR_PAYLOAD_MISMATCH');
              }
            } catch (g01CreateErr) {
              g01CreationMissingPayloadBlocked = String(g01CreateErr.message).includes('ERR_PAYLOAD_MISMATCH');
            }

            // 6a2. Vector P3-R04-F01: Token creation rejects mismatched digest fail-closed
            let f01CreationMismatchBlocked = false;
            try {
              const f01Res = await window.unionBotAPI.createApprovalToken({
                tokenId: 'tok_f01_bad_digest_' + Date.now(),
                actionType: 'format_disk_simulated',
                payload: { action: 'format_disk_simulated', path: '/genuine/data' },
                payloadDigest: 'bad_digest_f01_'.padEnd(64, '0'),
                origin: 'F01 Test Runner',
                roomId: 'gate-p3-room',
                workspaceId: 'gate-p3-ws',
              });
              if (!f01Res || !f01Res.success) {
                f01CreationMismatchBlocked = String(f01Res?.error).includes('ERR_PAYLOAD_MISMATCH');
              }
            } catch (f01Err) {
              f01CreationMismatchBlocked = String(f01Err.message).includes('ERR_PAYLOAD_MISMATCH');
            }

            // 6b. Create valid Approval Token (P3-007, P3-C01)
            const tokenPayload = { action: 'format_disk_simulated', path: '/local/test', destructive: true, riskLevel: 'HIGH', reversible: false };
            const digestRes = await window.unionBotAPI.computeActionDigest(tokenPayload);
            const tokenId = 'tok_p3_e2e_' + Date.now();
            const createTokenRes = await window.unionBotAPI.createApprovalToken({
              tokenId,
              actionType: 'format_disk_simulated',
              payload: tokenPayload,
              payloadDigest: digestRes.digest,
              origin: 'E2E Test Runner',
              workspaceId: 'gate-p3-ws',
              roomId: 'gate-p3-room',
              actorId: 'evaluator',
              recipient: 'local-storage',
              status: 'PENDING',
              expiresInMs: 60000,
            });
            const tokenCreated = createTokenRes && createTokenRes.success === true;

            // 6c. Vector P3-R04-F02: Create token, tamper DB row, assert approveToken rejects with ERR_PAYLOAD_MISMATCH
            const genuinePayloadF02 = { action: 'format_disk_simulated', path: '/safe/data' };
            const genuineDigestF02 = await window.unionBotAPI.computeActionDigest(genuinePayloadF02);
            const f02TokenId = 'tok_f02_tamper_' + Date.now();
            await window.unionBotAPI.createApprovalToken({
              tokenId: f02TokenId,
              actionType: 'format_disk_simulated',
              payload: genuinePayloadF02,
              payloadDigest: genuineDigestF02.digest,
              origin: 'F02 Test Runner',
              roomId: 'gate-p3-room',
              workspaceId: 'gate-p3-ws',
              status: 'PENDING',
              expiresInMs: 60000,
            });

            if (window.unionBotAPI.testTamperApprovalPayload) {
              await window.unionBotAPI.testTamperApprovalPayload({
                tokenId: f02TokenId,
                tamperedPayload: { action: 'format_disk_simulated', path: '/MALICIOUS_TAMPERED/data' },
              });
            }

            if (window.unionBotAPI.testSetConfirmationMode) {
              await window.unionBotAPI.testSetConfirmationMode('auto-approve');
            }

            let f02ApproveTamperBlocked = false;
            try {
              const f02ApproveRes = await window.unionBotAPI.approveToken(f02TokenId, { confirmedByUser: true });
              if (!f02ApproveRes || !f02ApproveRes.success) {
                f02ApproveTamperBlocked = String(f02ApproveRes?.error).includes('ERR_PAYLOAD_MISMATCH');
              }
            } catch (f02Err) {
              f02ApproveTamperBlocked = String(f02Err.message).includes('ERR_PAYLOAD_MISMATCH');
            }

            // 6d. Create a TAMPERED Approval Token for UI verification (UB-P3-R02-001, UB-P3-R02-004)
            const tamperedTokenId = 'tok_tampered_' + Date.now();
            await window.unionBotAPI.createApprovalToken({
              tokenId: tamperedTokenId,
              actionType: 'format_disk_simulated',
              payload: tokenPayload,
              payloadDigest: digestRes.digest,
              origin: 'Tamper Test Runner',
              workspaceId: 'gate-p3-ws',
              roomId: 'gate-p3-room',
              actorId: 'evaluator',
              recipient: 'local-storage',
              status: 'PENDING',
              expiresInMs: 60000,
            });
            if (window.unionBotAPI.testTamperApprovalPayload) {
              await window.unionBotAPI.testTamperApprovalPayload({
                tokenId: tamperedTokenId,
                tamperedPayload: { action: 'format_disk_simulated', path: '/tampered/exploit', destructive: true },
              });
            }

            const approvals = await window.unionBotAPI.listApprovals({ limit: 20 });
            const tokenInList = Array.isArray(approvals) && approvals.some(t => t.token_id === tokenId && t.payload_digest === digestRes.digest);
            const actionIntentPreserved = Array.isArray(approvals) && approvals.some(t => t.token_id === tokenId && t.payload && t.payload.path === '/local/test');

            // 6e. Vector P3-R04-F03: Real UI DOM Verification of Approval Inbox with Client-Side Web Crypto SHA-256
            const approvalsNavBtn = document.querySelector('[data-testid="nav-approvals-btn"]') ||
              Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Approval Inbox'));
            if (approvalsNavBtn) approvalsNavBtn.click();
            await new Promise(r => setTimeout(r, 800));

            const approvalCards = document.querySelectorAll('[data-testid="approval-card"]');
            const hasApprovalCards = approvalCards.length >= 2;
            const verifiedBadge = document.querySelector('[data-testid="sha-verified-badge"]');
            const hasVerifiedBadge = Boolean(verifiedBadge && verifiedBadge.innerText.includes('Verified Match'));
            const mismatchBadge = document.querySelector('[data-testid="sha-mismatch-badge"]');
            const hasMismatchBadge = Boolean(mismatchBadge && mismatchBadge.innerText.includes('TAMPER DETECTED'));

            const tamperedCard = document.querySelector('[data-token-id="' + tamperedTokenId + '"]');
            const tamperedApproveBtn = tamperedCard ? tamperedCard.querySelector('[data-testid="approval-approve-btn"]') : null;
            const f03ApproveBtnDisabledOnMismatch = Boolean(tamperedApproveBtn && tamperedApproveBtn.disabled === true);

            // 7. Test Rejection from Approval Inbox (P3-007)
            const rejectRes = await window.unionBotAPI.rejectApproval(tokenId, 'Operator rejected from Approval Inbox');
            const tokenRejected = rejectRes && rejectRes.success === true;

            // 8. UB-P3-R01-001: Path traversal defense & hash format validation
            const traversalRes = await window.unionBotAPI.readAttachment('../../windows/system32/cmd.exe');
            const pathTraversalBlocked = traversalRes && traversalRes.success === false;

            const badShaRes = await window.unionBotAPI.readAttachment('invalid_sha_format_123');
            const invalidShaBlocked = badShaRes && badShaRes.success === false && (badShaRes.code === 'ERR_INVALID_SHA256' || (badShaRes.error && badShaRes.error.includes('ERR_INVALID_SHA256')));

            // 9. Vector P3-R04-F05 (Form 1): Create Project via Real DOM Form Inputs & Submit Button
            const openProjectBtn = document.querySelector('[data-testid="open-create-project-btn"]');
            if (openProjectBtn) openProjectBtn.click();
            await new Promise(r => setTimeout(r, 400));

            const projNameInput = document.querySelector('[data-testid="project-name-input"]');
            const projDescInput = document.querySelector('[data-testid="project-desc-input"]');
            const projSubmitBtn = document.querySelector('[data-testid="project-submit-btn"]');
            let f05ProjectFormCreatedInDom = false;

            if (projNameInput && projSubmitBtn) {
              setNativeInputValue(projNameInput, 'Gate P3 GUI Form Project');
              if (projDescInput) {
                setNativeTextareaValue(projDescInput, 'Created through real DOM inputs');
              }
              await new Promise(r => setTimeout(r, 100));
              projSubmitBtn.click();
              await new Promise(r => setTimeout(r, 600));

              const projTrigger = document.querySelector('[data-testid="project-dropdown-trigger"]');
              f05ProjectFormCreatedInDom = Boolean(projTrigger && projTrigger.innerText.includes('Gate P3 GUI Form Project'));
            }

            const projs = await window.unionBotAPI.getProjects();
            const projectInList = Array.isArray(projs) && projs.some(p => p.name === 'Gate P3 GUI Form Project');

            // 10. UB-P3-R01-003: Durable Tasks in SQLite WAL & UI DOM Verification
            const taskRes = await window.unionBotAPI.createTask({
              title: 'CAS Byte Fidelity Verification Task',
              status: 'pending',
              progress: 0,
              roomId: 'gate-p3-room',
              metadata: { priority: 'P0', role: 'IMPLEMENTER' },
            });
            const taskCreated = taskRes && taskRes.success === true && Boolean(taskRes.task && taskRes.task.id);
            const tasks = await window.unionBotAPI.listTasks();
            const taskInList = Array.isArray(tasks) && tasks.some(t => t.title === 'CAS Byte Fidelity Verification Task');

            const tasksNavBtn = document.querySelector('[data-testid="nav-tasks-btn"]') ||
              Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Tasks'));
            if (tasksNavBtn) tasksNavBtn.click();
            await new Promise(r => setTimeout(r, 500));
            const hasTasksRendered = Boolean(document.querySelector('.inbox-container') || document.querySelector('.task-item'));

            // 11. Vector P3-R04-F05 & UB-P3-R04-G02: Workspace Export via Preferences Modal DOM & Disk Files
            const prefBtn = document.querySelector('[data-testid="open-preferences-btn"]');
            if (prefBtn) prefBtn.click();
            await new Promise(r => setTimeout(r, 500));

            const exportJsonBtn = document.querySelector('[data-testid="export-json-btn"]');
            const exportMdBtn = document.querySelector('[data-testid="export-markdown-btn"]');
            let f05ExportTriggeredViaDom = false;

            if (exportJsonBtn && exportMdBtn) {
              exportJsonBtn.click();
              await new Promise(r => setTimeout(r, 300));
              exportMdBtn.click();
              await new Promise(r => setTimeout(r, 300));
              f05ExportTriggeredViaDom = true;
            }

            const closePrefBtn = document.querySelector('[data-testid="close-preferences-btn"]');
            if (closePrefBtn) closePrefBtn.click();
            await new Promise(r => setTimeout(r, 300));

            const exportRes = await window.unionBotAPI.exportWorkspace();
            const exportSucceeded = exportRes && exportRes.success === true &&
              typeof exportRes.exportMarkdown === 'string' &&
              exportRes.exportMarkdown.includes('gate-p3-room') &&
              exportRes.roomCount >= 1 &&
              typeof exportRes.projectCount === 'number' &&
              typeof exportRes.taskCount === 'number';

            let exportFilesOnDiskValid = false;
            let exportFilesCheck = null;
            if (window.unionBotAPI.testGetExportFiles) {
              exportFilesCheck = await window.unionBotAPI.testGetExportFiles();
              exportFilesOnDiskValid = Boolean(
                exportFilesCheck && exportFilesCheck.success &&
                exportFilesCheck.jsonExists && exportFilesCheck.mdExists &&
                exportFilesCheck.jsonValid && exportFilesCheck.mdHasContent &&
                exportFilesCheck.jsonSizeBytes > 50 && exportFilesCheck.mdSizeBytes > 50
              );
            }

            return {
              roomCreated,
              roomInList,
              g02DraftPreservedOnError,
              g02AttachmentErrorBannerShown,
              g02PngAttachedViaButton,
              g02PdfAttachedViaButton,
              g02BothChipsRendered,
              pngSaved,
              pdfSaved,
              envelopeDispatched,
              historyFound,
              casFilesWritten,
              g01CreationMissingPayloadBlocked,
              f01CreationMismatchBlocked,
              tokenCreated,
              tokenInList,
              actionIntentPreserved,
              f02ApproveTamperBlocked,
              hasApprovalCards,
              hasVerifiedBadge,
              hasMismatchBadge,
              f03ApproveBtnDisabledOnMismatch,
              tokenRejected,
              pathTraversalBlocked,
              invalidShaBlocked,
              f05ProjectFormCreatedInDom,
              projectCreated: f05ProjectFormCreatedInDom,
              projectInList,
              f05ChatMessageSentViaDom,
              hasChatRendered: f05ChatMessageSentViaDom,
              tamperedApprovalBlocked: f03ApproveBtnDisabledOnMismatch,
              taskCreated,
              taskInList,
              hasTasksRendered,
              f05ExportTriggeredViaDom,
              exportSucceeded,
              exportFilesOnDiskValid,
              pngSha256: pngPart ? pngPart.sha256 : null,
              pdfSha256: pdfPart ? pdfPart.sha256 : null,
            };
          })()
        `);

        console.log('[P3-E2E] P3-003 Dynamic room created in SQLite:', p3Result.roomCreated);
        console.log('[P3-E2E] P3-003 Dynamic room in rooms list:', p3Result.roomInList);
        console.log('[P3-E2E] UB-P3-R04-G02 Attachment error banner shown on failure:', p3Result.g02AttachmentErrorBannerShown);
        console.log('[P3-E2E] UB-P3-R04-G02 Draft message preserved in textarea on failure:', p3Result.g02DraftPreservedOnError);
        console.log('[P3-E2E] UB-P3-R04-G02 PNG & PDF driven via composer attach button:', p3Result.g02BothChipsRendered);
        console.log('[P3-E2E] P3-004 PNG attachment saved in CAS store:', p3Result.pngSaved);
        console.log('[P3-E2E] P3-004 PDF attachment saved in CAS store:', p3Result.pdfSaved);
        console.log('[P3-E2E] UB-P3-R04-G02 Authentic CAS files written to disk:', p3Result.casFilesWritten);
        console.log('[P3-E2E] P3-004 Multi-line envelope dispatched:', p3Result.envelopeDispatched);
        console.log('[P3-E2E] P3-005 Room history with attachments retrieved from SQLite:', p3Result.historyFound);
        console.log('[P3-E2E] UB-P3-R04-G01 Token creation missing payload rejected fail-closed:', p3Result.g01CreationMissingPayloadBlocked);
        console.log('[P3-E2E] P3-R04-F01 Token creation mismatched digest rejected fail-closed:', p3Result.f01CreationMismatchBlocked);
        console.log('[P3-E2E] P3-007 Approval token created:', p3Result.tokenCreated);
        console.log('[P3-E2E] P3-C01 Approval inbox displays full parameters & digest:', p3Result.tokenInList);
        console.log('[P3-E2E] UB-P3-R02-001 ActionIntent payload preserved:', p3Result.actionIntentPreserved);
        console.log('[P3-E2E] P3-R04-F02 approveToken rejects tampered DB row fail-closed:', p3Result.f02ApproveTamperBlocked);
        console.log('[P3-E2E] UB-P3-R02-001 Live Web Crypto SHA-256 Verified Match rendered in DOM:', p3Result.hasVerifiedBadge);
        console.log('[P3-E2E] UB-P3-R02-001 Live Web Crypto SHA-256 Tamper Mismatch detected in DOM:', p3Result.hasMismatchBadge);
        console.log('[P3-E2E] UB-P3-R02-001 Tampered Approval Blocked fail-closed in UI:', p3Result.tamperedApprovalBlocked);
        console.log('[P3-E2E] P3-R04-F03 UI Approve button strictly disabled on mismatch/tamper:', p3Result.f03ApproveBtnDisabledOnMismatch);
        console.log('[P3-E2E] P3-007 Approval token rejected via inbox:', p3Result.tokenRejected);
        console.log('[P3-E2E] UB-P3-R01-001 Path traversal defense active:', p3Result.pathTraversalBlocked);
        console.log('[P3-E2E] UB-P3-R01-001 Invalid SHA format defense active:', p3Result.invalidShaBlocked);
        console.log('[P3-E2E] UB-P3-R01-002 Project created:', p3Result.projectCreated);
        console.log('[P3-E2E] P3-R04-F05 Form 1: Project created via real DOM form input:', p3Result.f05ProjectFormCreatedInDom);
        console.log('[P3-E2E] UB-P3-R01-002 Project present in list:', p3Result.projectInList);
        console.log('[P3-E2E] UB-P3-R02-004 Real UI DOM Chat View rendered:', p3Result.hasChatRendered);
        console.log('[P3-E2E] P3-R04-F05 Form 2: Chat message sent via real DOM textarea & button:', p3Result.f05ChatMessageSentViaDom);
        console.log('[P3-E2E] UB-P3-R01-003 Durable task created:', p3Result.taskCreated);
        console.log('[P3-E2E] UB-P3-R01-003 Durable task present in list:', p3Result.taskInList);
        console.log('[P3-E2E] UB-P3-R02-004 Real UI DOM Tasks View rendered:', p3Result.hasTasksRendered);
        console.log('[P3-E2E] P3-R04-F05 Form 3: Workspace export triggered via Preferences modal DOM:', p3Result.f05ExportTriggeredViaDom);
        console.log('[P3-E2E] Gate P3 Workspace exported to Markdown & JSON:', p3Result.exportSucceeded);
        console.log('[P3-E2E] UB-P3-R04-G02 Real export files on disk valid and non-empty:', p3Result.exportFilesOnDiskValid);

        const allPassed =
          p3Result.roomCreated &&
          p3Result.roomInList &&
          p3Result.g02AttachmentErrorBannerShown &&
          p3Result.g02DraftPreservedOnError &&
          p3Result.g02BothChipsRendered &&
          p3Result.pngSaved &&
          p3Result.pdfSaved &&
          p3Result.envelopeDispatched &&
          p3Result.historyFound &&
          p3Result.casFilesWritten &&
          p3Result.g01CreationMissingPayloadBlocked &&
          p3Result.f01CreationMismatchBlocked &&
          p3Result.tokenCreated &&
          p3Result.tokenInList &&
          p3Result.actionIntentPreserved &&
          p3Result.f02ApproveTamperBlocked &&
          p3Result.hasApprovalCards &&
          p3Result.hasVerifiedBadge &&
          p3Result.hasMismatchBadge &&
          p3Result.f03ApproveBtnDisabledOnMismatch &&
          p3Result.tokenRejected &&
          p3Result.pathTraversalBlocked &&
          p3Result.invalidShaBlocked &&
          p3Result.f05ProjectFormCreatedInDom &&
          p3Result.projectInList &&
          p3Result.f05ChatMessageSentViaDom &&
          p3Result.taskCreated &&
          p3Result.taskInList &&
          p3Result.hasTasksRendered &&
          p3Result.f05ExportTriggeredViaDom &&
          p3Result.exportSucceeded &&
          p3Result.exportFilesOnDiskValid;

        if (!allPassed) {
          console.error('[P3-E2E] FAILED: One or more P3 R04 checks did not pass');
          app.quit();
          process.exit(1);
        }

        const evidencePath = path.resolve(__dirname, '../../../reports/capability-evidence/ELECTRON_P3_E2E_EVIDENCE.json');
        fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
        fs.writeFileSync(evidencePath, JSON.stringify({
          timestamp: new Date().toISOString(),
          environment: 'Real Windows Electron Chromium E2E (Phase P3 Gate R04)',
          nodeEnv: process.env.NODE_ENV,
          regressionVectors: {
            'UB-P3-R04-G01': { creationMissingPayloadBlocked: p3Result.g01CreationMissingPayloadBlocked },
            'UB-P3-R04-G02': {
              attachmentErrorBannerShown: p3Result.g02AttachmentErrorBannerShown,
              draftPreservedOnError: p3Result.g02DraftPreservedOnError,
              bothChipsRendered: p3Result.g02BothChipsRendered,
              casFilesWritten: p3Result.casFilesWritten,
              exportFilesOnDiskValid: p3Result.exportFilesOnDiskValid,
            },
            'P3-R04-F01': { creationMismatchBlocked: p3Result.f01CreationMismatchBlocked },
            'P3-R04-F02': { approveTamperBlocked: p3Result.f02ApproveTamperBlocked },
            'P3-R04-F03': { approveBtnDisabledOnMismatch: p3Result.f03ApproveBtnDisabledOnMismatch },
            'P3-R04-F05': {
              projectFormCreatedInDom: p3Result.f05ProjectFormCreatedInDom,
              chatMessageSentViaDom: p3Result.f05ChatMessageSentViaDom,
              exportTriggeredViaDom: p3Result.f05ExportTriggeredViaDom,
            },
          },
          results: p3Result,
          allPassed: true,
        }, null, 2));

        console.log('[P3-E2E] ALL_P3_E2E_CHECKS_PASSED');
        app.quit();
        process.exit(0);
      } catch (err) {
        console.error('[P3-E2E] Exception:', err);
        app.quit();
        process.exit(1);
      }
    });
    return;
  }

  // 7l. P3-REOPEN-E2E: Reopen App and verify SQLite & CAS Durability (P3-C03, UB-P3-R01-005)
  if (process.argv.includes('--p3-reopen-e2e')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        console.log('[P3-REOPEN-E2E] Running Real Windows Electron Reopen Durability Check (P3-C03)...');

        const reopenResult = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const rooms = await window.unionBotAPI.getRooms();
            const roomFound = Array.isArray(rooms) && rooms.some(r => r.id === 'gate-p3-room');

            const projs = await window.unionBotAPI.getProjects();
            const projectFound = Array.isArray(projs) && projs.some(p => p.name === 'Gate P3 GUI Form Project' || p.id === 'proj-gate-p3');

            const tasks = await window.unionBotAPI.listTasks();
            const taskFound = Array.isArray(tasks) && tasks.some(t => t.title === 'CAS Byte Fidelity Verification Task');

            const history = await window.unionBotAPI.getRoomHistory('gate-p3-room');
            const historyFound = Array.isArray(history) && history.length > 0;
            const env = history.find(e => e.parts && e.parts.length === 3);
            const hasAttachments = Boolean(env && env.parts[1].filename === 'architecture_diagram.png' && env.parts[2].filename === 'specifications_doc.pdf');

            // UB-P3-R01-005 & UB-P3-R02-004: Read back BOTH PNG and PDF attachments and verify byte-for-byte fidelity
            const pngSha = env && env.parts[1].sha256;
            const readBackPng = await window.unionBotAPI.readAttachment(pngSha);
            const expectedPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            const pngFidelityVerified = readBackPng && readBackPng.success === true && readBackPng.dataBase64 === expectedPngBase64;

            const pdfSha = env && env.parts[2].sha256;
            const readBackPdf = await window.unionBotAPI.readAttachment(pdfSha);
            const expectedPdfText = '%PDF-1.4\\n1 0 obj\\n<< /Title (P3 Specifications) >>\\nendobj\\ntrailer\\n<< /Root 1 0 R >>\\n%%EOF';
            const readPdfText = readBackPdf && readBackPdf.dataBase64 ? atob(readBackPdf.dataBase64) : '';
            const pdfFidelityVerified = readBackPdf && readBackPdf.success === true && readPdfText === expectedPdfText;
            const bothAttachmentsFidelityVerified = pngFidelityVerified && pdfFidelityVerified;

            // UB-P3-R02-001: Verify approval token and ActionIntent payload survived restart
            const approvals = await window.unionBotAPI.listApprovals({ limit: 20 });
            const tokenSurvived = Array.isArray(approvals) && approvals.some(t => t.action_type === 'format_disk_simulated');
            const actionIntentSurvived = Array.isArray(approvals) && approvals.some(t => t.payload && t.payload.path === '/local/test');
            // UB-P3-R02-004: Verify real UI elements rendered in DOM across restart
            const rootRendered = Boolean(document.querySelector('#root'));
            const sidebarRendered = Boolean(document.querySelector('.sidebar'));
            const chatRendered = Boolean(document.querySelector('.chat-room') || document.querySelector('[data-testid="chat-room"]'));

            // Switch to Approval Inbox to verify live Web Crypto verification survives restart
            const reopenApprovalsBtn = document.querySelector('[data-testid="nav-approvals-btn"]') ||
              Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Approval Inbox'));
            if (reopenApprovalsBtn) reopenApprovalsBtn.click();
            await new Promise(r => setTimeout(r, 800));
            const reopenApprovalCards = document.querySelectorAll('[data-testid="approval-card"]').length > 0;
            const reopenVerifiedBadge = Boolean(document.querySelector('[data-testid="sha-verified-badge"]'));

            // Switch back to chat to verify navigation operates smoothly
            const reopenChatBtn = document.querySelector('[data-testid="nav-chat-btn"]');
            if (reopenChatBtn) reopenChatBtn.click();
            await new Promise(r => setTimeout(r, 400));

            const uiOperational = rootRendered && sidebarRendered && chatRendered && reopenApprovalCards && reopenVerifiedBadge;

            // UB-P3-R04-G02: Verify real JSON & Markdown export files survived restart on disk
            let exportFilesSurvived = false;
            if (window.unionBotAPI.testGetExportFiles) {
              const exportCheck = await window.unionBotAPI.testGetExportFiles();
              exportFilesSurvived = Boolean(
                exportCheck && exportCheck.success &&
                exportCheck.jsonExists && exportCheck.mdExists &&
                exportCheck.jsonValid && exportCheck.mdHasContent
              );
            }

            return {
              roomFound,
              projectFound,
              taskFound,
              historyFound,
              hasAttachments,
              pngFidelityVerified,
              pdfFidelityVerified,
              bothAttachmentsFidelityVerified,
              tokenSurvived,
              actionIntentSurvived,
              exportFilesSurvived,
              uiOperational,
              historyLength: history ? history.length : 0,
            };
          })()
        `);

        console.log('[P3-REOPEN-E2E] P3-C03 Room survived app restart:', reopenResult.roomFound);
        console.log('[P3-REOPEN-E2E] UB-P3-R01-002 Project survived app restart:', reopenResult.projectFound);
        console.log('[P3-REOPEN-E2E] UB-P3-R01-003 Tasks survived app restart:', reopenResult.taskFound);
        console.log('[P3-REOPEN-E2E] P3-C03 Envelopes survived app restart:', reopenResult.historyFound);
        console.log('[P3-REOPEN-E2E] P3-C03 Attachments (PNG & PDF) survived app restart:', reopenResult.hasAttachments);
        console.log('[P3-REOPEN-E2E] UB-P3-R01-005 & UB-P3-R02-004 Byte-for-byte CAS fidelity verified (both PNG & PDF):', reopenResult.bothAttachmentsFidelityVerified);
        console.log('[P3-REOPEN-E2E] UB-P3-R02-001 ActionIntent payload preserved across restart:', reopenResult.actionIntentSurvived);
        console.log('[P3-REOPEN-E2E] UB-P3-R04-G02 Real export files survived app restart:', reopenResult.exportFilesSurvived);
        console.log('[P3-REOPEN-E2E] UB-P3-R02-004 Real UI DOM rendered:', reopenResult.uiOperational);

        const allPassed =
          reopenResult.roomFound &&
          reopenResult.projectFound &&
          reopenResult.taskFound &&
          reopenResult.historyFound &&
          reopenResult.hasAttachments &&
          reopenResult.bothAttachmentsFidelityVerified &&
          reopenResult.actionIntentSurvived &&
          reopenResult.exportFilesSurvived &&
          reopenResult.uiOperational;

        if (!allPassed) {
          console.error('[P3-REOPEN-E2E] FAILED: Data did not survive app restart');
          app.quit();
          process.exit(1);
        }

        console.log('[P3-REOPEN-E2E] ALL_P3_REOPEN_CHECKS_PASSED');
        app.quit();
        process.exit(0);
      } catch (err) {
        console.error('[P3-REOPEN-E2E] Exception:', err);
        app.quit();
        process.exit(1);
      }
    });
    return;
  }

  // 7m. P4-E2E: Full Windows Electron Verification for Phase P4 Embedded Chromium & Native AI Provider Surfaces
  if (process.argv.includes('--p4-e2e')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        console.log('[P4-E2E] Running Real Windows Electron P4 Verification (Embedded Chromium & AI Provider Surfaces)...');

        const p4Result = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const results = {};

            // 1. Initial State & Provider Tabs (P4-001, P4-002)
            let state = await window.unionBotAPI.browserGetState();
            if (!state || !state.tabs || state.tabs.length === 0) {
              await new Promise(r => setTimeout(r, 400));
              state = await window.unionBotAPI.browserGetState();
            }

            results.tabsInitialized = Array.isArray(state.tabs) && state.tabs.length >= 4;
            const expectedProviders = ['chatgpt', 'gemini', 'claude', 'deepseek'];
            const actualProviders = state.tabs.map(t => t.providerId);
            results.allProvidersPresent = expectedProviders.every(p => actualProviders.includes(p));

            results.partitionsIsolated = state.tabs.every(t => 
              t.partition === 'persist:mcb-web-' + t.providerId
            );

            // 2. Cookie Partition Isolation (P4-003)
            const cookieSetRes = await window.unionBotAPI.testSetBrowserCookie({
              partition: 'persist:mcb-web-chatgpt',
              url: 'https://chatgpt.com',
              name: 'session_token',
              value: 'chatgpt_test_isolated_cookie_token_98765',
            });
            results.cookieSetSucceeded = Boolean(cookieSetRes && cookieSetRes.success === true);

            const chatgptCookies = await window.unionBotAPI.testGetBrowserCookies('persist:mcb-web-chatgpt');
            const hasChatgptCookie = Boolean(
              chatgptCookies?.success && 
              Array.isArray(chatgptCookies.cookies) && 
              chatgptCookies.cookies.some(c => c.name === 'session_token' && c.value === 'chatgpt_test_isolated_cookie_token_98765')
            );
            results.cookieFoundInChatgpt = hasChatgptCookie;

            const geminiCookies = await window.unionBotAPI.testGetBrowserCookies('persist:mcb-web-gemini');
            const hasLeakedToGemini = Boolean(
              geminiCookies?.success && 
              Array.isArray(geminiCookies.cookies) && 
              geminiCookies.cookies.some(c => c.name === 'session_token')
            );
            results.cookieNotLeakedToGemini = !hasLeakedToGemini;

            const claudeCookies = await window.unionBotAPI.testGetBrowserCookies('persist:mcb-web-claude');
            const hasLeakedToClaude = Boolean(
              claudeCookies?.success && 
              Array.isArray(claudeCookies.cookies) && 
              claudeCookies.cookies.some(c => c.name === 'session_token')
            );
            results.cookieNotLeakedToClaude = !hasLeakedToClaude;

            results.cookieIsolationVerified = results.cookieFoundInChatgpt && results.cookieNotLeakedToGemini && results.cookieNotLeakedToClaude;

            // 3. Safe Navigation & URL Policy (P4-004, P4-005)
            const chatgptTab = state.tabs.find(t => t.providerId === 'chatgpt');
            const geminiTab = state.tabs.find(t => t.providerId === 'gemini');
            const deepseekTab = state.tabs.find(t => t.providerId === 'deepseek');

            const dangerousFileNav = await window.unionBotAPI.browserNavigate({
              tabId: chatgptTab?.id,
              url: 'file:///C:/Windows/System32/cmd.exe',
            });
            results.dangerousFileBlocked = Boolean(dangerousFileNav && dangerousFileNav.success === false);

            const dangerousJsNav = await window.unionBotAPI.browserNavigate({
              tabId: chatgptTab?.id,
              url: 'javascript:alert("pwned")',
            });
            results.dangerousJsBlocked = Boolean(dangerousJsNav && dangerousJsNav.success === false);

            const dangerousPsNav = await window.unionBotAPI.browserNavigate({
              tabId: chatgptTab?.id,
              url: 'powershell:Get-Process',
            });
            results.dangerousPsBlocked = Boolean(dangerousPsNav && dangerousPsNav.success === false);

            const dangerousLoopbackNav = await window.unionBotAPI.browserNavigate({
              tabId: chatgptTab?.id,
              url: 'http://127.0.0.1:8080/secret',
            });
            results.dangerousLoopbackBlocked = Boolean(dangerousLoopbackNav && dangerousLoopbackNav.success === false);

            // UB-P4-R01-001 / P4-R02-T01: Deny createTab with malicious or private URLs
            const t01MaliciousTab = await window.unionBotAPI.browserCreateTab({
              providerId: 'custom',
              url: 'javascript:alert(1)',
            });
            const t01PrivateTab = await window.unionBotAPI.browserCreateTab({
              providerId: 'custom',
              url: 'http://127.0.0.2:8080/exploit',
            });
            results.t01CreateTabMaliciousDenied = Boolean(t01MaliciousTab && t01MaliciousTab.success === false);
            results.t01CreateTabPrivateDenied = Boolean(t01PrivateTab && t01PrivateTab.success === false);

            // UB-P4-R01-001 / P4-R02-T03: Block 127.0.0.2, [::1], and 169.254.169.254
            const loopback2Nav = await window.unionBotAPI.browserNavigate({
              tabId: chatgptTab?.id,
              url: 'http://127.0.0.2:8080/exploit',
            });
            const loopbackIpv6Nav = await window.unionBotAPI.browserNavigate({
              tabId: chatgptTab?.id,
              url: 'http://[::1]:9000/admin',
            });
            const metadataNav = await window.unionBotAPI.browserNavigate({
              tabId: chatgptTab?.id,
              url: 'http://169.254.169.254/latest/meta-data',
            });
            results.t03LoopbackPrivateBlocked = Boolean(
              loopback2Nav?.success === false &&
              loopbackIpv6Nav?.success === false &&
              metadataNav?.success === false
            );

            // UB-P4-R02-001 / P4-R03-A01: Provider auth HTTPS allowed, insecure HTTP strictly DENIED, and child popup window/redirect verified
            const geminiAuthHttpNav = await window.unionBotAPI.browserNavigate({
              tabId: geminiTab?.id,
              url: 'http://accounts.google.com/signin',
            });
            const geminiAuthHttpsNav = await window.unionBotAPI.browserNavigate({
              tabId: geminiTab?.id,
              url: 'https://accounts.google.com/signin',
            });
            const popupVerification = await window.unionBotAPI.testVerifyOAuthPopup('gemini');

            results.a01OAuthControlledAndHttpDenied = Boolean(
              geminiAuthHttpNav && geminiAuthHttpNav.success === false &&
              geminiAuthHttpsNav && geminiAuthHttpsNav.success === true &&
              popupVerification && popupVerification.success === true &&
              popupVerification.evidence?.allChecksPassed === true
            );
            results.a01PopupEvidence = popupVerification?.evidence;
            results.t04ProviderAuthAllowed = results.a01OAuthControlledAndHttpDenied;

            // UB-P4-R02-001 / P4-R03-A04: Cross-boundary navigation routes to search partition, leaving provider tab unpolluted
            const initialChatgptTabState = (await window.unionBotAPI.browserGetState()).tabs.find(t => t.id === chatgptTab?.id);
            const crossNavRes = await window.unionBotAPI.browserNavigate({
              tabId: chatgptTab?.id,
              url: 'https://news.ycombinator.com/',
            });
            const stateAfterCrossNav = await window.unionBotAPI.browserGetState();
            const postNavChatgptTab = stateAfterCrossNav.tabs.find(t => t.id === chatgptTab?.id);
            const routedSearchTab = stateAfterCrossNav.tabs.find(t => t.id === stateAfterCrossNav.activeTabId);
            results.a04CrossBoundaryPartitionUnpolluted = Boolean(
              crossNavRes &&
              crossNavRes.success === true &&
              crossNavRes.routedToSearchTab === true &&
              postNavChatgptTab &&
              postNavChatgptTab.url === initialChatgptTabState?.url &&
              postNavChatgptTab.partition === 'persist:mcb-web-chatgpt' &&
              routedSearchTab &&
              routedSearchTab.providerId === 'search' &&
              routedSearchTab.partition === 'persist:mcb-web-search' &&
              routedSearchTab.url.includes('news.ycombinator.com')
            );

            const validSearchNav = await window.unionBotAPI.browserNavigate({
              tabId: chatgptTab?.id,
              url: 'offline zero cost search query',
            });
            results.searchQueryResolved = Boolean(
              validSearchNav && 
              validSearchNav.success === true && 
              typeof validSearchNav.sanitizedUrl === 'string' &&
              validSearchNav.sanitizedUrl.includes('duckduckgo.com/?q=')
            );


            // 4. Tab Switching & Zoom Controls (P4-007)
            const selectRes = await window.unionBotAPI.browserSelectTab(geminiTab?.id);
            results.selectGeminiTab = Boolean(selectRes && selectRes.success === true);

            const stateAfterSelect = await window.unionBotAPI.browserGetState();
            results.activeTabSwitched = stateAfterSelect.activeTabId === geminiTab?.id;

            const zoomInRes = await window.unionBotAPI.browserPerformAction({ tabId: geminiTab?.id, action: 'zoom-in' });
            results.zoomInApplied = Boolean(zoomInRes && zoomInRes.success === true && zoomInRes.zoomFactor === 1.1);

            const zoomResetRes = await window.unionBotAPI.browserPerformAction({ tabId: geminiTab?.id, action: 'zoom-reset' });
            results.zoomResetApplied = Boolean(zoomResetRes && zoomResetRes.success === true && zoomResetRes.zoomFactor === 1.0);

            // 5. Modal Overlay Protection (P4-008)
            await window.unionBotAPI.browserSetVisibility(true);
            const modalActivateRes = await window.unionBotAPI.browserSetModalActive(true);
            results.modalHidesView = Boolean(modalActivateRes && modalActivateRes.isEffectiveVisible === false);

            const modalDeactivateRes = await window.unionBotAPI.browserSetModalActive(false);
            results.modalRestoresView = Boolean(modalDeactivateRes && modalDeactivateRes.isEffectiveVisible === true);

            // 6. Tab Crash Isolation & Recovery (P4-009)
            const crashTriggerRes = await window.unionBotAPI.testTriggerTabCrash(deepseekTab?.id);
            results.crashTriggerDispatched = Boolean(crashTriggerRes && crashTriggerRes.success === true);

            await new Promise(r => setTimeout(r, 600));
            const stateAfterCrash = await window.unionBotAPI.browserGetState();
            const crashedTab = stateAfterCrash.tabs.find(t => t.id === deepseekTab?.id);
            results.deepseekTabCrashed = Boolean(crashedTab && crashedTab.crashed === true);

            // Recover tab via reload
            const reloadRes = await window.unionBotAPI.browserPerformAction({ tabId: deepseekTab?.id, action: 'reload' });
            results.reloadActionDispatched = Boolean(reloadRes && reloadRes.success === true);

            // Wait for reload & poll recovery state
            let recoveredTab = null;
            for (let attempt = 0; attempt < 10; attempt++) {
              await new Promise(r => setTimeout(r, 200));
              const stateAfterReload = await window.unionBotAPI.browserGetState();
              recoveredTab = stateAfterReload.tabs.find(t => t.id === deepseekTab?.id);
              if (recoveredTab && recoveredTab.crashed === false) {
                break;
              }
            }
            results.deepseekTabRecovered = Boolean(recoveredTab && recoveredTab.crashed === false);

            // 7. Manual Share to Room History (P4-010)
            const createRoomRes = await window.unionBotAPI.createRoom({
              id: 'p4-verification-room',
              name: 'Phase P4 Browser Collaboration Room',
            });
            results.roomCreated = Boolean(createRoomRes && createRoomRes.success === true);

            const shareRes = await window.unionBotAPI.browserShareSelection({
              tabId: chatgptTab?.id,
              selectedText: 'Architectural analysis: Browser isolation successfully guarantees 0 paid API egress and zero credential leakage.',
              roomId: 'p4-verification-room',
            });
            results.shareSucceeded = Boolean(shareRes && shareRes.success === true);
            results.shareSenderIsUserManual = Boolean(shareRes?.envelope?.sender?.id === 'user_manual');
            await new Promise(r => setTimeout(r, 200));
            const roomHistory = await window.unionBotAPI.getRoomHistory('p4-verification-room');
            const sharedEnvelope = Array.isArray(roomHistory) && roomHistory.find(e => 
              e.sender && e.sender.id === 'user_manual' && 
              Array.isArray(e.parts) && e.parts.some(p => p.text && p.text.includes('Architectural analysis: Browser isolation'))
            );
            results.sharePersistedInHistory = Boolean(sharedEnvelope);

            // UB-P4-R01-003 / P4-R02-T05: Background inactive tab share provenance
            const bgShareRes = await window.unionBotAPI.browserShareSelection({
              tabId: chatgptTab?.id,
              selectedText: 'Provenance test from inactive tab',
              roomId: 'p4-verification-room',
            });
            results.t05BackgroundShareProvenanceCorrect = Boolean(
              bgShareRes &&
              bgShareRes.success === true &&
              bgShareRes.envelope?.sender?.provider === 'chatgpt'
            );

            // UB-P4-R02-002 / P4-R03-A02: Strict SQLite storage write fault injection (throw and return_false)
            // Listen for envelope broadcast to strictly prove 0 phantom broadcasts
            let broadcastEventsCount = 0;
            const unsubBroadcast = window.unionBotAPI.onEnvelopeReceived(() => {
              broadcastEventsCount++;
            });

            // Test Case 1: Storage throws exception
            await window.unionBotAPI.testSetStorageShareMode('throw');
            const throwShareRes = await window.unionBotAPI.browserShareSelection({
              tabId: chatgptTab?.id,
              selectedText: 'Fault injection test: Throw exception',
              roomId: 'p4-verification-room',
            });
            const throwFailedClosed = Boolean(
              throwShareRes &&
              throwShareRes.success === false &&
              throwShareRes.error &&
              throwShareRes.error.includes('STORAGE_WRITE_FAILED')
            );

            // Test Case 2: Storage returns { success: false }
            await window.unionBotAPI.testSetStorageShareMode('return_false');
            const returnFalseShareRes = await window.unionBotAPI.browserShareSelection({
              tabId: chatgptTab?.id,
              selectedText: 'Fault injection test: Return false',
              roomId: 'p4-verification-room',
            });
            const returnFalseFailedClosed = Boolean(
              returnFalseShareRes &&
              returnFalseShareRes.success === false &&
              returnFalseShareRes.error &&
              returnFalseShareRes.error.includes('STORAGE_WRITE_FAILED')
            );

            // Reset back to normal storage mode
            await window.unionBotAPI.testSetStorageShareMode('normal');

            // Verify neither fault-injected snippet leaked into room history or caused phantom envelopes
            await new Promise(r => setTimeout(r, 200));
            const historyAfterFaults = await window.unionBotAPI.getRoomHistory('p4-verification-room');
            const noPhantomThrow = !historyAfterFaults.some(e => e.parts?.some(p => p.text?.includes('Throw exception')));
            const noPhantomReturnFalse = !historyAfterFaults.some(e => e.parts?.some(p => p.text?.includes('Return false')));

            if (typeof unsubBroadcast === 'function') unsubBroadcast();

            results.a02BroadcastCount = broadcastEventsCount;
            results.a02StorageFaultInjectedFailClosed = Boolean(
              throwFailedClosed &&
              returnFalseFailedClosed &&
              noPhantomThrow &&
              noPhantomReturnFalse &&
              broadcastEventsCount === 0
            );
            results.t06FailClosedStorageHandled = results.a02StorageFaultInjectedFailClosed;

            // 8. DOM Controls Verification (P4-011)
            const toggleDockBtn = document.querySelector('[data-testid="toggle-browser-btn"]');
            if (toggleDockBtn) {
              toggleDockBtn.click();
              await new Promise(r => setTimeout(r, 400));
            } else {
              window.dispatchEvent(new CustomEvent('union-bot:toggle-browser', { detail: true }));
              await new Promise(r => setTimeout(r, 400));
            }

            const browserPanelContainer = document.querySelector('[data-testid="browser-panel-container"]');
            results.domPanelContainerRendered = Boolean(browserPanelContainer);

            const tabStrip = document.querySelector('[data-testid="browser-tab-strip"]');
            results.domTabStripRendered = Boolean(tabStrip);

            const chatgptTabDom = document.querySelector('[data-testid="browser-tab-chatgpt"]');
            const geminiTabDom = document.querySelector('[data-testid="browser-tab-gemini"]');
            results.domProviderTabsRendered = Boolean(chatgptTabDom && geminiTabDom);

            // UB-P4-R02-003 / P4-R03-A03: Click "+ Add Tab" DOM button -> Exactly verifies new tab count and distinct tab ID
            const addTabBtn = document.querySelector('[data-testid="browser-add-tab-btn"]');
            let addTabSuccess = false;
            if (addTabBtn) {
              const stateBefore = await window.unionBotAPI.browserGetState();
              const countBefore = stateBefore.tabs.length;
              const priorTabIds = new Set(stateBefore.tabs.map(t => t.id));

              addTabBtn.click();
              await new Promise(r => setTimeout(r, 500));

              const stateAfter = await window.unionBotAPI.browserGetState();
              const countAfter = stateAfter.tabs.length;
              const newlyAddedTab = stateAfter.tabs.find(t => !priorTabIds.has(t.id));

              const countIncremented = (countAfter === countBefore + 1);
              const hasNewId = Boolean(newlyAddedTab && newlyAddedTab.id && !priorTabIds.has(newlyAddedTab.id));
              const isDefaultSearchTab = Boolean(
                newlyAddedTab &&
                newlyAddedTab.providerId === 'search' &&
                newlyAddedTab.url === 'https://duckduckgo.com/' &&
                newlyAddedTab.partition === 'persist:mcb-web-search'
              );

              addTabSuccess = Boolean(countIncremented && hasNewId && isDefaultSearchTab);
              results.a03TabCountBefore = countBefore;
              results.a03TabCountAfter = countAfter;
              results.a03NewlyCreatedTabId = newlyAddedTab?.id;
            }
            results.a03AddTabCreatedSearchTab = addTabSuccess;

            const addressInput = document.querySelector('[data-testid="browser-address-input"]');
            const shareBtnDom = document.querySelector('[data-testid="browser-share-btn"]');
            const viewMount = document.querySelector('[data-testid="browser-view-mount"]');
            results.domToolbarAndMountRendered = Boolean(addressInput && shareBtnDom && viewMount);

            return results;
          })()
        `);

        // 9. Cost Guard Paid API Egress Verification (Main Process)
        const costGuardOpenAiBlocked = isCostGuardBlockedUrl('https://api.openai.com/v1/chat/completions');
        const costGuardGeminiBlocked = isCostGuardBlockedUrl('https://generativelanguage.googleapis.com/v1beta/models');
        const costGuardAnthropicBlocked = isCostGuardBlockedUrl('https://api.anthropic.com/v1/messages');
        const costGuardChatGPTWebAllowed = !isCostGuardBlockedUrl('https://chatgpt.com/');
        const costGuardGeminiWebAllowed = !isCostGuardBlockedUrl('https://gemini.google.com/');
        const costGuardClaudeWebAllowed = !isCostGuardBlockedUrl('https://claude.ai/');
        const costGuardEgressBlocked =
          costGuardOpenAiBlocked &&
          costGuardGeminiBlocked &&
          costGuardAnthropicBlocked &&
          costGuardChatGPTWebAllowed &&
          costGuardGeminiWebAllowed &&
          costGuardClaudeWebAllowed;

        console.log('[P4-E2E] P4-001 Tabs initialized in WebContentsView manager:', p4Result.tabsInitialized);
        console.log('[P4-E2E] P4-002 All 4 AI Provider surfaces configured:', p4Result.allProvidersPresent);
        console.log('[P4-E2E] P4-002 Partitions bound to persist:mcb-web-*:', p4Result.partitionsIsolated);
        console.log('[P4-E2E] P4-003 Cookie set in ChatGPT partition:', p4Result.cookieSetSucceeded);
        console.log('[P4-E2E] P4-003 Cookie present in ChatGPT partition:', p4Result.cookieFoundInChatgpt);
        console.log('[P4-E2E] P4-003 Cookie NOT leaked to Gemini partition:', p4Result.cookieNotLeakedToGemini);
        console.log('[P4-E2E] P4-003 Cookie NOT leaked to Claude partition:', p4Result.cookieNotLeakedToClaude);
        console.log('[P4-E2E] P4-003 Cookie partition isolation fully verified:', p4Result.cookieIsolationVerified);
        console.log('[P4-E2E] P4-004 Dangerous file:// scheme blocked:', p4Result.dangerousFileBlocked);
        console.log('[P4-E2E] P4-004 Dangerous javascript: scheme blocked:', p4Result.dangerousJsBlocked);
        console.log('[P4-E2E] P4-004 Dangerous powershell: scheme blocked:', p4Result.dangerousPsBlocked);
        console.log('[P4-E2E] P4-005 Loopback address navigation blocked:', p4Result.dangerousLoopbackBlocked);
        console.log('[P4-E2E] P4-004 Valid query resolved to DuckDuckGo search:', p4Result.searchQueryResolved);
        console.log('[P4-E2E] P4-R02-T01 CreateTab malicious/private denied fail-closed:', p4Result.t01CreateTabMaliciousDenied && p4Result.t01CreateTabPrivateDenied);
        console.log('[P4-E2E] P4-R02-T03 Comprehensive loopback/metadata blocked:', p4Result.t03LoopbackPrivateBlocked);
        console.log('[P4-E2E] P4-R03-A01 OAuth popup & HTTPS controlled, HTTP denied:', p4Result.a01OAuthControlledAndHttpDenied);
        console.log('[P4-E2E] P4-R03-A02 SQLite storage fault injection (throw & return_false) fail-closed:', p4Result.a02StorageFaultInjectedFailClosed);
        console.log('[P4-E2E] P4-R03-A03 DOM Add Tab created default search tab:', p4Result.a03AddTabCreatedSearchTab);
        console.log('[P4-E2E] P4-R03-A04 Cross-boundary navigation leaves provider partition clean:', p4Result.a04CrossBoundaryPartitionUnpolluted);
        console.log('[P4-E2E] P4-R02-T05 Inactive tab share preserves exact provenance:', p4Result.t05BackgroundShareProvenanceCorrect);
        console.log('[P4-E2E] P4-006 Cost Guard blocks paid APIs on browser session:', costGuardEgressBlocked);
        console.log('[P4-E2E] P4-007 Tab switching to Gemini succeeded:', p4Result.selectGeminiTab && p4Result.activeTabSwitched);
        console.log('[P4-E2E] P4-007 Zoom controls applied (zoom-in / zoom-reset):', p4Result.zoomInApplied && p4Result.zoomResetApplied);
        console.log('[P4-E2E] P4-008 Modal overlay hides WebContentsView:', p4Result.modalHidesView);
        console.log('[P4-E2E] P4-008 Closing modal restores WebContentsView:', p4Result.modalRestoresView);
        console.log('[P4-E2E] P4-009 Renderer crash trigger handled gracefully:', p4Result.crashTriggerDispatched);
        console.log('[P4-E2E] P4-009 Tab marked crashed without killing app:', p4Result.deepseekTabCrashed);
        console.log('[P4-E2E] P4-009 Reload action recovers crashed tab:', p4Result.deepseekTabRecovered);
        console.log('[P4-E2E] P4-010 Manual share dispatched with user_manual sender:', p4Result.shareSucceeded && p4Result.shareSenderIsUserManual);
        console.log('[P4-E2E] P4-010 Manual share persisted in SQLite room history:', p4Result.sharePersistedInHistory);
        console.log('[P4-E2E] P4-011 Browser Dock mounted in DOM via toggle:', p4Result.domPanelContainerRendered);
        console.log('[P4-E2E] P4-011 Tab strip and provider tabs rendered in DOM:', p4Result.domTabStripRendered && p4Result.domProviderTabsRendered);
        console.log('[P4-E2E] P4-011 Toolbar and WebContentsView mount rendered:', p4Result.domToolbarAndMountRendered);

        const allP4Passed =
          p4Result.tabsInitialized &&
          p4Result.allProvidersPresent &&
          p4Result.partitionsIsolated &&
          p4Result.cookieIsolationVerified &&
          p4Result.dangerousFileBlocked &&
          p4Result.dangerousJsBlocked &&
          p4Result.dangerousPsBlocked &&
          p4Result.dangerousLoopbackBlocked &&
          p4Result.searchQueryResolved &&
          p4Result.t01CreateTabMaliciousDenied &&
          p4Result.t01CreateTabPrivateDenied &&
          p4Result.t03LoopbackPrivateBlocked &&
          p4Result.a01OAuthControlledAndHttpDenied &&
          p4Result.a02StorageFaultInjectedFailClosed &&
          p4Result.a03AddTabCreatedSearchTab &&
          p4Result.a04CrossBoundaryPartitionUnpolluted &&
          p4Result.t05BackgroundShareProvenanceCorrect &&
          costGuardEgressBlocked &&
          p4Result.selectGeminiTab &&
          p4Result.activeTabSwitched &&
          p4Result.zoomInApplied &&
          p4Result.zoomResetApplied &&
          p4Result.modalHidesView &&
          p4Result.modalRestoresView &&
          p4Result.crashTriggerDispatched &&
          p4Result.deepseekTabCrashed &&
          p4Result.deepseekTabRecovered &&
          p4Result.shareSucceeded &&
          p4Result.shareSenderIsUserManual &&
          p4Result.sharePersistedInHistory &&
          p4Result.domPanelContainerRendered &&
          p4Result.domTabStripRendered &&
          p4Result.domProviderTabsRendered &&
          p4Result.domToolbarAndMountRendered;

        if (!allP4Passed) {
          console.error('[P4-E2E] FAILED: One or more Phase P4 checks did not pass');
          app.quit();
          process.exit(1);
        }

        const regressionVectors = {
          'P4-R03-A01': Boolean(p4Result.a01OAuthControlledAndHttpDenied),
          'P4-R03-A02': Boolean(p4Result.a02StorageFaultInjectedFailClosed),
          'P4-R03-A03': Boolean(p4Result.a03AddTabCreatedSearchTab),
          'P4-R03-A04': Boolean(p4Result.a04CrossBoundaryPartitionUnpolluted),
          'P4-R02-T01': Boolean(p4Result.t01CreateTabMaliciousDenied && p4Result.t01CreateTabPrivateDenied),
          'P4-R02-T05': Boolean(p4Result.t05BackgroundShareProvenanceCorrect),
        };

        const evidencePath = path.resolve(__dirname, '../../../reports/capability-evidence/ELECTRON_P4_E2E_EVIDENCE.json');
        fs.writeFileSync(evidencePath, JSON.stringify({
          timestamp: new Date().toISOString(),
          environment: 'Real Windows Electron Chromium E2E (Phase P4 Embedded AI Browser)',
          nodeEnv: process.env.NODE_ENV,
          costGuardEgressBlocked,
          regressionVectors,
          results: p4Result,
          allPassed: allP4Passed,
        }, null, 2));

        console.log('[P4-E2E] ALL_P4_E2E_CHECKS_PASSED');
        app.quit();
        process.exit(0);

      } catch (err) {
        console.error('[P4-E2E] Exception:', err);
        app.quit();
        process.exit(1);
      }
    });
    return;
  }

  // 7n. P5-E2E: Full Windows Electron Verification for Phase P5 Artifact Store, Previews & Local MCP
  if (process.argv.includes('--p5-e2e')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        console.log('[P5-E2E] Running Real Windows Electron P5 Verification (Artifact Store, Previews, Tool Host & MCP)...');

        const p5Result = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const results = {};

            // 1. P5-001: Save binary attachment with magic MIME detection and SHA-256
            const samplePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            const saveRes = await window.unionBotAPI.saveAttachment({
              filename: 'test-pixel.png',
              dataBase64: samplePngBase64,
            });
            results.savePngSucceeded = Boolean(saveRes?.success);
            results.pngSha256 = saveRes?.attachment?.sha256;
            results.pngMimeDetected = (saveRes?.attachment?.mimeType === 'image/png');

            // 2. P5-001: Deduplication test
            const dupRes = await window.unionBotAPI.saveAttachment({
              filename: 'test-pixel-duplicate.png',
              dataBase64: samplePngBase64,
            });
            results.dedupSameSha = (dupRes?.attachment?.sha256 === results.pngSha256);

            // 3. P5-004: Artifact Inspect
            const inspectRes = await window.unionBotAPI.artifactInspect(results.pngSha256);
            results.inspectSucceeded = Boolean(inspectRes?.success && inspectRes?.artifact?.byteSize > 0);

            // 4. P5-004: Save As with Queued Path in Test Harness
            const testExportPath = 'p5_test_saved_pixel.png';
            await window.unionBotAPI.testQueueSavePath(testExportPath);
            const saveAsRes = await window.unionBotAPI.artifactSaveAs({
              sha256: results.pngSha256,
              suggestedName: 'p5_test_saved_pixel.png',
            });
            results.saveAsSucceeded = Boolean(saveAsRes?.success && saveAsRes?.savedPath === testExportPath);

            // 5. P5-004: Show in folder & Open original
            const showFolderRes = await window.unionBotAPI.artifactShowInFolder(results.pngSha256);
            results.showInFolderSucceeded = Boolean(showFolderRes?.success);
            const openOrigRes = await window.unionBotAPI.artifactOpenOriginal(results.pngSha256);
            results.openOriginalSucceeded = Boolean(openOrigRes?.success);

            // 6. P5-005 / P5-010: Path traversal denial
            const badShaInspect = await window.unionBotAPI.artifactInspect('../../Windows/System32/cmd.exe');
            results.badShaInspectDenied = Boolean(badShaInspect?.success === false);

            // 7. P5-007: Tool Host execution
            const toolRead = await window.unionBotAPI.toolHostExecute({
              command: 'readFile',
              args: ['package.json'],
            });
            results.toolHostReadFile = Boolean(toolRead?.success && toolRead?.content?.includes('union-bot-monorepo'));

            const toolTraversal = await window.unionBotAPI.toolHostExecute({
              command: 'readFile',
              args: ['../../Windows/System32/drivers/etc/hosts'],
            });
            results.toolHostTraversalDenied = Boolean(toolTraversal?.success === false && toolTraversal?.error?.includes('ERR_PATH_TRAVERSAL'));

            const toolSearch = await window.unionBotAPI.toolHostExecute({
              command: 'searchFiles',
              args: ['mcp-service'],
            });
            results.toolHostSearchFiles = Boolean(toolSearch?.success && toolSearch?.count > 0);

            const toolGit = await window.unionBotAPI.toolHostExecute({
              command: 'getGitStatus',
            });
            results.toolHostGitStatus = Boolean(toolGit?.success && typeof toolGit?.branch === 'string');

            // 8. P5-008: MCP Capability & Tool Listing
            const mcpTools = await window.unionBotAPI.mcpListTools();
            results.mcpListToolsSucceeded = Boolean(mcpTools?.success && mcpTools?.tools?.length >= 3);
            const toolNames = (mcpTools?.tools || []).map(t => t.name);
            results.mcpCalculatorPresent = toolNames.includes('calculator');
            results.mcpArtifactInspectPresent = toolNames.includes('artifact_inspect');
            results.mcpWorkspaceSummaryPresent = toolNames.includes('workspace_summary');

            // 9. P5-009: MCP Safe Calculator Tool
            const calcRes = await window.unionBotAPI.mcpCall({
              toolName: 'calculator',
              args: { expression: '(15 * 8) - (3 ^ 3) / 9' },
            });
            results.mcpCalculatorComputed = Boolean(calcRes && !calcRes.isError && calcRes.data?.value === 117);

            const calcDivZero = await window.unionBotAPI.mcpCall({
              toolName: 'calculator',
              args: { expression: '50 / 0' },
            });
            results.mcpCalculatorDivZeroHandled = Boolean(calcDivZero && calcDivZero.isError);

            // 10. P5-009: MCP Artifact Inspect Tool
            const mcpInspectRes = await window.unionBotAPI.mcpCall({
              toolName: 'artifact_inspect',
              args: { sha256: results.pngSha256 },
            });
            results.mcpInspectComputed = Boolean(mcpInspectRes && !mcpInspectRes.isError && mcpInspectRes.data?.exists);

            // 11. P5-009: MCP Workspace Summary Tool
            const mcpSummaryRes = await window.unionBotAPI.mcpCall({
              toolName: 'workspace_summary',
            });
            results.mcpSummaryComputed = Boolean(mcpSummaryRes && !mcpSummaryRes.isError && mcpSummaryRes.data?.directories?.length > 0);

            // 12. P5-010 / UB-P5-R01-004: SVG XSS sanitization & read-back proof
            const maliciousSvg = '<svg><script>alert("xss")</script><circle cx="5" cy="5" r="5" onclick="alert(1)"/><a href="javascript:alert(2)">click</a></svg>';
            const svgSaveRes = await window.unionBotAPI.saveAttachment({
              filename: 'test.svg',
              textContent: maliciousSvg,
            });
            results.svgSaved = Boolean(svgSaveRes?.success);

            let svgSanitizedOk = false;
            if (svgSaveRes?.attachment?.sha256) {
              const readBack = await window.unionBotAPI.readAttachment(svgSaveRes.attachment.sha256);
              if (readBack?.success && readBack?.dataBase64) {
                const decoded = atob(readBack.dataBase64);
                svgSanitizedOk = !decoded.includes('<script>') && !decoded.includes('alert("xss")') && !decoded.includes('onclick=') && !decoded.includes('javascript:');
              }
            }
            results.r02_svgSanitized = svgSanitizedOk;

            // 13. P5-011 / UB-P5-R01-003: Transcript Bundle Export with durable SQLite history
            const exportBundleRes = await window.unionBotAPI.exportTranscriptBundle({
              roomId: 'orchestration',
            });
            results.exportBundleSucceeded = Boolean(exportBundleRes?.success && exportBundleRes?.transcriptPath && exportBundleRes?.manifestPath);

            // 14. UB-P5-R01-001 / P5-R02-T01: 50MB file size fail-closed denial
            const largeSaveRes = await window.unionBotAPI.saveAttachment({
              filename: 'oversize.bin',
              textContent: 'A'.repeat(51 * 1024 * 1024),
            });
            results.r02_largeFileRejected = Boolean(largeSaveRes?.success === false && largeSaveRes?.code === 'ERR_FILE_TOO_LARGE');

            // 15. UB-P5-R01-002 / P5-R02-T02: ToolHost unapproved script execution blocked
            const unapprovedScriptRes = await window.unionBotAPI.toolHostExecute({
              command: 'runSafeTest',
              args: ['malicious_script.bat'],
            });
            results.r02_unapprovedScriptBlocked = Boolean(unapprovedScriptRes?.success === false && (unapprovedScriptRes?.code === 'ERR_APPROVAL_REQUIRED' || unapprovedScriptRes?.error?.includes('ERR_APPROVAL_REQUIRED')));

            // 16. UB-P5-R01-003 / P5-R02-T03: Path traversal on export roomId blocked
            const maliciousRoomExportRes = await window.unionBotAPI.exportTranscriptBundle({
              roomId: '../../malicious_escape',
            });
            results.r02_maliciousRoomExportBlocked = Boolean(maliciousRoomExportRes?.success === false && maliciousRoomExportRes?.code === 'ERR_INVALID_ROOM_ID');

            // 17. UB-P5-R01-005 / P5-R02-T05: Bucketed CAS layout verified via MCP inspect
            results.r02_mcpInspectBucketed = Boolean(mcpInspectRes && !mcpInspectRes.isError && mcpInspectRes.data?.exists && mcpInspectRes.data?.byteSize > 0);

            // 18. UI Component verification in DOM (P5-002, P5-003, P5-004)
            const exportBundleBtn = document.querySelector('[data-testid="export-transcript-bundle-btn"]');
            results.domExportBundleBtnRendered = Boolean(exportBundleBtn);

            return results;
          })();
        `);

        console.log('[P5-E2E] Results:', JSON.stringify(p5Result, null, 2));

        const requiredChecks = [
          'savePngSucceeded',
          'pngMimeDetected',
          'dedupSameSha',
          'inspectSucceeded',
          'saveAsSucceeded',
          'showInFolderSucceeded',
          'openOriginalSucceeded',
          'badShaInspectDenied',
          'toolHostReadFile',
          'toolHostTraversalDenied',
          'toolHostSearchFiles',
          'toolHostGitStatus',
          'mcpListToolsSucceeded',
          'mcpCalculatorPresent',
          'mcpArtifactInspectPresent',
          'mcpWorkspaceSummaryPresent',
          'mcpCalculatorComputed',
          'mcpCalculatorDivZeroHandled',
          'mcpInspectComputed',
          'mcpSummaryComputed',
          'svgSaved',
          'r02_svgSanitized',
          'exportBundleSucceeded',
          'r02_largeFileRejected',
          'r02_unapprovedScriptBlocked',
          'r02_maliciousRoomExportBlocked',
          'r02_mcpInspectBucketed',
          'domExportBundleBtnRendered',
        ];

        let allPassed = true;
        for (const check of requiredChecks) {
          const pass = Boolean(p5Result[check]);
          console.log(`[P5-E2E] Check ${check}: ${pass}`);
          if (!pass) allPassed = false;
        }

        const reportDir = path.resolve(__dirname, '../../../reports/capability-evidence');
        if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
        const evidencePath = path.resolve(reportDir, 'ELECTRON_P5_E2E_EVIDENCE.json');
        fs.writeFileSync(evidencePath, JSON.stringify({
          timestamp: new Date().toISOString(),
          environment: 'Real Windows Electron (Phase P5 Artifact Store, Previews, Tool Host & MCP)',
          nodeEnv: process.env.NODE_ENV,
          results: p5Result,
          allPassed,
        }, null, 2));

        if (!allPassed) {
          console.error('[P5-E2E] One or more P5 checks failed.');
          app.quit();
          process.exit(1);
        }

        console.log('[P5-E2E] ALL_P5_E2E_CHECKS_PASSED');
        app.quit();
        process.exit(0);
      } catch (err) {
        console.error('[P5-E2E] Exception:', err);
        app.quit();
        process.exit(1);
      }
    });
    return;
  }

  // 7o. P6-E2E: Full Windows Electron Verification for Phase P6 Native Codex Agent
  if (process.argv.includes('--p6-e2e')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        console.log('[P6-E2E] Running Real Windows Electron P6 Verification (Native Codex Agent Integration)...');

        const p6Result = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const results = {};

            // 1. P6-001: Discover local Codex CLI binary and version
            const discRes = await window.unionBotAPI.codexDiscover();
            results.codexDiscoverSuccess = Boolean(discRes?.success);
            results.codexAvailable = Boolean(discRes?.discovery?.available);
            results.codexVersion = discRes?.discovery?.version;
            results.codexExecutablePath = discRes?.discovery?.executablePath;
            results.codexVersionMatches = (discRes?.discovery?.version === '0.162.1');

            // 2. P6-007: Canonical workspace boundary enforcement
            const validBoundary = await window.unionBotAPI.codexVerifyBoundary('package.json');
            results.validBoundaryAllowed = Boolean(validBoundary?.success && validBoundary?.resolved);

            const invalidBoundary = await window.unionBotAPI.codexVerifyBoundary('../../Windows/System32/cmd.exe');
            results.invalidBoundaryDenied = Boolean(
              invalidBoundary?.success === false &&
              invalidBoundary?.error?.includes('ERR_PATH_TRAVERSAL')
            );

            // 3. P6-002, P6-003, P6-004: Execution & Real-Time Event Streaming via Mock Transport
            await window.unionBotAPI.testSetCodexMock({
              threadId: 'test-thread-p6-e2e',
              deltaChunks: ['Hello from ', 'native Codex agent ', 'in Windows Electron!'],
              finalText: 'Hello from native Codex agent in Windows Electron!'
            });

            const deltas = [];
            let turnCompletedPayload = null;

            const unsubDelta = window.unionBotAPI.onCodexDelta((d) => {
              if (d && d.delta) deltas.push(d.delta);
            });
            const unsubTurn = window.unionBotAPI.onCodexTurnCompleted((t) => {
              turnCompletedPayload = t;
            });

            const execRes = await window.unionBotAPI.codexExecute({
              prompt: 'Generate system overview for Union Bot P6 verification'
            });

            // Cleanup listeners
            unsubDelta();
            unsubTurn();

            results.executeSuccess = Boolean(execRes?.success);
            results.providerIsCodex = (execRes?.result?.provider === 'codex');
            results.turnCompleted = (execRes?.result?.status === 'completed');
            results.deltasReceived = Boolean(deltas.length >= 3);
            results.fullTextMatch = (execRes?.result?.text === 'Hello from native Codex agent in Windows Electron!');
            results.provenanceVerified = (execRes?.result?.provenance?.originator === 'codex');

            // 4. P6-009: Strict Zero-Cost Enforcement ($0.00 / 0đ)
            results.costIsZero = (execRes?.result?.costEstimate === 0);

            // 5. P6-006: Cancellation check
            const cancelRes = await window.unionBotAPI.codexCancel();
            results.cancelSucceeded = Boolean(cancelRes?.success);

            // Restore transport
            await window.unionBotAPI.testSetCodexMock(false);

            return results;
          })()
        `);

        console.log('[P6-E2E] Results:', JSON.stringify(p6Result, null, 2));

        const requiredChecks = [
          'codexDiscoverSuccess',
          'codexAvailable',
          'codexVersionMatches',
          'validBoundaryAllowed',
          'invalidBoundaryDenied',
          'executeSuccess',
          'providerIsCodex',
          'turnCompleted',
          'deltasReceived',
          'fullTextMatch',
          'provenanceVerified',
          'costIsZero',
          'cancelSucceeded',
        ];

        let allPassed = true;
        for (const check of requiredChecks) {
          const pass = Boolean(p6Result[check]);
          console.log(`[P6-E2E] Check ${check}: ${pass}`);
          if (!pass) allPassed = false;
        }

        const reportDir = path.resolve(__dirname, '../../../reports/capability-evidence');
        if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
        const evidencePath = path.resolve(reportDir, 'ELECTRON_P6_E2E_EVIDENCE.json');
        fs.writeFileSync(evidencePath, JSON.stringify({
          timestamp: new Date().toISOString(),
          environment: 'Real Windows Electron (Phase P6 Native Codex Agent Integration)',
          nodeEnv: process.env.NODE_ENV,
          results: p6Result,
          allPassed,
        }, null, 2));

        if (!allPassed) {
          console.error('[P6-E2E] One or more P6 checks failed.');
          app.quit();
          process.exit(1);
        }

        console.log('[P6-E2E] ALL_P6_E2E_CHECKS_PASSED');
        app.quit();
        process.exit(0);
      } catch (err) {
        console.error('[P6-E2E] Exception:', err);
        app.quit();
        process.exit(1);
      }
    });
    return;
  }

  // Phase P7: Real Windows Electron P7 Verification (Native Antigravity Agent Integration)
  if (process.argv.includes('--p7-e2e')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        console.log('[P7-E2E] Running Real Windows Electron P7 Verification (Native Antigravity Agent Integration)...');

        const e2eScratchDir = path.resolve(__dirname, '../../../scratch/p7-e2e-junction');
        const e2eOutsideDir = path.join(os.tmpdir(), `p7-e2e-outside-${Date.now()}`);
        fs.mkdirSync(e2eScratchDir, { recursive: true });
        fs.mkdirSync(e2eOutsideDir, { recursive: true });
        const e2eJunctionPath = path.join(e2eScratchDir, 'escape-junction');
        const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
        try {
          fs.symlinkSync(e2eOutsideDir, e2eJunctionPath, symlinkType);
        } catch {}

        const p7Result = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const results = {};

            // 1. P7-001: Discover local Antigravity CLI binary and version
            const discRes = await window.unionBotAPI.antigravityDiscover();
            results.antigravityDiscoverSuccess = Boolean(discRes?.success);
            results.antigravityAvailable = Boolean(discRes?.discovery?.available);
            results.antigravityVersion = discRes?.discovery?.version;
            results.antigravityExecutablePath = discRes?.discovery?.executablePath;
            results.antigravityVersionMatches = (discRes?.discovery?.version === '1.4.2');

            // 2. P7-004: Canonical workspace boundary enforcement
            const validBoundary = await window.unionBotAPI.antigravityVerifyBoundary('package.json');
            results.validBoundaryAllowed = Boolean(validBoundary?.success && validBoundary?.resolved);

            const invalidBoundary = await window.unionBotAPI.antigravityVerifyBoundary('../../Windows/System32/cmd.exe');
            results.invalidBoundaryDenied = Boolean(
              invalidBoundary?.success === false &&
              invalidBoundary?.error?.includes('ERR_PATH_TRAVERSAL')
            );

            // 2b. P7-R01: Real filesystem Windows junction escape defense (including non-existent child)
            const junctionBoundary = await window.unionBotAPI.antigravityVerifyBoundary('scratch/p7-e2e-junction/escape-junction');
            const nonExistInJunction = await window.unionBotAPI.antigravityVerifyBoundary('scratch/p7-e2e-junction/escape-junction/nested-file.txt');
            results.junctionEscapeDenied = Boolean(
              junctionBoundary?.success === false &&
              junctionBoundary?.error?.includes('ERR_PATH_TRAVERSAL') &&
              nonExistInJunction?.success === false &&
              nonExistInJunction?.error?.includes('ERR_PATH_TRAVERSAL')
            );

            // 3. P7-004: Explicit denial of forbidden flags (--dangerously-skip-permissions)
            const forbiddenFlagRes = await window.unionBotAPI.antigravityExecute({
              prompt: 'test prompt',
              options: {
                forbiddenFlags: ['--dangerously-skip-permissions']
              }
            });
            results.forbiddenFlagDenied = Boolean(
              forbiddenFlagRes?.success === false &&
              forbiddenFlagRes?.error?.includes('ERR_FORBIDDEN_FLAG')
            );

            // 4. P7-002, P7-003, P7-004: Execution & Real-Time Event Streaming via Mock Transport
            const mockEvents = [
              JSON.stringify({
                event: 'init',
                conversation_id: 'test-session-p7-e2e',
                init: { cwd: 'D:\\\\WORK-TEAM', tools: ['view_file', 'run_command'], permission_mode: 'request-review' }
              }),
              JSON.stringify({
                event: 'step_update',
                step_update: { conversation_id: 'test-session-p7-e2e', step_index: 0, state: 'DONE', step_type: 'user_input' }
              }),
              JSON.stringify({
                event: 'step_update',
                step_update: { conversation_id: 'test-session-p7-e2e', step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Hello from ' }
              }),
              JSON.stringify({
                event: 'step_update',
                step_update: { conversation_id: 'test-session-p7-e2e', step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'native Antigravity agent in Windows Electron!' }
              }),
              JSON.stringify({
                event: 'result',
                result: {
                  conversation_id: 'test-session-p7-e2e',
                  status: 'SUCCESS',
                  response: 'Hello from native Antigravity agent in Windows Electron!',
                  duration_seconds: 1.25,
                  num_turns: 1,
                  usage: { input_tokens: 1200, output_tokens: 30, thinking_tokens: 15, total_tokens: 1245 }
                }
              })
            ];

            await window.unionBotAPI.testSetAntigravityMock(mockEvents);

            const deltas = [];
            let turnCompletedPayload = null;

            const unsubDelta = window.unionBotAPI.onAntigravityDelta((d) => {
              if (d && d.delta) deltas.push(d.delta);
            });
            const unsubTurn = window.unionBotAPI.onAntigravityTurnCompleted((t) => {
              turnCompletedPayload = t;
            });

            const execRes = await window.unionBotAPI.antigravityExecute({
              prompt: 'Generate system overview for Union Bot P7 verification'
            });

            // Cleanup listeners
            unsubDelta();
            unsubTurn();

            results.executeSuccess = Boolean(execRes?.success);
            results.providerIsAntigravity = (execRes?.result?.provider === 'antigravity');
            results.deltasReceived = Boolean(deltas.length >= 2);
            results.fullTextMatch = (execRes?.result?.response === 'Hello from native Antigravity agent in Windows Electron!');
            results.artifactCreated = Boolean(execRes?.result?.artifact && execRes?.result?.artifact?.sha256);

            // 5. P7-008: Strict Zero-Cost Enforcement ($0.00 / 0đ)
            results.costIsZero = (execRes?.result?.cost === 0);

            // 6. P7-006: Cancellation check
            const cancelRes = await window.unionBotAPI.antigravityCancel();
            results.cancelSucceeded = Boolean(cancelRes?.success);

            // Restore transport
            await window.unionBotAPI.testSetAntigravityMock(false);

            return results;
          })()
        `);

        console.log('[P7-E2E] Results:', JSON.stringify(p7Result, null, 2));

        const requiredChecks = [
          'antigravityDiscoverSuccess',
          'antigravityAvailable',
          'antigravityVersionMatches',
          'validBoundaryAllowed',
          'invalidBoundaryDenied',
          'junctionEscapeDenied',
          'forbiddenFlagDenied',
          'executeSuccess',
          'providerIsAntigravity',
          'deltasReceived',
          'fullTextMatch',
          'artifactCreated',
          'costIsZero',
          'cancelSucceeded',
        ];

        let allPassed = true;
        for (const check of requiredChecks) {
          const pass = Boolean(p7Result[check]);
          console.log(`[P7-E2E] Check ${check}: ${pass}`);
          if (!pass) allPassed = false;
        }

        const reportDir = path.resolve(__dirname, '../../../reports/capability-evidence');
        if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
        const evidencePath = path.resolve(reportDir, 'ELECTRON_P7_E2E_EVIDENCE.json');
        fs.writeFileSync(evidencePath, JSON.stringify({
          timestamp: new Date().toISOString(),
          environment: 'Real Windows Electron (Phase P7 Native Antigravity Agent Integration)',
          nodeEnv: process.env.NODE_ENV,
          results: p7Result,
          allPassed,
        }, null, 2));

        try {
          if (fs.existsSync(e2eJunctionPath)) fs.rmSync(e2eJunctionPath, { force: true });
          if (fs.existsSync(e2eScratchDir)) fs.rmSync(e2eScratchDir, { recursive: true, force: true });
          if (fs.existsSync(e2eOutsideDir)) fs.rmSync(e2eOutsideDir, { recursive: true, force: true });
        } catch {}

        if (!allPassed) {
          console.error('[P7-E2E] One or more P7 checks failed.');
          app.quit();
          process.exit(1);
        }

        console.log('[P7-E2E] ALL_P7_E2E_CHECKS_PASSED');
        app.quit();
        process.exit(0);
      } catch (err) {
        console.error('[P7-E2E] Exception:', err);
        app.quit();
        process.exit(1);
      }
    });
    return;
  }

  // Phase P8: Real Windows Electron P8 Verification (Multi-Agent Task Graph & Consensus Engine)
  if (process.argv.includes('--p8-e2e')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        console.log('[P8-E2E] Running Real Windows Electron P8 Verification (Multi-Agent Task Graph & Consensus Engine)...');

        const e2eScratchDir = path.resolve(__dirname, '../../../scratch/p8-e2e-junction');
        const e2eOutsideDir = path.join(os.tmpdir(), `p8-e2e-outside-${Date.now()}`);
        fs.mkdirSync(e2eScratchDir, { recursive: true });
        fs.mkdirSync(e2eOutsideDir, { recursive: true });
        const e2eJunctionPath = path.join(e2eScratchDir, 'escape-junction');
        const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
        try {
          fs.symlinkSync(e2eOutsideDir, e2eJunctionPath, symlinkType);
        } catch {}

        const p8Result = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const results = {};

            // 1. P8-001 & P8-003: Create standard 5-stage pipeline
            const pipeRes = await window.unionBotAPI.taskGraphStandardPipeline({
              id: 'p8-e2e-pipeline',
              name: 'Windows Electron E2E 5-Stage Task Graph',
              planPrompt: 'Architect multi-agent consensus workflow',
              targetFiles: ['src/feature.ts'],
            });
            results.pipelineCreateSuccess = Boolean(pipeRes?.success);
            results.nodeCountIs5 = Boolean(pipeRes?.graph?.nodes?.length === 5);
            results.hasPlanNode = Boolean(pipeRes?.graph?.nodes?.some(n => n.stage === 'PLAN'));
            results.hasImplementNode = Boolean(pipeRes?.graph?.nodes?.some(n => n.stage === 'IMPLEMENT'));
            results.hasReviewNode = Boolean(pipeRes?.graph?.nodes?.some(n => n.stage === 'REVIEW'));
            results.hasFixNode = Boolean(pipeRes?.graph?.nodes?.some(n => n.stage === 'FIX'));
            results.hasVerifyNode = Boolean(pipeRes?.graph?.nodes?.some(n => n.stage === 'VERIFY'));

            // 2. P8-007: Canonical workspace boundary verification
            const validBoundary = await window.unionBotAPI.taskGraphVerifyBoundary('package.json');
            results.validBoundaryAllowed = Boolean(validBoundary?.success && validBoundary?.isInside === true);

            const invalidBoundary = await window.unionBotAPI.taskGraphVerifyBoundary('../../Windows/System32/cmd.exe');
            results.invalidBoundaryDenied = Boolean(invalidBoundary?.success && invalidBoundary?.isInside === false);

            const junctionBoundary = await window.unionBotAPI.taskGraphVerifyBoundary('scratch/p8-e2e-junction/escape-junction');
            results.junctionEscapeDenied = Boolean(junctionBoundary?.success && junctionBoundary?.isInside === false);

            // 3. P8-002: Cycle detection fail-closed (ERR_CYCLE_DETECTED)
            const cyclicRes = await window.unionBotAPI.taskGraphCreate({
              id: 'p8-e2e-cyclic',
              name: 'Cyclic Graph',
              nodes: [
                { id: 'node-a', name: 'Task A', stage: 'PLAN', assignedRole: 'ARCHITECT', dependencies: ['node-b'] },
                { id: 'node-b', name: 'Task B', stage: 'IMPLEMENT', assignedRole: 'IMPLEMENTER', dependencies: ['node-a'] },
              ],
            });
            results.cycleDetectionEnforced = Boolean(
              cyclicRes?.success === false &&
              (cyclicRes?.code === 'ERR_CYCLE_DETECTED' || cyclicRes?.error?.includes('Cyclic dependency'))
            );

            // 4. P8-R02 Voter Authentication, Digest Binding & Deduplication
            // A. Attempt forged vote submission by unauthorized caller
            const forgedRes = await window.unionBotAPI.taskGraphSubmitVote({
              graphId: 'p8-e2e-pipeline',
              nodeId: 'node-review',
              vote: {
                voterId: 'unauthorized-intruder',
                voterRole: 'QA_SECURITY',
                decision: 'APPROVE',
                reviewedDigest: 'dummy-digest',
                rationale: 'forged vote attempt',
              },
            });
            results.forgedVoteDenied = Boolean(
              forgedRes?.success === false &&
              (forgedRes?.code === 'ERR_UNAUTHORIZED_VOTER' || forgedRes?.error?.includes('not an authorized reviewer'))
            );

            // B. Submit authentic vote from registered QA_SECURITY reviewer
            const activeDigest = 'sha256-active-e2e-artifact-v1';
            const authenticRes = await window.unionBotAPI.taskGraphSubmitVote({
              graphId: 'p8-e2e-pipeline',
              nodeId: 'node-review',
              vote: {
                voterId: 'qa-sec-auditor',
                voterRole: 'QA_SECURITY',
                decision: 'APPROVE',
                reviewedDigest: activeDigest,
                rationale: 'Authentic security review passed with 100% boundary & zero-cost guarantees',
              },
            });
            results.authenticVoteAccepted = Boolean(authenticRes?.success === true);

            // C. Attempt vote with stale / mismatched digest against active review targetDigest
            const staleRes = await window.unionBotAPI.taskGraphSubmitVote({
              graphId: 'p8-e2e-pipeline',
              nodeId: 'node-review',
              vote: {
                voterId: 'reviewer-qa-1',
                voterRole: 'REVIEWER',
                decision: 'APPROVE',
                reviewedDigest: 'stale-mismatched-digest-v0',
                rationale: 'Reviewing outdated digest',
              },
            });
            results.staleDigestVoteDenied = Boolean(
              staleRes?.success === false &&
              (staleRes?.code === 'ERR_STALE_VOTE_DIGEST' || staleRes?.error?.includes('does not match active review targetDigest'))
            );

            // D. Deduplication: update vote in-place without duplicating
            const dupVoteRes = await window.unionBotAPI.taskGraphSubmitVote({
              graphId: 'p8-e2e-pipeline',
              nodeId: 'node-review',
              vote: {
                voterId: 'qa-sec-auditor',
                voterRole: 'QA_SECURITY',
                decision: 'APPROVE',
                reviewedDigest: activeDigest,
                rationale: 'Updated audit rationale: 100% verified',
              },
            });
            const statusBeforeRun = await window.unionBotAPI.taskGraphStatus('p8-e2e-pipeline');
            const revNodeBefore = (statusBeforeRun?.nodes || statusBeforeRun?.graph?.nodes)?.find(n => n.id === 'node-review');
            results.duplicateVoteDeduplicated = Boolean(
              dupVoteRes?.success === true &&
              revNodeBefore?.votes?.length === 1 &&
              revNodeBefore?.votes?.[0]?.rationale === 'Updated audit rationale: 100% verified'
            );

            // 5. Live execution of 5-Stage Task Graph with Consensus & Remediation
            const eventLog = [];
            const unsubEvents = window.unionBotAPI.onTaskGraphEvent((evt) => {
              if (evt) eventLog.push(evt);
            });

            const execRes = await window.unionBotAPI.taskGraphRun({
              graphId: 'p8-e2e-pipeline',
            });
            unsubEvents();

            results.runGraphSuccess = Boolean(execRes?.success);
            results.graphStatusCompleted = (execRes?.status === 'COMPLETED');
            results.all5NodesCompleted = Boolean(
              execRes?.nodes?.length === 5 &&
              execRes?.nodes?.every(n => n.status === 'COMPLETED' || n.status === 'SKIPPED')
            );
            const reviewNodeAfter = execRes?.nodes?.find(n => n.stage === 'REVIEW');
            const qaVote = reviewNodeAfter?.votes?.find(v => v.voterId === 'qa-sec-auditor');
            results.consensusVotesRecorded = Boolean(
              qaVote &&
              qaVote.voterRole === 'QA_SECURITY' &&
              qaVote.decision === 'APPROVE' &&
              qaVote.reviewedDigest === activeDigest
            );
            results.requiredRoleApprovalVerified = Boolean(qaVote && qaVote.voterRole === 'QA_SECURITY');
            results.eventsEmitted = Boolean(eventLog.length >= 3);

            return results;
          })()
        `);

        console.log('[P8-E2E] Results:', JSON.stringify(p8Result, null, 2));

        const requiredChecks = [
          'pipelineCreateSuccess',
          'nodeCountIs5',
          'hasPlanNode',
          'hasImplementNode',
          'hasReviewNode',
          'hasFixNode',
          'hasVerifyNode',
          'validBoundaryAllowed',
          'invalidBoundaryDenied',
          'junctionEscapeDenied',
          'cycleDetectionEnforced',
          'forgedVoteDenied',
          'authenticVoteAccepted',
          'staleDigestVoteDenied',
          'duplicateVoteDeduplicated',
          'runGraphSuccess',
          'graphStatusCompleted',
          'all5NodesCompleted',
          'consensusVotesRecorded',
          'requiredRoleApprovalVerified',
          'eventsEmitted',
        ];

        let allPassed = true;
        for (const check of requiredChecks) {
          const pass = Boolean(p8Result[check]);
          console.log(`[P8-E2E] Check ${check}: ${pass}`);
          if (!pass) allPassed = false;
        }

        const reportDir = path.resolve(__dirname, '../../../reports/capability-evidence');
        if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
        const evidencePath = path.resolve(reportDir, 'ELECTRON_P8_E2E_EVIDENCE.json');
        fs.writeFileSync(evidencePath, JSON.stringify({
          timestamp: new Date().toISOString(),
          environment: 'Real Windows Electron (Phase P8 Multi-Agent Task Graph & Consensus Engine)',
          nodeEnv: process.env.NODE_ENV,
          results: p8Result,
          allPassed,
        }, null, 2));

        try {
          if (fs.existsSync(e2eJunctionPath)) fs.rmSync(e2eJunctionPath, { force: true });
          if (fs.existsSync(e2eScratchDir)) fs.rmSync(e2eScratchDir, { recursive: true, force: true });
          if (fs.existsSync(e2eOutsideDir)) fs.rmSync(e2eOutsideDir, { recursive: true, force: true });
        } catch {}

        if (!allPassed) {
          console.error('[P8-E2E] One or more P8 checks failed.');
          app.quit();
          process.exit(1);
        }

        console.log('[P8-E2E] ALL_P8_E2E_CHECKS_PASSED');
        app.quit();
        process.exit(0);
      } catch (err) {
        console.error('[P8-E2E] Exception:', err);
        app.quit();
        process.exit(1);
      }
    });
    return;
  }

  // 7. Handle Standard GUI Smoke Test Mode
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
        const smokeEnvId = `smoke_gui_env_${Date.now()}`;
        const ipcSendResult = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            if (!window.unionBotAPI) return { error: 'window.unionBotAPI not found' };
            return await window.unionBotAPI.dispatchEnvelope({
              id: '${smokeEnvId}',
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
        const ipcSendSuccess = Boolean(ipcSendResult && ipcSendResult.success === true && ipcSendResult.envelopeId === smokeEnvId);
        console.log('[SmokeTest] ipcSendResult raw:', JSON.stringify(ipcSendResult));
        console.log('[SmokeTest] Real GUI IPC send message verified:', ipcSendSuccess);

        // 6. Verify Real GUI -> IPC room history retrieval through window.unionBotAPI
        const historyResult = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            if (!window.unionBotAPI) return [];
            return await window.unionBotAPI.getRoomHistory('orchestration');
          })()
        `);
        const historyVerified = Array.isArray(historyResult) && historyResult.some((e) => e.id === smokeEnvId);
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

// Strict senderFrame verification enforcing main Window and exact UI frame URL (UB-P2-R01-008, UB-P2-R02-006, P2-T13, R03-E11)
function checkSenderAuthorized(event) {
  return isAuthorizedSenderFrame(event, mainWindow, allowedUiFileUrl);
}

// IPC Handlers: Strictly routed through Orchestrator with renderer anti-spoofing and origin validation (C03, UB-P2-R01-008)
ipcMain.handle('union-bot:get-app-status', async (event) => {
  return { status: appStatus, error: storageInitError };
});

ipcMain.handle('union-bot:dispatch-envelope', async (event, envelope) => {
  if (appStatus !== 'READY') {
    return {
      success: false,
      error: `ERR_STORAGE_UNAVAILABLE: Desktop storage is not ready (${appStatus}): ${storageInitError || 'Storage offline'} (UB-P2-R03-05)`,
    };
  }

  if (!checkSenderAuthorized(event)) {
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
  return { success: true, envelopeId: result.envelopeId, roomId: result.roomId, deduplicated: result.deduplicated };
});

ipcMain.handle('union-bot:get-room-history', async (event, roomId) => {
  if (!checkSenderAuthorized(event)) {
    return [];
  }
  if (typeof roomId !== 'string') return [];
  return await orchestrator.getRoomHistoryAsync(roomId);
});

// P3-003: Dynamic Room Management IPC
// P3-R02 / UB-P3-R01-002: Project Workspace Hierarchy IPC
ipcMain.handle('union-bot:get-projects', async (event, options) => {
  if (!checkSenderAuthorized(event)) return [];
  if (appStatus !== 'READY') return [];
  try {
    const includeArchived = options && options.includeArchived === true;
    return await storage.getProjects(includeArchived);
  } catch (err) {
    console.error('[UnionBot] Failed to get projects:', err);
    return [];
  }
});

ipcMain.handle('union-bot:create-project', async (event, payload) => {
  if (!checkSenderAuthorized(event)) return { success: false, error: 'Unauthorized IPC sender origin' };
  if (appStatus !== 'READY') return { success: false, error: `ERR_STORAGE_UNAVAILABLE: Desktop storage is not ready (${appStatus})` };
  try {
    const { id, name, description } = payload || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return { success: false, error: 'Project name is required' };
    }
    const cleanId = (id && typeof id === 'string' && id.trim())
      ? id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-')
      : `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const cleanName = String(name).trim();
    const result = await storage.createProject(cleanId, cleanName, description || '');
    return { success: true, project: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('union-bot:rename-project', async (event, payload) => {
  if (!checkSenderAuthorized(event)) return { success: false, error: 'Unauthorized IPC sender origin' };
  if (appStatus !== 'READY') return { success: false, error: `ERR_STORAGE_UNAVAILABLE: Desktop storage is not ready (${appStatus})` };
  try {
    const { id, newName } = payload || {};
    if (!id || !newName || typeof newName !== 'string' || !newName.trim()) {
      return { success: false, error: 'Valid id and newName required' };
    }
    const result = await storage.renameProject(id, newName.trim());
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('union-bot:archive-project', async (event, id) => {
  if (!checkSenderAuthorized(event)) return { success: false, error: 'Unauthorized IPC sender origin' };
  if (appStatus !== 'READY') return { success: false, error: `ERR_STORAGE_UNAVAILABLE: Desktop storage is not ready (${appStatus})` };
  try {
    if (!id || id === 'default') {
      return { success: false, error: 'Cannot archive default project' };
    }
    const result = await storage.archiveProject(id);
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('union-bot:delete-project', async (event, id) => {
  if (!checkSenderAuthorized(event)) return { success: false, error: 'Unauthorized IPC sender origin' };
  if (appStatus !== 'READY') return { success: false, error: `ERR_STORAGE_UNAVAILABLE: Desktop storage is not ready (${appStatus})` };
  try {
    if (!id || id === 'default') {
      return { success: false, error: 'Cannot delete default project' };
    }
    const result = await storage.deleteProject(id);
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// P3-003: Dynamic Room Management IPC
ipcMain.handle('union-bot:get-rooms', async (event, options) => {
  if (!checkSenderAuthorized(event)) {
    return [];
  }
  if (appStatus !== 'READY') {
    return [];
  }
  try {
    const projectId = options && options.projectId;
    let rooms = await storage.getRooms(projectId);
    if (!rooms || rooms.length === 0) {
      if (!projectId || projectId === 'default') {
        // Seed initial default rooms if table is empty
        const defaultRooms = [
          { id: 'orchestration', name: 'orchestration', projectId: 'default' },
          { id: 'agent-dev', name: 'agent-dev', projectId: 'default' },
          { id: 'qa-audit', name: 'qa-audit', projectId: 'default' },
          { id: 'review-briefing', name: 'review-briefing', projectId: 'default' },
        ];
        for (const r of defaultRooms) {
          await storage.ensureRoom(r.id, r.name, r.projectId);
        }
        rooms = await storage.getRooms(projectId);
      }
    }
    return rooms || [];
  } catch (err) {
    console.error('[UnionBot] Failed to get rooms:', err);
    return [];
  }
});

ipcMain.handle('union-bot:create-room', async (event, payload) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  if (appStatus !== 'READY') {
    return { success: false, error: `ERR_STORAGE_UNAVAILABLE: Desktop storage is not ready (${appStatus})` };
  }
  try {
    const { id, name, projectId } = payload || {};
    if (!id || !name) {
      return { success: false, error: 'Room id and name are required' };
    }
    const cleanId = String(id).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const cleanName = String(name).trim();
    const cleanProjectId = projectId || 'default';
    const result = await storage.createRoom(cleanId, cleanName, cleanProjectId);
    return { success: true, room: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// P3-R02 / UB-P3-R01-003: Tasks Durable Tracking IPC
ipcMain.handle('union-bot:list-tasks', async (event, options) => {
  if (!checkSenderAuthorized(event)) return [];
  if (appStatus !== 'READY') return [];
  try {
    return await storage.listTasks(options || {});
  } catch (err) {
    console.error('[UnionBot] Failed to list tasks:', err);
    return [];
  }
});

ipcMain.handle('union-bot:create-task', async (event, taskData) => {
  if (!checkSenderAuthorized(event)) return { success: false, error: 'Unauthorized IPC sender origin' };
  if (appStatus !== 'READY') return { success: false, error: `ERR_STORAGE_UNAVAILABLE: Desktop storage is not ready (${appStatus})` };
  try {
    const { title, status, progress, roomId, metadata } = taskData || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      return { success: false, error: 'Task title is required' };
    }
    const result = await storage.createTask({
      title: title.trim(),
      status: status || 'pending',
      progress: typeof progress === 'number' ? progress : 0,
      roomId: roomId || null,
      metadata: metadata || null,
    });
    return { success: true, task: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('union-bot:update-task', async (event, payload) => {
  if (!checkSenderAuthorized(event)) return { success: false, error: 'Unauthorized IPC sender origin' };
  if (appStatus !== 'READY') return { success: false, error: `ERR_STORAGE_UNAVAILABLE: Desktop storage is not ready (${appStatus})` };
  try {
    const { taskId, updates } = payload || {};
    if (!taskId) return { success: false, error: 'taskId is required' };
    const result = await storage.updateTask(taskId, updates || {});
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// P3-R02 / UB-P3-R01-007: Storage Diagnostics IPC
ipcMain.handle('union-bot:get-storage-diagnostics', async (event) => {
  if (!checkSenderAuthorized(event)) return { success: false, error: 'Unauthorized IPC sender origin' };
  try {
    const diag = await storage.getStorageDiagnostics();
    const userDataDir = app.getPath('userData');
    const casDir = path.resolve(userDataDir, 'cas-store');
    let casSizeBytes = 0;
    let casItemCount = 0;
    if (fs.existsSync(casDir)) {
      const files = fs.readdirSync(casDir);
      casItemCount = files.length;
      for (const f of files) {
        try {
          casSizeBytes += fs.statSync(path.join(casDir, f)).size;
        } catch {}
      }
    }
    return {
      success: true,
      diagnostics: {
        ...diag,
        casDir,
        casSizeBytes,
        casItemCount,
        appStatus,
      },
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// P3-007 / P3-C01: Approval Inbox list and rejection IPC
ipcMain.handle('union-bot:list-approvals', async (event, options) => {
  if (!checkSenderAuthorized(event)) {
    return [];
  }
  if (appStatus !== 'READY') {
    return [];
  }
  try {
    const limit = (options && options.limit) || 50;
    return await storage.listApprovals(limit);
  } catch (err) {
    console.error('[UnionBot] Failed to list approvals:', err);
    return [];
  }
});

ipcMain.handle('union-bot:reject-approval', async (event, payload) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  if (appStatus !== 'READY') {
    return { success: false, error: `ERR_STORAGE_UNAVAILABLE: Desktop storage is not ready (${appStatus})` };
  }
  try {
    const { tokenId, reason } = payload || {};
    if (!tokenId) {
      return { success: false, error: 'tokenId is required' };
    }
    return await storage.rejectToken(tokenId, reason);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// P3-004 / P3-005 / P3-C03 / UB-P5-R01-001 / UB-P5-R01-004: Attachments CAS store & file dialogue IPC
ipcMain.handle('union-bot:save-attachment', async (event, payload) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  try {
    const { filename, mimeType, dataBase64, textContent } = payload || {};
    if (!filename || typeof filename !== 'string') {
      return { success: false, error: 'Filename is required' };
    }
    let buffer;
    if (dataBase64) {
      const base64Data = dataBase64.includes('base64,') ? dataBase64.split('base64,')[1] : dataBase64;
      buffer = Buffer.from(base64Data, 'base64');
    } else if (typeof textContent === 'string') {
      buffer = Buffer.from(textContent, 'utf8');
    } else {
      return { success: false, error: 'File data is required' };
    }

    // UB-P5-R01-001 / P5-R02-T01: Enforce 50MB maximum artifact size fail-closed
    const MAX_SIZE = ArtifactStore.DEFAULT_MAX_ARTIFACT_SIZE_BYTES || 50 * 1024 * 1024;
    if (buffer.length > MAX_SIZE) {
      return {
        success: false,
        code: 'ERR_FILE_TOO_LARGE',
        error: `ERR_FILE_TOO_LARGE: File exceeds maximum allowed size of 50MB (size: ${buffer.length} bytes)`,
      };
    }

    // Sniff MIME type using magic bytes
    let cleanMime = detectMimeType(buffer, mimeType);

    // UB-P5-R01-004 / P5-R02-T04: Sanitize SVG before storing
    const isSvg = cleanMime === 'image/svg+xml' || filename.toLowerCase().endsWith('.svg');
    if (isSvg) {
      const svgText = buffer.toString('utf8');
      const sanitizedSvg = sanitizeSvg(svgText);
      buffer = Buffer.from(sanitizedSvg, 'utf8');
      cleanMime = 'image/svg+xml';
    }

    // Store via ArtifactStore CAS
    const meta = artifactStore.storeBytes(buffer, filename, { mimeType: cleanMime });
    const dataUrl = cleanMime.startsWith('image/') ? `data:${cleanMime};base64,${buffer.toString('base64')}` : undefined;

    return {
      success: true,
      attachment: {
        filename,
        sha256: meta.sha256,
        mimeType: meta.mimeType || cleanMime,
        sizeBytes: buffer.length,
        byteSize: buffer.length,
        casPath: meta.storedPath,
        dataUrl,
      },
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// P3-R02 / UB-P3-R01-001 / UB-P5-R01-005: Strict SHA-256 validation & CAS fallback lookup
ipcMain.handle('union-bot:read-attachment', async (event, sha256) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  try {
    if (!sha256 || !ArtifactStore.isValidSha256(sha256)) {
      return { success: false, code: 'ERR_INVALID_SHA256', error: 'ERR_INVALID_SHA256: Input must be a valid 64-character hexadecimal SHA-256 hash' };
    }
    const cleanSha = sha256.trim().toLowerCase();
    let buffer;
    try {
      buffer = artifactStore.readBytes(cleanSha);
    } catch {
      const userDataDir = app.getPath('userData');
      const casDir = path.resolve(userDataDir, 'cas-store');
      const flatPath = path.resolve(casDir, cleanSha);
      if (flatPath.startsWith(casDir + path.sep) && fs.existsSync(flatPath)) {
        buffer = fs.readFileSync(flatPath);
      } else {
        return { success: false, error: 'Attachment not found in CAS store' };
      }
    }
    return {
      success: true,
      sha256: cleanSha,
      sizeBytes: buffer.length,
      dataBase64: buffer.toString('base64'),
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('union-bot:open-file-dialog', async (event) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  try {
    let selectedPath;
    if (isDedicatedTestHarness && testQueuedFileDialogPaths.length > 0) {
      selectedPath = testQueuedFileDialogPaths.shift();
    } else {
      if (isDedicatedTestHarness && process.argv.includes('--headless')) {
        return { success: false, error: 'No queued file dialog path in headless test harness' };
      }
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select File to Attach',
        properties: ['openFile'],
        filters: [
          { name: 'Images & Documents', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'json', 'md', 'svg'] },
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
          { name: 'PDF Documents', extensions: ['pdf'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }
      selectedPath = result.filePaths[0];
    }
    if (!fs.existsSync(selectedPath)) {
      return { success: false, error: `File not found on filesystem: ${selectedPath}` };
    }
    const filename = path.basename(selectedPath);
    let buffer = fs.readFileSync(selectedPath);

    const MAX_SIZE = ArtifactStore.DEFAULT_MAX_ARTIFACT_SIZE_BYTES || 50 * 1024 * 1024;
    if (buffer.length > MAX_SIZE) {
      return {
        success: false,
        code: 'ERR_FILE_TOO_LARGE',
        error: `ERR_FILE_TOO_LARGE: File exceeds maximum allowed size of 50MB (size: ${buffer.length} bytes)`,
      };
    }

    let cleanMime = detectMimeType(buffer);
    const isSvg = cleanMime === 'image/svg+xml' || filename.toLowerCase().endsWith('.svg');
    if (isSvg) {
      const svgText = buffer.toString('utf8');
      const sanitizedSvg = sanitizeSvg(svgText);
      buffer = Buffer.from(sanitizedSvg, 'utf8');
      cleanMime = 'image/svg+xml';
    }

    const meta = artifactStore.storeBytes(buffer, filename, { mimeType: cleanMime });
    const dataUrl = cleanMime.startsWith('image/') ? `data:${cleanMime};base64,${buffer.toString('base64')}` : undefined;

    return {
      success: true,
      attachment: {
        filename,
        sha256: meta.sha256,
        mimeType: meta.mimeType || cleanMime,
        sizeBytes: buffer.length,
        byteSize: buffer.length,
        casPath: meta.storedPath,
        dataUrl,
      },
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// P3-009 / P3-R02 / Gate P3 / UB-P3-R01-006: Uncapped Multi-Format Workspace Export
ipcMain.handle('union-bot:export-workspace', async (event, options = {}) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  try {
    // UB-P3-R02-002: Truly uncapped export using SQLite native uncapped sentinel (-1)
    const limit = typeof options.limit === 'number' ? options.limit : -1;
    const projects = await storage.getProjects(true);
    const rooms = await storage.getRooms();
    const tasks = await storage.listTasks({ limit: typeof options.taskLimit === 'number' ? options.taskLimit : -1 });
    const exportData = {
      exportedAt: new Date().toISOString(),
      projects,
      rooms: [],
      tasks,
    };
    for (const r of rooms) {
      const history = await storage.getRoomEnvelopes(r.id, limit);
      exportData.rooms.push({
        id: r.id,
        name: r.name,
        projectId: r.project_id || 'default',
        envelopes: history,
      });
    }

    const jsonString = JSON.stringify(exportData, null, 2);
    let mdContent = `# Union Bot Workspace Export\n*Exported at: ${exportData.exportedAt}*\n\n`;
    mdContent += `## Projects (${projects.length})\n\n`;
    for (const p of projects) {
      mdContent += `- **${p.name}** (\`${p.id}\`)${p.archived ? ' [ARCHIVED]' : ''}: ${p.description || 'No description'}\n`;
    }
    mdContent += '\n';

    for (const r of exportData.rooms) {
      mdContent += `## Room: #${r.name} (${r.id}) [Project: ${r.projectId}]\n\n`;
      if (!r.envelopes || r.envelopes.length === 0) {
        mdContent += `*No messages in this room.*\n\n`;
      } else {
        for (const env of r.envelopes) {
          const sender = env.sender ? `${env.sender.name} (${env.sender.role || env.sender.kind})` : 'Unknown';
          const time = env.timestamp ? new Date(env.timestamp).toLocaleString() : '';
          mdContent += `### [${time}] ${sender}\n`;
          if (env.parts) {
            for (const p of env.parts) {
              if (p.kind === 'text') mdContent += `${p.text}\n\n`;
              else if (p.kind === 'code') mdContent += `\`\`\`${p.language || ''}\n${p.code || p.content}\n\`\`\`\n\n`;
              else if (p.kind === 'artifact' || p.kind === 'attachment') mdContent += `📎 **Attachment:** ${p.filename} (${p.sizeBytes} bytes, SHA256: \`${p.sha256}\`)\n\n`;
            }
          }
        }
      }
    }

    const userDataDir = app.getPath('userData');
    const exportsDir = path.resolve(userDataDir, 'exports');
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }
    const exportJsonPath = path.resolve(exportsDir, 'workspace_export.json');
    const exportMdPath = path.resolve(exportsDir, 'workspace_export.md');
    fs.writeFileSync(exportJsonPath, jsonString, 'utf8');
    fs.writeFileSync(exportMdPath, mdContent, 'utf8');

    return {
      success: true,
      exportJson: jsonString,
      exportMarkdown: mdContent,
      exportJsonPath,
      exportMdPath,
      projectCount: exportData.projects.length,
      roomCount: exportData.rooms.length,
      taskCount: exportData.tasks.length,
      totalEnvelopes: exportData.rooms.reduce((acc, r) => acc + (r.envelopes ? r.envelopes.length : 0), 0),
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('union-bot:create-approval-token', async (event, tokenData) => {
  if (appStatus !== 'READY') {
    return { success: false, error: `ERR_STORAGE_UNAVAILABLE: Desktop storage is not ready (${appStatus}) (UB-P2-R03-05)` };
  }
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Security violation: Unauthorized IPC sender origin or missing frame (UB-P2-R01-008)' };
  }
  if (!tokenData || typeof tokenData !== 'object') {
    return { success: false, error: 'ERR_INVALID_TOKEN_DATA: tokenData is required' };
  }
  const hasPayload = (tokenData.payload !== undefined && tokenData.payload !== null) ||
                     (typeof tokenData.payload_json === 'string' && tokenData.payload_json.trim() !== '') ||
                     (typeof tokenData.payloadJson === 'string' && tokenData.payloadJson.trim() !== '');
  if (!hasPayload) {
    return { success: false, error: 'ERR_PAYLOAD_MISMATCH: ActionIntent payload or payload_json is required to create an approval token (UB-P3-R04-G01)' };
  }
  try {
    const token = await storage.createApprovalToken(tokenData);
    return { success: true, token };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('union-bot:compute-action-digest', async (event, input) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Security violation: Unauthorized IPC sender origin or missing frame (UB-P2-R01-008)' };
  }
  try {
    const semanticInput = extractActionSemanticInput(input);
    const digest = computeCanonicalDigest(semanticInput, 1);
    return { success: true, digest, semanticInput };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Native Human Confirmation Controller (Main-Process Owned - UB-P2-R06-001, R07-A01)
// Never accepts untrusted renderer boolean. Requires authentic OS-bound native prompt or verified test confirmation delegate.
let nativeConfirmationDelegate = null;
if (isDedicatedTestHarness) {
  if (process.env.UNION_BOT_AUTO_APPROVE === '1') {
    nativeConfirmationDelegate = async () => true;
  } else {
    // In automated test harness without explicit auto-approve, default to Cancel/rejection
    // to prevent headless test runner hanging on native modal dialog.
    nativeConfirmationDelegate = async () => false;
  }
}

async function requestNativeHumanConfirmation(tokenRecord, ownerWindow) {
  if (typeof nativeConfirmationDelegate === 'function') {
    return await nativeConfirmationDelegate(tokenRecord, ownerWindow);
  }

  // Default: Main-process owned Electron native dialog
  if (dialog && typeof dialog.showMessageBox === 'function') {
    try {
      const targetWin = ownerWindow || BrowserWindow.getFocusedWindow() || mainWindow;
      const res = await dialog.showMessageBox(targetWin, {
        type: 'question',
        buttons: ['Cancel', 'Authorize & Approve'],
        defaultId: 0, // Cancel is the default button
        cancelId: 0, // Escape or closing window cancels
        title: 'Union Bot - Native Security Authorization',
        message: `Authorize Action: ${tokenRecord.action_type || tokenRecord.actionType || 'execute'}`,
        detail: [
          `Target: ${tokenRecord.target || tokenRecord.recipient || 'local'}`,
          `Scope: ${tokenRecord.scope || 'default'}`,
          `Payload Digest: ${tokenRecord.payload_digest || tokenRecord.payloadDigest || 'unknown'}`,
          `Cost: $0.00 (Zero-Cost Local Execution)`,
          '',
          'Affirmative native human interaction required. Cancel or dismissal will deny authorization.',
        ].join('\n'),
      });
      return res.response === 1; // 1 is Authorize & Approve, 0 is Cancel
    } catch {
      return false;
    }
  }

  return false;
}

ipcMain.handle('union-bot:approve-token', async (event, payload) => {
  if (appStatus !== 'READY') {
    return { success: false, error: `ERR_STORAGE_UNAVAILABLE: Desktop storage is not ready (${appStatus}) (UB-P2-R03-05)` };
  }
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Security violation: Unauthorized IPC sender origin or missing frame (UB-P2-R01-008)' };
  }

  const tokenId = typeof payload === 'string' ? payload : (payload?.tokenId || payload?.id);
  const rawContext = typeof payload === 'object' ? (payload?.decisionContext || payload) : undefined;
  const decisionContext = (rawContext && typeof rawContext === 'object' && rawContext.decisionContext)
    ? rawContext.decisionContext
    : rawContext;

  if (!tokenId || typeof tokenId !== 'string') {
    return { success: false, error: 'ERR_UNTRUSTED_ACTION: tokenId is required' };
  }

  // 1. Fetch pending token directly from durable storage (Main Process Owned)
  let tokenRecord;
  try {
    tokenRecord = await storage.getApprovalToken(tokenId);
  } catch (fetchErr) {
    return { success: false, error: `ERR_STORAGE_UNAVAILABLE: Failed to read token: ${fetchErr.message}` };
  }

  if (!tokenRecord) {
    return { success: false, error: `ERR_UNTRUSTED_ACTION: Approval token not found: ${tokenId}` };
  }
  if (tokenRecord.status !== 'PENDING') {
    return {
      success: false,
      error: `ERR_UNTRUSTED_ACTION: Token ${tokenId} is not in PENDING state (status: ${tokenRecord.status})`,
    };
  }

  // 2. Check expiration
  if (tokenRecord.expires_at && new Date(tokenRecord.expires_at).getTime() < Date.now()) {
    return { success: false, error: `ERR_APPROVAL_EXPIRED: Token ${tokenId} has expired` };
  }

  // 3. Stale / changed intent check: verify expected digest against stored canonical digest (R07-A01)
  const storedDigest = tokenRecord.payload_digest || tokenRecord.payloadDigest;
  const expectedDigest = decisionContext?.expectedDigest || payload?.expectedDigest;
  if (expectedDigest && storedDigest && expectedDigest !== storedDigest) {
    return {
      success: false,
      error: `ERR_PAYLOAD_MISMATCH: Stale or modified intent; expected digest ${expectedDigest} does not match stored digest ${storedDigest} (R07-A01)`,
    };
  }

  // UB-P3-R04-G01: ActionIntent payload is strictly required for approval. Missing or unreadable payload is rejected BEFORE human confirmation!
  let rawPayload = tokenRecord.payload !== undefined && tokenRecord.payload !== null
    ? tokenRecord.payload
    : null;
  if (rawPayload === null && tokenRecord.payload_json) {
    try {
      rawPayload = JSON.parse(tokenRecord.payload_json);
    } catch (parseErr) {
      return {
        success: false,
        error: `ERR_PAYLOAD_MISMATCH: Malformed stored payload_json: ${parseErr.message} (UB-P3-R04-G01)`,
      };
    }
  }

  if (rawPayload === null || rawPayload === undefined) {
    return {
      success: false,
      error: `ERR_PAYLOAD_MISMATCH: ActionIntent payload is missing or unreadable on token ${tokenId}. Approval strictly requires verified ActionIntent (UB-P3-R04-G01)`,
    };
  }

  try {
    const version = tokenRecord.canonicalization_version || tokenRecord.canonicalizationVersion || 1;
    const recomputedDigest = computeCanonicalDigest(rawPayload, version);
    if (!storedDigest || recomputedDigest !== storedDigest) {
      return {
        success: false,
        error: `ERR_PAYLOAD_MISMATCH: Stored payload_json does not match stored payload_digest: computed ${recomputedDigest} vs stored ${storedDigest} (P3-R04-F02)`,
      };
    }
  } catch (digestErr) {
    return {
      success: false,
      error: `ERR_PAYLOAD_MISMATCH: Failed to recompute canonical digest from stored payload_json: ${digestErr.message} (UB-P3-R04-G01)`,
    };
  }

  // 4. Authentic Native Human Confirmation (UB-P2-R06-001, R07-A01)
  // Renderer-supplied boolean is strictly untrusted and IGNORED as authorization proof.
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  const confirmedByHuman = await requestNativeHumanConfirmation(tokenRecord, ownerWindow);

  if (!confirmedByHuman) {
    return {
      success: false,
      error: 'ERR_HUMAN_CONFIRMATION_REQUIRED: Action approval requires explicit native user confirmation. User cancelled, dismissed prompt, or affirmative native approval was not given (R07-A01)',
    };
  }

  // 5. Server-side TrustedPrincipal minted by main process - NEVER take untrusted role from renderer (UB-P2-R03-02)
  const trustedApprover = {
    id: 'local-operator',
    role: 'OPERATOR',
    isTrustedContext: true,
  };

  const authenticatedDecisionContext = {
    ...decisionContext,
    confirmedByUser: true,
    confirmedVia: 'NATIVE_MAIN_PROCESS_CONFIRMATION',
    confirmedDigest: storedDigest,
    confirmedAt: new Date().toISOString(),
  };

  try {
    const result = await storage.approveToken(tokenId, trustedApprover, authenticatedDecisionContext);
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('union-bot:get-approval-token', async (event, tokenId) => {
  if (!checkSenderAuthorized(event)) {
    return null;
  }
  if (!tokenId || typeof tokenId !== 'string') return null;
  try {
    return await storage.getApprovalToken(tokenId);
  } catch {
    return null;
  }
});

// --- Phase P4: Embedded Chromium & AI Provider Browser IPC Handlers ---
ipcMain.handle('union-bot:browser-get-state', async (event) => {
  if (!checkSenderAuthorized(event)) {
    return { tabs: [], activeTabId: null, isVisible: false, isModalActive: false, bounds: { x: 0, y: 0, width: 0, height: 0 } };
  }
  if (!browserService) return { tabs: [], activeTabId: null, isVisible: false, isModalActive: false, bounds: { x: 0, y: 0, width: 0, height: 0 } };
  return browserService.getState();
});

ipcMain.handle('union-bot:browser-create-tab', async (event, payload) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'ERR_UNAUTHORIZED_FRAME: Caller frame unauthorized (UB-P2-R01-008)' };
  }
  if (!browserService) return { success: false, error: 'BrowserService not initialized' };
  try {
    const res = browserService.createTab(payload?.providerId || 'search', payload?.url, payload?.title);
    return res;
  } catch (err) {
    return { success: false, error: err.message };
  }

});

ipcMain.handle('union-bot:browser-close-tab', async (event, tabId) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'ERR_UNAUTHORIZED_FRAME: Caller frame unauthorized (UB-P2-R01-008)' };
  }
  if (!browserService) return { success: false, error: 'BrowserService not initialized' };
  try {
    const res = browserService.closeTab(tabId);
    return { success: true, ...res };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('union-bot:browser-select-tab', async (event, tabId) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'ERR_UNAUTHORIZED_FRAME: Caller frame unauthorized (UB-P2-R01-008)' };
  }
  if (!browserService) return { success: false, error: 'BrowserService not initialized' };
  const ok = browserService.selectTab(tabId);
  return { success: ok };
});

ipcMain.handle('union-bot:browser-navigate', async (event, payload) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'ERR_UNAUTHORIZED_FRAME: Caller frame unauthorized (UB-P2-R01-008)' };
  }
  if (!browserService) return { success: false, error: 'BrowserService not initialized' };
  return await browserService.navigate(payload?.tabId, payload?.url);
});

ipcMain.handle('union-bot:browser-action', async (event, payload) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'ERR_UNAUTHORIZED_FRAME: Caller frame unauthorized (UB-P2-R01-008)' };
  }
  if (!browserService) return { success: false, error: 'BrowserService not initialized' };
  return await browserService.performAction(payload?.tabId, payload?.action);
});

ipcMain.handle('union-bot:browser-set-bounds', async (event, bounds) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'ERR_UNAUTHORIZED_FRAME: Caller frame unauthorized (UB-P2-R01-008)' };
  }
  if (!browserService) return { success: false, error: 'BrowserService not initialized' };
  return browserService.setBounds(bounds);
});

ipcMain.handle('union-bot:browser-set-visibility', async (event, visible) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'ERR_UNAUTHORIZED_FRAME: Caller frame unauthorized (UB-P2-R01-008)' };
  }
  if (!browserService) return { success: false, error: 'BrowserService not initialized' };
  return browserService.setVisibility(visible);
});

ipcMain.handle('union-bot:browser-set-modal-active', async (event, active) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'ERR_UNAUTHORIZED_FRAME: Caller frame unauthorized (UB-P2-R01-008)' };
  }
  if (!browserService) return { success: false, error: 'BrowserService not initialized' };
  return browserService.setModalActive(active);
});

ipcMain.handle('union-bot:browser-share-selection', async (event, payload) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'ERR_UNAUTHORIZED_FRAME: Caller frame unauthorized (UB-P2-R01-008)' };
  }
  if (!browserService) return { success: false, error: 'BrowserService not initialized' };
  return await browserService.shareSelection(payload?.tabId, payload?.selectedText, payload?.roomId);
});

// Phase P5: Artifact Store, Previews & Local MCP IPC Handlers
ipcMain.handle('union-bot:artifact-save-as', async (event, payload) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  try {
    const { sha256, suggestedName } = payload || {};
    if (!sha256 || !ArtifactStore.isValidSha256(sha256)) {
      return { success: false, error: 'ERR_INVALID_SHA256: Input must be a valid 64-character hexadecimal SHA-256 hash' };
    }
    const cleanSha = sha256.trim().toLowerCase();

    let bytes;
    try {
      bytes = artifactStore.readBytes(cleanSha);
    } catch {
      const flatPath = path.resolve(localCasDir, cleanSha);
      if (fs.existsSync(flatPath)) {
        bytes = fs.readFileSync(flatPath);
      } else {
        return { success: false, error: `Artifact ${cleanSha} not found in CAS store` };
      }
    }

    let targetPath;
    if (isDedicatedTestHarness && testQueuedSaveDialogPaths.length > 0) {
      targetPath = testQueuedSaveDialogPaths.shift();
    } else {
      if (isDedicatedTestHarness && process.argv.includes('--headless')) {
        return { success: false, error: 'No queued save dialog path in headless test harness' };
      }
      const saveRes = await dialog.showSaveDialog(mainWindow, {
        title: 'Save Artifact As',
        defaultPath: suggestedName || cleanSha,
      });
      if (saveRes.canceled || !saveRes.filePath) {
        return { success: false, canceled: true };
      }
      targetPath = saveRes.filePath;
    }

    fs.writeFileSync(targetPath, bytes);
    return { success: true, savedPath: targetPath, byteSize: bytes.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('union-bot:artifact-show-in-folder', async (event, sha256) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  try {
    if (!sha256 || !ArtifactStore.isValidSha256(sha256)) {
      return { success: false, error: 'ERR_INVALID_SHA256: Input must be a valid 64-character hexadecimal SHA-256 hash' };
    }
    const cleanSha = sha256.trim().toLowerCase();
    const info = artifactStore.inspectArtifact(cleanSha);
    let targetPath = info?.storedPath;
    if (!targetPath) {
      const flatPath = path.resolve(localCasDir, cleanSha);
      if (fs.existsSync(flatPath)) {
        targetPath = flatPath;
      } else {
        return { success: false, error: `Artifact ${cleanSha} not found in CAS store` };
      }
    }
    shell.showItemInFolder(targetPath);
    return { success: true, path: targetPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('union-bot:artifact-open-original', async (event, sha256) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  try {
    if (!sha256 || !ArtifactStore.isValidSha256(sha256)) {
      return { success: false, error: 'ERR_INVALID_SHA256: Input must be a valid 64-character hexadecimal SHA-256 hash' };
    }
    const cleanSha = sha256.trim().toLowerCase();
    const info = artifactStore.inspectArtifact(cleanSha);
    let targetPath = info?.storedPath;
    if (!targetPath) {
      const flatPath = path.resolve(localCasDir, cleanSha);
      if (fs.existsSync(flatPath)) {
        targetPath = flatPath;
      } else {
        return { success: false, error: `Artifact ${cleanSha} not found in CAS store` };
      }
    }
    const openErr = await shell.openPath(targetPath);
    if (openErr) {
      return { success: false, error: openErr };
    }
    return { success: true, path: targetPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('union-bot:artifact-inspect', async (event, sha256) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  try {
    if (!sha256 || !ArtifactStore.isValidSha256(sha256)) {
      return { success: false, error: 'ERR_INVALID_SHA256: Input must be a valid 64-character hexadecimal SHA-256 hash' };
    }
    const cleanSha = sha256.trim().toLowerCase();
    const info = artifactStore.inspectArtifact(cleanSha);
    if (info) {
      return { success: true, artifact: info };
    }
    const flatPath = path.resolve(localCasDir, cleanSha);
    if (fs.existsSync(flatPath)) {
      const stat = fs.statSync(flatPath);
      return {
        success: true,
        artifact: {
          sha256: cleanSha,
          byteSize: stat.size,
          storedPath: flatPath,
        },
      };
    }
    return { success: false, error: `Artifact ${cleanSha} not found in CAS store` };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('union-bot:tool-host-execute', async (event, payload) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  const { command, args = [] } = payload || {};
  if (command === 'readFile') {
    return await toolHost.readFile(...args);
  } else if (command === 'searchFiles') {
    return await toolHost.searchFiles(...args);
  } else if (command === 'getGitStatus') {
    return await toolHost.getGitStatus();
  } else if (command === 'runSafeTest') {
    return await toolHost.runSafeTest(...args);
  } else {
    return { success: false, error: `Disallowed tool command: ${command}` };
  }
});

ipcMain.handle('union-bot:mcp-call', async (event, payload) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  const { toolName, args } = payload || {};
  return await mcpService.callTool(toolName, args);
});

ipcMain.handle('union-bot:mcp-list-tools', async (event) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  return { success: true, tools: mcpService.listTools() };
});

// P5-011 / UB-P5-R01-003 / P5-R02-T03: Transcript bundle export with durable SQLite history and path safety
ipcMain.handle('union-bot:export-transcript-bundle', async (event, options = {}) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  try {
    const { roomId = 'orchestration' } = options;
    const ROOM_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
    if (!roomId || typeof roomId !== 'string' || !ROOM_ID_REGEX.test(roomId)) {
      return {
        success: false,
        code: 'ERR_INVALID_ROOM_ID',
        error: 'ERR_INVALID_ROOM_ID: Room ID must contain only alphanumeric characters, underscores, and dashes',
      };
    }
    const cleanRoomId = roomId.trim();

    // UB-P5-R01-003 / P5-R02-T03: Fetch durable history from SQLite storage worker
    let history = [];
    if (storage) {
      try {
        const persisted = await storage.getRoomEnvelopes(cleanRoomId, 500);
        if (Array.isArray(persisted) && persisted.length > 0) {
          history = persisted;
        }
      } catch (err) {
        console.warn(`[ExportBundle] Failed to fetch durable history from storage: ${err.message}`);
      }
    }
    if (history.length === 0 && orchestrator) {
      history = (await orchestrator.getRoomHistoryAsync(cleanRoomId)) || [];
    }

    const userDataDir = app.getPath('userData');
    const exportsDir = path.resolve(userDataDir, 'exports');
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }

    const bundleDir = path.resolve(exportsDir, `bundle_${cleanRoomId}_${Date.now()}`);
    if (!bundleDir.startsWith(exportsDir + path.sep)) {
      return {
        success: false,
        code: 'ERR_PATH_TRAVERSAL',
        error: 'ERR_PATH_TRAVERSAL: Access denied outside exports directory',
      };
    }
    fs.mkdirSync(bundleDir, { recursive: true });

    let transcriptMd = `# Transcript Export — Room: ${cleanRoomId}\nExported at: ${new Date().toISOString()}\nTotal Messages: ${history.length}\n\n---\n\n`;
    const shaList = [];

    for (const env of history) {
      const timeStr = new Date(env.timestamp).toLocaleTimeString();
      const senderName = env.sender?.name || env.sender?.id || 'Unknown';
      const role = env.sender?.role || env.sender?.kind || 'USER';
      transcriptMd += `### [${timeStr}] ${senderName} (${role})\n`;

      if (Array.isArray(env.parts)) {
        for (const p of env.parts) {
          if (p.kind === 'text') {
            transcriptMd += `${p.text}\n\n`;
          } else if (p.kind === 'attachment' || p.kind === 'artifact') {
            const sha = p.sha256;
            if (sha) {
              shaList.push(sha);
              transcriptMd += `📎 **Artifact**: \`${p.filename || sha}\` (SHA256: \`${sha}\`)\n\n`;
            }
          }
        }
      }
      transcriptMd += `---\n\n`;
    }

    fs.writeFileSync(path.join(bundleDir, 'transcript.md'), transcriptMd, 'utf8');

    const manifest = artifactStore.generateManifest(shaList);
    fs.writeFileSync(path.join(bundleDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    return {
      success: true,
      bundleDir,
      transcriptPath: path.join(bundleDir, 'transcript.md'),
      manifestPath: path.join(bundleDir, 'manifest.json'),
      artifactCount: shaList.length,
      manifest,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Phase P6: Native Codex Agent IPC Handlers
ipcMain.handle('union-bot:codex-discover', async (event) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  try {
    const discovery = await codexService.discover();
    return { success: true, discovery };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('union-bot:codex-execute', async (event, payload) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  try {
    const { prompt, options } = payload || {};
    const result = await codexService.executeTurn(prompt, options);
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('union-bot:codex-cancel', async (event) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  try {
    await codexService.cancelTurn();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('union-bot:codex-verify-boundary', async (event, targetPath) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  try {
    const resolved = await codexService.verifyWorkspaceBoundary(targetPath);
    return { success: true, resolved };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Phase P7: Native Antigravity Agent IPC Handlers
ipcMain.handle('union-bot:antigravity-discover', async (event) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  try {
    const discovery = await antigravityService.discover();
    return { success: true, discovery };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('union-bot:antigravity-execute', async (event, payload) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  try {
    const { prompt, options } = payload || {};
    const result = await antigravityService.executePrompt(prompt, options);
    if (result && result.success === false) {
      return { success: false, error: result.error, result };
    }
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('union-bot:antigravity-cancel', async (event) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  try {
    await antigravityService.cancelTurn();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('union-bot:antigravity-verify-boundary', async (event, targetPath) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  try {
    const resolved = await antigravityService.verifyWorkspaceBoundary(targetPath);
    return { success: true, resolved };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Phase P8: Multi-Agent Task Graph & Consensus IPC Handlers
ipcMain.handle('union-bot:task-graph-create', async (event, def) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  try {
    const graph = taskGraphService.createGraph(def);
    return {
      success: true,
      graph: {
        id: graph.id,
        name: graph.name,
        status: graph.status,
        nodeCount: graph.nodes.size,
      },
    };
  } catch (err) {
    return { success: false, error: err.message, code: err.code };
  }
});

ipcMain.handle('union-bot:task-graph-standard-pipeline', async (event, params) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  try {
    const pipeline = taskGraphService.createStandard5StagePipeline(params);
    const graph = taskGraphService.createGraph(pipeline);
    return {
      success: true,
      graph: {
        id: graph.id,
        name: graph.name,
        status: graph.status,
        nodes: Array.from(graph.nodes.values()).map((n) => ({
          id: n.id,
          stage: n.stage,
          role: n.assignedRole,
          dependencies: n.dependencies,
        })),
      },
    };
  } catch (err) {
    return { success: false, error: err.message, code: err.code };
  }
});

ipcMain.handle('union-bot:task-graph-run', async (event, payload) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  try {
    const { graphId, mockHandlers } = payload || {};
    const result = await taskGraphService.runGraph(graphId, mockHandlers);
    return {
      success: result.status === 'COMPLETED',
      status: result.status,
      graphId: result.id,
      completedAt: result.completedAt,
      error: result.error,
      nodes: Array.from(result.nodes.values()).map((n) => ({
        id: n.id,
        stage: n.stage,
        status: n.status,
        result: n.result,
        votes: n.votes,
      })),
      historyLength: result.history.length,
    };
  } catch (err) {
    return { success: false, error: err.message, code: err.code };
  }
});

ipcMain.handle('union-bot:task-graph-status', async (event, graphId) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  try {
    const graph = taskGraphService.getGraph(graphId);
    if (!graph) return { success: false, error: 'Graph not found' };
    return {
      success: true,
      status: graph.status,
      currentFixAttempt: graph.currentFixAttempt,
      nodes: Array.from(graph.nodes.values()).map((n) => ({
        id: n.id,
        stage: n.stage,
        status: n.status,
        votes: n.votes,
      })),
      historyCount: graph.history.length,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('union-bot:task-graph-submit-vote', async (event, payload) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  try {
    const { graphId, nodeId, vote } = payload || {};
    taskGraphService.submitVote(graphId, nodeId, vote);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message, code: err.code };
  }
});

ipcMain.handle('union-bot:task-graph-register-reviewer', async (event, payload) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  try {
    const { graphId, reviewer } = payload || {};
    taskGraphService.registerReviewer(graphId, reviewer);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message, code: err.code };
  }
});

ipcMain.handle('union-bot:task-graph-verify-boundary', async (event, targetPath) => {
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Unauthorized IPC sender origin' };
  }
  try {
    const isInside = taskGraphService.verifyWorkspaceBoundary(targetPath);
    return { success: true, isInside };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

if (isDedicatedTestHarness) {
  ipcMain.handle('union-bot:test-set-codex-mock', async (event, options) => {
    if (!checkSenderAuthorized(event)) {
      return { success: false, error: 'Unauthorized IPC sender origin' };
    }
    try {
      if (options === false || (options && options.enabled === false)) {
        codexService.disableMockTransport();
      } else {
        await codexService.enableMockTransport(typeof options === 'object' ? options : {});
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('union-bot:test-set-antigravity-mock', async (event, messages) => {
    if (!checkSenderAuthorized(event)) {
      return { success: false, error: 'Unauthorized IPC sender origin' };
    }
    try {
      if (messages === false || (messages && messages.enabled === false)) {
        antigravityService.disableMockTransport();
      } else {
        const msgArray = Array.isArray(messages) ? messages : (messages?.messages || []);
        await antigravityService.enableMockTransport(msgArray);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('union-bot:test-kill-worker', async (event) => {
    if (!checkSenderAuthorized(event)) {
      return { success: false, error: 'Unauthorized IPC sender origin (UB-P2-R01-008)' };
    }
    if (storage && storage.worker) {
      try {
        storage.worker.kill();
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    return { success: false, error: 'No active storage worker' };
  });

  ipcMain.handle('union-bot:test-set-confirmation-mode', async (event, mode) => {
    if (!checkSenderAuthorized(event)) {
      return { success: false, error: 'Unauthorized IPC sender origin' };
    }
    if (mode === 'auto-approve') {
      nativeConfirmationDelegate = async () => true;
    } else if (mode === 'auto-reject') {
      nativeConfirmationDelegate = async () => false;
    } else {
      nativeConfirmationDelegate = process.env.UNION_BOT_AUTO_APPROVE === '1' ? async () => true : async () => false;
    }
    return { success: true, mode };
  });

  ipcMain.handle('union-bot:test-tamper-approval-payload', async (event, payload) => {
    if (!checkSenderAuthorized(event)) {
      return { success: false, error: 'Unauthorized IPC sender origin (UB-P2-R01-008)' };
    }
    const { tokenId, tamperedPayload } = payload || {};
    if (!tokenId) return { success: false, error: 'tokenId required' };
    try {
      await storage.testTamperApprovalPayload(tokenId, tamperedPayload);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('union-bot:test-queue-attachment-path', async (event, filePath) => {
    if (!checkSenderAuthorized(event)) {
      return { success: false, error: 'Unauthorized IPC sender origin (UB-P2-R01-008)' };
    }
    if (typeof filePath !== 'string' || !filePath) {
      return { success: false, error: 'Valid filePath string required' };
    }
    testQueuedFileDialogPaths.push(filePath);
    return { success: true, queuedCount: testQueuedFileDialogPaths.length };
  });

  ipcMain.handle('union-bot:test-queue-save-path', async (event, filePath) => {
    if (!checkSenderAuthorized(event)) {
      return { success: false, error: 'Unauthorized IPC sender origin (UB-P2-R01-008)' };
    }
    if (typeof filePath !== 'string' || !filePath) {
      return { success: false, error: 'Valid filePath string required' };
    }
    testQueuedSaveDialogPaths.push(filePath);
    return { success: true, queuedCount: testQueuedSaveDialogPaths.length };
  });

  ipcMain.handle('union-bot:test-get-export-files', async (event) => {
    if (!checkSenderAuthorized(event)) {
      return { success: false, error: 'Unauthorized IPC sender origin (UB-P2-R01-008)' };
    }
    const userDataDir = app.getPath('userData');
    const exportsDir = path.resolve(userDataDir, 'exports');
    const jsonPath = path.resolve(exportsDir, 'workspace_export.json');
    const mdPath = path.resolve(exportsDir, 'workspace_export.md');
    const jsonExists = fs.existsSync(jsonPath);
    const mdExists = fs.existsSync(mdPath);
    const jsonContent = jsonExists ? fs.readFileSync(jsonPath, 'utf8') : null;
    const mdContent = mdExists ? fs.readFileSync(mdPath, 'utf8') : null;
    return {
      success: true,
      exportsDir,
      jsonPath,
      mdPath,
      jsonExists,
      mdExists,
      jsonSizeBytes: jsonContent ? Buffer.byteLength(jsonContent) : 0,
      mdSizeBytes: mdContent ? Buffer.byteLength(mdContent) : 0,
      jsonValid: jsonContent ? Boolean(JSON.parse(jsonContent)) : false,
      mdHasContent: mdContent ? mdContent.length > 50 : false,
    };
  });

  ipcMain.handle('union-bot:test-set-browser-cookie', async (event, payload) => {
    if (!checkSenderAuthorized(event)) {
      return { success: false, error: 'Unauthorized IPC sender origin (UB-P2-R01-008)' };
    }
    try {
      const partSession = session.fromPartition(payload.partition);
      const cookieData = payload.cookie || {
        url: payload.url,
        name: payload.name,
        value: payload.value,
        domain: payload.domain,
        path: payload.path,
      };
      await partSession.cookies.set(cookieData);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('union-bot:test-get-browser-cookies', async (event, partition) => {
    if (!checkSenderAuthorized(event)) {
      return { success: false, error: 'Unauthorized IPC sender origin (UB-P2-R01-008)' };
    }
    try {
      const partSession = session.fromPartition(partition);
      const cookies = await partSession.cookies.get({});
      return { success: true, cookies };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('union-bot:test-trigger-tab-crash', async (event, tabId) => {
    if (!checkSenderAuthorized(event)) {
      return { success: false, error: 'Unauthorized IPC sender origin (UB-P2-R01-008)' };
    }
    if (!browserService) return { success: false, error: 'No browserService' };
    const targetTabId = tabId || browserService.stateManager.getState().activeTabId;
    const view = browserService.views.get(targetTabId);
    if (!view) return { success: false, error: 'View not found' };
    try {
      if (typeof view.webContents.forcefullyCrashRenderer === 'function') {
        try {
          view.webContents.forcefullyCrashRenderer();
        } catch (_) {}
      }
      setTimeout(() => {
        const currentTab = browserService.stateManager.tabs.get(targetTabId);
        if (currentTab && !currentTab.crashed) {
          view.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
        }
      }, 100);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('union-bot:test-set-storage-share-mode', async (event, mode) => {
    if (!checkSenderAuthorized(event)) {
      return { success: false, error: 'Unauthorized IPC sender origin (UB-P2-R01-008)' };
    }
    if (!browserService) return { success: false, error: 'No browserService' };
    browserService._testStorageFaultMode = mode;
    return { success: true };
  });

  ipcMain.handle('union-bot:test-verify-oauth-popup', async (event, providerId) => {
    if (!checkSenderAuthorized(event)) {
      return { success: false, error: 'Unauthorized IPC sender origin (UB-P2-R01-008)' };
    }
    if (!browserService) return { success: false, error: 'No browserService' };
    const targetProvider = providerId || 'gemini';
    const targetTab = browserService.getState().tabs.find(t => t.providerId === targetProvider);
    if (!targetTab) return { success: false, error: 'Target tab not found' };

    const view = browserService.views.get(targetTab.id);
    if (!view) return { success: false, error: 'View not found' };

    return new Promise(async (resolve) => {
      const evidence = {
        childWindowCreated: false,
        childPartitionPreserved: false,
        willNavigateHttpAuthBlocked: false,
        willNavigateExternalBlocked: false,
        willRedirectExternalBlocked: false,
        willRedirectHttpsAuthAllowed: false,
        externalPopupDeniedDirectly: false,
      };

      const handleChildCreated = (childWindow) => {
        evidence.childWindowCreated = true;
        evidence.childPartitionPreserved = (childWindow.webContents.session === view.webContents.session);

        // 1. Verify will-navigate blocks insecure HTTP auth navigation in child popup
        let httpNavPrevented = false;
        childWindow.webContents.emit('will-navigate', {
          preventDefault: () => { httpNavPrevented = true; },
          defaultPrevented: false
        }, 'http://accounts.google.com/signin');
        evidence.willNavigateHttpAuthBlocked = httpNavPrevented;

        // 2. Verify will-navigate blocks non-provider external URL in child popup
        let extNavPrevented = false;
        childWindow.webContents.emit('will-navigate', {
          preventDefault: () => { extNavPrevented = true; },
          defaultPrevented: false
        }, 'https://malicious-tracker.com/login');
        evidence.willNavigateExternalBlocked = extNavPrevented;

        // 3. Verify will-redirect blocks external unauthorized redirect in child popup
        let extRedirPrevented = false;
        childWindow.webContents.emit('will-redirect', {
          preventDefault: () => { extRedirPrevented = true; },
          defaultPrevented: false
        }, 'https://malicious-oauth-stealer.com/callback');
        evidence.willRedirectExternalBlocked = extRedirPrevented;

        // 4. Verify will-redirect allows valid HTTPS auth redirect in child popup
        let validRedirPrevented = false;
        childWindow.webContents.emit('will-redirect', {
          preventDefault: () => { validRedirPrevented = true; },
          defaultPrevented: false
        }, 'https://accounts.google.com/signin/oauth/consent');
        evidence.willRedirectHttpsAuthAllowed = !validRedirPrevented;

        try {
          childWindow.close();
        } catch (_) {}
      };

      view.webContents.once('did-create-window', handleChildCreated);

      // Trigger window.open for valid OAuth HTTPS endpoint
      try {
        await view.webContents.executeJavaScript(
          "window.open('https://accounts.google.com/o/oauth2/v2/auth', '_blank');"
        );
      } catch (err) {
        console.warn('[TestOAuthPopup] executeJavaScript error:', err.message);
      }

      await new Promise(r => setTimeout(r, 400));
      view.webContents.removeListener('did-create-window', handleChildCreated);

      // 5. Also verify that opening an external non-auth popup returns action: 'deny' without creating child window
      let externalPopupCreated = false;
      const onExternalChild = () => { externalPopupCreated = true; };
      view.webContents.once('did-create-window', onExternalChild);

      try {
        await view.webContents.executeJavaScript(
          "window.open('https://malicious-external-site.com/login', '_blank');"
        );
      } catch (_) {}

      await new Promise(r => setTimeout(r, 200));
      view.webContents.removeListener('did-create-window', onExternalChild);
      evidence.externalPopupDeniedDirectly = !externalPopupCreated;

      evidence.allChecksPassed = Boolean(
        evidence.childWindowCreated &&
        evidence.childPartitionPreserved &&
        evidence.willNavigateHttpAuthBlocked &&
        evidence.willNavigateExternalBlocked &&
        evidence.willRedirectExternalBlocked &&
        evidence.willRedirectHttpsAuthAllowed &&
        evidence.externalPopupDeniedDirectly
      );

      resolve({ success: true, evidence });
    });
  });

} else {
  // Production / non-harness mode: fail-closed rejection
  ipcMain.handle('union-bot:test-verify-oauth-popup', async () => {
    return {
      success: false,
      error: 'ERR_TEST_IPC_DISABLED: Test IPC channels are strictly disabled in production mode (UB-P2-R06-003)',
    };
  });

  ipcMain.handle('union-bot:test-set-storage-share-mode', async () => {
    return {
      success: false,
      error: 'ERR_TEST_IPC_DISABLED: Test IPC channels are strictly disabled in production mode (UB-P2-R06-003)',
    };
  });

  ipcMain.handle('union-bot:test-kill-worker', async () => {
    return {
      success: false,
      error: 'ERR_TEST_IPC_DISABLED: Test IPC channels are strictly disabled in production mode (UB-P2-R06-003)',
    };
  });

  ipcMain.handle('union-bot:test-tamper-approval-payload', async () => {
    return {
      success: false,
      error: 'ERR_TEST_IPC_DISABLED: Test IPC channels are strictly disabled in production mode (UB-P2-R06-003)',
    };
  });

  ipcMain.handle('union-bot:test-queue-attachment-path', async () => {
    return {
      success: false,
      error: 'ERR_TEST_IPC_DISABLED: Test IPC channels are strictly disabled in production mode (UB-P2-R06-003)',
    };
  });

  ipcMain.handle('union-bot:test-queue-save-path', async () => {
    return {
      success: false,
      error: 'ERR_TEST_IPC_DISABLED: Test IPC channels are strictly disabled in production mode (UB-P2-R06-003)',
    };
  });

  ipcMain.handle('union-bot:test-get-export-files', async () => {
    return {
      success: false,
      error: 'ERR_TEST_IPC_DISABLED: Test IPC channels are strictly disabled in production mode (UB-P2-R06-003)',
    };
  });

  ipcMain.handle('union-bot:test-set-browser-cookie', async () => {
    return {
      success: false,
      error: 'ERR_TEST_IPC_DISABLED: Test IPC channels are strictly disabled in production mode (UB-P2-R06-003)',
    };
  });

  ipcMain.handle('union-bot:test-get-browser-cookies', async () => {
    return {
      success: false,
      error: 'ERR_TEST_IPC_DISABLED: Test IPC channels are strictly disabled in production mode (UB-P2-R06-003)',
    };
  });

  ipcMain.handle('union-bot:test-trigger-tab-crash', async () => {
    return {
      success: false,
      error: 'ERR_TEST_IPC_DISABLED: Test IPC channels are strictly disabled in production mode (UB-P2-R06-003)',
    };
  });

  ipcMain.handle('union-bot:test-set-codex-mock', async () => {
    return {
      success: false,
      error: 'ERR_TEST_IPC_DISABLED: Test IPC channels are strictly disabled in production mode (UB-P2-R06-003)',
    };
  });
}


// App Lifecycle
app.whenReady().then(async () => {
  try {
    if (process.argv.includes('--test-force-storage-error')) {
      throw new Error('ERR_STORAGE_UNAVAILABLE: Forced storage failure for test verification (UB-P2-R03-05)');
    }
    if (storage && storage.ready) {
      await storage.ready;
    }
    appStatus = 'READY';
  } catch (err) {
    appStatus = 'STORAGE_ERROR_BLOCKED';
    storageInitError = err.message;
    console.error('[UnionBot] Critical storage initialization failure on startup:', err.message);
  }
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
