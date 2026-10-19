/**
 * @file codex-discovery.ts
 * @description Local Codex Executable & Version Discovery for Union Bot (Phase P6 - Ticket P6-001).
 *
 * Guarantees:
 * - Discovers local `codex` executable across Windows, macOS, and Linux.
 * - Parses version string safely without throwing.
 * - Fail-closed: If `codex` is not installed, returns structured guidance without crashing the application.
 * - Zero-cost: Local inspection only, zero network egress.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

export interface CodexDiscoveryResult {
  available: boolean;
  executablePath?: string;
  version?: string;
  error?: string;
  installInstructions?: string;
}

export class CodexDiscovery {
  /**
   * Discovers the local codex executable and verifies its version.
   */
  public static discover(customPath?: string): CodexDiscoveryResult {
    const candidatePaths: string[] = [];

    if (customPath && customPath.trim().length > 0) {
      const explicitPath = path.resolve(customPath.trim());
      if (!fs.existsSync(explicitPath)) {
        return {
          available: false,
          error: 'ERR_CODEX_NOT_INSTALLED',
          installInstructions: `Codex executable not found at specified path: ${explicitPath}. Install Codex via: npm install -g @openai/codex.`,
        };
      }
      candidatePaths.push(explicitPath);
    } else {
      if (process.platform === 'win32') {
        const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

        candidatePaths.push(
          path.join(appData, 'npm', 'codex.cmd'),
          path.join(appData, 'npm', 'codex.ps1'),
          path.join(appData, 'npm', 'codex'),
          path.join(localAppData, 'Programs', 'codex', 'codex.exe'),
          path.join(os.homedir(), '.cargo', 'bin', 'codex.exe')
        );
      } else {
        candidatePaths.push(
          '/usr/local/bin/codex',
          '/usr/bin/codex',
          path.join(os.homedir(), '.cargo', 'bin', 'codex'),
          path.join(os.homedir(), '.npm-global', 'bin', 'codex')
        );
      }

      // Try resolving from PATH via 'where' or 'which'
      try {
        const probeCmd = process.platform === 'win32' ? 'where.exe' : 'which';
        const stdout = execFileSync(probeCmd, ['codex'], {
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
        error: 'ERR_CODEX_NOT_INSTALLED',
        installInstructions:
          'Codex is not installed or not found on PATH. Install Codex via: npm install -g @openai/codex or visit https://github.com/openai/codex.',
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
      };
    } catch (err: any) {
      return {
        available: false,
        executablePath: resolvedPath,
        error: `ERR_CODEX_EXEC_FAILED: ${err.message || String(err)}`,
        installInstructions:
          'Codex binary found but failed to execute --version. Check file execution permissions or install via npm install -g @openai/codex.',
      };
    }
  }
}
