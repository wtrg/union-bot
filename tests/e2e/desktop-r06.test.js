/**
 * @file desktop-r06.test.js
 * @description Windows Real Electron E2E Test Suite for Union Bot Phase P2 Round R06.
 *
 * Strictly tests in real Electron subprocess:
 * - R06-B01: Multi-action envelope with fake token on action 1 and valid token on action 2 rejected fail-closed, valid token untouched.
 * - R06-B03: Human consent requirement: approveToken() without confirmedByUser: true is rejected with ERR_HUMAN_CONFIRMATION_REQUIRED.
 * - R06-B06: Test IPC isolation in real Electron: testKillWorker is permitted in test mode, and blocked fail-closed with ERR_TEST_IPC_DISABLED in production mode.
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

function runElectronProcess(args, { timeoutMs = 45000, onStdout, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    assert.ok(electronPath, 'Electron executable must be found');
    const childEnv = {
      ...process.env,
      UNION_BOT_E2E_HARNESS: '1',
      NODE_ENV: 'test',
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
      if (str.includes('ALL_R06_E2E_CHECKS_PASSED')) {
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

describe('Union Bot Phase P2 Gate R06: Windows Real Electron E2E Suite', () => {
  it('R06 Real Electron E2E: Validates R06-B01, R06-B03, and R06-B06 in live Electron Chromium instance', async () => {
    const tempUserData = path.join(os.tmpdir(), `ub-test-r06-e2e-${Date.now()}`);

    const res = await runElectronProcess([
      '--headless',
      `--test-user-data=${tempUserData}`,
      '--r06-e2e',
    ]);

    console.log('[R06 Test Runner] Output:\n', res.stdout);
    if (res.stderr) console.error('[R06 Test Runner] Stderr:\n', res.stderr);

    assert.equal(res.code, 0, `Electron process must exit with code 0. Stderr: ${res.stderr}`);
    assert.ok(res.stdout.includes('ALL_R06_E2E_CHECKS_PASSED'), 'Output must confirm ALL_R06_E2E_CHECKS_PASSED');

    // Read capability evidence
    const evidencePath = path.resolve(repoRoot, 'reports/capability-evidence/ELECTRON_R06_E2E_EVIDENCE.json');
    assert.ok(fs.existsSync(evidencePath), 'Evidence file must exist');
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf-8'));
    assert.equal(evidence.result, 'PASS', 'Evidence result must be PASS');
    assert.equal(evidence.vectors['R06-B01'].multiActionDenied, true);
    assert.equal(evidence.vectors['R06-B01'].validTokenNotConsumed, true);
    assert.equal(evidence.vectors['R06-B03'].unconfirmedDenied, true);
    assert.equal(evidence.vectors['R06-B03'].confirmedApproved, true);
    assert.equal(evidence.vectors['R06-B06'].testModeAllowed, true);

    try {
      fs.rmSync(tempUserData, { recursive: true, force: true });
    } catch {}
  });
});
