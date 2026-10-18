/**
 * @file backup-manager.ts
 * @description Storage Backup, Restore, and Redacted Diagnostic Export for Union Bot (P2-009, P2-010).
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { StorageEngine } from './storage-engine.ts';
import { UnionBotError } from './errors.ts';

export interface BackupManifest {
  version: string;
  databaseFilename: string;
  sha256: string;
  sizeBytes: number;
  timestamp: string;
}

export class StorageBackupManager {
  private storage: StorageEngine;

  constructor(storage: StorageEngine) {
    this.storage = storage;
  }

  /**
   * P2-010: Creates an atomic backup snapshot of the database with SHA256 manifest.
   */
  public backup(destDir: string): { backupFile: string; manifestFile: string; manifest: BackupManifest } {
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `union_bot_backup_${timestamp}.db`;
    const backupFile = path.join(destDir, backupFileName);

    // If using in-memory or file, vacuum into destination
    const db = this.storage.getRawDatabase();
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    db.exec(`VACUUM INTO '${backupFile.replace(/\\/g, '/')}';`);

    const fileBytes = fs.readFileSync(backupFile);
    const sha256 = createHash('sha256').update(fileBytes).digest('hex');

    const manifest: BackupManifest = {
      version: '1.0.0',
      databaseFilename: backupFileName,
      sha256,
      sizeBytes: fileBytes.length,
      timestamp: new Date().toISOString(),
    };

    const manifestFile = path.join(destDir, `manifest_${timestamp}.json`);
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf-8');

    return {
      backupFile,
      manifestFile,
      manifest,
    };
  }

  /**
   * P2-010: Restores a database backup after verifying SHA256 and manifest integrity.
   */
  public static restore(backupFile: string, manifestFile: string, targetPath: string): void {
    if (!fs.existsSync(backupFile)) {
      throw new UnionBotError({
        code: 'ERR_STORAGE_CORRUPTION',
        message: `Backup file not found: ${backupFile}`,
      });
    }

    if (!fs.existsSync(manifestFile)) {
      throw new UnionBotError({
        code: 'ERR_STORAGE_CORRUPTION',
        message: `Manifest file not found: ${manifestFile}`,
      });
    }

    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8')) as BackupManifest;
    const currentBytes = fs.readFileSync(backupFile);
    const calculatedHash = createHash('sha256').update(currentBytes).digest('hex');

    if (calculatedHash !== manifest.sha256) {
      throw new UnionBotError({
        code: 'ERR_STORAGE_CORRUPTION',
        message: 'Backup corruption detected! SHA256 does not match manifest.',
        details: { expected: manifest.sha256, actual: calculatedHash },
      });
    }

    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    fs.copyFileSync(backupFile, targetPath);
  }

  /**
   * P2-009: Exports redacted diagnostics, ensuring secrets, auth cookies, and keys are scrubbed.
   */
  public exportRedactedDiagnostics(): Record<string, unknown> {
    const db = this.storage.getRawDatabase();
    const rooms = db.prepare('SELECT id, name, created_at FROM rooms').all();
    const eventStats = db.prepare('SELECT event_type, COUNT(*) as count FROM events GROUP BY event_type').all();
    const envelopeCount = db.prepare('SELECT COUNT(*) as count FROM envelopes').get() as { count: number };
    const migrations = db.prepare('SELECT version, name, applied_at FROM schema_migrations').all();

    const diagnostics = {
      system: 'Union Bot',
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      rooms,
      eventStats,
      totalEnvelopes: envelopeCount.count,
      migrations,
    };

    // Scrub any unexpected credentials or tokens
    const jsonStr = JSON.stringify(diagnostics);
    const scrubbedStr = jsonStr
      .replace(/("?(password|secret|token|cookie|key)"?\s*:\s*)"[^"]+"/gi, '$1"[REDACTED]"')
      .replace(/sk-[a-zA-Z0-9_-]{20,}/g, '[REDACTED_API_KEY]');

    return JSON.parse(scrubbedStr);
  }
}
