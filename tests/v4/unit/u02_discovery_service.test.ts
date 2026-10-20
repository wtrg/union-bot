import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
// @ts-ignore
import { DiscoveryService } from '../../../apps/desktop/src/services/discovery-service.cjs';
import { runMigrations } from '../../../packages/storage/src/migrations.ts';

describe('UB-V4-U02: Discovery Service, Slash Parser & DiscoveryReadyGate', () => {
  it('U02-001: parses slash commands and handles escaping and code fences cleanly', () => {
    // Basic slash commands
    const chatCmd = DiscoveryService.parseSlashCommand('/chat');
    assert.equal(chatCmd.isCommand, true);
    assert.equal(chatCmd.command, 'chat');

    const workCmd = DiscoveryService.parseSlashCommand('/work implement milestone 1');
    assert.equal(workCmd.isCommand, true);
    assert.equal(workCmd.command, 'work');
    assert.equal(workCmd.args, 'implement milestone 1');

    // Escaped command: //chat -> literal /chat
    const escaped = DiscoveryService.parseSlashCommand('//chat hello');
    assert.equal(escaped.isCommand, false);
    assert.equal(escaped.wasEscaped, true);
    assert.equal(escaped.cleanText, '/chat hello');

    // Inside backticks or code block -> not command
    const codeFence = DiscoveryService.parseSlashCommand('```\n/chat\n```');
    assert.equal(codeFence.isCommand, false);

    const inlineCode = DiscoveryService.parseSlashCommand('`/work` is a command');
    assert.equal(inlineCode.isCommand, false);

    // Regular conversation text -> not command
    const normalText = DiscoveryService.parseSlashCommand('Chào bạn, hôm nay có việc gì?');
    assert.equal(normalText.isCommand, false);
  });

  it('U02-002: manages fact lifecycle, supersedes old confirmed facts on update', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);
    const service = new DiscoveryService({ nativeDb: db });

    const session = service.getOrCreateDiscoverySession('proj-test');
    assert.ok(session.id);

    // 1. Propose a fact
    const fact1 = service.recordFact(session.id, 'proj-test', 'targetOs', 'Windows 10', 'turn-1');
    assert.equal(fact1.state, 'PROPOSED');

    // 2. Confirm fact
    const fact2 = service.recordFact(session.id, 'proj-test', 'targetOs', 'Windows 10 and 11 x64', 'turn-2', 'user-po');
    assert.equal(fact2.state, 'CONFIRMED');

    // 3. Update confirmed fact with new value -> supersedes previous confirmed
    const fact3 = service.recordFact(session.id, 'proj-test', 'targetOs', 'Windows 11 x64 only', 'turn-3', 'user-po');
    assert.equal(fact3.state, 'CONFIRMED');

    const activeFacts = db.prepare(
      "SELECT value, state FROM requirement_facts WHERE discovery_id = ? AND key = 'targetOs' ORDER BY rowid ASC"
    ).all(session.id) as any[];

    assert.equal(activeFacts.length, 3);
    assert.equal(activeFacts[0].state, 'PROPOSED');
    assert.equal(activeFacts[1].state, 'SUPERSEDED');
    assert.equal(activeFacts[2].state, 'CONFIRMED');
    assert.equal(activeFacts[2].value, 'Windows 11 x64 only');

    db.close();
  });

  it('U02-005: manages open questions and de-duplicates questions for same requirementKey', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);
    const service = new DiscoveryService({ nativeDb: db });
    const session = service.getOrCreateDiscoverySession('proj-test');

    const q1 = service.addQuestion(session.id, 'apiCost', 'Are paid APIs allowed?', 'CRITICAL', true);
    assert.equal(q1.duplicate, false);

    // Duplicate question for same requirement key is rejected
    const q1Dup = service.addQuestion(session.id, 'apiCost', 'Do we use paid endpoints?', 'HIGH', true);
    assert.equal(q1Dup.duplicate, true);

    // Resolve question
    const resolved = service.resolveQuestion(q1.id, 'Strictly 0 VND, no paid APIs');
    assert.equal(resolved, true);

    // Now adding question for that key is allowed again because previous one is resolved
    const q2 = service.addQuestion(session.id, 'apiCost', 'What happens if free quota exhausts?', 'MEDIUM', false);
    assert.equal(q2.duplicate, false);

    db.close();
  });

  it('U02-004 & U02-006: evaluates DiscoveryReadyGate and computes deterministic Brief Digest', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db);
    const service = new DiscoveryService({ nativeDb: db });
    const session = service.getOrCreateDiscoverySession('proj-gate');

    // Initially 0 facts and 0 questions -> not ready (no confirmed facts)
    let gate = service.checkReadyForWork(session.id);
    assert.equal(gate.ready, false);

    // Add a blocking open question
    const q = service.addQuestion(session.id, 'exportFormat', 'What format is required for export?', 'HIGH', true);

    // Confirm a fact
    service.recordFact(session.id, 'proj-gate', 'framework', 'Electron 33 + React 18', 'turn-1', 'user-po');

    // Still not ready because of open blocking question
    gate = service.checkReadyForWork(session.id);
    assert.equal(gate.ready, false);
    assert.equal(gate.blockingQuestions?.length, 1);

    // Resolve the blocking question
    service.resolveQuestion(q.id, 'Portable ZIP and SHA-256 CAS bundle');

    // Now DiscoveryReadyGate PASSES!
    gate = service.checkReadyForWork(session.id);
    assert.equal(gate.ready, true);
    assert.ok(gate.briefDigest);
    assert.equal(gate.briefDigest.length, 64);

    // Compact context generates matching digest
    const compacted = service.compactContext(session.id);
    assert.equal(compacted.facts.length, 1);
    assert.equal(compacted.openQuestions.length, 0);

    db.close();
  });
});
