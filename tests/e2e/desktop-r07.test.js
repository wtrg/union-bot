/**
 * @file desktop-r07.test.js
 * @description Windows Real Electron E2E Test Suite for Union Bot Phase P2 Round R07.
 *
 * Strictly tests in real Electron subprocess:
 * - R07-A01: Live Human Consent & Native Confirmation Controller in Chromium:
 *   - Unconfirmed renderer approval rejected fail-closed; token remains PENDING
 *   - Dispatching envelope with PENDING token blocked
 *   - Stale/modified intent (expectedDigest mismatch) rejected; token remains PENDING
 *   - Affirmative native confirmation approves token
 *   - Dispatching envelope with APPROVED token succeeds, atomically consumes token (CONSUMED)
 *   - Consumed digest matches action digest with 100% cryptographic fidelity
 * - R07-A03: Production Security Boundary Verification (C03):
 *   - Live Electron launched with production environment asserting test mutation IPCs
 *     (testKillWorker, testSetConfirmationMode) are strictly undefined/inaccessible in renderer
 *   - Proves generic flags like --headless alone cannot enable test mutation channels
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
      if (str.includes('[R07-E2E] ALL_R07_E2E_CHECKS_PASSED')) {
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

describe('Union Bot Phase P2 Gate R07: Windows Real Electron E2E Suite', () => {
  it('R07-A01: Real Electron live human confirmation, digest matching, and atomic consumption', async () => {
    const tempUserData = path.join(os.tmpdir(), `ub-test-r07-e2e-${Date.now()}`);

    const res = await runElectronProcess(
      [
        '--headless',
        `--test-user-data=${tempUserData}`,
        '--r07-e2e',
      ],
      {
        env: {
          UNION_BOT_E2E_HARNESS: '1',
          NODE_ENV: 'test',
        },
      }
    );

    console.log('[R07 Test Runner] Output:\n', res.stdout);
    if (res.stderr) console.error('[R07 Test Runner] Stderr:\n', res.stderr);

    assert.equal(res.code, 0, `Electron process must exit with code 0. Stderr: ${res.stderr}`);
    assert.ok(res.stdout.includes('ALL_R07_E2E_CHECKS_PASSED'), 'Output must confirm ALL_R07_E2E_CHECKS_PASSED');

    // Read capability evidence
    const evidencePath = path.resolve(repoRoot, 'reports/capability-evidence/ELECTRON_R07_E2E_EVIDENCE.json');
    assert.ok(fs.existsSync(evidencePath), 'Evidence file must exist');
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf-8'));
    assert.equal(evidence.result, 'PASS', 'Evidence result must be PASS');
    assert.equal(evidence.vectors['R07-A01'].unconfirmedDenied, true);
    assert.equal(evidence.vectors['R07-A01'].remainedPending, true);
    assert.equal(evidence.vectors['R07-A01'].dispatchPendingBlocked, true);
    assert.equal(evidence.vectors['R07-A01'].staleDenied, true);
    assert.equal(evidence.vectors['R07-A01'].confirmedApproved, true);
    assert.equal(evidence.vectors['R07-A01'].tokenBecameApproved, true);
    assert.equal(evidence.vectors['R07-A01'].dispatchSucceeded, true);
    assert.equal(evidence.vectors['R07-A01'].tokenConsumed, true);
    assert.equal(evidence.vectors['R07-A01'].digestMatched, true);
    assert.equal(evidence.vectors['R07-A03'].harnessAllowed, true);

    try {
      fs.rmSync(tempUserData, { recursive: true, force: true });
    } catch {}
  });

  it('R07-A03: Real Electron production configuration strictly denies test mutation channels (C03)', async () => {
    const tempUserData = path.join(os.tmpdir(), `ub-test-r07-prod-${Date.now()}`);

    const res = await runElectronProcess(
      [
        '--headless',
        `--test-user-data=${tempUserData}`,
        '--r07-prod-e2e',
      ],
      {
        env: {
          NODE_ENV: 'production',
          UNION_BOT_E2E_HARNESS: '0',
        },
      }
    );

    console.log('[R07 Prod Runner] Output:\n', res.stdout);
    if (res.stderr) console.error('[R07 Prod Runner] Stderr:\n', res.stderr);

    assert.equal(res.code, 0, `Electron process must exit with code 0. Stderr: ${res.stderr}`);
    assert.ok(res.stdout.includes('ALL_R07_PROD_CHECKS_PASSED'), 'Output must confirm ALL_R07_PROD_CHECKS_PASSED');

    // Read capability evidence
    const evidencePath = path.resolve(repoRoot, 'reports/capability-evidence/ELECTRON_R07_PROD_EVIDENCE.json');
    assert.ok(fs.existsSync(evidencePath), 'Evidence file must exist');
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf-8'));
    assert.equal(evidence.result, 'PASS', 'Evidence result must be PASS');
    assert.equal(evidence.vectors['R07-A03'].productionTestKillDisabled, true);
    assert.equal(evidence.vectors['R07-A03'].productionConfirmationDisabled, true);

    try {
      fs.rmSync(tempUserData, { recursive: true, force: true });
    } catch {}
  });
});
