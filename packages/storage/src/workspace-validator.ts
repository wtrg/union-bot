/**
 * @file workspace-validator.ts
 * @description Hardened Workspace Path Allowlist and Traversal Defense for Union Bot (P2-007, UB-P2-R01-010, P2-T16).
 *
 * Guarantees:
 * - Walks up ancestor chain recursively to find the deepest existing ancestor and resolves realpathSync (detecting junctions/symlinks).
 * - Defends against:
 *   - '..' traversal and null bytes
 *   - Alternate Data Streams (ADS: 'file.txt:hidden')
 *   - Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
 *   - Trailing dots and spaces on path components
 *   - Drive-relative paths ('C:foo' without slash)
 *   - Unallowed UNC network paths ('\\\\evil\\share')
 *   - Symlink and NTFS junction escapes
 */

import path from 'node:path';
import fs from 'node:fs';
import { UnionBotError } from './errors.ts';

const WINDOWS_RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

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
   * Validates that targetPath resolves strictly within one of the allowed workspace roots.
   */
  public validate(targetPath: string): string {
    if (!targetPath || typeof targetPath !== 'string') {
      throw new UnionBotError({
        code: 'ERR_PATH_TRAVERSAL_DENIED',
        message: 'Invalid target path provided.',
      });
    }

    // 1. Null byte injection check
    if (targetPath.includes('\0')) {
      throw new UnionBotError({
        code: 'ERR_PATH_TRAVERSAL_DENIED',
        message: 'Null byte injection detected in path.',
      });
    }

    // 2. Drive-relative check (e.g. "C:foo" instead of "C:\foo")
    if (/^[a-zA-Z]:[^\\/]/.test(targetPath)) {
      throw new UnionBotError({
        code: 'ERR_PATH_TRAVERSAL_DENIED',
        message: `Drive-relative paths without leading separator are disallowed: ${targetPath}`,
      });
    }

    // 3. Alternate Data Streams (ADS) check: ':' appearing after drive letter
    const withoutDrive = targetPath.replace(/^[a-zA-Z]:/, '');
    if (withoutDrive.includes(':')) {
      throw new UnionBotError({
        code: 'ERR_PATH_TRAVERSAL_DENIED',
        message: `Alternate Data Streams (ADS) syntax ':' is disallowed: ${targetPath}`,
      });
    }

    // 4. Resolve full path
    const resolved = path.resolve(targetPath);
    const normalized = path.normalize(resolved);

    // 5. Windows reserved device names and trailing dot/space checks on each segment
    const segments = normalized.split(path.sep).filter(Boolean);
    for (const segment of segments) {
      // Check trailing dot or space (Windows filesystem quirk / bypass vector)
      if (segment.endsWith('.') || segment.endsWith(' ')) {
        throw new UnionBotError({
          code: 'ERR_PATH_TRAVERSAL_DENIED',
          message: `Path segment with trailing dot or space is disallowed: '${segment}'`,
        });
      }

      // Check reserved names (e.g. CON, NUL, AUX, etc.)
      const baseName = segment.split('.')[0].toLowerCase();
      if (WINDOWS_RESERVED_NAMES.has(baseName)) {
        throw new UnionBotError({
          code: 'ERR_PATH_TRAVERSAL_DENIED',
          message: `Windows reserved device name is disallowed in path: '${segment}'`,
        });
      }
    }

    // 6. Deepest existing ancestor walk to detect symlinks / reparse points / junctions
    let currentCheck = normalized;
    const missingSegments: string[] = [];

    while (currentCheck && !fs.existsSync(currentCheck)) {
      const parent = path.dirname(currentCheck);
      if (parent === currentCheck) break; // Reached filesystem root
      missingSegments.unshift(path.basename(currentCheck));
      currentCheck = parent;
    }

    let realTarget = normalized;
    if (fs.existsSync(currentCheck)) {
      try {
        const canonicalAncestor = fs.realpathSync(currentCheck);
        realTarget = missingSegments.length > 0
          ? path.join(canonicalAncestor, ...missingSegments)
          : canonicalAncestor;
      } catch (err: any) {
        throw new UnionBotError({
          code: 'ERR_PATH_TRAVERSAL_DENIED',
          message: `Failed to resolve realpath for ancestor '${currentCheck}': ${err.message}`,
          cause: err,
        });
      }
    }

    // 7. Verify realTarget is inside one of the allowed roots
    const targetNormalized = path.normalize(realTarget).toLowerCase();
    const isAllowed = this.allowedRoots.some((root) => {
      const rootNormalized = path.normalize(root).toLowerCase();
      return (
        targetNormalized === rootNormalized ||
        targetNormalized.startsWith(rootNormalized + path.sep)
      );
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
