/**
 * @file desktop-p10-uat.test.js
 * @description Windows Real Electron E2E UAT Test Suite for Union Bot Phase P10 (UI Task Execution & Native Durability).
 *
 * Verifies real end-to-end UAT criteria from UI:
 * 1. Task Creation with selected role preserved (IMPLEMENTER, not CORE).
 * 2. Native task dispatch via UI Preload API (union-bot:task-execute).
 * 3. Execution of "Tạo file scratch/hello.txt chứa nội dung HELLO UNION BOT":
 *    - Scratch file created with exact bytes and SHA-256 CAS digest.
 *    - Authentic native Codex verification (syntax, boundary, zero-cost, digest).
 * 4. Anti-double-dispatch protection (Start cannot be triggered concurrently or redundantly).
 * 5. Durability & SQLite WAL reload persistence.
 * 6. Path traversal containment defense (fail-closed on boundary escape).
 * 7. Arithmetic local task execution (e.g., 2 + 3 = 5).
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

function runElectronProcess(args, { timeoutMs = 65000, env = {} } = {}) {
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
      if (str.includes('[P10-UAT] ALL_P10_UAT_CHECKS_PASSED')) {
        setTimeout(() => {
          clearTimeout(timer);
          try {
            if (process.platform === 'win32') {
              spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)]);
            } else {
              child.kill('SIGKILL');
            }
          } catch {}
          resolve({ code: 0, signal: null, stdout, stderr, child });
        }, 1000);
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

describe('Union Bot Phase P10 Gate: Windows Real Electron UI UAT Suite', () => {
  const testUserDataDir = path.join(os.tmpdir(), `union_bot_p10_uat_${Date.now()}`);

  it('P10-UAT: Native Task Execution, Scratch Artifact Creation, Codex Verification & Anti-Double-Dispatch (PASS)', async () => {
    fs.mkdirSync(testUserDataDir, { recursive: true });

    const { code, stdout, stderr } = await runElectronProcess([
      '--headless',
      '--p10-uat',
      `--test-user-data=${testUserDataDir}`,
    ], {
      env: {
        NODE_ENV: 'test',
        UNION_BOT_E2E_HARNESS: '1',
      },
      timeoutMs: 65000,
    });

    assert.equal(code, 0, `Electron process should exit with code 0. Stderr: ${stderr}\nStdout: ${stdout}`);
    assert.match(stdout, /\[P10-UAT\] ALL_P10_UAT_CHECKS_PASSED/);

    const evidencePath = path.resolve(repoRoot, 'reports/capability-evidence/ELECTRON_P10_UAT_EVIDENCE.json');
    assert.ok(fs.existsSync(evidencePath), 'P10 UAT evidence JSON must be written');
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    assert.equal(evidence.allPassed, true);

    // Assert individual UAT capabilities
    assert.equal(evidence.results.hasUnionBotAPI, true, 'UAT: Preload unionBotAPI must expose executeTask');
    assert.equal(evidence.results.taskCreated, true, 'UAT: Task must be created in SQLite');
    assert.equal(evidence.results.rolePreservedAsImplementer, true, 'UAT: Selected role must be preserved as IMPLEMENTER (not CORE)');
    assert.equal(evidence.results.execSuccess, true, 'UAT: Task execution must succeed');
    assert.equal(evidence.results.execStatusCompleted, true, 'UAT: Task execution must reach COMPLETED status');
    assert.equal(evidence.results.isNativeAgent, true, 'UAT: Native execution must route to authentic agent service');
    assert.equal(evidence.results.reactiveUpdateReceived, true, 'UAT: Renderer must receive reactive onTaskUpdated event');
    assert.equal(evidence.results.doubleDispatchBlocked, true, 'UAT: Start repeated invocation must be blocked');
    assert.equal(evidence.results.concurrentDoubleStartBlocked, true, 'UAT: Promise.all simultaneous double Start must be blocked fail-closed');
    assert.equal(evidence.results.cancelRequestedTransition, true, 'UAT: Cancel must transition through cancel_requested state');
    assert.equal(evidence.results.cancelFinalizedAsCancelled, true, 'UAT: Cancelled task must settle into cancelled status');
    assert.equal(evidence.results.persistedCompleted, true, 'UAT: Task must remain completed across listTasks query');
    assert.equal(evidence.results.traversalDenied, true, 'UAT: Path traversal must be blocked fail-closed');
    assert.equal(evidence.results.localUtilityVerified, true, 'UAT: Local utility tasks must be honestly labeled LOCAL_UTILITY (not native)');
    assert.equal(evidence.results.diskFileCreated, true, 'UAT: scratch/hello.txt must be created on disk');
    assert.equal(evidence.results.diskContentMatches, true, 'UAT: scratch/hello.txt content must match exact bytes');
    assert.equal(evidence.results.diskByteSizeMatches, true, 'UAT: scratch/hello.txt must be 15 bytes');
    assert.equal(evidence.results.diskDigestMatches, true, 'UAT: scratch/hello.txt SHA-256 digest must match');
    assert.equal(evidence.results.verifiedByCodex, true, 'UAT: Output must be verified by Codex native service');
    assert.equal(evidence.results.codexZeroCostConfirmed, true, 'UAT: Codex must confirm zero cost');
    assert.equal(evidence.results.codexBoundaryVerified, true, 'UAT: Codex must confirm boundary containment');
    assert.equal(evidence.results.codexDigestVerified, true, 'UAT: Codex must confirm artifact digest');
    assert.equal(evidence.results.escapedFileBlocked, true, 'UAT: Escaped file must not exist on disk');

    // Clean up test directory
    try {
      fs.rmSync(testUserDataDir, { recursive: true, force: true });
    } catch {}
  });
});
