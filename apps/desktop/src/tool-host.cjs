/**
 * @file tool-host.cjs
 * @description Safe Read-Only Tool Host & Workspace Command Execution for Union Bot Phase P5 (P5-007).
 *
 * Enforces:
 * - Read-only workspace boundary enforcement (no file writes or path traversal outside workspace).
 * - Safe git status and file search.
 * - Zero-cost execution with local timeout and resource bounds.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

class ToolHost {
  constructor(workspaceRoot) {
    this.workspaceRoot = path.resolve(workspaceRoot || process.cwd());
  }

  /**
   * Sets or updates the active workspace root.
   */
  setWorkspaceRoot(newRoot) {
    if (typeof newRoot === 'string' && newRoot.trim().length > 0) {
      this.workspaceRoot = path.resolve(newRoot);
    }
  }

  /**
   * Resolves and verifies that a relative path stays strictly within the workspace root.
   * Throws ERR_PATH_TRAVERSAL if an escape attempt is detected (P5-005, P5-010).
   */
  resolveSafePath(targetPath) {
    if (typeof targetPath !== 'string' || !targetPath.trim()) {
      throw new Error('ERR_INVALID_PATH: Path must be a non-empty string');
    }
    const resolved = path.resolve(this.workspaceRoot, targetPath.trim());
    if (resolved !== this.workspaceRoot && !resolved.startsWith(this.workspaceRoot + path.sep)) {
      throw new Error(`ERR_PATH_TRAVERSAL: Access denied outside workspace boundary (${targetPath})`);
    }
    return resolved;
  }

  /**
   * Read-only file reader with workspace boundary enforcement (P5-007).
   */
  async readFile(targetPath, maxBytes = 2 * 1024 * 1024) {
    try {
      const safePath = this.resolveSafePath(targetPath);
      if (!fs.existsSync(safePath)) {
        return { success: false, error: `File not found: ${targetPath}` };
      }
      const stat = fs.statSync(safePath);
      if (!stat.isFile()) {
        return { success: false, error: `Target is not a file: ${targetPath}` };
      }
      if (stat.size > maxBytes) {
        return { success: false, error: `File size (${stat.size} bytes) exceeds limit of ${maxBytes} bytes` };
      }

      const content = fs.readFileSync(safePath, 'utf8');
      return {
        success: true,
        path: targetPath,
        sizeBytes: stat.size,
        content,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Searches for files matching a query within the workspace root (P5-007).
   */
  async searchFiles(query, maxResults = 25) {
    try {
      if (!query || typeof query !== 'string') {
        return { success: false, error: 'Query string is required' };
      }
      const q = query.toLowerCase();
      const results = [];

      const walk = (dir) => {
        if (results.length >= maxResults) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') {
            continue;
          }
          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(this.workspaceRoot, fullPath);

          if (entry.name.toLowerCase().includes(q)) {
            results.push({
              path: relPath.replace(/\\/g, '/'),
              type: entry.isDirectory() ? 'directory' : 'file',
            });
            if (results.length >= maxResults) return;
          }

          if (entry.isDirectory()) {
            walk(fullPath);
          }
        }
      };

      walk(this.workspaceRoot);
      return { success: true, query, count: results.length, results };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Safe read-only Git status check within workspace (P5-007).
   */
  async getGitStatus() {
    return new Promise((resolve) => {
      execFile('git', ['status', '--porcelain', '-b'], {
        cwd: this.workspaceRoot,
        timeout: 5000,
      }, (err, stdout, stderr) => {
        if (err) {
          return resolve({ success: false, error: stderr.trim() || err.message });
        }
        const lines = stdout.trim().split('\n').filter(Boolean);
        const branchHeader = lines[0] || '';
        const changedFiles = lines.slice(1).map(l => l.trim());
        resolve({
          success: true,
          branch: branchHeader.replace('## ', ''),
          changedCount: changedFiles.length,
          changes: changedFiles.slice(0, 50),
        });
      });
    });
  }

  /**
   * Runs safe test command within workspace with strict resource timeout (P5-007).
   */
  async runSafeTest(command = 'test', timeoutMs = 15000) {
    return new Promise((resolve) => {
      const allowedCommands = ['test', 'lint', 'typecheck', 'status'];
      if (!allowedCommands.includes(command)) {
        return resolve({ success: false, error: `Command '${command}' not permitted in safe tool host` });
      }

      let bin = 'npm';
      let args = ['test', '--', '--test-only'];
      if (process.platform === 'win32') {
        bin = 'npm.cmd';
      }

      execFile(bin, args, {
        cwd: this.workspaceRoot,
        timeout: timeoutMs,
      }, (err, stdout, stderr) => {
        resolve({
          success: !err,
          command,
          exitCode: err ? (err.code || 1) : 0,
          stdout: stdout.slice(-2000),
          stderr: stderr.slice(-2000),
        });
      });
    });
  }
}

module.exports = { ToolHost };
