/**
 * @file desktop-p3.test.js
 * @description Windows Real Electron E2E Test Suite for Union Bot Phase P3 (Desktop UI Offline & Durable Storage).
 *
 * Strictly tests in real Electron subprocess:
 * - P3-001..P3-014: Full Offline Desktop Flow in live Chromium:
 *   - P3-003: Dynamic Room Creation in SQLite WAL
 *   - P3-004 & P3-005: Messages with File Attachments (PNG & PDF) saved in CAS store
 *   - P3-007 & P3-C01: Approval Inbox Token Lifecycle with deep parameter & digest inspection
 *   - P3-009 & Gate P3: Standalone Workspace Export to Markdown & JSON
 * - P3-C03: Durable Restart Preservation:
 *   - Closes live Electron app
 *   - Reopens Electron app with identical database path
 *   - Verifies room history, message order, and PNG/PDF attachments survive 100%
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

describe('Union Bot Phase P3 Gate: Windows Real Electron E2E Suite', () => {
  const testUserDataDir = path.join(os.tmpdir(), `union_bot_p3_e2e_${Date.now()}`);

  it('P3-E2E: Real Electron live dynamic room, PNG/PDF attachments, approval inbox, and export (PASS)', async () => {
    fs.mkdirSync(testUserDataDir, { recursive: true });

    const { code, stdout, stderr } = await runElectronProcess([
      '--headless',
      '--p3-e2e',
      `--test-user-data=${testUserDataDir}`,
    ], {
      env: {
        NODE_ENV: 'test',
        UNION_BOT_E2E_HARNESS: '1',
      },
      timeoutMs: 85000,
    });

    assert.equal(code, 0, `Electron process should exit with code 0. Stderr: ${stderr}\nStdout: ${stdout}`);
    assert.match(stdout, /\[P3-E2E\] ALL_P3_E2E_CHECKS_PASSED/);

    const evidencePath = path.resolve(repoRoot, 'reports/capability-evidence/ELECTRON_P3_E2E_EVIDENCE.json');
    assert.ok(fs.existsSync(evidencePath), 'P3 E2E evidence JSON must be written');
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    assert.equal(evidence.allPassed, true);
    assert.equal(evidence.results.roomCreated, true);
    assert.equal(evidence.results.roomInList, true);
    assert.equal(evidence.results.pngSaved, true);
    assert.equal(evidence.results.pdfSaved, true);
    assert.equal(evidence.results.envelopeDispatched, true);
    assert.equal(evidence.results.historyFound, true);
    assert.equal(evidence.results.tokenCreated, true);
    assert.equal(evidence.results.tokenInList, true);
    assert.equal(evidence.results.tokenRejected, true);
    assert.equal(evidence.results.exportSucceeded, true);
    assert.equal(evidence.results.pathTraversalBlocked, true);
    assert.equal(evidence.results.invalidShaBlocked, true);
    assert.equal(evidence.results.projectCreated, true);
    assert.equal(evidence.results.projectInList, true);
    assert.equal(evidence.results.taskCreated, true);
    assert.equal(evidence.results.taskInList, true);
    assert.equal(evidence.results.actionIntentPreserved, true);
    assert.equal(evidence.results.hasApprovalCards, true);
    assert.equal(evidence.results.hasVerifiedBadge, true);
    assert.equal(evidence.results.hasMismatchBadge, true);
    assert.equal(evidence.results.tamperedApprovalBlocked, true);
    assert.equal(evidence.results.hasTasksRendered, true);
    assert.equal(evidence.results.hasChatRendered, true);

    // Phase P3 R04 G01 & G02 Regression Vectors
    assert.equal(evidence.regressionVectors['UB-P3-R04-G01'].creationMissingPayloadBlocked, true);
    assert.equal(evidence.regressionVectors['UB-P3-R04-G02'].attachmentErrorBannerShown, true);
    assert.equal(evidence.regressionVectors['UB-P3-R04-G02'].draftPreservedOnError, true);
    assert.equal(evidence.regressionVectors['UB-P3-R04-G02'].bothChipsRendered, true);
    assert.equal(evidence.regressionVectors['UB-P3-R04-G02'].casFilesWritten, true);
    assert.equal(evidence.regressionVectors['UB-P3-R04-G02'].exportFilesOnDiskValid, true);

    // Phase P3 R04 Regression Vectors
    assert.equal(evidence.regressionVectors['P3-R04-F01'].creationMismatchBlocked, true);
    assert.equal(evidence.regressionVectors['P3-R04-F02'].approveTamperBlocked, true);
    assert.equal(evidence.regressionVectors['P3-R04-F03'].approveBtnDisabledOnMismatch, true);
    assert.equal(evidence.regressionVectors['P3-R04-F05'].projectFormCreatedInDom, true);
    assert.equal(evidence.regressionVectors['P3-R04-F05'].chatMessageSentViaDom, true);
    assert.equal(evidence.regressionVectors['P3-R04-F05'].exportTriggeredViaDom, true);

    assert.match(stdout, /\[P3-E2E\] UB-P3-R04-G01 Token creation missing payload rejected fail-closed: true/);
    assert.match(stdout, /\[P3-E2E\] UB-P3-R04-G02 Attachment error banner shown on failure: true/);
    assert.match(stdout, /\[P3-E2E\] UB-P3-R04-G02 Draft message preserved in textarea on failure: true/);
    assert.match(stdout, /\[P3-E2E\] UB-P3-R04-G02 PNG & PDF driven via composer attach button: true/);
    assert.match(stdout, /\[P3-E2E\] UB-P3-R04-G02 Authentic CAS files written to disk: true/);
    assert.match(stdout, /\[P3-E2E\] UB-P3-R04-G02 Real export files on disk valid and non-empty: true/);
    assert.match(stdout, /\[P3-E2E\] UB-P3-R02-001 Live Web Crypto SHA-256 Verified Match rendered in DOM: true/);
    assert.match(stdout, /\[P3-E2E\] UB-P3-R02-001 Live Web Crypto SHA-256 Tamper Mismatch detected in DOM: true/);
    assert.match(stdout, /\[P3-E2E\] UB-P3-R02-001 Tampered Approval Blocked fail-closed in UI: true/);
    assert.match(stdout, /\[P3-E2E\] UB-P3-R02-004 Real UI DOM Tasks View rendered: true/);
    assert.match(stdout, /\[P3-E2E\] UB-P3-R02-004 Real UI DOM Chat View rendered: true/);
  });

  it('P3-REOPEN-E2E: Real Electron close & reopen verifies SQLite & CAS attachment durability (P3-C03) (PASS)', async () => {
    // Target the EXACT SAME testUserDataDir where P3-E2E created room and sent attachments
    const { code, stdout, stderr } = await runElectronProcess([
      '--headless',
      '--p3-reopen-e2e',
      `--test-user-data=${testUserDataDir}`,
    ], {
      env: {
        NODE_ENV: 'test',
        UNION_BOT_E2E_HARNESS: '1',
      },
      timeoutMs: 85000,
    });

    assert.equal(code, 0, `Electron process should exit with code 0 on reopen. Stderr: ${stderr}\nStdout: ${stdout}`);
    assert.match(stdout, /\[P3-REOPEN-E2E\] P3-C03 Room survived app restart: true/);
    assert.match(stdout, /\[P3-REOPEN-E2E\] UB-P3-R01-002 Project survived app restart: true/);
    assert.match(stdout, /\[P3-REOPEN-E2E\] UB-P3-R01-003 Tasks survived app restart: true/);
    assert.match(stdout, /\[P3-REOPEN-E2E\] P3-C03 Envelopes survived app restart: true/);
    assert.match(stdout, /\[P3-REOPEN-E2E\] P3-C03 Attachments \(PNG & PDF\) survived app restart: true/);
    assert.match(stdout, /\[P3-REOPEN-E2E\] UB-P3-R01-005 & UB-P3-R02-004 Byte-for-byte CAS fidelity verified \(both PNG & PDF\): true/);
    assert.match(stdout, /\[P3-REOPEN-E2E\] UB-P3-R02-001 ActionIntent payload preserved across restart: true/);
    assert.match(stdout, /\[P3-REOPEN-E2E\] UB-P3-R04-G02 Real export files survived app restart: true/);
    assert.match(stdout, /\[P3-REOPEN-E2E\] UB-P3-R02-004 Real UI DOM rendered: true/);
    assert.match(stdout, /\[P3-REOPEN-E2E\] ALL_P3_REOPEN_CHECKS_PASSED/);

    // Clean up test directory after successful assertions
    try {
      fs.rmSync(testUserDataDir, { recursive: true, force: true });
    } catch {}
  });
});
