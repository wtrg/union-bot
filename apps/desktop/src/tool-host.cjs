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
const crypto = require('node:crypto');

const ABSOLUTE_MAX_READ_BYTES = 5 * 1024 * 1024; // 5 MB hard cap (P5-R02-T02)

/**
 * Cryptographically trusted approval registry for native script execution.
 * Enforces:
 * - HMAC-SHA256 signatures over id:command:expiresAt:status.
 * - Mandatory non-empty ID and APPROVED status.
 * - Mandatory command binding (fail-closed if missing or mismatched).
 * - Mandatory expiration (fail-closed if missing or expired).
 * - Anti-forgery: self-crafted/unregistered tokens strictly rejected.
 * - Anti-replay: single-use atomic consumption.
 */
class ApprovalRegistry {
  constructor(secret) {
    this.secret = secret || crypto.randomBytes(32).toString('hex');
    this.tokens = new Map(); // tokenId -> tokenRecord
  }

  /**
   * Issues a cryptographically signed approval token bound to an exact command.
   */
  issueToken({ command, expiresInMs = 60000, metadata = {} } = {}) {
    if (!command || typeof command !== 'string' || !command.trim()) {
      throw new Error('ERR_INVALID_COMMAND: Approval token must have a valid bound command');
    }
    const cleanCommand = command.trim();
    const id = `tok_th_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    const issuedAt = Date.now();
    const expiresAt = issuedAt + Math.max(1, expiresInMs);

    // Cryptographic signature binding id, command, and expiresAt
    const sigPayload = `${id}:${cleanCommand}:${expiresAt}:APPROVED`;
    const signature = crypto.createHmac('sha256', this.secret).update(sigPayload).digest('hex');

    const token = {
      id,
      status: 'APPROVED',
      boundCommand: cleanCommand,
      issuedAt,
      expiresAt,
      signature,
      consumed: false,
      metadata,
    };

    this.tokens.set(id, token);
    return token;
  }

  /**
   * Validates and atomically consumes an approval token.
   * Fail-closed against missing token, invalid status, unbound/mismatched command,
   * expired timestamp, forged signature, unregistered token, or replayed token.
   */
  validateAndConsume(token, command) {
    if (!token || typeof token !== 'object') {
      return { valid: false, code: 'ERR_MISSING_TOKEN', reason: 'Missing approval token object' };
    }
    const { id, status, boundCommand, expiresAt, signature } = token;

    // 1. Mandatory ID
    if (!id || typeof id !== 'string' || !id.trim()) {
      return { valid: false, code: 'ERR_INVALID_TOKEN_ID', reason: 'Invalid or missing token ID' };
    }

    // 2. Mandatory status
    if (status !== 'APPROVED') {
      return { valid: false, code: 'ERR_TOKEN_STATUS_INVALID', reason: `Invalid token status: ${status}` };
    }

    // 3. Mandatory command binding (fail-closed if missing)
    if (!boundCommand || typeof boundCommand !== 'string' || !boundCommand.trim()) {
      return { valid: false, code: 'ERR_UNBOUND_COMMAND', reason: 'Token must have mandatory boundCommand' };
    }
    if (boundCommand.trim() !== (command || '').trim()) {
      return { valid: false, code: 'ERR_COMMAND_MISMATCH', reason: `Token is bound to command '${boundCommand}', not '${command}'` };
    }

    // 4. Mandatory expiration (fail-closed if missing)
    if (!expiresAt) {
      return { valid: false, code: 'ERR_MISSING_EXPIRY', reason: 'Token must have mandatory expiresAt timestamp' };
    }
    const expiryNum = typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt);
    if (isNaN(expiryNum) || expiryNum <= Date.now()) {
      return { valid: false, code: 'ERR_TOKEN_EXPIRED', reason: 'Approval token has expired' };
    }

    // 5. Anti-forgery check: Signature & Registry verification
    if (!signature || typeof signature !== 'string') {
      return { valid: false, code: 'ERR_TOKEN_FORGED', reason: 'Missing cryptographic signature (untrusted/forged token)' };
    }
    const expectedSig = crypto.createHmac('sha256', this.secret)
      .update(`${id}:${boundCommand.trim()}:${expiryNum}:APPROVED`)
      .digest('hex');

    const sigBuf = Buffer.from(signature, 'hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return { valid: false, code: 'ERR_TOKEN_FORGED', reason: 'Cryptographic signature mismatch (untrusted/forged token)' };
    }

    // 6. Registry verification (must be issued by this registry)
    const recorded = this.tokens.get(id);
    if (!recorded) {
      return { valid: false, code: 'ERR_UNREGISTERED_TOKEN', reason: 'Token not issued by trusted authority (unregistered)' };
    }

    // 7. Anti-replay defense: Once consumed, cannot be reused
    if (recorded.consumed) {
      return { valid: false, code: 'ERR_TOKEN_REPLAY', reason: 'Approval token already consumed (replay attack denied)' };
    }

    // Mark atomically consumed
    recorded.consumed = true;
    recorded.consumedAt = Date.now();
    return { valid: true, token: recorded };
  }
}

class ToolHost {
  constructor(workspaceRoot, options = {}) {
    this.workspaceRoot = path.resolve(workspaceRoot || process.cwd());
    this.approvalRegistry = options.approvalRegistry || new ApprovalRegistry(options.secret);
  }

  /**
   * Issues a trusted approval token via the internal ApprovalRegistry.
   */
  issueApprovalToken(opts) {
    return this.approvalRegistry.issueToken(opts);
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
   * Validates human approval token via the trusted ApprovalRegistry (UB-P5-R01-002 / Gate Hardening).
   * Verifies status, non-empty tokenId, command binding, non-expiration, signature, and anti-replay.
   */
  validateApprovalToken(token, command) {
    return this.approvalRegistry.validateAndConsume(token, command);
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

module.exports = { ToolHost, ApprovalRegistry, ABSOLUTE_MAX_READ_BYTES };
