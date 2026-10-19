/**
 * @file desktop-p5.test.js
 * @description Windows Real Electron E2E Test Suite for Union Bot Phase P5 (Artifact Store, Previews, Tool Host & Local MCP).
 *
 * Strictly verifies in real Windows Electron subprocess:
 * - P5-001: Content-Addressable Storage (CAS) with atomic writes, deduplication, and magic MIME sniffing.
 * - P5-002: Rich artifact previews (code syntax viewer with line numbers, image previews).
 * - P5-003: Structured test result cards.
 * - P5-004: User actions on artifacts (Save As, Show in folder, Open original, Copy SHA-256).
 * - P5-005: Path traversal denial on CAS storage and workspace boundaries.
 * - P5-007: Safe read-only Tool Host workspace commands (readFile, searchFiles, getGitStatus).
 * - P5-008: Local MCP capability negotiation and tool listing.
 * - P5-009: Local zero-cost MCP tools (safe calculator, artifact inspector, workspace summary).
 * - P5-010: SVG XSS sanitization and script stripping defense.
 * - P5-011: Transcript bundle export with SHA-256 manifest verification.
 * - P5-012: Fail-closed size limit and zero-cost local execution.
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

function runElectronProcess(args, { timeoutMs = 35000, env = {} } = {}) {
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
      stdout += d.toString();
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

describe('Union Bot Phase P5 Gate: Windows Real Electron E2E Suite', () => {
  const testUserDataDir = path.join(os.tmpdir(), `union_bot_p5_e2e_${Date.now()}`);

  it('P5-E2E: Real Electron CAS storage, rich previews, action buttons, tool host & local MCP (PASS)', async () => {
    fs.mkdirSync(testUserDataDir, { recursive: true });

    const { code, stdout, stderr } = await runElectronProcess([
      '--headless',
      '--p5-e2e',
      `--test-user-data=${testUserDataDir}`,
    ], {
      env: {
        NODE_ENV: 'test',
        UNION_BOT_E2E_HARNESS: '1',
      },
      timeoutMs: 65000,
    });

    assert.equal(code, 0, `Electron process should exit with code 0. Stderr: ${stderr}\nStdout: ${stdout}`);
    assert.match(stdout, /\[P5-E2E\] ALL_P5_E2E_CHECKS_PASSED/);

    const evidencePath = path.resolve(repoRoot, 'reports/capability-evidence/ELECTRON_P5_E2E_EVIDENCE.json');
    assert.ok(fs.existsSync(evidencePath), 'P5 E2E evidence JSON must be written');
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    assert.equal(evidence.allPassed, true);

    // Assert individual capabilities
    assert.equal(evidence.results.savePngSucceeded, true);
    assert.equal(evidence.results.pngMimeDetected, true);
    assert.equal(evidence.results.dedupSameSha, true);
    assert.equal(evidence.results.inspectSucceeded, true);
    assert.equal(evidence.results.saveAsSucceeded, true);
    assert.equal(evidence.results.showInFolderSucceeded, true);
    assert.equal(evidence.results.openOriginalSucceeded, true);
    assert.equal(evidence.results.badShaInspectDenied, true);
    assert.equal(evidence.results.toolHostReadFile, true);
    assert.equal(evidence.results.toolHostTraversalDenied, true);
    assert.equal(evidence.results.toolHostSearchFiles, true);
    assert.equal(evidence.results.toolHostGitStatus, true);
    assert.equal(evidence.results.mcpListToolsSucceeded, true);
    assert.equal(evidence.results.mcpCalculatorPresent, true);
    assert.equal(evidence.results.mcpArtifactInspectPresent, true);
    assert.equal(evidence.results.mcpWorkspaceSummaryPresent, true);
    assert.equal(evidence.results.mcpCalculatorComputed, true);
    assert.equal(evidence.results.mcpCalculatorDivZeroHandled, true);
    assert.equal(evidence.results.mcpInspectComputed, true);
    assert.equal(evidence.results.mcpSummaryComputed, true);
    assert.equal(evidence.results.svgSaved, true);
    assert.equal(evidence.results.exportBundleSucceeded, true);
    assert.equal(evidence.results.domExportBundleBtnRendered, true);

    // P5-R02-T01 through T05 regression assertions
    assert.equal(evidence.results.r02_largeFileRejected, true, 'P5-R02-T01: Files >50MB must be rejected fail-closed');
    assert.equal(evidence.results.r02_unapprovedScriptBlocked, true, 'P5-R02-T02: Unapproved scripts must require approval token');
    assert.equal(evidence.results.r02_maliciousRoomExportBlocked, true, 'P5-R02-T03: Malicious roomId traversal in export must be blocked');
    assert.equal(evidence.results.r02_svgSanitized, true, 'P5-R02-T04: SVG scripts and handlers must be sanitized before storing/preview');
    assert.equal(evidence.results.r02_mcpInspectBucketed, true, 'P5-R02-T05: MCP inspect must resolve bucketed CAS hash');

    // Verify stdout log checks
    assert.match(stdout, /\[P5-E2E\] Check savePngSucceeded: true/);
    assert.match(stdout, /\[P5-E2E\] Check pngMimeDetected: true/);
    assert.match(stdout, /\[P5-E2E\] Check dedupSameSha: true/);
    assert.match(stdout, /\[P5-E2E\] Check inspectSucceeded: true/);
    assert.match(stdout, /\[P5-E2E\] Check saveAsSucceeded: true/);
    assert.match(stdout, /\[P5-E2E\] Check toolHostReadFile: true/);
    assert.match(stdout, /\[P5-E2E\] Check toolHostTraversalDenied: true/);
    assert.match(stdout, /\[P5-E2E\] Check mcpCalculatorComputed: true/);
    assert.match(stdout, /\[P5-E2E\] Check mcpInspectComputed: true/);
    assert.match(stdout, /\[P5-E2E\] Check mcpSummaryComputed: true/);
    assert.match(stdout, /\[P5-E2E\] Check exportBundleSucceeded: true/);
    assert.match(stdout, /\[P5-E2E\] Check r02_largeFileRejected: true/);
    assert.match(stdout, /\[P5-E2E\] Check r02_unapprovedScriptBlocked: true/);
    assert.match(stdout, /\[P5-E2E\] Check r02_maliciousRoomExportBlocked: true/);
    assert.match(stdout, /\[P5-E2E\] Check r02_svgSanitized: true/);
    assert.match(stdout, /\[P5-E2E\] Check r02_mcpInspectBucketed: true/);

    // Clean up test directory
    try {
      fs.rmSync(testUserDataDir, { recursive: true, force: true });
    } catch {}
  });
});
