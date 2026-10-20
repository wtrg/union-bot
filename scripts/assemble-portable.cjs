/**
 * @file assemble-portable.cjs
 * @description Assembles the zero-cost, self-contained Windows x64 Portable Union Bot release
 * from pre-existing local artifacts and runtimes without downloading any external packages.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const repoRoot = path.resolve(__dirname, '..');
const outDir = path.resolve(repoRoot, 'release/union-bot-portable-win-x64');

console.log('[Assemble] Assembling Union Bot Portable release to:', outDir);

// 1. Create directory structure
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.join(outDir, 'runtime'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'resources/app'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'resources/app/apps/desktop/src'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'resources/app/apps/workspace-ui/dist'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'resources/app/node_modules'), { recursive: true });

// Helper to copy directory recursively
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
      if (fs.existsSync(destPath) && fs.statSync(srcPath).size === fs.statSync(destPath).size) {
        continue;
      }
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 2. Copy Electron Dist
const electronDist = path.resolve(repoRoot, 'spikes/electron-browser/node_modules/.pnpm/electron@33.4.11/node_modules/electron/dist');
if (!fs.existsSync(electronDist)) {
  throw new Error(`Electron distribution not found at: ${electronDist}`);
}
console.log('[Assemble] Copying Electron binaries from:', electronDist);
copyDirSync(electronDist, outDir, (p) => !p.includes('default_app.asar'));

// 3. Copy Local Node 24 Binary into runtime/node.exe
const systemNode = 'C:\\Program Files\\nodejs\\node.exe';
const targetNode = path.join(outDir, 'runtime/node.exe');
if (fs.existsSync(systemNode)) {
  console.log('[Assemble] Bundling standalone Node 24 runtime from:', systemNode);
  fs.copyFileSync(systemNode, targetNode);
} else {
  console.warn('[Assemble] WARNING: System node.exe not found at default location!');
}

// 4. Copy Desktop backend source
const desktopSrc = path.resolve(repoRoot, 'apps/desktop/src');
console.log('[Assemble] Copying desktop backend source from:', desktopSrc);
copyDirSync(desktopSrc, path.join(outDir, 'resources/app/apps/desktop/src'));

// 5. Copy UI dist
const uiDist = path.resolve(repoRoot, 'apps/workspace-ui/dist');
console.log('[Assemble] Copying pre-built UI from:', uiDist);
copyDirSync(uiDist, path.join(outDir, 'resources/app/apps/workspace-ui/dist'));

// 6. Copy Packages
const packagesSrc = path.resolve(repoRoot, 'packages');
console.log('[Assemble] Copying monorepo packages from:', packagesSrc);
copyDirSync(packagesSrc, path.join(outDir, 'resources/app/packages'), (p) => {
  return !p.includes('node_modules') && !p.includes('.git') && !p.includes('tests');
});

// 7. Copy zod dependency into resources/app/node_modules/zod
const zodDist = path.resolve(repoRoot, 'node_modules/.pnpm/zod@3.25.76/node_modules/zod');
if (fs.existsSync(zodDist)) {
  console.log('[Assemble] Copying zod dependency from:', zodDist);
  copyDirSync(zodDist, path.join(outDir, 'resources/app/node_modules/zod'));
}

// 8. Write resources/app/package.json
const appPackageJson = {
  name: 'union-bot-desktop',
  version: '1.0.0',
  description: 'Union Bot — Autonomous Multi-Agent Desktop Application (Windows Portable)',
  main: 'apps/desktop/src/main.js',
  type: 'commonjs',
};
fs.writeFileSync(
  path.join(outDir, 'resources/app/package.json'),
  JSON.stringify(appPackageJson, null, 2),
  'utf8'
);

// 9. Create union-bot.exe from electron.exe
const targetExe = path.join(outDir, 'union-bot.exe');
const sourceExe = path.join(outDir, 'electron.exe');
if (!fs.existsSync(targetExe) || fs.statSync(sourceExe).size !== fs.statSync(targetExe).size) {
  fs.copyFileSync(sourceExe, targetExe);
}

// 10. Write union-bot.bat
const batContent = `@echo off
rem =========================================================================
rem Union Bot - Windows Portable Launcher
rem Fully self-contained: No system installation, admin rights, or Node.js required.
rem =========================================================================
setlocal
set "PORTABLE_ROOT=%~dp0"
set "SYSTEM_NODE_PATH=%PORTABLE_ROOT%runtime\\node.exe"
set "PATH=%PORTABLE_ROOT%runtime;%PATH%"
if not exist "%PORTABLE_ROOT%data" mkdir "%PORTABLE_ROOT%data"

set "USER_DATA_OVERRIDE="
for %%A in (%*) do (
    echo "%%A" | findstr /i /c:"--user-data-dir=" >nul && set "USER_DATA_OVERRIDE=1"
    echo "%%A" | findstr /i /c:"--test-user-data=" >nul && set "USER_DATA_OVERRIDE=1"
)
(call )

if "%1"=="" (
    start "" "%PORTABLE_ROOT%union-bot.exe" --user-data-dir="%PORTABLE_ROOT%data"
    exit /b 0
) else (
    if defined USER_DATA_OVERRIDE (
        "%PORTABLE_ROOT%union-bot.exe" %*
    ) else (
        "%PORTABLE_ROOT%union-bot.exe" --user-data-dir="%PORTABLE_ROOT%data" %*
    )
    exit /b %ERRORLEVEL%
)
`;
fs.writeFileSync(path.join(outDir, 'union-bot.bat'), batContent, 'utf8');

// 11. Write run-smoke-test.bat for QA verification
const smokeBatContent = `@echo off
setlocal
set "PORTABLE_ROOT=%~dp0"
set "SYSTEM_NODE_PATH=%PORTABLE_ROOT%runtime\\node.exe"
set "PATH=%PORTABLE_ROOT%runtime;%PATH%"
"%PORTABLE_ROOT%union-bot.exe" --smoke --headless --test-user-data="%TEMP%\\union_bot_portable_smoke"
`;
fs.writeFileSync(path.join(outDir, 'run-smoke-test.bat'), smokeBatContent, 'utf8');

// 12. Generate SHA-256 CAS Manifest
function getFileSha256(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

console.log('[Assemble] Generating SHA-256 CAS manifest...');
const manifestLines = [
  '# UNION BOT WINDOWS X64 PORTABLE CAS MANIFEST',
  `# Generated: ${new Date().toISOString()}`,
  '# Package: release/union-bot-portable-win-x64',
  '# Cost: $0.00 (Zero-Cost, strictly verified)',
  '# T1 Live Status: NOT_LIVE_VERIFIED',
  '# System Requirements: Windows 10/11 x64 (No Node.js, pnpm, git, or admin required)',
  '# -----------------------------------------------------------------------------',
  'SHA256                                                           FILE_SIZE   RELATIVE_PATH',
  '---------------------------------------------------------------- ----------- ----------------------------------------',
];

function scanFilesForManifest(dir, relPrefix = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.join(relPrefix, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      // Recursively scan runtime, resources/app/apps, and root
      if (relPath.startsWith('resources/app/packages') || relPath.startsWith('resources/app/node_modules') || relPath.startsWith('locales')) {
        continue; // summary level
      }
      scanFilesForManifest(fullPath, relPath);
    } else {
      if (entry.name === 'SHA256_MANIFEST.txt' || entry.name === 'SHA256_PORTABLE_MANIFEST.txt') {
        continue; // Exclude manifest itself from checksum list
      }
      const stat = fs.statSync(fullPath);
      const hash = getFileSha256(fullPath);
      const sizeStr = String(stat.size).padStart(11, ' ');
      manifestLines.push(`${hash} ${sizeStr} ${relPath}`);
    }
  }
}

scanFilesForManifest(outDir);
const manifestText = manifestLines.join('\n') + '\n';
fs.writeFileSync(path.resolve(repoRoot, 'release/SHA256_PORTABLE_MANIFEST.txt'), manifestText, 'utf8');
fs.writeFileSync(path.join(outDir, 'SHA256_MANIFEST.txt'), manifestText, 'utf8');

console.log('[Assemble] Portable distribution assembly & SHA-256 manifest complete!');
