import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export type ArtifactFidelity =
  | 'original_bytes'
  | 'structured_copy'
  | 'rendered_preview'
  | 'screenshot_only'
  | 'reference_only'
  | 'unavailable';

export type ArtifactTransferState =
  | 'local_verified'
  | 'reference_only'
  | 'needs_manual_export'
  | 'blocked_permission'
  | 'failed';

export interface ArtifactProvenance {
  sourceActor: string; // e.g. 'antigravity', 'codex', 'chatgpt_web', 'user'
  provider: string;    // e.g. 'local', 'openai', 'google', 'anthropic'
  turnId?: string;
  captureMethod: 'auto_captured' | 'user_manual' | 'filesystem';
  timestamp: string;
}

export interface ArtifactMetadata {
  sha256: string;
  byteSize: number;
  mimeType: string;
  originalFilename?: string;
  fidelity: ArtifactFidelity;
  transferState: ArtifactTransferState;
  provenance: ArtifactProvenance;
  storedPath: string;
  deduplicated?: boolean;
}

export const DEFAULT_MAX_ARTIFACT_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB (P5-012)

/**
 * Detects MIME type from magic bytes in buffer with security-oriented fallbacks (P5-001, P5-010).
 */
export function detectMimeType(buffer: Buffer, fallbackMime?: string): string {
  if (!buffer || buffer.length === 0) {
    return fallbackMime || 'application/octet-stream';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // GIF: GIF87a or GIF89a
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return 'image/gif';
  }

  // WebP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  // PDF: %PDF-
  if (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  ) {
    return 'application/pdf';
  }

  // ZIP / Office doc: PK.. (50 4B 03 04)
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return 'application/zip';
  }

  // Text / SVG / Code inspection
  const snippet = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('utf8');

  // SVG: starts with <svg or xml followed by <svg
  if (/<svg[\s>]/i.test(snippet)) {
    return 'image/svg+xml';
  }

  // HTML: <html or <!DOCTYPE html (P5-010 security flag)
  if (/<!DOCTYPE\s+html|<html[\s>]/i.test(snippet)) {
    return 'text/html';
  }

  // JSON
  const trimmed = snippet.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(buffer.toString('utf8'));
      return 'application/json';
    } catch {}
  }

  // Fallback to provided MIME or octet-stream
  return fallbackMime || 'application/octet-stream';
}

/**
 * Sanitizes SVG content by strictly stripping scripts, inline event handlers, and javascript: URLs (P5-010).
 */
