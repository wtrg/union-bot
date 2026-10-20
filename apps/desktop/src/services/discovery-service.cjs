/**
 * @file discovery-service.cjs
 * @description Manages /chat BA discovery mode, slash commands, requirement facts ledger,
 * open questions, context compaction, and DiscoveryReadyGate (UB-V4-U02).
 */

const crypto = require('node:crypto');

class DiscoveryService {
  constructor(storageService) {
    this.storage = storageService;
  }

  /**
   * Parses user input for slash commands with exact syntax and escaping (U02-001).
   * Supports: /chat, /work, /status, /pause, /resume, /stop, /help
   * Escaping: //command produces literal /command without triggering execution.
   * Ignores commands embedded inside code fences or backticks.
   */
  static parseSlashCommand(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      return { isCommand: false, cleanText: '' };
    }

    const trimmed = rawText.trim();

    // Check escaping: //chat -> literal /chat
    if (trimmed.startsWith('//')) {
      return {
        isCommand: false,
        cleanText: trimmed.slice(1),
        wasEscaped: true,
      };
    }

    // Do not trigger if inside markdown code fence or quotes
    if (trimmed.startsWith('```') || trimmed.startsWith('`') || trimmed.startsWith('>')) {
      return { isCommand: false, cleanText: trimmed };
    }

    // Match leading slash command
    const match = trimmed.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
    if (!match) {
      return { isCommand: false, cleanText: trimmed };
    }

    const commandName = match[1].toLowerCase();
    const args = (match[2] || '').trim();

    const KNOWN_COMMANDS = ['chat', 'work', 'status', 'pause', 'resume', 'stop', 'help'];
    if (KNOWN_COMMANDS.includes(commandName)) {
      return {
        isCommand: true,
        command: commandName,
        args,
        cleanText: trimmed,
      };
    }

