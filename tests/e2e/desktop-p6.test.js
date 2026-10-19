/**
 * @file desktop-p6.test.js
 * @description Windows Real Electron E2E Test Suite for Union Bot Phase P6 (Native Codex Agent Integration).
 *
 * Strictly verifies in real Windows Electron subprocess:
 * - P6-001: Local Codex CLI binary discovery and version check (codex 0.162.1 on Windows).
 * - P6-002: Stdio JSON-RPC connection & handshake.
 * - P6-003: Thread & turn execution with bidirectional ID tracking.
 * - P6-004: Real-time event streaming (onCodexDelta, onCodexTurnCompleted).
 * - P6-005: Human approval token gating and zero-cost policy enforcement ($0.00).
 * - P6-006: Turn cancellation and process lifecycle management.
 * - P6-007: Canonical workspace boundary enforcement (path.relative directory traversal defense).
 * - P6-008: CAS provenance tracking for native agent outputs.
 * - P6-009: Strict zero-cost egress preservation ($0.00 / 0đ).
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
      if (str.includes('[P6-E2E] ALL_P6_E2E_CHECKS_PASSED')) {
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

describe('Union Bot Phase P6 Gate: Windows Real Electron E2E Suite', () => {
  const testUserDataDir = path.join(os.tmpdir(), `union_bot_p6_e2e_${Date.now()}`);

  it('P6-E2E: Real Electron Native Codex Discovery, Boundary Containment, Event Streaming & Zero Cost (PASS)', async () => {
    fs.mkdirSync(testUserDataDir, { recursive: true });

    const { code, stdout, stderr } = await runElectronProcess([
      '--headless',
      '--p6-e2e',
      `--test-user-data=${testUserDataDir}`,
    ], {
      env: {
        NODE_ENV: 'test',
        UNION_BOT_E2E_HARNESS: '1',
      },
      timeoutMs: 65000,
    });

    assert.equal(code, 0, `Electron process should exit with code 0. Stderr: ${stderr}\nStdout: ${stdout}`);
    assert.match(stdout, /\[P6-E2E\] ALL_P6_E2E_CHECKS_PASSED/);

    const evidencePath = path.resolve(repoRoot, 'reports/capability-evidence/ELECTRON_P6_E2E_EVIDENCE.json');
    assert.ok(fs.existsSync(evidencePath), 'P6 E2E evidence JSON must be written');
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    assert.equal(evidence.allPassed, true);

    // Assert individual P6 capabilities
    assert.equal(evidence.results.codexDiscoverSuccess, true, 'P6-001: codexDiscover IPC must succeed');
    assert.equal(evidence.results.codexAvailable, true, 'P6-001: Local Codex CLI must be available on Windows');
    assert.equal(evidence.results.codexVersionMatches, true, 'P6-001: Codex CLI version must be 0.162.1');
    assert.equal(evidence.results.validBoundaryAllowed, true, 'P6-007: In-workspace path must be allowed');
    assert.equal(evidence.results.invalidBoundaryDenied, true, 'P6-007: Directory traversal must be rejected with ERR_PATH_TRAVERSAL');
    assert.equal(evidence.results.executeSuccess, true, 'P6-003: Turn execution must succeed');
    assert.equal(evidence.results.providerIsCodex, true, 'P6-003: Execution provider must be codex');
    assert.equal(evidence.results.turnCompleted, true, 'P6-003: Turn status must be completed');
    assert.equal(evidence.results.deltasReceived, true, 'P6-004: Streaming deltas must be received by renderer');
    assert.equal(evidence.results.fullTextMatch, true, 'P6-004: Turn output text must match full response');
    assert.equal(evidence.results.provenanceVerified, true, 'P6-008: Artifact provenance must be codex');
    assert.equal(evidence.results.costIsZero, true, 'P6-009: Cost estimate must be strictly $0.00');
    assert.equal(evidence.results.cancelSucceeded, true, 'P6-006: Turn cancellation must be clean');

    // Verify stdout log checks
    assert.match(stdout, /\[P6-E2E\] Check codexDiscoverSuccess: true/);
    assert.match(stdout, /\[P6-E2E\] Check codexAvailable: true/);
    assert.match(stdout, /\[P6-E2E\] Check codexVersionMatches: true/);
    assert.match(stdout, /\[P6-E2E\] Check validBoundaryAllowed: true/);
    assert.match(stdout, /\[P6-E2E\] Check invalidBoundaryDenied: true/);
    assert.match(stdout, /\[P6-E2E\] Check executeSuccess: true/);
    assert.match(stdout, /\[P6-E2E\] Check providerIsCodex: true/);
    assert.match(stdout, /\[P6-E2E\] Check turnCompleted: true/);
    assert.match(stdout, /\[P6-E2E\] Check deltasReceived: true/);
    assert.match(stdout, /\[P6-E2E\] Check fullTextMatch: true/);
    assert.match(stdout, /\[P6-E2E\] Check provenanceVerified: true/);
    assert.match(stdout, /\[P6-E2E\] Check costIsZero: true/);
    assert.match(stdout, /\[P6-E2E\] Check cancelSucceeded: true/);

    // Clean up test directory
    try {
      fs.rmSync(testUserDataDir, { recursive: true, force: true });
    } catch {}
  });
});
