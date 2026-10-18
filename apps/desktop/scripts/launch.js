#!/usr/bin/env node
/**
 * @file launch.js
 * @description Launcher for Union Bot Desktop application on Windows.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function findElectronExecutable() {
  const candidates = [
    process.env.ELECTRON_OVERRIDE_DIST_PATH
      ? path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH, 'electron.exe')
      : null,
    path.resolve(__dirname, '../../../spikes/electron-browser/node_modules/.pnpm/electron@33.4.11/node_modules/electron/dist/electron.exe'),
    path.resolve(process.cwd(), 'spikes/electron-browser/node_modules/.pnpm/electron@33.4.11/node_modules/electron/dist/electron.exe'),
    path.resolve(__dirname, '../../../node_modules/.pnpm/electron@33.4.11/node_modules/electron/dist/electron.exe'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      process.env.ELECTRON_OVERRIDE_DIST_PATH = path.dirname(candidate);
      return candidate;
    }
  }

  try {
    const required = require('electron');
    if (typeof required === 'string' && fs.existsSync(required)) {
      return required;
    }
  } catch {}

  return null;
}

const electronPath = findElectronExecutable();
if (!electronPath) {
  console.error('[LaunchError] Electron binary not found! Please check installation.');
  process.exit(1);
}

const mainScript = path.resolve(__dirname, '../src/main.js');
const args = [mainScript, ...process.argv.slice(2)];

const child = spawn(electronPath, args, {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
