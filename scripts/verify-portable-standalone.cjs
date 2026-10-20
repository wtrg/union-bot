/**
 * @file verify-portable-standalone.cjs
 * @description Official Codex/QA Independent Verification for Phase P11:
 * Tests that `union-bot-portable-win-x64` operates 100% standalone when copied
 * completely OUTSIDE the repository, with system Node.js and pnpm stripped from PATH.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const crypto = require('crypto');

const repoRoot = path.resolve(__dirname, '..');
const portableSrc = path.resolve(repoRoot, 'release/union-bot-portable-win-x64');
const externalDest = path.join(os.tmpdir(), `union_bot_standalone_verify_${Date.now()}`);

console.log('[P11-Verify] Starting Independent Standalone Portable Verification...');
console.log('[P11-Verify] Source portable bundle:', portableSrc);
console.log('[P11-Verify] External standalone destination (outside repo):', externalDest);

const evidence = {
  timestamp: new Date().toISOString(),
  environment: 'Windows x64 Outside-Repo Standalone',
  externalDirectory: externalDest,
  zeroCostConfirmed: true,
  t1LiveStatus: 'NOT_LIVE_VERIFIED',
  checks: {},
};

// 1. Copy directory recursively outside repository
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log('[P11-Verify] 1. Copying portable bundle outside repo...');
const t0 = Date.now();
copyDirSync(portableSrc, externalDest);
console.log(`[P11-Verify] Bundle copied in ${Date.now() - t0}ms`);
evidence.checks.copiedOutsideRepo = fs.existsSync(externalDest);

// 2. Verify SHA-256 CAS Manifest
console.log('[P11-Verify] 2. Verifying SHA-256 CAS Manifest checksums...');
const manifestPath = path.join(externalDest, 'SHA256_MANIFEST.txt');
evidence.checks.hasManifest = fs.existsSync(manifestPath);

const manifestContent = fs.readFileSync(manifestPath, 'utf8');
const manifestLines = manifestContent.split('\n');
let manifestCheckedCount = 0;
let manifestAllMatch = true;

for (const line of manifestLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('SHA256') || trimmed.startsWith('---')) continue;
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 3) {
    const expectedHash = parts[0];
    const relFile = parts.slice(2).join(' ');
    if (relFile === 'SHA256_MANIFEST.txt' || relFile === 'SHA256_PORTABLE_MANIFEST.txt') continue;
    const absFile = path.join(externalDest, relFile);
    if (fs.existsSync(absFile)) {
      const actualHash = crypto.createHash('sha256').update(fs.readFileSync(absFile)).digest('hex');
      if (actualHash !== expectedHash) {
        console.error(`[P11-Verify] Hash mismatch for ${relFile}! Expected ${expectedHash}, got ${actualHash}`);
        manifestAllMatch = false;
      }
      manifestCheckedCount++;
    } else {
      console.error(`[P11-Verify] File missing in portable bundle: ${relFile}`);
      manifestAllMatch = false;
    }
  }
}

console.log(`[P11-Verify] Manifest verified: ${manifestCheckedCount} files checked, allMatch = ${manifestAllMatch}`);
evidence.checks.manifestCheckedCount = manifestCheckedCount;
evidence.checks.manifestAllMatch = manifestAllMatch;

// 3. Verify bundled runtime binaries exist
const bundledNode = path.join(externalDest, 'runtime/node.exe');
const bundledExe = path.join(externalDest, 'union-bot.exe');
const bundledBat = path.join(externalDest, 'union-bot.bat');

evidence.checks.bundledNodeExists = fs.existsSync(bundledNode);
evidence.checks.bundledExeExists = fs.existsSync(bundledExe);
evidence.checks.bundledBatExists = fs.existsSync(bundledBat);

// 4. Test execution with stripped PATH (No global Node, no pnpm)
console.log('[P11-Verify] 3. Testing execution with stripped PATH (simulating zero-Node host)...');
const cleanPath = 'C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\Wbem';
const strippedEnv = {
  ...process.env,
  PATH: cleanPath,
  SYSTEM_NODE_PATH: undefined,
  NODE_PATH: undefined,
};
delete strippedEnv.SYSTEM_NODE_PATH;
delete strippedEnv.NODE_PATH;

// Verify that 'node' is NOT found in stripped PATH
let systemNodeAvailable = true;
try {
  cp.execSync('node -v', { env: strippedEnv, stdio: 'ignore' });
} catch {
  systemNodeAvailable = false;
}
evidence.checks.systemNodeStripped = !systemNodeAvailable;
console.log('[P11-Verify] System node in stripped environment available:', systemNodeAvailable, '(Must be false)');

// 5. Run union-bot.bat with --smoke test in external folder
console.log('[P11-Verify] 4. Executing union-bot.bat --smoke from external directory...');
const testUserData = path.join(externalDest, 'test-isolated-profile');

let smokeStdout = '';
let smokeStderr = '';
let smokeExitCode = null;

try {
  const result = cp.spawnSync(
    'cmd.exe',
    ['/c', 'union-bot.bat', '--smoke', '--headless', `--test-user-data=${testUserData}`],
    {
      cwd: externalDest,
      env: strippedEnv,
      encoding: 'utf8',
      timeout: 60000,
    }
  );
  smokeStdout = result.stdout || '';
  smokeStderr = result.stderr || '';
  smokeExitCode = result.status;
  console.log('[P11-Verify] Process exit code:', smokeExitCode);
} catch (err) {
  console.error('[P11-Verify] Execution error:', err);
  smokeExitCode = 1;
}

evidence.checks.smokeExitCodeZero = smokeExitCode === 0;
evidence.checks.smokeOutputPass = smokeStdout.includes('[SmokeTest] Smoke test PASS! All assertions verified cleanly.');
evidence.checks.costGuardActive = smokeStdout.includes('[SmokeTest] CostGuard egress check (paid API blocked): true');
evidence.checks.orchestratorZeroCost = smokeStdout.includes('[SmokeTest] Orchestrator zero-cost admission passed: true');
evidence.checks.ipcVerified = smokeStdout.includes('[SmokeTest] Real GUI IPC send message verified: true');

// 6. Verify SQLite database & migrations created in test profile
const primaryDb = path.join(testUserData, 'union_bot.db');
const defaultDb = path.join(externalDest, 'data/union_bot.db');
const effectiveDb = fs.existsSync(primaryDb) ? primaryDb : (fs.existsSync(defaultDb) ? defaultDb : null);
evidence.checks.databaseCreated = Boolean(effectiveDb);

// Verify Database schema using bundled node.exe
if (effectiveDb) {
  try {
    const dbCheckScript = `
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync('${effectiveDb.replace(/\\/g, '\\\\')}');
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      console.log(JSON.stringify(tables.map(t => t.name)));
    `;
    const checkRes = cp.spawnSync(bundledNode, ['-e', dbCheckScript], { encoding: 'utf8' });
    const tableList = JSON.parse(checkRes.stdout.trim());
    console.log('[P11-Verify] SQLite tables created by migrations:', tableList);
    evidence.checks.hasMigrationTables = tableList.includes('rooms') && tableList.includes('events') && tableList.includes('envelopes');
  } catch (err) {
    console.error('[P11-Verify] DB verification error:', err.message);
    evidence.checks.hasMigrationTables = false;
  }
}

// 7. Cleanup external test directory
console.log('[P11-Verify] 5. Cleaning up external test directory...');
function sleepMs(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    cp.spawnSync('powershell.exe', ['-NoProfile', '-Command', `Start-Sleep -Milliseconds ${ms}`]);
  }
}

// Allow Windows 2 seconds to release memory-mapped executable handles
sleepMs(2000);

let cleaned = false;
for (let attempt = 1; attempt <= 15; attempt++) {
  if (!fs.existsSync(externalDest)) {
    cleaned = true;
    break;
  }
  try {
    // Only target own test process tree matching exact unique QA temp root (UB-P11-QA requirement)
    const folderPattern = path.basename(externalDest);
    const killOwnCmd = `
      $target = "*${folderPattern}*"
      $procs = Get-CimInstance Win32_Process | Where-Object { ($_.CommandLine -like $target) -or ($_.ExecutablePath -like $target) }
      $pids = @($procs.ProcessId)
      if ($pids.Count -gt 0) {
        $children = Get-CimInstance Win32_Process | Where-Object { $pids -contains $_.ParentProcessId }
        $allPids = $pids + @($children.ProcessId)
        $allPids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
      }
    `;
    cp.spawnSync('powershell.exe', ['-NoProfile', '-Command', killOwnCmd], { stdio: 'ignore' });
  } catch {}
  try {
    fs.rmSync(externalDest, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    if (!fs.existsSync(externalDest)) {
      cleaned = true;
      break;
    }
  } catch {}
  try {
    cp.spawnSync('powershell.exe', ['-NoProfile', '-Command', `Remove-Item -Path "${externalDest}" -Recurse -Force -ErrorAction SilentlyContinue`], { stdio: 'ignore' });
    if (!fs.existsSync(externalDest)) {
      cleaned = true;
      break;
    }
  } catch {}
  try {
    cp.spawnSync('cmd.exe', ['/c', `del /f /s /q "${externalDest}\\*.*"`], { stdio: 'ignore' });
    cp.spawnSync('cmd.exe', ['/c', `rmdir /s /q "${externalDest}"`], { stdio: 'ignore' });
    if (!fs.existsSync(externalDest)) {
      cleaned = true;
      break;
    }
  } catch {}
  sleepMs(1000);
}
evidence.checks.externalDirCleanedUp = cleaned;

// Overall assessment
evidence.allPassed = Object.values(evidence.checks).every(Boolean);
console.log('[P11-Verify] Final Results:', JSON.stringify(evidence, null, 2));

// Write evidence files
const evidencePath = path.resolve(repoRoot, 'reports/capability-evidence/P11_PORTABLE_STANDALONE_EVIDENCE.json');
fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

if (!evidence.allPassed) {
  console.error('[P11-Verify] FAIL: One or more standalone checks failed!');
  process.exit(1);
}

console.log('[P11-Verify] SUCCESS: Portable Windows x64 standalone verification 100% PASS!');
process.exit(0);
