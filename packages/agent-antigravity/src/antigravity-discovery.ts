/**
 * @file antigravity-discovery.ts
 * @description Local Antigravity (agy) Executable & Version Discovery for Union Bot (Phase P7 - Ticket P7-001).
 *
 * Guarantees:
 * - Discovers local `agy` executable across Windows, macOS, and Linux.
 * - Parses version string safely without throwing.
 * - Fail-closed: If `agy` is not installed, returns structured guidance without crashing the application.
 * - Zero-cost: Local inspection only, zero network egress.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

export interface AntigravityDiscoveryResult {
  available: boolean;
  executablePath?: string;
  version?: string;
  authStatus?: 'FREE_LOCAL' | 'LOGIN_REQUIRED' | 'UNAVAILABLE';
  error?: string;
  installInstructions?: string;
}

export class AntigravityDiscovery {
  /**
   * Discovers the local Antigravity (agy) executable and verifies its version.
   */
  public static discover(customPath?: string): AntigravityDiscoveryResult {
    const candidatePaths: string[] = [];

    if (customPath && customPath.trim().length > 0) {
      const explicitPath = path.resolve(customPath.trim());
      if (!fs.existsSync(explicitPath)) {
        return {
          available: false,
          error: 'ERR_ANTIGRAVITY_NOT_INSTALLED',
          installInstructions: `Antigravity executable not found at specified path: ${explicitPath}. Install Antigravity CLI via Google DeepMind official channels or check PATH.`,
        };
      }
      candidatePaths.push(explicitPath);
    } else {
      if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
        const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');

        candidatePaths.push(
          path.join(localAppData, 'agy', 'bin', 'agy.exe'),
          path.join(localAppData, 'Programs', 'agy', 'bin', 'agy.exe'),
          path.join(localAppData, 'Programs', 'agy', 'agy.exe'),
          path.join(appData, 'npm', 'agy.cmd'),
          path.join(appData, 'npm', 'agy.exe'),
          path.join(os.homedir(), '.antigravity', 'bin', 'agy.exe')
        );
      } else {
        candidatePaths.push(
          path.join(os.homedir(), '.local', 'bin', 'agy'),
          '/usr/local/bin/agy',
          '/usr/bin/agy',
          path.join(os.homedir(), '.antigravity', 'bin', 'agy')
        );
      }

      // Try resolving from PATH via 'where.exe' or 'which'
      try {
        const probeCmd = process.platform === 'win32' ? 'where.exe' : 'which';
        const stdout = execFileSync(probeCmd, ['agy'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 3000,
        });
        const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          if (!candidatePaths.includes(line)) {
            candidatePaths.unshift(line);
          }
        }
      } catch {
        // PATH probe failed or binary not found on PATH; continue checking candidates
      }
    }

    // Check candidate paths existence
    let resolvedPath: string | null = null;
    for (const cand of candidatePaths) {
      if (cand && fs.existsSync(cand)) {
        try {
          const stat = fs.statSync(cand);
          if (stat.isFile()) {
            resolvedPath = cand;
            break;
          }
        } catch {
          continue;
        }
      }
    }

    if (!resolvedPath) {
      return {
        available: false,
        error: 'ERR_ANTIGRAVITY_NOT_INSTALLED',
        installInstructions:
          'Antigravity CLI (agy) is not installed or not found on PATH. Ensure agy is installed at %LOCALAPPDATA%\\agy\\bin\\agy.exe or added to system PATH.',
      };
    }

    // Verify version by running `--version`
    try {
      const isWindows = process.platform === 'win32';
      const isCmdOrBat = isWindows && (resolvedPath.endsWith('.cmd') || resolvedPath.endsWith('.bat'));
      let versionOutput = '';

      if (isCmdOrBat) {
        versionOutput = execFileSync('cmd.exe', ['/c', resolvedPath, '--version'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 5000,
        }).trim();
      } else {
        versionOutput = execFileSync(resolvedPath, ['--version'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 5000,
          shell: isWindows,
        }).trim();
      }

      const versionMatch = versionOutput.match(/(\d+\.\d+\.\d+)/);
      const parsedVersion = versionMatch ? versionMatch[1] : versionOutput;

      return {
        available: true,
        executablePath: resolvedPath,
        version: parsedVersion,
        authStatus: 'FREE_LOCAL',
      };
    } catch (err: any) {
      return {
        available: false,
        executablePath: resolvedPath,
        error: `ERR_ANTIGRAVITY_EXEC_FAILED: ${err.message || String(err)}`,
        installInstructions:
          'Antigravity binary found but failed to execute --version. Check execution permissions.',
      };
    }
  }
}