    return { isCommand: false, cleanText: trimmed };
  }

  /**
   * Initializes or fetches active discovery session for a project.
   */
  getOrCreateDiscoverySession(projectId = 'default') {
    const rawDb = this.storage.nativeDb || (this.storage.client && this.storage.client.db);
    if (!rawDb) return null;

    let session = rawDb.prepare(
      'SELECT * FROM discovery_sessions WHERE project_id = ? AND state != ? ORDER BY version DESC LIMIT 1'
    ).get(projectId, 'SUPERSEDED');

    if (!session) {
      const now = new Date().toISOString();
      const id = `disc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      rawDb.prepare(`
        INSERT INTO discovery_sessions (id, project_id, mode, version, state, created_at, updated_at)
        VALUES (?, ?, 'DISCOVERY', 1, 'ACTIVE', ?, ?)
      `).run(id, projectId, now, now);
      session = rawDb.prepare('SELECT * FROM discovery_sessions WHERE id = ?').get(id);
    }

    return session;
  }

  /**
   * Records or updates a RequirementFact in the ledger (U02-002).
   */
  recordFact(discoveryId, projectId, key, value, sourceTurnRef, confirmedBy = null) {
    const rawDb = this.storage.nativeDb || (this.storage.client && this.storage.client.db);
    if (!rawDb) throw new Error('Database unavailable');

    const now = new Date().toISOString();
    const id = `fact_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const state = confirmedBy ? 'CONFIRMED' : 'PROPOSED';

    // Mark previous facts with the same key as SUPERSEDED if this is confirmed
    if (state === 'CONFIRMED') {
      rawDb.prepare(`
        UPDATE requirement_facts
        SET state = 'SUPERSEDED', updated_at = ?
        WHERE discovery_id = ? AND key = ? AND state = 'CONFIRMED'
      `).run(now, discoveryId, key);
    }

    rawDb.prepare(`
      INSERT INTO requirement_facts (
        id, discovery_id, project_id, key, value, source_turn_ref, confidence, state, confirmed_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1.0, ?, ?, ?, ?)
    `).run(id, discoveryId, projectId, key, value, sourceTurnRef, state, confirmedBy, now, now);

    return { id, key, value, state };
  }

  /**
   * Adds an open question to the discovery backlog, preventing duplicates (U02-005).
   */
  addQuestion(discoveryId, requirementKey, question, priority = 'HIGH', blocking = true) {
    const rawDb = this.storage.nativeDb || (this.storage.client && this.storage.client.db);
    if (!rawDb) throw new Error('Database unavailable');

    // Check for existing question for this requirementKey
    const existing = rawDb.prepare(
      'SELECT id FROM open_questions WHERE discovery_id = ? AND requirement_key = ? AND resolved = 0'
    ).get(discoveryId, requirementKey);

    if (existing) {
      return { id: existing.id, duplicate: true };
    }

    const id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    rawDb.prepare(`
      INSERT INTO open_questions (
        id, discovery_id, requirement_key, question, priority, blocking, resolved, asked_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `).run(id, discoveryId, requirementKey, question, priority, blocking ? 1 : 0, now);

    return { id, duplicate: false };
  }

  /**
   * Resolves an open question with user/PO answer.
   */
  resolveQuestion(id, resolution) {
    const rawDb = this.storage.nativeDb || (this.storage.client && this.storage.client.db);
    if (!rawDb) throw new Error('Database unavailable');

    const now = new Date().toISOString();
    const res = rawDb.prepare(`
      UPDATE open_questions
      SET resolved = 1, resolution = ?, resolved_at = ?
      WHERE id = ?
    `).run(resolution, now, id);

    return res.changes > 0;
  }

  /**
   * Compacts conversation context into a structured Decision Ledger (U02-004).
   * Bounded size, no lost confirmed facts.
   */
  compactContext(discoveryId) {
    const rawDb = this.storage.nativeDb || (this.storage.client && this.storage.client.db);
    if (!rawDb) return { facts: [], questions: [], digest: '' };

    const confirmedFacts = rawDb.prepare(
      "SELECT key, value, source_turn_ref FROM requirement_facts WHERE discovery_id = ? AND state = 'CONFIRMED' ORDER BY key ASC"
    ).all(discoveryId) || [];

    const openQuestions = rawDb.prepare(
      'SELECT requirement_key, question, priority FROM open_questions WHERE discovery_id = ? AND resolved = 0 ORDER BY blocking DESC'
    ).all(discoveryId) || [];

    const canonicalString = JSON.stringify({ facts: confirmedFacts, questions: openQuestions });
    const digest = crypto.createHash('sha256').update(canonicalString).digest('hex');

    return {
      facts: confirmedFacts,
      openQuestions,
      digest,
    };
  }

  /**
   * Evaluates DiscoveryReadyGate before allowing transition to /work (U02-006).
   * Returns { ready: boolean, blockingQuestions: string[], briefDigest: string }
   */
  checkReadyForWork(discoveryId) {
    const rawDb = this.storage.nativeDb || (this.storage.client && this.storage.client.db);
    if (!rawDb) return { ready: false, reason: 'Database offline' };

    const blockingQuestions = rawDb.prepare(
      'SELECT requirement_key, question FROM open_questions WHERE discovery_id = ? AND blocking = 1 AND resolved = 0'
    ).all(discoveryId) || [];

    const confirmedFacts = rawDb.prepare(
      "SELECT key, value FROM requirement_facts WHERE discovery_id = ? AND state = 'CONFIRMED' ORDER BY key ASC"
    ).all(discoveryId) || [];

    if (blockingQuestions.length > 0) {
      return {
        ready: false,
        reason: `${blockingQuestions.length} câu hỏi quan trọng chưa được giải quyết`,
        blockingQuestions: blockingQuestions.map(q => `${q.requirement_key}: ${q.question}`),
      };
    }

    if (confirmedFacts.length === 0) {
      return {
        ready: false,
        reason: 'Chưa có thông tin yêu cầu nào được xác nhận (Confirmed Facts = 0)',
        blockingQuestions: [],
      };
    }

    const digest = crypto.createHash('sha256').update(JSON.stringify(confirmedFacts)).digest('hex');

    return {
      ready: true,
      briefDigest: digest,
      factCount: confirmedFacts.length,
      blockingQuestions: [],
    };
  }
}

module.exports = {
  DiscoveryService,
};