export function sanitizeSvg(rawSvg: string): string {
  if (typeof rawSvg !== 'string') return '';
  return rawSvg
    .replace(/<script[\s\S]*?<\/script>/gi, '') // Strip script tags
    .replace(/<script[\s\S]*?$/gi, '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '') // Strip on* event attributes
    .replace(/\son\w+\s*=\s*[^>\s]+/gi, '')
    .replace(/href\s*=\s*(['"])javascript:.*?\1/gi, 'href=$1#$1') // Neutralize javascript: hrefs
    .replace(/xlink:href\s*=\s*(['"])javascript:.*?\1/gi, 'xlink:href=$1#$1');
}

export class ArtifactStore {
  private readonly baseDir: string;
  private readonly maxSizeBytes: number;

  constructor(baseDir: string, maxSizeBytes: number = DEFAULT_MAX_ARTIFACT_SIZE_BYTES) {
    this.baseDir = path.resolve(baseDir);
    this.maxSizeBytes = maxSizeBytes;
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Computes SHA256 hex digest of a buffer.
   */
  public static hashBuffer(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Validates that a string is a standard 64-character lowercase or uppercase hex SHA-256 digest.
   */
  public static isValidSha256(hash: string): boolean {
    return typeof hash === 'string' && /^[a-f0-9]{64}$/i.test(hash.trim());
  }

  private validateSha256(sha256: string): string {
    const trimmed = (sha256 || '').trim().toLowerCase();
    if (!ArtifactStore.isValidSha256(trimmed)) {
      throw new Error(`Invalid SHA256 digest format: "${sha256}". Must be a valid 64-character hexadecimal string.`);
    }
    return trimmed;
  }

  /**
   * Stores raw bytes into the CAS store with ATOMIC write and deduplication (P5-001, P5-012).
   * Path: <baseDir>/<sha256.substring(0, 2)>/<sha256>
   */
  public storeBytes(
    buffer: Buffer,
    mimeType: string,
    fidelity: ArtifactFidelity,
    provenance: ArtifactProvenance,
    originalFilename?: string
  ): ArtifactMetadata {
    if (buffer.length > this.maxSizeBytes) {
      throw new Error(`ERR_FILE_TOO_LARGE: Artifact size (${buffer.length} bytes) exceeds limit of ${this.maxSizeBytes} bytes (P5-012)`);
    }

    const sha256 = ArtifactStore.hashBuffer(buffer);
    const detectedMime = detectMimeType(buffer, mimeType);
    const prefix = sha256.substring(0, 2);
    const bucketDir = path.join(this.baseDir, prefix);
    if (!fs.existsSync(bucketDir)) {
      fs.mkdirSync(bucketDir, { recursive: true });
    }

    const targetPath = path.join(bucketDir, sha256);
    let deduplicated = false;

    if (!fs.existsSync(targetPath)) {
      // Atomic write: write to a temporary file then renameSync (P5-001)
      const tmpPath = path.join(bucketDir, `.tmp-${sha256}-${crypto.randomBytes(6).toString('hex')}`);
      try {
        fs.writeFileSync(tmpPath, buffer);
        fs.renameSync(tmpPath, targetPath);
      } catch (err) {
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
        throw err;
      }
    } else {
      deduplicated = true;
    }

    return {
      sha256,
      byteSize: buffer.length,
      mimeType: detectedMime,
      originalFilename,
      fidelity,
      transferState: 'local_verified',
      provenance,
      storedPath: targetPath,
      deduplicated,
    };
  }

  /**
   * Retrieves raw bytes by SHA256 digest, verifying integrity.
   */
  public readBytes(sha256: string): Buffer {
    const validHash = this.validateSha256(sha256);
    const prefix = validHash.substring(0, 2);
    const targetPath = path.resolve(this.baseDir, prefix, validHash);

    // Defense-in-depth: Ensure target path cannot escape baseDir (P5-010)
    if (!targetPath.startsWith(this.baseDir)) {
      throw new Error(`Path traversal attempt detected for artifact ${sha256}`);
    }

    if (!fs.existsSync(targetPath)) {
      throw new Error(`Artifact with SHA256 ${validHash} not found in store.`);
    }

    const buffer = fs.readFileSync(targetPath);
    const computedHash = ArtifactStore.hashBuffer(buffer);
    if (computedHash !== validHash) {
      throw new Error(`Integrity check failed for ${validHash}: computed ${computedHash}`);
    }

    return buffer;
  }

  /**
   * Checks if an artifact exists by SHA256.
   */
  public hasArtifact(sha256: string): boolean {
    if (!ArtifactStore.isValidSha256(sha256)) {
      return false;
    }
    const validHash = sha256.trim().toLowerCase();
    const prefix = validHash.substring(0, 2);
    const targetPath = path.resolve(this.baseDir, prefix, validHash);
    if (!targetPath.startsWith(this.baseDir)) {
      return false;
    }
    return fs.existsSync(targetPath);
  }

  /**
   * Returns metadata and stats of an artifact without necessarily loading entire content into memory (P5-012).
   */
  public inspectArtifact(sha256: string): { sha256: string; byteSize: number; storedPath: string } | null {
    if (!this.hasArtifact(sha256)) return null;
    const validHash = sha256.trim().toLowerCase();
    const prefix = validHash.substring(0, 2);
    const targetPath = path.resolve(this.baseDir, prefix, validHash);
    const stats = fs.statSync(targetPath);
    return {
      sha256: validHash,
      byteSize: stats.size,
      storedPath: targetPath,
    };
  }

  /**
   * Builds an export manifest mapping SHA256 hashes to metadata for backup/export bundles (P5-011).
   */
  public generateManifest(shaList: string[]): Array<{ sha256: string; byteSize: number; exists: boolean }> {
    return shaList.map(sha => {
      const info = this.inspectArtifact(sha);
      return {
        sha256: sha,
        byteSize: info ? info.byteSize : 0,
        exists: !!info,
      };
    });
  }
}
