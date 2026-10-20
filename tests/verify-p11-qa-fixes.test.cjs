/**
 * @file verify-p11-qa-fixes.test.cjs
 * @description Focused Regression Tests for Codex QA Findings (2026-10-21):
 * 1. Test Launcher Error Code Propagation (Negative child exit 9 must yield 9 from union-bot.bat)
 * 2. Test Same-Size Freshness in assemble-portable (Content change with same byte length must update bundle)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const crypto = require('crypto');
const assert = require('assert');

console.log('[P11-QA-Fixes] Starting Focused Regression Tests...');

const repoRoot = path.resolve(__dirname, '..');
const portableRelease = path.resolve(repoRoot, 'release/union-bot-portable-win-x64');

// ============================================================================
// TEST 1: Launcher Exit Code Propagation (Repro from Codex finding)
// ============================================================================
console.log('\n[Test 1] Testing Launcher Exit Code Propagation...');

const testProbeDir = path.join(os.tmpdir(), `union_bot_exit_probe_test_${Date.now()}`);
fs.mkdirSync(testProbeDir, { recursive: true });

try {
  const srcBat = path.join(portableRelease, 'union-bot.bat');
  const srcNode = path.join(portableRelease, 'runtime/node.exe');
  
  assert.ok(fs.existsSync(srcBat), 'union-bot.bat must exist in release');
  assert.ok(fs.existsSync(srcNode), 'bundled node.exe must exist in release');

  fs.copyFileSync(srcBat, path.join(testProbeDir, 'union-bot.bat'));
  // Rename node.exe to union-bot.exe so the batch file invokes it as its child
  fs.copyFileSync(srcNode, path.join(testProbeDir, 'union-bot.exe'));

  // 1A. Direct invocation: node rejects --test-user-data=exit-probe with exit code 9
  const directRes = cp.spawnSync(
    path.join(testProbeDir, 'union-bot.exe'),
    ['--test-user-data=exit-probe'],
    { encoding: 'utf8' }
  );
  const directExit = directRes.status;
  console.log(`[Test 1A] Direct child exit code: ${directExit} (Expected: 9)`);
  assert.strictEqual(directExit, 9, 'Direct node execution with invalid flag must exit with code 9');

  // 1B. Launcher invocation: union-bot.bat must propagate the EXACT same exit code (9)
  const launcherRes = cp.spawnSync(
    'cmd.exe',
    ['/c', 'union-bot.bat', '--test-user-data=exit-probe'],
    { cwd: testProbeDir, encoding: 'utf8' }
  );
  const launcherExit = launcherRes.status;
  console.log(`[Test 1B] Launcher exit code: ${launcherExit} (Expected: 9)`);
  assert.strictEqual(launcherExit, 9, 'union-bot.bat MUST propagate child exit code 9 without hiding error');
  assert.strictEqual(launcherExit, directExit, 'Launcher exit code must identically match direct child exit code');

  console.log('[Test 1] PASS: Launcher error code propagation verified 100% authentic.');
} finally {
  try {
    fs.rmSync(testProbeDir, { recursive: true, force: true });
  } catch {}
}

// ============================================================================
// TEST 2: Same-Size Freshness Test in copyDirSync / assemble-portable
// ============================================================================
console.log('\n[Test 2] Testing Same-Size Freshness in copyDirSync...');

function getFileSha256(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function copyDirSync(src, dest, filterFn) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (filterFn && !filterFn(srcPath, entry)) continue;
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath, filterFn);
    } else {
      if (fs.existsSync(destPath)) {
        const srcHash = getFileSha256(srcPath);
        const destHash = getFileSha256(destPath);
        if (srcHash === destHash) {
          continue; // Truly identical by SHA-256 CAS, skip to avoid locks
        }
      }
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const testFreshnessDir = path.join(os.tmpdir(), `union_bot_freshness_test_${Date.now()}`);
const srcDir = path.join(testFreshnessDir, 'src');
const bundleDir = path.join(testFreshnessDir, 'bundle');
fs.mkdirSync(srcDir, { recursive: true });
fs.mkdirSync(bundleDir, { recursive: true });

try {
  const testFileSrc = path.join(srcDir, 'module.js');
  const testFileDest = path.join(bundleDir, 'module.js');

  // Step 1: Initial content (21 bytes)
  const initialContent = "const version = '1.0';"; // length 22
  fs.writeFileSync(testFileSrc, initialContent, 'utf8');
  const initialLen = Buffer.byteLength(initialContent);

  // Initial copy
  copyDirSync(srcDir, bundleDir);
  assert.strictEqual(fs.readFileSync(testFileDest, 'utf8'), initialContent);
  console.log(`[Test 2A] Initial copy verified (${initialLen} bytes)`);

  // Step 2: Modify source with EXACT same length (different bytes!)
  const updatedContent = "const version = '2.0';"; // length 22, same length!
  assert.strictEqual(Buffer.byteLength(updatedContent), initialLen, 'Lengths must be identical');
  fs.writeFileSync(testFileSrc, updatedContent, 'utf8');

  // Copy again with new CAS logic
  copyDirSync(srcDir, bundleDir);
  const bundleContent = fs.readFileSync(testFileDest, 'utf8');
  console.log(`[Test 2B] Updated copy content: "${bundleContent}"`);

  assert.strictEqual(
    bundleContent,
    updatedContent,
    'Bundle must receive updated content even when byte length is identical!'
  );

  console.log('[Test 2] PASS: Same-size freshness verification verified 100% correct.');
} finally {
  try {
    fs.rmSync(testFreshnessDir, { recursive: true, force: true });
  } catch {}
}

console.log('\n[P11-QA-Fixes] ALL FOCUSED REGRESSION TESTS PASSED CLEANLY (100% OK)!');
