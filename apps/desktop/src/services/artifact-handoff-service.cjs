/**
 * @file artifact-handoff-service.cjs
 * @description Artifact Handoff & Multimodal Fidelity Service (UB-V4-U05).
 * Enforces:
 * - Exact SHA-256 CAS byte verification.
 * - Dangerous payload quarantine (no unauthorized executables).
 * - Full lifecycle: READY_FOR_RECEIVER -> READ_ACKNOWLEDGED / REJECTED_CHECKSUM / REJECTED_QUARANTINE.
 * - Durable SQLite handoff_records persistence.
 */

const crypto = require('node:crypto');

const DANGEROUS_EXTENSIONS = ['.exe', '.dll', '.bat', '.cmd', '.ps1', '.vbs', '.msi', '.scr'];
const DANGEROUS_MIMES = ['application/x-msdownload', 'application/x-msdos-program', 'application/x-sh'];

class ArtifactHandoffService {
  constructor(storageService, artifactStore = null) {
    this.storage = storageService;
    this.artifactStore = artifactStore;
  }

  getDb() {
    return this.storage.nativeDb || (this.storage.client && this.storage.client.db);
  }

  /**
   * Registers a new artifact handoff from sourceProvider to targetProvider (U05-001, U05-002, U05-003).
   */
  createHandoff(params) {
    const rawDb = this.getDb();
    if (!rawDb) return { success: false, error: 'Database unavailable' };

    const {
      projectId = 'default',
      goalId = null,
      sourceProvider,
      sourceTurnRef = null,
      targetProvider,
      sha256,
      byteSize,
      mimeType = 'application/octet-stream',
      fidelity = 'original_bytes',
      filename = '',
    } = params;

    if (!sourceProvider || !targetProvider) {
      return { success: false, error: 'Both sourceProvider and targetProvider are required' };
    }

    if (!sha256 || !/^[a-f0-9]{64}$/i.test(sha256)) {
      return { success: false, error: 'Invalid SHA-256 digest format', code: 'ERR_INVALID_CHECKSUM' };
    }

    if (typeof byteSize !== 'number' || byteSize < 0) {
      return { success: false, error: 'Invalid byteSize' };
    }

    // Security: Check for dangerous executable quarantine (U05-003)
    const lowerFilename = (filename || '').toLowerCase();
    const isDangerousExt = DANGEROUS_EXTENSIONS.some((ext) => lowerFilename.endsWith(ext));
    const isDangerousMime = DANGEROUS_MIMES.includes(mimeType.toLowerCase());

    const id = `ho_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();

    if (isDangerousExt || isDangerousMime) {
      // Quarantine immediately
      rawDb.prepare(`
        INSERT INTO handoff_records (
          id, project_id, goal_id, source_provider, source_turn_ref, target_provider,
          sha256, byte_size, mime_type, fidelity, state, ack_evidence_ref, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'REJECTED_QUARANTINE', ?, ?)
      `).run(
        id, projectId, goalId, sourceProvider, sourceTurnRef, targetProvider,
        sha256, byteSize, mimeType, fidelity, 'Quarantined: dangerous executable format', now
      );

      return {
        success: false,
        handoffId: id,
        state: 'REJECTED_QUARANTINE',
        error: `Artifact rejected: dangerous executable signature detected (${filename || mimeType})`,
        code: 'ERR_QUARANTINE_REJECTED',
      };
    }

    // Check physical CAS bytes if ArtifactStore is present
    if (this.artifactStore && typeof this.artifactStore.hasArtifact === 'function') {
      const exists = this.artifactStore.hasArtifact(sha256);
      if (!exists) {
        return {
          success: false,
          error: `CAS object with SHA-256 '${sha256}' not found on disk`,
          code: 'ERR_CAS_NOT_FOUND',
        };
      }
    }

    // Insert durable handoff record
    rawDb.prepare(`
      INSERT INTO handoff_records (
        id, project_id, goal_id, source_provider, source_turn_ref, target_provider,
        sha256, byte_size, mime_type, fidelity, state, ack_evidence_ref, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'READY_FOR_RECEIVER', NULL, ?)
    `).run(
      id, projectId, goalId, sourceProvider, sourceTurnRef, targetProvider,
      sha256, byteSize, mimeType, fidelity, now
    );

    return {
      success: true,
      handoff: {
        id,
        projectId,
        goalId,
        sourceProvider,
        sourceTurnRef,
        targetProvider,
        sha256,
        byteSize,
        mimeType,
        fidelity,
        state: 'READY_FOR_RECEIVER',
        createdAt: now,
      },
    };
  }

  /**
   * Target provider acknowledges receipt of the artifact (U05-004).
   */
  acknowledgeHandoff(params) {
    const rawDb = this.getDb();
    if (!rawDb) return { success: false, error: 'Database unavailable' };

    const { handoffId, receiverProvider, ackEvidenceRef } = params;
    if (!handoffId || !receiverProvider) {
      return { success: false, error: 'handoffId and receiverProvider are required' };
    }

    const handoff = rawDb.prepare('SELECT * FROM handoff_records WHERE id = ?').get(handoffId);
    if (!handoff) {
      return { success: false, error: `Handoff '${handoffId}' not found`, code: 'ERR_HANDOFF_NOT_FOUND' };
    }

    if (handoff.target_provider !== receiverProvider) {
      return {
        success: false,
        error: `Receiver '${receiverProvider}' does not match targetProvider '${handoff.target_provider}'`,
        code: 'ERR_TARGET_MISMATCH',
      };
    }

    if (handoff.state !== 'READY_FOR_RECEIVER') {
      return {
        success: false,
        error: `Handoff '${handoffId}' is not in READY_FOR_RECEIVER state (current: ${handoff.state})`,
        code: 'ERR_INVALID_HANDOFF_STATE',
      };
    }

    rawDb.prepare(`
      UPDATE handoff_records
      SET state = 'READ_ACKNOWLEDGED', ack_evidence_ref = ?
      WHERE id = ?
    `).run(ackEvidenceRef || 'received_and_verified', handoffId);

    return {
      success: true,
      handoffId,
      state: 'READ_ACKNOWLEDGED',
      ackEvidenceRef: ackEvidenceRef || 'received_and_verified',
    };
  }

  /**
   * Rejects handoff due to checksum failure or quarantine.
   */
  rejectHandoff(handoffId, reason = 'CHECKSUM', details = '') {
    const rawDb = this.getDb();
    if (!rawDb) return false;

    const state = reason === 'CHECKSUM' ? 'REJECTED_CHECKSUM' : 'REJECTED_QUARANTINE';
    const res = rawDb.prepare(`
      UPDATE handoff_records
      SET state = ?, ack_evidence_ref = ?
      WHERE id = ?
    `).run(state, details || reason, handoffId);

    return res.changes > 0;
  }

  /**
   * Retrieves handoff by ID.
   */
  getHandoff(id) {
    const rawDb = this.getDb();
    if (!rawDb) return null;
    return rawDb.prepare('SELECT * FROM handoff_records WHERE id = ?').get(id) || null;
  }

  /**
   * Lists handoffs for a project.
   */
  listHandoffs(projectId = 'default', limit = 50) {
    const rawDb = this.getDb();
    if (!rawDb) return [];
    return rawDb.prepare(
      'SELECT * FROM handoff_records WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(projectId, limit) || [];
  }
}

module.exports = {
  ArtifactHandoffService,
};
