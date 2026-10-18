/**
 * @file workspace-validator.ts
 * @description Workspace Path Allowlist and Traversal Defense for Union Bot (P2-007).
 */

import path from 'node:path';
import fs from 'node:fs';
import { UnionBotError } from './errors.ts';

export class WorkspacePathValidator {
  private allowedRoots: string[] = [];

  constructor(allowedRoots: string[] = []) {
    this.allowedRoots = allowedRoots.map((r) => this.canonicalize(r));
  }

  public addAllowedRoot(rootPath: string): void {
    this.allowedRoots.push(this.canonicalize(rootPath));
  }

  private canonicalize(p: string): string {
    const resolved = path.resolve(p);
    try {
      if (fs.existsSync(resolved)) {
        return path.normalize(fs.realpathSync(resolved));
      }
    } catch {
      // If doesn't exist yet, normalize resolved
    }
    return path.normalize(resolved);
  }

  /**
   * Validates that targetPath resolves within one of the allowed workspace roots.
   * Defends against '..', null bytes, symlinks, junctions, alternative data streams, and drive jumping.
   */
  public validate(targetPath: string): string {
    if (!targetPath || typeof targetPath !== 'string') {
      throw new UnionBotError({
        code: 'ERR_PATH_TRAVERSAL_DENIED',
        message: 'Invalid target path provided.',
      });
    }

    if (targetPath.includes('\0')) {
      throw new UnionBotError({
        code: 'ERR_PATH_TRAVERSAL_DENIED',
        message: 'Null byte injection detected in path.',
      });
    }

    // Resolve full path
    const normalized = path.normalize(path.resolve(targetPath));

    // Resolve realpath if file or parent directory exists to detect symlink escapes
    let realTarget = normalized;
    try {
      if (fs.existsSync(normalized)) {
        realTarget = fs.realpathSync(normalized);
      } else {
        const parent = path.dirname(normalized);
        if (fs.existsSync(parent)) {
          realTarget = path.join(fs.realpathSync(parent), path.basename(normalized));
        }
      }
    } catch (err) {
      throw new UnionBotError({
        code: 'ERR_PATH_TRAVERSAL_DENIED',
        message: `Failed to resolve realpath for: ${targetPath}`,
        cause: err,
      });
    }

    const targetLower = realTarget.toLowerCase();
    const isAllowed = this.allowedRoots.some((root) => {
      const rootLower = root.toLowerCase();
      return targetLower === rootLower || targetLower.startsWith(rootLower + path.sep);
    });

    if (!isAllowed) {
      throw new UnionBotError({
        code: 'ERR_PATH_TRAVERSAL_DENIED',
        message: `Access denied: target path '${targetPath}' resolves outside allowed workspace roots.`,
        details: { targetPath, resolvedReal: realTarget, allowedRoots: this.allowedRoots },
      });
    }

    return realTarget;
  }
}
