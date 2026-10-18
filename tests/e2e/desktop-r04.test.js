/**
 * @file desktop-r04.test.js
 * @description Windows Real E2E Test Suite for Union Bot Phase P2 Round R04.
 * Covers:
 * - R04-G07: Invalid worker/incompatible DB at real Electron startup -> recovery screen, mutations blocked
 * - R04-G08: Real Electron kill/main relaunch -> durable SQLite storage, kill recovery, duplicate replay, changed payload rejection
 * - R04-G11: Actual Electron IPC frame boundary -> trusted main frame permitted, second window & unauthorized frames rejected
 * (UB-P2-R03-05, UB-P2-R03-06, UB-P2-R01-008)
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

function runElectronProcess(args, { timeoutMs = 25000, onStdout, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    assert.ok(electronPath, 'Electron executable must be found');
    const childEnv = { ...process.env, ...env };
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Union Bot P2-R04 Desktop Windows E2E Suite', () => {
  it('R04-G07: Real Electron startup with storage failure shows recovery screen and strictly blocks mutation IPC', async () => {
    const tempUserData = path.join(os.tmpdir(), `ub-test-g07-${Date.now()}`);
    fs.mkdirSync(tempUserData, { recursive: true });

    try {
      const res = await runElectronProcess([
        '--headless',
        '--test-force-storage-error',
        '--smoke-error-test',
        `--test-user-data=${tempUserData}`,
      ], { timeoutMs: 25000 });

      assert.equal(res.code, 0, `Electron smoke error test failed with code ${res.code}.\nStdout:\n${res.stdout}\nStderr:\n${res.stderr}`);
      assert.match(res.stdout, /\[SmokeErrorTest\] PASS!/);

      const evidencePath = path.resolve(repoRoot, 'reports/capability-evidence/ELECTRON_STORAGE_ERROR_SMOKE_EVIDENCE.json');
      assert.ok(fs.existsSync(evidencePath), 'ELECTRON_STORAGE_ERROR_SMOKE_EVIDENCE.json must exist');
      const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf-8'));
      assert.equal(evidence.result, 'PASS');
      assert.equal(evidence.appStatus, 'STORAGE_ERROR_BLOCKED');
      assert.equal(evidence.dispatchBlocked, true);
      assert.equal(evidence.approveBlocked, true);
    } finally {
      try { fs.rmSync(tempUserData, { recursive: true, force: true }); } catch {}
    }
  });

  it('R04-G08: Real Electron kill/relaunch maintains exactly-once durable state, replay ACK, and changed rejection', async () => {
    const tempUserData = path.join(os.tmpdir(), `ub-test-g08-${Date.now()}`);
    fs.mkdirSync(tempUserData, { recursive: true });

    try {
      // Stage 1: Launch Electron, send envelope, await durable ACK, hard-kill Electron main process
      let stage1Killed = false;
      const stage1Promise = runElectronProcess([
        '--headless',
        `--test-user-data=${tempUserData}`,
        '--r04-e2e-stage=1',
      ], {
        timeoutMs: 25000,
        onStdout: (chunk, child) => {
          if (chunk.includes('[R04-G08] STAGE1_DURABLE_ACK_RECEIVED') && !stage1Killed) {
            stage1Killed = true;
            // Immediate abrupt hard kill of the real Electron main process
            if (process.platform === 'win32') {
              spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)]);
            } else {
              child.kill('SIGKILL');
            }
          }
        },
      });

      const stage1Res = await stage1Promise;
      assert.ok(stage1Killed, 'Stage 1 should have received durable ACK before being hard-killed');

      // Verify Stage 1 marker file on disk in temp userData
      const ackMarkerPath = path.join(tempUserData, 'e2e_stage1_ack.json');
      assert.ok(fs.existsSync(ackMarkerPath), 'Stage 1 ack marker must be durable on disk');

      // Wait 500ms for Windows OS to release all process handles cleanly
      await sleep(500);

      // Stage 2: Relaunch Electron with the exact same userData directory
      const stage2Res = await runElectronProcess([
        '--headless',
        `--test-user-data=${tempUserData}`,
        '--r04-e2e-stage=2',
      ], { timeoutMs: 25000 });

      assert.equal(stage2Res.code, 0, `Stage 2 relaunch failed with code ${stage2Res.code}.\nStdout:\n${stage2Res.stdout}\nStderr:\n${stage2Res.stderr}`);
      assert.match(stage2Res.stdout, /\[R04-G08\] STAGE2_VERIFICATION_PASSED/);

      // Verify evidence JSON
      const evidencePath = path.resolve(repoRoot, 'reports/capability-evidence/ELECTRON_KILL_RESTART_EVIDENCE.json');
      assert.ok(fs.existsSync(evidencePath), 'ELECTRON_KILL_RESTART_EVIDENCE.json must exist');
      const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf-8'));
      assert.equal(evidence.result, 'PASS');
      assert.equal(evidence.historyCountBefore, 1);
      assert.equal(evidence.historyCountAfter, 1);
      assert.equal(evidence.dupResult?.deduplicated, true);
      assert.equal(evidence.changedResult?.success, false);
      assert.match(evidence.changedResult?.error, /ERR_PAYLOAD_MISMATCH/);
    } finally {
      try { fs.rmSync(tempUserData, { recursive: true, force: true }); } catch {}
    }
  });

  it('R04-G11: Actual Electron IPC frame boundary permits only trusted main frame and strictly denies rogue windows/frames', async () => {
    const tempUserData = path.join(os.tmpdir(), `ub-test-g11-${Date.now()}`);
    fs.mkdirSync(tempUserData, { recursive: true });

    try {
      const res = await runElectronProcess([
        '--headless',
        '--r04-e2e-frame-test',
        `--test-user-data=${tempUserData}`,
      ], { timeoutMs: 25000 });

      assert.equal(res.code, 0, `Frame boundary test failed with code ${res.code}.\nStdout:\n${res.stdout}\nStderr:\n${res.stderr}`);
      assert.match(res.stdout, /\[R04-G11\] FRAME_BOUNDARY_VERIFICATION_PASSED/);

      const evidencePath = path.resolve(repoRoot, 'reports/capability-evidence/ELECTRON_FRAME_BOUNDARY_EVIDENCE.json');
      assert.ok(fs.existsSync(evidencePath), 'ELECTRON_FRAME_BOUNDARY_EVIDENCE.json must exist');
      const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf-8'));
      assert.equal(evidence.result, 'PASS');
      assert.equal(evidence.mainFrameAllowed, true);
      assert.equal(evidence.rogueBlocked, true);
      assert.equal(evidence.iframeCheckDenied, true);
      assert.equal(evidence.untrustedUrlDenied, true);
    } finally {
      try { fs.rmSync(tempUserData, { recursive: true, force: true }); } catch {}
    }
  });
});
