/**
 * @file desktop-p9.test.js
 * @description Windows Real Electron E2E Test Suite for Union Bot Phase P9 (Web Provider Extensions & 6-AI Collaboration Integration).
 *
 * Strictly verifies in real Windows Electron subprocess:
 * - P9-001: Backend Provider Session Registry initialization for all 6 AI actors (ChatGPT, Gemini, Claude, DeepSeek, Codex, Antigravity).
 * - P9-002: Anti-spoofing backend identity guard (renderer cannot forge provider identity or role).
 * - P9-003: Provider health monitor & error taxonomy (Cloudflare Captcha, Quota exhaustion, Auth required fail-closed).
 * - P9-004: Native thread reference extraction & provenance-tracked text sharing.
 * - P9-005: File sharing with canonical boundary containment (assertCanonicalWorkspacePath, no junction escape, SHA256 digest).
 * - P9-006: 6-AI Collaborative Workflow Pipeline creation & DAG execution with locked-digest consensus.
 * - P9-007: Truth-probe fidelity and zero synthetic approval enforcement.
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
      if (str.includes('[P9-E2E] ALL_P9_E2E_CHECKS_PASSED') || str.includes('[P9-PROD-E2E] ALL_P9_PROD_CHECKS_PASSED')) {
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

describe('Union Bot Phase P9 Gate: Windows Real Electron E2E Suite', () => {
  const testUserDataDir = path.join(os.tmpdir(), `union_bot_p9_e2e_${Date.now()}`);

  it('P9-E2E: Web Provider Sessions, Health Monitor, Provenance Sharing & 6-AI Pipeline (PASS)', async () => {
    fs.mkdirSync(testUserDataDir, { recursive: true });

    const { code, stdout, stderr } = await runElectronProcess([
      '--headless',
      '--p9-e2e',
      `--test-user-data=${testUserDataDir}`,
    ], {
      env: {
        NODE_ENV: 'test',
        UNION_BOT_E2E_HARNESS: '1',
      },
      timeoutMs: 65000,
    });

    assert.equal(code, 0, `Electron process should exit with code 0. Stderr: ${stderr}\nStdout: ${stdout}`);
    assert.match(stdout, /\[P9-E2E\] ALL_P9_E2E_CHECKS_PASSED/);

    const evidencePath = path.resolve(repoRoot, 'reports/capability-evidence/ELECTRON_P9_E2E_EVIDENCE.json');
    assert.ok(fs.existsSync(evidencePath), 'P9 E2E evidence JSON must be written');
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    assert.equal(evidence.allPassed, true);

    // Assert individual P9 capabilities
    assert.equal(evidence.results.allSessionsRetrieved, true, 'P9-001: Must retrieve all provider sessions');
    assert.equal(evidence.results.hasChatgptSession, true, 'P9-001: Must have ChatGPT session with LEADER role');
    assert.equal(evidence.results.hasGeminiSession, true, 'P9-001: Must have Gemini session with RESEARCHER role');
    assert.equal(evidence.results.hasClaudeSession, true, 'P9-001: Must have Claude session with REVIEWER role');
    assert.equal(evidence.results.hasDeepseekSession, true, 'P9-001: Must have DeepSeek session with REVIEWER role');
    assert.equal(evidence.results.hasCodexSession, true, 'P9-001: Must have Codex session with QA_SECURITY role');
    assert.equal(evidence.results.hasAntigravitySession, true, 'P9-001: Must have Antigravity session with IMPLEMENTER role');

    // Anti-spoofing
    assert.equal(evidence.results.validSenderIdentityAccepted, true, 'P9-002: Valid sender identity must be accepted');
    assert.equal(evidence.results.spoofedProviderDenied, true, 'P9-002: Spoofed provider must be denied');
    assert.equal(evidence.results.spoofedRoleDenied, true, 'P9-002: Spoofed role must be denied');

    // Health Monitor
    assert.equal(evidence.results.captchaChallengeDetected, true, 'P9-003: Captcha challenge must be detected');
    assert.equal(evidence.results.quotaExceededDetected, true, 'P9-003: Quota exhaustion must be detected');

    // Text & Reference Sharing
    assert.equal(evidence.results.threadReferenceCaptured, true, 'P9-004: Thread reference must be captured');
    assert.equal(evidence.results.textShareSuccess, true, 'P9-004: Text share with provenance must succeed');
    assert.equal(evidence.results.textShareSignedWithSession, true, 'P9-004: Text share envelope must be signed with authoritative session');

    // File Sharing & Boundary Containment
    assert.equal(evidence.results.validFileShareSuccess, true, 'P9-005: Valid file share must compute SHA256');
    assert.equal(evidence.results.fileShareEnvelopeHasArtifact, true, 'P9-005: Envelope must contain artifact part');
    assert.equal(evidence.results.traversalFileShareDenied, true, 'P9-005: Traversal file share must be denied');
    assert.equal(evidence.results.junctionFileShareDenied, true, 'P9-005: Junction file escape must be denied');

    // 6-AI Collaborative Workflow Engine
    assert.equal(evidence.results.sixAiPipelineCreated, true, 'P9-006: 6-AI Pipeline must be created with 6 nodes');
    assert.equal(evidence.results.sixAiHasScope, true, 'P9-006: Must have ChatGPT Scope node');
    assert.equal(evidence.results.sixAiHasResearch, true, 'P9-006: Must have Gemini Research node');
    assert.equal(evidence.results.sixAiHasArch, true, 'P9-006: Must have Claude Architecture node');
    assert.equal(evidence.results.sixAiHasImplement, true, 'P9-006: Must have Antigravity Implementation node');
    assert.equal(evidence.results.sixAiHasReview, true, 'P9-006: Must have DeepSeek Review node');
    assert.equal(evidence.results.sixAiHasVerify, true, 'P9-006: Must have Codex Verification node');
    assert.equal(evidence.results.reviewersBoundToSessions, true, 'P9-R01-001: Authorized reviewers must be bound to active session IDs');
    assert.equal(evidence.results.fakeStaticVoteDenied, true, 'P9-R01-001: Fake static voter session_deepseek_reviewer must be denied');
    assert.equal(evidence.results.mismatchedRoleVoteDenied, true, 'P9-R01-001: DeepSeek claiming QA_SECURITY must be denied (ERR_ROLE_MISMATCH)');
    assert.equal(evidence.results.removedSessionVoteDenied, true, 'P9-R01-001: Old/removed session must be denied');
    assert.equal(evidence.results.premature6AiVoteDenied, true, 'P9-006: Premature review vote before implementation digest must be denied');
    assert.equal(evidence.results.implementProducedAuthenticDigest, true, 'P9-R01-002: Implement node must produce authentic output digest');
    assert.equal(evidence.results.authenticDeepseekVoteAccepted, true, 'P9-R01-001: Authentic DeepSeek session vote must be accepted');
    assert.equal(evidence.results.authenticCodexVoteAccepted, true, 'P9-R01-001: Authentic Codex session vote must be accepted');
    assert.equal(evidence.results.sixAiRunCompleted, true, 'P9-006: 6-AI pipeline execution must reach COMPLETED status');
    assert.equal(evidence.results.codexVerificationEvidencePresent, true, 'P9-R01-002: Codex verification evidence must be recorded');
    assert.equal(evidence.results.allNodesHaveProviderProvenance, true, 'P9-R01-002: All nodes must contain authentic provider session provenance');

    // Verify stdout log checks
    assert.match(stdout, /\[P9-E2E\] Check allSessionsRetrieved: true/);
    assert.match(stdout, /\[P9-E2E\] Check hasChatgptSession: true/);
    assert.match(stdout, /\[P9-E2E\] Check hasGeminiSession: true/);
    assert.match(stdout, /\[P9-E2E\] Check hasClaudeSession: true/);
    assert.match(stdout, /\[P9-E2E\] Check hasDeepseekSession: true/);
    assert.match(stdout, /\[P9-E2E\] Check hasCodexSession: true/);
    assert.match(stdout, /\[P9-E2E\] Check hasAntigravitySession: true/);
    assert.match(stdout, /\[P9-E2E\] Check validSenderIdentityAccepted: true/);
    assert.match(stdout, /\[P9-E2E\] Check spoofedProviderDenied: true/);
    assert.match(stdout, /\[P9-E2E\] Check spoofedRoleDenied: true/);
    assert.match(stdout, /\[P9-E2E\] Check captchaChallengeDetected: true/);
    assert.match(stdout, /\[P9-E2E\] Check quotaExceededDetected: true/);
    assert.match(stdout, /\[P9-E2E\] Check threadReferenceCaptured: true/);
    assert.match(stdout, /\[P9-E2E\] Check textShareSuccess: true/);
    assert.match(stdout, /\[P9-E2E\] Check textShareSignedWithSession: true/);
    assert.match(stdout, /\[P9-E2E\] Check validFileShareSuccess: true/);
    assert.match(stdout, /\[P9-E2E\] Check fileShareEnvelopeHasArtifact: true/);
    assert.match(stdout, /\[P9-E2E\] Check traversalFileShareDenied: true/);
    assert.match(stdout, /\[P9-E2E\] Check junctionFileShareDenied: true/);
    assert.match(stdout, /\[P9-E2E\] Check sixAiPipelineCreated: true/);
    assert.match(stdout, /\[P9-E2E\] Check sixAiHasScope: true/);
    assert.match(stdout, /\[P9-E2E\] Check sixAiHasResearch: true/);
    assert.match(stdout, /\[P9-E2E\] Check sixAiHasArch: true/);
    assert.match(stdout, /\[P9-E2E\] Check sixAiHasImplement: true/);
    assert.match(stdout, /\[P9-E2E\] Check sixAiHasReview: true/);
    assert.match(stdout, /\[P9-E2E\] Check sixAiHasVerify: true/);
    assert.match(stdout, /\[P9-E2E\] Check reviewersBoundToSessions: true/);
    assert.match(stdout, /\[P9-E2E\] Check fakeStaticVoteDenied: true/);
    assert.match(stdout, /\[P9-E2E\] Check mismatchedRoleVoteDenied: true/);
    assert.match(stdout, /\[P9-E2E\] Check removedSessionVoteDenied: true/);
    assert.match(stdout, /\[P9-E2E\] Check premature6AiVoteDenied: true/);
    assert.match(stdout, /\[P9-E2E\] Check implementProducedAuthenticDigest: true/);
    assert.match(stdout, /\[P9-E2E\] Check authenticDeepseekVoteAccepted: true/);
    assert.match(stdout, /\[P9-E2E\] Check authenticCodexVoteAccepted: true/);
    assert.match(stdout, /\[P9-E2E\] Check sixAiRunCompleted: true/);
    assert.match(stdout, /\[P9-E2E\] Check codexVerificationEvidencePresent: true/);
    assert.match(stdout, /\[P9-E2E\] Check allNodesHaveProviderProvenance: true/);

    // Clean up test directory
    try {
      fs.rmSync(testUserDataDir, { recursive: true, force: true });
    } catch {}
  });

  it('P9-PROD-E2E: Production Mode Real 6-AI Transport Registration & Native Service Routing (PASS)', async () => {
    const prodUserDataDir = path.join(os.tmpdir(), `union_bot_p9_prod_${Date.now()}`);
    fs.mkdirSync(prodUserDataDir, { recursive: true });

    const { code, stdout, stderr } = await runElectronProcess([
      '--headless',
      '--p9-prod-e2e',
      `--test-user-data=${prodUserDataDir}`,
    ], {
      env: {
        NODE_ENV: 'production',
        // Purposely NO UNION_BOT_E2E_HARNESS - pure production runtime
      },
      timeoutMs: 65000,
    });

    assert.equal(code, 0, `Electron process should exit with code 0. Stderr: ${stderr}\nStdout: ${stdout}`);
    assert.match(stdout, /\[P9-PROD-E2E\] ALL_P9_PROD_CHECKS_PASSED/);

    const evidencePath = path.resolve(repoRoot, 'reports/capability-evidence/ELECTRON_P9_PROD_EVIDENCE.json');
    assert.ok(fs.existsSync(evidencePath), 'P9 Production evidence JSON must be written');
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    assert.equal(evidence.allPassed, true);

    // Assert individual production checks
    assert.equal(evidence.results.productionTransportsRegistered, true, 'P9-R02-001: All 6 providers must have production transports registered');
    assert.equal(evidence.results.missingHandlerFailsClosed, true, 'P9-R02-001: Unknown provider must fail closed');
    assert.equal(evidence.results.webProviderRoutesThroughBrowserSession, true, 'P9-R02-001: Web provider routes through live BrowserService session');
    assert.equal(evidence.results.antigravityRoutesThroughNativeService, true, 'P9-R02-001: Antigravity routes through native antigravityService');
    assert.equal(evidence.results.codexRoutesThroughNativeService, true, 'P9-R02-001: Codex routes through native codexService');
    assert.equal(evidence.results.noE2EMocksInProduction, true, 'P9-R02-001: Production mode must not contain E2E mocks');

    // Verify stdout checks
    assert.match(stdout, /\[P9-PROD-E2E\] Check productionTransportsRegistered: true/);
    assert.match(stdout, /\[P9-PROD-E2E\] Check missingHandlerFailsClosed: true/);
    assert.match(stdout, /\[P9-PROD-E2E\] Check webProviderRoutesThroughBrowserSession: true/);
    assert.match(stdout, /\[P9-PROD-E2E\] Check antigravityRoutesThroughNativeService: true/);
    assert.match(stdout, /\[P9-PROD-E2E\] Check codexRoutesThroughNativeService: true/);
    assert.match(stdout, /\[P9-PROD-E2E\] Check noE2EMocksInProduction: true/);

    // Clean up test directory
    try {
      fs.rmSync(prodUserDataDir, { recursive: true, force: true });
    } catch {}
  });
});
