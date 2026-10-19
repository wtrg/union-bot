/**
 * @file schema-definition.cjs
 * @description Authoritative Single Source of Truth for Union Bot SQLite Schema and Migrations (UB-P2-R04-01).
 * Shared across TypeScript StorageEngine, Electron Native SQLite, and Node 24 Storage Worker.
 */

const { createHash } = require('node:crypto');

const MIGRATION_1_SQL = `
  -- 2. Chat & Collaboration Rooms
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 3. Append-only Event Journal (P2-004)
  CREATE TABLE IF NOT EXISTS events (
    sequence_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT UNIQUE NOT NULL,
    stream_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    metadata_json TEXT,
    occurred_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_stream_seq ON events (stream_id, sequence_id);
  CREATE INDEX IF NOT EXISTS idx_events_occurred_at ON events (occurred_at);
  CREATE INDEX IF NOT EXISTS idx_events_type ON events (event_type);

  -- 4. Canonical Envelopes Table
  CREATE TABLE IF NOT EXISTS envelopes (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    correlation_id TEXT,
    room_id TEXT NOT NULL,
    sender_kind TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_role TEXT,
    raw_json TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_envelopes_room ON envelopes (room_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_envelopes_trace ON envelopes (trace_id);

  -- 5. Idempotency Keys (P2-005, C05, UB-P2-R01-005, UB-P2-R02-005)
  CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    target_id TEXT NOT NULL,
    status TEXT NOT NULL,
    payload_digest TEXT,
    response_json TEXT,
    dispatch_prepared INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  -- 6. Outbox for Guaranteed Delivery & Recovery (P2-005, UB-P2-R01-005)
  CREATE TABLE IF NOT EXISTS outbox (
    id TEXT PRIMARY KEY,
    stream_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL,
    retry_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox (status);

  -- 7. Approval Tokens for Actions (P2-006, C02, UB-P2-R01-001, UB-P2-R01-002)
  CREATE TABLE IF NOT EXISTS approvals (
    token_id TEXT PRIMARY KEY,
    action_type TEXT NOT NULL,
    payload_digest TEXT NOT NULL,
    canonicalization_version INTEGER DEFAULT 1,
    origin TEXT NOT NULL,
    workspace_id TEXT,
    room_id TEXT,
    actor_id TEXT,
    recipient TEXT,
    policy_version TEXT DEFAULT '1.0.0',
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    approver_id TEXT,
    approved_at TEXT,
    rejected_at TEXT,
    rejection_reason TEXT,
    consumed_at TEXT
  );

  -- 8. DAG Task Graph Nodes (P2 Task Graph Foundation)
  CREATE TABLE IF NOT EXISTS dag_nodes (
    task_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    name TEXT NOT NULL,
    dependencies_json TEXT NOT NULL,
    assigned_role TEXT NOT NULL,
    assigned_provider TEXT,
    revision INTEGER DEFAULT 1,
    attempt INTEGER DEFAULT 1,
    correlation_id TEXT NOT NULL,
    recovery_state TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (task_id, node_id)
  );
  CREATE INDEX IF NOT EXISTS idx_dag_recovery ON dag_nodes (recovery_state);

  -- 9. Snapshots for Event Sourcing Projection Rebuild (P2-004)
  CREATE TABLE IF NOT EXISTS snapshots (
    stream_id TEXT PRIMARY KEY,
    last_sequence_id INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- 10. Audit Ledger
  CREATE TABLE IF NOT EXISTS audit_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    details_json TEXT,
    created_at TEXT NOT NULL
  );
`;

function computeChecksum(content) {
  return createHash('sha256').update(content.trim(), 'utf8').digest('hex');
}

