/**
 * @file desktop-p7.test.js
 * @description Windows Real Electron E2E Test Suite for Union Bot Phase P7 (Native Antigravity Agent Integration).
 *
 * Strictly verifies in real Windows Electron subprocess:
 * - P7-001: Local Antigravity CLI binary discovery and version check (agy 1.4.2 on Windows).
 * - P7-002: Headless `agy -p` with stream-json event streaming.
 * - P7-003: Structured stdout parser & stderr diagnostics.
 * - P7-004: Canonical workspace boundary enforcement (path.relative directory traversal defense).
 * - P7-004: Explicit denial of forbidden flags (--dangerously-skip-permissions).
 * - P7-005: Turn execution with Zero-Cost enforcement ($0.00 / 0đ).
 * - P7-006: Turn cancellation and process lifecycle management.
 * - P7-007: CAS artifact registration and provenance tracking for Antigravity outputs.
 * - P7-008: Strict zero-cost egress preservation ($0.00 / 0đ).
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

function runElectronProcess(args, { timeoutMs = 45000, env = {} } = {}) {
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
      if (str.includes('[P7-E2E] ALL_P7_E2E_CHECKS_PASSED')) {
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

describe('Union Bot Phase P7 Gate: Windows Real Electron E2E Suite', () => {
  const testUserDataDir = path.join(os.tmpdir(), `union_bot_p7_e2e_${Date.now()}`);

  it('P7-E2E: Real Electron Native Antigravity Discovery, Boundary Containment, Event Streaming & Zero Cost (PASS)', async () => {
    fs.mkdirSync(testUserDataDir, { recursive: true });

    const { code, stdout, stderr } = await runElectronProcess([
      '--headless',
      '--p7-e2e',
      `--test-user-data=${testUserDataDir}`,
    ], {
      env: {
        NODE_ENV: 'test',
        UNION_BOT_E2E_HARNESS: '1',
      },
      timeoutMs: 65000,
    });

    assert.equal(code, 0, `Electron process should exit with code 0. Stderr: ${stderr}\nStdout: ${stdout}`);
    assert.match(stdout, /\[P7-E2E\] ALL_P7_E2E_CHECKS_PASSED/);

    const evidencePath = path.resolve(repoRoot, 'reports/capability-evidence/ELECTRON_P7_E2E_EVIDENCE.json');
    assert.ok(fs.existsSync(evidencePath), 'P7 E2E evidence JSON must be written');
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    assert.equal(evidence.allPassed, true);

    // Assert individual P7 capabilities
    assert.equal(evidence.results.antigravityDiscoverSuccess, true, 'P7-001: antigravityDiscover IPC must succeed');
    assert.equal(evidence.results.antigravityAvailable, true, 'P7-001: Local Antigravity CLI must be available on Windows');
    assert.equal(evidence.results.antigravityVersionMatches, true, 'P7-001: Antigravity CLI version must be 1.4.2');
    assert.equal(evidence.results.validBoundaryAllowed, true, 'P7-004: In-workspace path must be allowed');
    assert.equal(evidence.results.invalidBoundaryDenied, true, 'P7-004: Directory traversal must be rejected with ERR_PATH_TRAVERSAL');
    assert.equal(evidence.results.forbiddenFlagDenied, true, 'P7-004: Forbidden flag must be rejected with ERR_FORBIDDEN_FLAG');
    assert.equal(evidence.results.executeSuccess, true, 'P7-002: Prompt execution must succeed');
    assert.equal(evidence.results.providerIsAntigravity, true, 'P7-002: Execution provider must be antigravity');
    assert.equal(evidence.results.deltasReceived, true, 'P7-002: Streaming deltas must be received by renderer');
    assert.equal(evidence.results.fullTextMatch, true, 'P7-003: Turn output text must match full response');
    assert.equal(evidence.results.artifactCreated, true, 'P7-007: Output artifact must be stored in CAS');
    assert.equal(evidence.results.costIsZero, true, 'P7-008: Cost must be strictly $0.00');
    assert.equal(evidence.results.cancelSucceeded, true, 'P7-006: Turn cancellation must be clean');

    // Verify stdout log checks
    assert.match(stdout, /\[P7-E2E\] Check antigravityDiscoverSuccess: true/);
    assert.match(stdout, /\[P7-E2E\] Check antigravityAvailable: true/);
    assert.match(stdout, /\[P7-E2E\] Check antigravityVersionMatches: true/);
    assert.match(stdout, /\[P7-E2E\] Check validBoundaryAllowed: true/);
    assert.match(stdout, /\[P7-E2E\] Check invalidBoundaryDenied: true/);
    assert.match(stdout, /\[P7-E2E\] Check forbiddenFlagDenied: true/);
    assert.match(stdout, /\[P7-E2E\] Check executeSuccess: true/);
    assert.match(stdout, /\[P7-E2E\] Check providerIsAntigravity: true/);
    assert.match(stdout, /\[P7-E2E\] Check deltasReceived: true/);
    assert.match(stdout, /\[P7-E2E\] Check fullTextMatch: true/);
    assert.match(stdout, /\[P7-E2E\] Check artifactCreated: true/);
    assert.match(stdout, /\[P7-E2E\] Check costIsZero: true/);
    assert.match(stdout, /\[P7-E2E\] Check cancelSucceeded: true/);

    // Clean up test directory
    try {
      fs.rmSync(testUserDataDir, { recursive: true, force: true });
    } catch {}
  });
});
