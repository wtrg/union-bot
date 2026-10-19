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
const { isAuthorizedSenderFrame } = require('./auth-check.cjs');
const { extractActionSemanticInput, computeCanonicalDigest } = require('./canonical-json.cjs');

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
let appStatus = 'STARTING'; // 'STARTING' | 'READY' | 'STORAGE_ERROR_BLOCKED'
let storageInitError = null;
const uiDistPath = path.resolve(__dirname, '../../workspace-ui/dist/index.html');
const allowedUiFileUrl = pathToFileURL(uiDistPath).href;
const costGuard = new CostGuard();

const userDataPath = app.getPath('userData');
const dbFilePath = path.join(userDataPath, 'union_bot.db');
const storage = new StorageServiceClient(dbFilePath);
const orchestrator = new Orchestrator({ costGuard, storage });

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
              payloadDigest: digest,
              origin: 'desktop_ui',
              roomId: 'orchestration',
              workspaceId: 'ws_h05',
              recipient: 'agent_coder',
            });
            const approveRes = await window.unionBotAPI.approveToken('tok_h05_kill');
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
              payloadDigest: previewDigest,
              origin: 'desktop_ui',
              roomId: 'orchestration',
              workspaceId: 'ws_h07',
              recipient: recipientA.id,
            });

            // 4. Main process validates approver and issues approval decision
            await window.unionBotAPI.approveToken(tokenIdA);
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
              payloadDigest: digestB,
              origin: 'desktop_ui',
              roomId: 'orchestration',
              workspaceId: 'ws_h07',
              recipient: 'agent_writer',
            });
            await window.unionBotAPI.approveToken(tokenIdB);

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

            const approveBlocked = await window.unionBotAPI.approveToken('tok_blocked');

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

ipcMain.handle('union-bot:approve-token', async (event, { tokenId, decisionContext } = {}) => {
  if (appStatus !== 'READY') {
    return { success: false, error: `ERR_STORAGE_UNAVAILABLE: Desktop storage is not ready (${appStatus}) (UB-P2-R03-05)` };
  }
  if (!checkSenderAuthorized(event)) {
    return { success: false, error: 'Security violation: Unauthorized IPC sender origin or missing frame (UB-P2-R01-008)' };
  }
  if (!tokenId || typeof tokenId !== 'string') {
    return { success: false, error: 'ERR_UNTRUSTED_ACTION: tokenId is required' };
  }

  // Server-side TrustedPrincipal minted by main process - NEVER take untrusted role from renderer (UB-P2-R03-02)
  const trustedApprover = {
    id: 'local-operator',
    role: 'OPERATOR',
    isTrustedContext: true,
  };

  try {
    const result = await storage.approveToken(tokenId, trustedApprover, decisionContext);
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