const CANONICAL_MIGRATION_1_CHECKSUM = computeChecksum(MIGRATION_1_SQL);
// Known legacy checksum from R03/R04 desktop implementations
const LEGACY_R04_EMPTY_CHECKSUM = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const MIGRATIONS = [
  {
    version: 1,
    name: '001_initial_p2_schema',
    checksum: CANONICAL_MIGRATION_1_CHECKSUM,
    sql: MIGRATION_1_SQL,
    up: (db) => {
      db.exec(MIGRATION_1_SQL);
    },
    down: (db) => {
      db.exec(`
        DROP TABLE IF EXISTS audit_ledger;
        DROP TABLE IF EXISTS snapshots;
        DROP TABLE IF EXISTS dag_nodes;
        DROP TABLE IF EXISTS approvals;
        DROP TABLE IF EXISTS outbox;
        DROP TABLE IF EXISTS idempotency_keys;
        DROP TABLE IF EXISTS envelopes;
        DROP TABLE IF EXISTS events;
        DROP TABLE IF EXISTS rooms;
      `);
    },
  },
];

/**
 * Checks if the database matches a verified legacy schema fingerprint.
 */
function isVerifiedLegacyFingerprint(db, appliedChecksum) {
  if (appliedChecksum !== LEGACY_R04_EMPTY_CHECKSUM) {
    return false;
  }
  try {
    // 1. Verify PRAGMA integrity_check
    const integrityRow = db.prepare('PRAGMA integrity_check').get();
    const integrityOk = integrityRow && (integrityRow.integrity_check === 'ok' || integrityRow['integrity_check'] === 'ok');
    if (!integrityOk) {
      return false;
    }

    // 2. Verify expected legacy core tables exist
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    const requiredLegacyTables = ['rooms', 'events', 'envelopes', 'idempotency_keys', 'outbox', 'approvals', 'audit_ledger'];
    for (const t of requiredLegacyTables) {
      if (!tables.includes(t)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Applies migrations or reconciles verified legacy schema.
 */
function runSchemaMigrations(db) {
  // Ensure schema_migrations table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  // Ensure legacy table structures with missing columns/indices are upgraded safely (UB-P2-R03-04, R04-G06, R05-H03)
  const existingTables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  if (existingTables.includes('idempotency_keys')) {
    const idempotencyCols = db.prepare('PRAGMA table_info(idempotency_keys)').all();
    if (!idempotencyCols.some((c) => c.name === 'dispatch_prepared')) {
      db.exec('ALTER TABLE idempotency_keys ADD COLUMN dispatch_prepared INTEGER DEFAULT 0;');
    }
  }
  if (existingTables.includes('events')) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_occurred_at ON events (occurred_at);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events (event_type);
    `);
  }
  if (existingTables.includes('envelopes')) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_envelopes_trace ON envelopes (trace_id);
    `);
  }
  if (existingTables.includes('outbox')) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox (status);
    `);
  }

  const appliedRows = db
    .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version ASC')
    .all();

  const appliedMap = new Map(appliedRows.map((r) => [r.version, r]));
  const maxCodeVersion = Math.max(...MIGRATIONS.map((m) => m.version), 0);

  // 1. Verify integrity of existing applied migrations
  for (const applied of appliedRows) {
    if (applied.version > maxCodeVersion) {
      const err = new Error(
        `Database version ${applied.version} is newer than supported code version ${maxCodeVersion}. Refusing write migration to prevent database corruption.`
      );
      err.code = 'ERR_UNSUPPORTED_SCHEMA_VERSION';
      err.details = { databaseVersion: applied.version, maxCodeVersion };
      throw err;
    }

    const expectedMigration = MIGRATIONS.find((m) => m.version === applied.version);
    if (!expectedMigration) {
      const err = new Error(`Unknown migration version ${applied.version} recorded in database.`);
      err.code = 'ERR_MIGRATION_TAMPERED';
      err.details = { version: applied.version };
      throw err;
    }

    if (applied.checksum !== expectedMigration.checksum) {
      // Check if this is a verified legacy schema fingerprint that can be upgraded safely (UB-P2-R04-01, R05-H03)
      if (isVerifiedLegacyFingerprint(db, applied.checksum)) {
        // Upgrade legacy schema atomically to full canonical parity
        db.exec('BEGIN IMMEDIATE TRANSACTION;');
        try {
          // 1. Ensure dag_nodes and snapshots exist
          db.exec(`
            CREATE TABLE IF NOT EXISTS dag_nodes (
              task_id TEXT NOT NULL,
              node_id TEXT NOT NULL,
              name TEXT NOT NULL,
              dependencies_json TEXT NOT NULL,
              assigned_role TEXT NOT NULL,
              assigned_provider TEXT,
              revision INTEGER DEFAULT 1,
              attempt INTEGER DEFAULT 1,
              correlation_id TEXT NOT NULL,
              recovery_state TEXT NOT NULL,
              raw_json TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (task_id, node_id)
            );
            CREATE INDEX IF NOT EXISTS idx_dag_recovery ON dag_nodes (recovery_state);

            CREATE TABLE IF NOT EXISTS snapshots (
              stream_id TEXT PRIMARY KEY,
              last_sequence_id INTEGER NOT NULL,
              state_json TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_events_occurred_at ON events (occurred_at);
            CREATE INDEX IF NOT EXISTS idx_events_type ON events (event_type);
            CREATE INDEX IF NOT EXISTS idx_envelopes_trace ON envelopes (trace_id);
            CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox (status);
          `);

          // 2. Ensure dispatch_prepared exists in idempotency_keys
          const idempotencyCols = db.prepare('PRAGMA table_info(idempotency_keys)').all();
          if (!idempotencyCols.some((c) => c.name === 'dispatch_prepared')) {
            db.exec('ALTER TABLE idempotency_keys ADD COLUMN dispatch_prepared INTEGER DEFAULT 0;');
          }

          // 3. Update checksum to canonical
          db.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = ?').run(
            expectedMigration.checksum,
            applied.version
          );

          db.exec('COMMIT;');
          continue;
        } catch (upgradeErr) {
          try { db.exec('ROLLBACK;'); } catch {}
          const err = new Error(`ERR_MIGRATION_FAILED: Legacy database upgrade failed and was rolled back: ${upgradeErr.message}`);
          err.code = 'ERR_MIGRATION_FAILED';
          throw err;
        }
      }

      // If not a recognized legacy fingerprint, strictly reject as tampered
      const err = new Error(
        `Migration version ${applied.version} checksum mismatch! Expected ${expectedMigration.checksum}, database has ${applied.checksum}. Migration definitions must not be modified after application.`
      );
      err.code = 'ERR_MIGRATION_TAMPERED';
      err.details = { version: applied.version, expected: expectedMigration.checksum, actual: applied.checksum };
      throw err;
    }
  }

  // 2. Apply pending migrations inside atomic transactions
  let appliedCount = 0;
  for (const m of MIGRATIONS) {
    if (!appliedMap.has(m.version)) {
      db.exec('BEGIN IMMEDIATE TRANSACTION;');
      try {
        if (typeof m.up === 'function') {
          m.up(db);
        } else if (m.sql) {
          db.exec(m.sql);
        }
        db.prepare(`
          INSERT INTO schema_migrations (version, name, checksum, applied_at)
          VALUES (?, ?, ?, ?)
        `).run(m.version, m.name, m.checksum, new Date().toISOString());

        db.exec('COMMIT;');
        appliedCount++;
      } catch (err) {
        try { db.exec('ROLLBACK;'); } catch {}
        const failErr = new Error(`Migration ${m.version} (${m.name}) failed and was cleanly rolled back: ${err.message}`);
        failErr.code = 'ERR_MIGRATION_FAILED';
        failErr.details = { version: m.version, name: m.name };
        throw failErr;
      }
    }
  }

  const latestRow = db.prepare('SELECT MAX(version) as v FROM schema_migrations').get();
  return {
    appliedCount,
    currentVersion: latestRow?.v ?? 0,
  };
}

module.exports = {
  MIGRATION_1_SQL,
  CANONICAL_MIGRATION_1_CHECKSUM,
  LEGACY_R04_EMPTY_CHECKSUM,
  MIGRATIONS,
  computeChecksum,
  isVerifiedLegacyFingerprint,
  runSchemaMigrations,
};
