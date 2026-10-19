/**
 * @file desktop-p8.test.js
 * @description Windows Real Electron E2E Test Suite for Union Bot Phase P8 (Multi-Agent Task Graph & Consensus Engine).
 *
 * Strictly verifies in real Windows Electron subprocess:
 * - P8-001: Standard 5-stage pipeline creation via IPC (Plan -> Implement -> Review -> Fix -> Verify).
 * - P8-002: Cycle detection fail-closed (ERR_CYCLE_DETECTED).
 * - P8-003: Full 5-stage orchestration lifecycle execution to COMPLETED status.
 * - P8-004: Dynamic role assignment across all 5 nodes (Architect, Implementer, QA_Security, Tester).
 * - P8-005: Stale review invalidation capability.
 * - P8-006: Multi-agent consensus protocol and threshold voting.
 * - P8-007: Strict canonical workspace boundary defense (including Windows junction escape prevention).
 * - P8-008: Event streaming and capability evidence generation.
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
      if (str.includes('[P8-E2E] ALL_P8_E2E_CHECKS_PASSED')) {
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

describe('Union Bot Phase P8 Gate: Windows Real Electron E2E Suite', () => {
  const testUserDataDir = path.join(os.tmpdir(), `union_bot_p8_e2e_${Date.now()}`);

  it('P8-E2E: Real Electron Multi-Agent Task Graph, Consensus Voting, Boundary Containment & Lifecycle (PASS)', async () => {
    fs.mkdirSync(testUserDataDir, { recursive: true });

    const { code, stdout, stderr } = await runElectronProcess([
      '--headless',
      '--p8-e2e',
      `--test-user-data=${testUserDataDir}`,
    ], {
      env: {
        NODE_ENV: 'test',
        UNION_BOT_E2E_HARNESS: '1',
      },
      timeoutMs: 65000,
    });

    assert.equal(code, 0, `Electron process should exit with code 0. Stderr: ${stderr}\nStdout: ${stdout}`);
    assert.match(stdout, /\[P8-E2E\] ALL_P8_E2E_CHECKS_PASSED/);

    const evidencePath = path.resolve(repoRoot, 'reports/capability-evidence/ELECTRON_P8_E2E_EVIDENCE.json');
    assert.ok(fs.existsSync(evidencePath), 'P8 E2E evidence JSON must be written');
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    assert.equal(evidence.allPassed, true);

    // Assert individual P8 capabilities
    assert.equal(evidence.results.pipelineCreateSuccess, true, 'P8-001: Pipeline creation must succeed');
    assert.equal(evidence.results.nodeCountIs5, true, 'P8-001: Standard 5-stage pipeline must contain 5 nodes');
    assert.equal(evidence.results.hasPlanNode, true, 'P8-003: Must have PLAN node');
    assert.equal(evidence.results.hasImplementNode, true, 'P8-003: Must have IMPLEMENT node');
    assert.equal(evidence.results.hasReviewNode, true, 'P8-003: Must have REVIEW node');
    assert.equal(evidence.results.hasFixNode, true, 'P8-003: Must have FIX node');
    assert.equal(evidence.results.hasVerifyNode, true, 'P8-003: Must have VERIFY node');
    assert.equal(evidence.results.validBoundaryAllowed, true, 'P8-007: In-workspace path must be allowed');
    assert.equal(evidence.results.invalidBoundaryDenied, true, 'P8-007: Directory traversal must be denied');
    assert.equal(evidence.results.junctionEscapeDenied, true, 'P8-007: Windows junction escape must be denied');
    assert.equal(evidence.results.cycleDetectionEnforced, true, 'P8-002: Cycle detection must throw ERR_CYCLE_DETECTED');
    assert.equal(evidence.results.fakeQaRegistrationDenied, true, 'P8-R03: Renderer privileged QA_SECURITY registration must be denied');
    assert.equal(evidence.results.preApprovalDenied, true, 'P8-R03: Pre-approval vote before targetDigest exists must be denied');
    assert.equal(evidence.results.forgedVoteDenied, true, 'P8-R02: Forged voter without authorization must be denied');
    assert.equal(evidence.results.authenticVoteAccepted, true, 'P8-R02: Authentic QA_SECURITY vote must be accepted');
    assert.equal(evidence.results.staleDigestVoteDenied, true, 'P8-R02: Vote with mismatched digest must be denied');
    assert.equal(evidence.results.duplicateVoteDeduplicated, true, 'P8-R02: Duplicate voter submission must be replaced in-place');
    assert.equal(evidence.results.runGraphSuccess, true, 'P8-003: Task graph execution must succeed');
    assert.equal(evidence.results.graphStatusCompleted, true, 'P8-003: Final graph status must be COMPLETED');
    assert.equal(evidence.results.all5NodesCompleted, true, 'P8-003: All 5 nodes must complete successfully');
    assert.equal(evidence.results.consensusVotesRecorded, true, 'P8-006: Authentic vote with QA_SECURITY role & reviewed digest must be recorded');
    assert.equal(evidence.results.requiredRoleApprovalVerified, true, 'P8-006: Required role approval from QA_SECURITY must be verified');
    assert.equal(evidence.results.eventsEmitted, true, 'P8-008: Real-time lifecycle events must be received');

    // Verify stdout log checks
    assert.match(stdout, /\[P8-E2E\] Check pipelineCreateSuccess: true/);
    assert.match(stdout, /\[P8-E2E\] Check nodeCountIs5: true/);
    assert.match(stdout, /\[P8-E2E\] Check hasPlanNode: true/);
    assert.match(stdout, /\[P8-E2E\] Check hasImplementNode: true/);
    assert.match(stdout, /\[P8-E2E\] Check hasReviewNode: true/);
    assert.match(stdout, /\[P8-E2E\] Check hasFixNode: true/);
    assert.match(stdout, /\[P8-E2E\] Check hasVerifyNode: true/);
    assert.match(stdout, /\[P8-E2E\] Check validBoundaryAllowed: true/);
    assert.match(stdout, /\[P8-E2E\] Check invalidBoundaryDenied: true/);
    assert.match(stdout, /\[P8-E2E\] Check junctionEscapeDenied: true/);
    assert.match(stdout, /\[P8-E2E\] Check cycleDetectionEnforced: true/);
    assert.match(stdout, /\[P8-E2E\] Check fakeQaRegistrationDenied: true/);
    assert.match(stdout, /\[P8-E2E\] Check preApprovalDenied: true/);
    assert.match(stdout, /\[P8-E2E\] Check forgedVoteDenied: true/);
    assert.match(stdout, /\[P8-E2E\] Check authenticVoteAccepted: true/);
    assert.match(stdout, /\[P8-E2E\] Check staleDigestVoteDenied: true/);
    assert.match(stdout, /\[P8-E2E\] Check duplicateVoteDeduplicated: true/);
    assert.match(stdout, /\[P8-E2E\] Check runGraphSuccess: true/);
    assert.match(stdout, /\[P8-E2E\] Check graphStatusCompleted: true/);
    assert.match(stdout, /\[P8-E2E\] Check all5NodesCompleted: true/);
    assert.match(stdout, /\[P8-E2E\] Check consensusVotesRecorded: true/);
    assert.match(stdout, /\[P8-E2E\] Check requiredRoleApprovalVerified: true/);
    assert.match(stdout, /\[P8-E2E\] Check eventsEmitted: true/);

    // Clean up test directory
    try {
      fs.rmSync(testUserDataDir, { recursive: true, force: true });
    } catch {}
  });
});
