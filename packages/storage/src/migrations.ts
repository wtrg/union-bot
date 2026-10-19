/**
 * @file migrations.ts
 * @description Hardened transactional SQLite schema migrations engine for Union Bot (P2-003, UB-P2-R01-006, P2-T08, P2-T09, UB-P2-R04-01).
 *
 * Guarantees:
 * - Authoritative single schema registry shared with Desktop Electron native & Node 24 storage-worker.
 * - Every migration step and tracker write runs inside an atomic BEGIN IMMEDIATE TRANSACTION ... COMMIT / ROLLBACK.
 * - Fault injection / mid-migration failure leaves zero partial schema.
 * - SHA-256 checksum recorded in schema_migrations; tampered migration definitions are strictly rejected.
 * - Future/unsupported database versions are detected and prevented from corrupting data.
 * - PRAGMA foreign_keys = ON enforced.
 */

import { DatabaseSync } from 'node:sqlite';
import { UnionBotError } from './errors.ts';
// Import authoritative shared migration registry
// @ts-ignore - CommonJS module import in strip-types environment
import schemaDefinition from './schema-definition.cjs';

const {
  MIGRATION_1_SQL,
  CANONICAL_MIGRATION_1_CHECKSUM,
  LEGACY_R04_EMPTY_CHECKSUM,
  computeChecksum: schemaComputeChecksum,
  runSchemaMigrations,
} = schemaDefinition;

export interface Migration {
  version: number;
  name: string;
  checksum: string;
  up: (db: DatabaseSync) => void;
  down: (db: DatabaseSync) => void;
}

export const computeChecksum = schemaComputeChecksum;

export const MIGRATIONS: Migration[] = schemaDefinition.MIGRATIONS;


/**
 * Runs pending migrations atomically with checksum validation and verified legacy upgrade.
 */
export function runMigrations(db: DatabaseSync): { appliedCount: number; currentVersion: number } {
  try {
    return runSchemaMigrations(db);
  } catch (err: any) {
    if (err instanceof UnionBotError) {
      throw err;
    }
    const code = err.code || 'ERR_MIGRATION_FAILED';
    throw new UnionBotError({
      code: code as any,
      message: err.message,
      cause: err,
      details: err.details,
    });
  }
}

/**
 * Rolls back the latest applied migration atomically.
 */
export function rollbackMigration(db: DatabaseSync): { rolledBackVersion: number | null } {
  const latestRow = db.prepare('SELECT MAX(version) as v FROM schema_migrations').get() as { v: number | null };
  if (!latestRow || latestRow.v === null) {
    return { rolledBackVersion: null };
  }

  const version = latestRow.v;
  const migration = MIGRATIONS.find((m) => m.version === version);
  if (!migration) {
    throw new UnionBotError({
      code: 'ERR_STORAGE_CORRUPTION',
      message: `Cannot rollback migration version ${version}: definition not found`,
    });
  }

  db.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    migration.down(db);
    db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(version);
    db.exec('COMMIT;');
    return { rolledBackVersion: version };
  } catch (err: any) {
    db.exec('ROLLBACK;');
    throw new UnionBotError({
      code: 'ERR_MIGRATION_FAILED',
      message: `Rollback of migration ${version} failed and was rolled back: ${err.message}`,
      cause: err,
    });
  }
}
