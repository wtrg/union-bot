/**
 * @file tool-host.cjs
 * @description Safe Read-Only Tool Host & Workspace Boundary Enforcement for Union Bot (UB-P5-R01-002, P5-R02-T02).
 *
 * Enforces:
 * - Read-only workspace boundary enforcement with realpath/symlink breakout defense.
 * - Safe git status and file search.
 * - Zero unapproved native script execution (fail-closed with ERR_APPROVAL_REQUIRED).
 * - Zero-cost execution with local timeout and resource bounds.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const ABSOLUTE_MAX_READ_BYTES = 5 * 1024 * 1024; // 5 MB hard cap (P5-R02-T02)

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
   * Defends against both string traversal (../..) and symlink/junction breakouts (P5-R02-T02).
   */
  resolveSafePath(targetPath) {
    if (typeof targetPath !== 'string' || !targetPath.trim()) {
      throw new Error('ERR_INVALID_PATH: Path must be a non-empty string');
    }
    const resolved = path.resolve(this.workspaceRoot, targetPath.trim());
    const relToWorkspace = path.relative(this.workspaceRoot, resolved);
    if (relToWorkspace.startsWith('..') || path.isAbsolute(relToWorkspace)) {
      throw new Error(`ERR_PATH_TRAVERSAL: Access denied outside workspace boundary (${targetPath})`);
    }

    // Defense-in-depth: Verify realpath against symlinks / Windows junctions pointing outside workspace
    if (fs.existsSync(resolved)) {
      try {
        const realResolved = fs.realpathSync(resolved);
        const realWorkspace = fs.realpathSync(this.workspaceRoot);
        const relToRealWorkspace = path.relative(realWorkspace, realResolved);
        if (relToRealWorkspace.startsWith('..') || path.isAbsolute(relToRealWorkspace)) {
          throw new Error(`ERR_PATH_TRAVERSAL: Symlink target outside workspace boundary (${targetPath})`);
        }
        return realResolved;
      } catch (err) {
        if (err.message && err.message.startsWith('ERR_PATH_TRAVERSAL')) {
          throw err;
        }
        throw new Error(`ERR_PATH_TRAVERSAL: Failed to verify canonical realpath for ${targetPath}: ${err.message}`);
      }
    }

    return resolved;
  }

  /**
   * Read-only file reader with workspace boundary enforcement and hard size cap (P5-007, P5-R02-T02).
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

      // Hard limit defense: caller cannot arbitrarily elevate beyond ABSOLUTE_MAX_READ_BYTES
      const effectiveMax = Math.min(Math.max(1, maxBytes), ABSOLUTE_MAX_READ_BYTES);
      if (stat.size > effectiveMax) {
        return { success: false, error: `File size (${stat.size} bytes) exceeds limit of ${effectiveMax} bytes` };
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
      const realWorkspace = fs.realpathSync(this.workspaceRoot);

      const walk = (dir) => {
        if (results.length >= maxResults) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') {
            continue;
          }
          const fullPath = path.join(dir, entry.name);

          // Verify symlink target does not escape workspace
          try {
            const realEntry = fs.realpathSync(fullPath);
            const relToReal = path.relative(realWorkspace, realEntry);
            if (relToReal.startsWith('..') || path.isAbsolute(relToReal)) {
              continue;
            }
          } catch {
            continue;
          }

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
   * Validates human approval token (UB-P5-R01-002 / Gate Hardening).
   * Verifies status, non-empty tokenId, command binding, and non-expiration.
   */
  validateApprovalToken(token, command) {
    if (!token || typeof token !== 'object') {
      return { valid: false, reason: 'Missing approval token' };
    }
    if (token.status !== 'APPROVED') {
      return { valid: false, reason: `Invalid token status: ${token.status}` };
    }
    if (!token.id || typeof token.id !== 'string' || token.id.trim().length === 0) {
      return { valid: false, reason: 'Invalid or missing token ID' };
    }
    if (token.boundCommand && token.boundCommand !== command) {
      return { valid: false, reason: `Token is bound to command '${token.boundCommand}', not '${command}'` };
    }
    if (token.expiresAt) {
      const expiry = typeof token.expiresAt === 'number' ? token.expiresAt : Date.parse(token.expiresAt);
      if (isNaN(expiry) || expiry <= Date.now()) {
        return { valid: false, reason: 'Approval token has expired' };
      }
    }
    return { valid: true };
  }

  /**
   * Native script execution control (UB-P5-R01-002 / P5-R02-T02).
   * ToolHost is strictly read-only. Executing native test scripts requires an explicit approval token.
   */
  async runSafeTest(command = 'test', options = {}) {
    const { approvalToken } = options || {};
    const validation = this.validateApprovalToken(approvalToken, command);
    if (!validation.valid) {
      return {
        success: false,
        code: 'ERR_APPROVAL_REQUIRED',
        error: `ERR_APPROVAL_REQUIRED: Native script execution in ToolHost requires valid approval token (${validation.reason})`,
      };
    }

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
        timeout: options.timeoutMs || 15000,
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

ToolHost.ABSOLUTE_MAX_READ_BYTES = ABSOLUTE_MAX_READ_BYTES;

module.exports = { ToolHost, ABSOLUTE_MAX_READ_BYTES };
