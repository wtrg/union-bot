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
}

export class ArtifactStore {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir);
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
   * Stores raw bytes into the CAS store.
   * Path: <baseDir>/<sha256.substring(0, 2)>/<sha256>
   */
  public storeBytes(
    buffer: Buffer,
    mimeType: string,
    fidelity: ArtifactFidelity,
    provenance: ArtifactProvenance,
    originalFilename?: string
  ): ArtifactMetadata {
    const sha256 = ArtifactStore.hashBuffer(buffer);
    const prefix = sha256.substring(0, 2);
    const bucketDir = path.join(this.baseDir, prefix);
    if (!fs.existsSync(bucketDir)) {
      fs.mkdirSync(bucketDir, { recursive: true });
    }

    const targetPath = path.join(bucketDir, sha256);
    if (!fs.existsSync(targetPath)) {
      fs.writeFileSync(targetPath, buffer);
    }

    const metadata: ArtifactMetadata = {
      sha256,
      byteSize: buffer.length,
      mimeType,
      originalFilename,
      fidelity,
      transferState: 'local_verified',
      provenance,
      storedPath: targetPath
    };

    return metadata;
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
   * Retrieves raw bytes by SHA256 digest, verifying integrity.
   */
  public readBytes(sha256: string): Buffer {
    const validHash = this.validateSha256(sha256);
    const prefix = validHash.substring(0, 2);
    const targetPath = path.resolve(this.baseDir, prefix, validHash);

    // Defense-in-depth: Ensure target path cannot escape baseDir
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
}
