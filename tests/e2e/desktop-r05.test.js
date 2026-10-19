/**
 * @file desktop-r05.test.js
 * @description Windows Real Electron E2E Test Suite for Union Bot Phase P2 Round R05.
 * Strictly verifies production IPC paths and crash/recovery behaviors:
 * - R05-H05: Hard kill Electron after approved action commit -> restart with same userData -> replay returns cached ACK (deduplicated: true) without ALREADY_CONSUMED, zero duplicate records, tampered replay rejected
 * - R05-H07: Full Production IPC Approval Flow: preview -> approve -> dispatch -> consume -> recorded with identical digest, tampered parameters rejected
 * - R05-H08: Crash / Recovery Verification: runtime worker termination causes UI state transition to STORAGE_ERROR_BLOCKED, renderer notified, mutation IPC blocked fail-closed
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

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
      UNION_BOT_E2E_HARNESS: '1',
      UNION_BOT_AUTO_APPROVE: '1',
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

describe('Union Bot Phase P2 Gate R05: Windows Electron Real E2E Suite (H05, H07, H08)', () => {
  // =========================================================================
  // R05-H05: Hard kill sau commit approval -> restart -> replay không tiêu thụ lại
  // =========================================================================
  it('R05-H05: Hard kill after approved action commit -> restart -> identical replay ACKs without ALREADY_CONSUMED, zero duplicate events/outbox', async () => {
    const tempUserData = path.join(os.tmpdir(), `ub-test-r05-h05-${Date.now()}`);
    fs.mkdirSync(tempUserData, { recursive: true });

    try {
      // Stage 1: Commit approved action envelope via Electron IPC, then hard kill Electron main process
      let stage1Killed = false;
      const stage1Promise = runElectronProcess([
        '--headless',
        `--test-user-data=${tempUserData}`,
        '--r05-e2e-h05-stage=1',
      ], {
        timeoutMs: 25000,
        onStdout: (chunk, child) => {
          if (chunk.includes('[R05-H05] STAGE1_COMMITTED') && !stage1Killed) {
            stage1Killed = true;
            if (process.platform === 'win32') {
              spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)]);
            } else {
              child.kill('SIGKILL');
            }
          }
        },
      });

      await stage1Promise;
      assert.ok(stage1Killed, 'Stage 1 must reach committed state before hard-kill');

      const ackMarkerPath = path.join(tempUserData, 'e2e_h05_stage1.json');
      assert.ok(fs.existsSync(ackMarkerPath), 'Stage 1 committed marker must exist on disk');

      // Wait 600ms for Windows OS to release SQLite file lock
      await sleep(600);

      // Stage 2: Relaunch Electron with the exact same userData directory
      const stage2Res = await runElectronProcess([
        '--headless',
        `--test-user-data=${tempUserData}`,
        '--r05-e2e-h05-stage=2',
      ], { timeoutMs: 25000 });

      assert.equal(stage2Res.code, 0, `Stage 2 relaunch failed with code ${stage2Res.code}.\nStdout:\n${stage2Res.stdout}\nStderr:\n${stage2Res.stderr}`);
      assert.match(stage2Res.stdout, /\[R05-H05\] STAGE2_VERIFICATION_PASSED/);

      // Verify evidence JSON
      const evidencePath = path.resolve(repoRoot, 'reports/capability-evidence/ELECTRON_R05_H05_KILL_REPLAY_EVIDENCE.json');
      assert.ok(fs.existsSync(evidencePath), 'ELECTRON_R05_H05_KILL_REPLAY_EVIDENCE.json must exist');
      const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf-8'));
      assert.equal(evidence.result, 'PASS');
      assert.equal(evidence.historyCountBefore, 1);
      assert.equal(evidence.historyCountAfter, 1);
      assert.equal(evidence.tokenStatus, 'CONSUMED');
      assert.equal(evidence.replayResult?.deduplicated, true);
      assert.equal(evidence.tamperedResult?.success, false);
      assert.match(evidence.tamperedResult?.error, /ERR_PAYLOAD_MISMATCH/);

      // Independent direct inspection of persistent SQLite WAL database
      const dbPath = path.join(tempUserData, 'union_bot.db');
      const rawDb = new DatabaseSync(dbPath);

      const tokenRow = rawDb.prepare('SELECT status, consumed_at FROM approvals WHERE token_id = ?').get('tok_h05_kill');
      assert.equal(tokenRow.status, 'CONSUMED', 'Approval token must remain CONSUMED (not reset, not double-consumed)');
      assert.ok(tokenRow.consumed_at, 'consumed_at timestamp must be present');

      const envCount = rawDb.prepare('SELECT COUNT(*) as c FROM envelopes').get().c;
      assert.equal(envCount, 1, 'Exactly 1 envelope record must exist (no duplicate created on replay)');

      const evtCount = rawDb.prepare('SELECT COUNT(*) as c FROM events WHERE stream_id = ?').get('room:orchestration').c;
      assert.equal(evtCount, 1, 'Exactly 1 event record must exist in event journal');

      const outCount = rawDb.prepare('SELECT COUNT(*) as c FROM outbox').get().c;
      assert.equal(outCount, 1, 'Exactly 1 outbox record must exist (no duplicate task created)');

      const idempRow = rawDb.prepare('SELECT status FROM idempotency_keys WHERE key = ?').get('env_h05_kill_001');
      assert.equal(idempRow.status, 'COMPLETED');

      rawDb.close();
    } finally {
      try { fs.rmSync(tempUserData, { recursive: true, force: true }); } catch {}
    }
  });

  // =========================================================================
  // R05-H07: Action được phê duyệt thành công qua Electron IPC thật (Production Path)
  // =========================================================================
  it('R05-H07: Full production IPC approval flow matches digests (preview===approved===consumed===recorded), blocks post-preview tamper', async () => {
    const tempUserData = path.join(os.tmpdir(), `ub-test-r05-h07-${Date.now()}`);
    fs.mkdirSync(tempUserData, { recursive: true });

    try {
      const res = await runElectronProcess([
        '--headless',
        `--test-user-data=${tempUserData}`,
        '--r05-e2e-h07',
      ], { timeoutMs: 25000 });

      assert.equal(res.code, 0, `H07 test failed with code ${res.code}.\nStdout:\n${res.stdout}\nStderr:\n${res.stderr}`);
      assert.match(res.stdout, /\[R05-H07\] PRODUCTION_IPC_APPROVAL_PASSED/);

      const evidencePath = path.resolve(repoRoot, 'reports/capability-evidence/ELECTRON_R05_H07_APPROVAL_IPC_EVIDENCE.json');
      assert.ok(fs.existsSync(evidencePath), 'ELECTRON_R05_H07_APPROVAL_IPC_EVIDENCE.json must exist');
      const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf-8'));
      assert.equal(evidence.result, 'PASS');
      assert.equal(evidence.digestsMatch, true);
      assert.equal(evidence.previewDigest, evidence.approvedDigest);
      assert.equal(evidence.approvedDigest, evidence.consumedDigest);
      assert.equal(evidence.consumedDigest, evidence.recordedDigest);
      assert.equal(evidence.tokenStatus, 'CONSUMED');
      assert.equal(evidence.recordedCount, 1);
      assert.equal(evidence.tamper1Denied, true);
      assert.equal(evidence.tamper2Denied, true);
    } finally {
      try { fs.rmSync(tempUserData, { recursive: true, force: true }); } catch {}
    }
  });

  // =========================================================================
  // R05-H08: Crash / Recovery Verification (Runtime Worker Death & Mutation Block)
  // =========================================================================
  it('R05-H08: Storage worker runtime termination triggers STORAGE_ERROR_BLOCKED and strictly blocks mutation IPC fail-closed', async () => {
    const tempUserData = path.join(os.tmpdir(), `ub-test-r05-h08-${Date.now()}`);
    fs.mkdirSync(tempUserData, { recursive: true });

    try {
      const res = await runElectronProcess([
        '--headless',
        `--test-user-data=${tempUserData}`,
        '--r05-e2e-h08',
      ], { timeoutMs: 25000 });

      assert.equal(res.code, 0, `H08 worker kill test failed with code ${res.code}.\nStdout:\n${res.stdout}\nStderr:\n${res.stderr}`);
      assert.match(res.stdout, /\[R05-H08\] CRASH_RECOVERY_VERIFICATION_PASSED/);

      const evidencePath = path.resolve(repoRoot, 'reports/capability-evidence/ELECTRON_R05_H08_WORKER_KILL_EVIDENCE.json');
      assert.ok(fs.existsSync(evidencePath), 'ELECTRON_R05_H08_WORKER_KILL_EVIDENCE.json must exist');
      const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf-8'));
      assert.equal(evidence.result, 'PASS');
      assert.equal(evidence.case4?.initialReady, true);
      assert.equal(evidence.case4?.transitionedBlocked, true);
      assert.equal(evidence.case4?.dispatchDenied, true);
      assert.equal(evidence.case4?.approveDenied, true);
    } finally {
      try { fs.rmSync(tempUserData, { recursive: true, force: true }); } catch {}
    }
  });
});
