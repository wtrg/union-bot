const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { GroupChatService, targetsFor } = require('../src/services/group-chat-service.cjs');
const { isFreshReply, readPage, runGroupTurn } = require('../src/services/web-group-turn.cjs');
const vm = require('node:vm');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StorageServiceClient } = require('../src/storage-service.cjs');

const user = (id = 'u1', roomId = 'r1', text = 'hello') => ({ id, roomId, traceId: `trace_${id}`, sender: { kind: 'user', id: 'local-user', name: 'User' }, parts: [{ kind: 'text', text }] });
function fixture(browser) {
  const saved = [], emitted = [];
  const group = new GroupChatService({ storage: { getRoomEnvelopes: async () => saved, insertEnvelope: async e => { saved.push(structuredClone(e)); return { success: true }; } }, browser, emit: e => emitted.push(structuredClone(e)), workspaceRoot: process.cwd() });
  return { group, saved, emitted };
}

test('default leader and explicit member routing are predictable', () => {
  assert.deepEqual(targetsFor('hello'), ['chatgpt']);
  assert.deepEqual(targetsFor('@Antigravity hello @codex @antigravity'), ['antigravity', 'codex']);
  assert.equal(targetsFor('@all hello').length, 6);
  assert.deepEqual(targetsFor('mail user@codex.example'), ['chatgpt']);
});

test('live leader deltas appear under its own identity, final reply is durable', async () => {
  const { group, saved, emitted } = fixture({ runGroupTurn: async ({ onText }) => { onText('Xin'); onText('Xin chào'); return { text: 'Xin chào', url: 'https://chatgpt.com/c/test', conversationId: 'test' }; } });
  await group.enqueue(user());
  assert.equal(emitted[0].delivery.state, 'sending');
  assert.equal(emitted[1].delivery.state, 'streaming');
  assert.equal(emitted[1].sender.id, 'chatgpt_web');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].parts[0].text, 'Xin chào');
  assert.equal(saved[0].delivery.state, 'completed');
  assert.equal(saved[0].delivery.replyTo, 'u1');
});

test('native denial is a visible system block, never a fabricated member answer', async () => {
  const { group, saved } = fixture({});
  group.antigravity = Object.assign(new EventEmitter(), { executePrompt: async () => ({ success: false, error: 'ERR_ANTIGRAVITY_PERMISSION_REQUIRED: command' }) });
  await group.enqueue(user('u1', 'r1', '@antigravity download'));
  assert.equal(saved[0].sender.kind, 'system');
  assert.equal(saved[0].delivery.memberName, 'Antigravity');
  assert.equal(saved[0].delivery.state, 'blocked');
  assert.match(saved[0].parts[0].text, /command/);
});

test('room/provider serialization keeps streamed replies associated with their requests', async () => {
  let active = 0, peak = 0;
  const { group, saved } = fixture({ runGroupTurn: async ({ roomId, onText }) => {
    peak = Math.max(peak, ++active); await new Promise(r => setTimeout(r, 10)); onText(roomId); active--; return { text: roomId };
  } });
  await Promise.all([group.enqueue(user('a', 'room-a')), group.enqueue(user('b', 'room-b'))]);
  assert.equal(peak, 1);
  assert.deepEqual(saved.map(e => [e.roomId, e.parts[0].text]), [['room-a', 'room-a'], ['room-b', 'room-b']]);
});

test('leader consultations dispatch one bounded real member turn', async () => {
  const { group, saved } = fixture({ runGroupTurn: async () => ({ text: 'Cần kiểm tra. [[ask:antigravity]]Bạn đề xuất cách nào?[[/ask]]' }) });
  let calls = 0;
  group.antigravity = Object.assign(new EventEmitter(), { executePrompt: async prompt => { calls++; assert.match(prompt, /Bạn đề xuất cách nào/); return { success: true, response: 'Tôi đề xuất bước A.' }; } });
  await group.enqueue(user());
  assert.equal(calls, 1);
  assert.deepEqual(saved.map(e => e.sender.id), ['chatgpt_web', 'antigravity']);
  assert.match(saved[0].parts[0].text, /@antigravity/);
  assert.equal(saved[1].delivery.replyTo, saved[0].id);
});

test('web capture rejects old assistant content and accepts only a fresh turn', () => {
  const old = { count: 2, messageId: 'old', text: 'old answer' };
  assert.equal(isFreshReply(old, old), false);
  assert.equal(isFreshReply(old, { ...old, text: 'changed old answer' }), false);
  assert.equal(isFreshReply(old, { ...old, count: 3, text: 'new answer' }), true);
  assert.equal(isFreshReply(old, { ...old, messageId: 'new', text: 'new answer' }), true);
  assert.equal(isFreshReply(old, { count: 3, messageId: 'new', text: '' }), false);
});

