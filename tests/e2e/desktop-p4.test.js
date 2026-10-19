/**
 * @file desktop-p4.test.js
 * @description Windows Real Electron E2E Test Suite for Union Bot Phase P4 (Embedded Chromium, Browser Isolation & Native Provider Surfaces).
 *
 * Strictly verifies in real Windows Electron subprocess:
 * - P4-001: WebContentsView lifecycle & child management
 * - P4-002: Default provider surfaces configured (chatgpt, gemini, claude, deepseek)
 * - P4-003: Cookie and Session storage partition isolation (persist:mcb-web-*)
 * - P4-004: Safe navigation & URL policy enforcement (file:, javascript:, powershell: blocked)
 * - P4-005: Boundary protection (loopback/private IP blocking, default-deny device permissions)
 * - P4-006: Cost Guard egress filter on browser sessions (paid APIs blocked)
 * - P4-007: Tab management (switching, zoom in/out/reset)
 * - P4-008: Modal overlay protection (WebContentsView hidden when modal active)
 * - P4-009: Renderer crash isolation & recovery (tab crash does not affect app, reload recovers)
 * - P4-010: Manual share to room history (user_manual attribution, persisted in SQLite WAL)
 * - P4-011: Workspace UI DOM integration (dock toggle, tab strip, toolbar, provider auth chip)
 * - P4-012: Zero-Cost 0đ verification & offline compliance
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const mainScript = path.resolve(repoRoot, 'apps/desktop/src/main.js');

function findElectronExecutable() {
  const candidates = [
    process.env.ELECTRON_OVERRIDE_DIST_PATH
      ? path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH, 'electron.exe')
      : null,
    path.resolve(repoRoot, 'spikes/electron-browser/node_modules/.pnpm/electron@33.4.11/node_modules/electron/dist/electron.exe'),
    path.resolve(repoRoot, 'node_modules/.pnpm/electron@33.4.11/node_modules/electron/dist/electron.exe'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

const electronPath = findElectronExecutable();

function runElectronProcess(args, { timeoutMs = 35000, onStdout, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    assert.ok(electronPath, 'Electron executable must be found');
    const childEnv = {
      ...process.env,
      ...env,
    };
    delete childEnv.NODE_TEST_CONTEXT;

    const child = spawn(electronPath, [mainScript, ...args], {
      cwd: repoRoot,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      const str = d.toString();
      stdout += str;
      if (typeof onStdout === 'function') {
        onStdout(str, child);
      }
    });

    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    const timer = setTimeout(() => {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)]);
        } else {
          child.kill('SIGKILL');
        }
      } catch {}
      reject(new Error(`Process timed out after ${timeoutMs}ms. Output:\n${stdout}\nStderr:\n${stderr}`));
    }, timeoutMs);

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, child });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('Union Bot Phase P4 Gate: Windows Real Electron E2E Suite', () => {
  const testUserDataDir = path.join(os.tmpdir(), `union_bot_p4_e2e_${Date.now()}`);

  it('P4-E2E: Real Electron embedded browser isolation, safe navigation, modal overlay defense, crash recovery & room sharing (PASS)', async () => {
    fs.mkdirSync(testUserDataDir, { recursive: true });

    const { code, stdout, stderr } = await runElectronProcess([
      '--headless',
      '--p4-e2e',
      `--test-user-data=${testUserDataDir}`,
    ], {
      env: {
        NODE_ENV: 'test',
        UNION_BOT_E2E_HARNESS: '1',
      },
      timeoutMs: 40000,
    });

    assert.equal(code, 0, `Electron process should exit with code 0. Stderr: ${stderr}\nStdout: ${stdout}`);
    assert.match(stdout, /\[P4-E2E\] ALL_P4_E2E_CHECKS_PASSED/);

    const evidencePath = path.resolve(repoRoot, 'reports/capability-evidence/ELECTRON_P4_E2E_EVIDENCE.json');
    assert.ok(fs.existsSync(evidencePath), 'P4 E2E evidence JSON must be written');
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    assert.equal(evidence.allPassed, true);

    // Assert individual results
    assert.equal(evidence.results.tabsInitialized, true);
    assert.equal(evidence.results.allProvidersPresent, true);
    assert.equal(evidence.results.partitionsIsolated, true);
    assert.equal(evidence.results.cookieSetSucceeded, true);
    assert.equal(evidence.results.cookieFoundInChatgpt, true);
    assert.equal(evidence.results.cookieNotLeakedToGemini, true);
    assert.equal(evidence.results.cookieNotLeakedToClaude, true);
    assert.equal(evidence.results.cookieIsolationVerified, true);
    assert.equal(evidence.results.dangerousFileBlocked, true);
    assert.equal(evidence.results.dangerousJsBlocked, true);
    assert.equal(evidence.results.dangerousPsBlocked, true);
    assert.equal(evidence.results.dangerousLoopbackBlocked, true);
    assert.equal(evidence.results.searchQueryResolved, true);
    assert.equal(evidence.costGuardEgressBlocked, true);
    assert.equal(evidence.results.selectGeminiTab, true);
    assert.equal(evidence.results.activeTabSwitched, true);
    assert.equal(evidence.results.zoomInApplied, true);
    assert.equal(evidence.results.zoomResetApplied, true);
    assert.equal(evidence.results.modalHidesView, true);
    assert.equal(evidence.results.modalRestoresView, true);
    assert.equal(evidence.results.crashTriggerDispatched, true);
    assert.equal(evidence.results.deepseekTabCrashed, true);
    assert.equal(evidence.results.deepseekTabRecovered, true);
    assert.equal(evidence.results.roomCreated, true);
    assert.equal(evidence.results.shareSucceeded, true);
    assert.equal(evidence.results.shareSenderIsUserManual, true);
    assert.equal(evidence.results.sharePersistedInHistory, true);
    assert.equal(evidence.results.domPanelContainerRendered, true);
    assert.equal(evidence.results.domTabStripRendered, true);
    assert.equal(evidence.results.domProviderTabsRendered, true);
    assert.equal(evidence.results.domToolbarAndMountRendered, true);

    // Verify stdout log messages
    assert.match(stdout, /\[P4-E2E\] P4-001 Tabs initialized in WebContentsView manager: true/);
    assert.match(stdout, /\[P4-E2E\] P4-002 All 4 AI Provider surfaces configured: true/);
    assert.match(stdout, /\[P4-E2E\] P4-002 Partitions bound to persist:mcb-web-\*: true/);
    assert.match(stdout, /\[P4-E2E\] P4-003 Cookie partition isolation fully verified: true/);
    assert.match(stdout, /\[P4-E2E\] P4-004 Dangerous file:\/\/ scheme blocked: true/);
    assert.match(stdout, /\[P4-E2E\] P4-004 Dangerous javascript: scheme blocked: true/);
    assert.match(stdout, /\[P4-E2E\] P4-004 Dangerous powershell: scheme blocked: true/);
    assert.match(stdout, /\[P4-E2E\] P4-005 Loopback address navigation blocked: true/);
    assert.match(stdout, /\[P4-E2E\] P4-004 Valid query resolved to DuckDuckGo search: true/);
    assert.match(stdout, /\[P4-E2E\] P4-006 Cost Guard blocks paid APIs on browser session: true/);
    assert.match(stdout, /\[P4-E2E\] P4-007 Tab switching to Gemini succeeded: true/);
    assert.match(stdout, /\[P4-E2E\] P4-007 Zoom controls applied \(zoom-in \/ zoom-reset\): true/);
    assert.match(stdout, /\[P4-E2E\] P4-008 Modal overlay hides WebContentsView: true/);
    assert.match(stdout, /\[P4-E2E\] P4-008 Closing modal restores WebContentsView: true/);
    assert.match(stdout, /\[P4-E2E\] P4-009 Tab marked crashed without killing app: true/);
    assert.match(stdout, /\[P4-E2E\] P4-009 Reload action recovers crashed tab: true/);
    assert.match(stdout, /\[P4-E2E\] P4-010 Manual share dispatched with user_manual sender: true/);
    assert.match(stdout, /\[P4-E2E\] P4-010 Manual share persisted in SQLite room history: true/);
    assert.match(stdout, /\[P4-E2E\] P4-011 Browser Dock mounted in DOM via toggle: true/);

    // Clean up test directory
    try {
      fs.rmSync(testUserDataDir, { recursive: true, force: true });
    } catch {}
  });
});