test('ChatGPT without author roles excludes the marked user prompt and locates its new reply', () => {
  const element = (text, order, children = []) => ({ textContent: text, innerText: text, children, id: '', classList: { contains: () => false },
    getClientRects: () => [1], getAttribute: () => null, closest: () => null,
    contains(other) { return this === other || children.some(child => child.contains(other)); },
    compareDocumentPosition(other) { return order < other.order ? 4 : 2; }, order });
  const old = element('previous answer', 1);
  const marker = element('UNION_TURN_TEST', 2);
  const submitted = element('long prompt UNION_TURN_TEST', 2, [marker]);
  const current = element('Which requirement should we discuss?', 3);
  const editor = element('', 4);
  const document = { title: 'ChatGPT', querySelector: () => null, querySelectorAll(selector) {
    if (selector.includes('MarkdownRoot-')) return [old, submitted, current];
    if (selector === 'p, div, span') return [submitted, marker];
    if (selector === 'p') return [marker];
    if (selector.includes('#prompt-textarea')) return [editor];
    return [];
  } };
  const page = vm.runInNewContext(`(${readPage.toString()})('UNION_TURN_TEST')`, { document,
    location: { href: 'https://chatgpt.com/c/test' }, Node: { DOCUMENT_POSITION_FOLLOWING: 4 } });
  assert.equal(page.count, 2);
  assert.equal(page.text, current.innerText);
  assert.equal(page.hasPromptMarker, true);
  assert.equal(page.assistantAfterUser, true);
});

test('Gemini rich-textarea shadow DOM exposes the composer and model response', () => {
  const element = (text, order) => ({ textContent: text, innerText: text, children: [], id: '', value: '', disabled: false, isContentEditable: true,
    classList: { contains: () => false }, getClientRects: () => [1], getAttribute: () => null, closest: () => null,
    contains(other) { return this === other; }, compareDocumentPosition(other) { return order < other.order ? 4 : 2; }, order });
  const response = element('Tôi đã tìm được 5 hình Doraemon.', 1);
  const editor = element('', 2);
  const send = element('', 3);
  send.disabled = false;
  const shadowRoot = { querySelectorAll(selector) {
    if (selector === 'model-response') return [response];
    if (selector.includes('[contenteditable="true"]')) return [editor];
    if (selector.includes('button[data-testid*="send"]')) return [send];
    return [];
  } };
  const host = { shadowRoot };
  const document = { title: 'Gemini', querySelector: () => null, querySelectorAll(selector) {
    if (selector === 'rich-textarea, message-content, model-response') return [host];
    return [];
  } };
  const page = vm.runInNewContext(`(${readPage.toString()})('UNION_TURN_TEST', 'gemini')`, { document,
    location: { href: 'https://gemini.google.com/app/test' }, Node: { DOCUMENT_POSITION_FOLLOWING: 4 } });
  assert.equal(page.editor, true);
  assert.equal(page.sendReady, true);
  assert.equal(page.text, response.innerText);
});

test('web bridge respects an empty textarea value even when its initial DOM text remains', async () => {
  const editor = { tagName: 'TEXTAREA', value: '', textContent: 'stale initial DOM value', id: 'prompt-textarea',
    focus() {}, closest: () => null, getClientRects: () => [1] };
  const assistant = { textContent: 'old answer', innerText: 'old answer', getAttribute: () => 'old', closest: () => null };
  const document = { title: 'ChatGPT', querySelector: () => null, querySelectorAll(selector) {
    if (selector.includes('#prompt-textarea')) return [editor];
    if (selector.includes('[data-message-author-role="assistant"]')) return [assistant];
    return [];
  } };
  let inserted = false;
  const web = { isDestroyed: () => false, isLoading: () => false,
    executeJavaScript: async code => vm.runInNewContext(code, { document, location: { href: 'https://chatgpt.com/c/test' } }),
    insertText: async () => { inserted = true; throw new Error('STOP_AFTER_INSERT'); } };
  let autoOpenEvents = 0;
  const browser = { getState: () => ({ tabs: [{ id: 't', providerId: 'chatgpt', url: 'https://chatgpt.com/c/test' }] }),
    views: new Map([['t', { webContents: web }]]), selectTab() {}, mainWindow: { webContents: { send(channel) { if (channel === 'union-bot:group-browser-needed') autoOpenEvents++; } } } };
  await assert.rejects(runGroupTurn(browser, { roomId: 'r1', providerId: 'chatgpt', reference: { url: 'https://chatgpt.com/c/test' }, prompt: 'hello' }), /STOP_AFTER_INSERT/);
  assert.equal(inserted, true);
  assert.equal(autoOpenEvents, 0, 'a background group turn must not open the browser dock');
});

test('SQLite reload returns the newest room messages in chronological order', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'union-group-history-'));
  const storage = new StorageServiceClient(path.join(temporary, 'test.db'));
  try {
    await storage.ready;
    for (let i = 0; i < 5; i++) {
      await storage.insertEnvelope({ ...user(`history-${i}`), timestamp: Date.now(), recipient: { kind: 'room', id: 'r1' }, fidelity: 'L0_RAW_TEXT' });
    }
    assert.deepEqual((await storage.getRoomEnvelopes('r1', 2)).map(e => e.id), ['history-3', 'history-4']);
    assert.equal((await storage.getRoomEnvelopes('r1', -1)).length, 5);
  } finally {
    storage.close();
    assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
