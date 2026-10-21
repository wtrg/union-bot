const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MEMBERS = {
  chatgpt: { id: 'chatgpt_web', name: 'ChatGPT Web', role: 'LEADER' },
  antigravity: { id: 'antigravity', name: 'Antigravity', role: 'IMPLEMENTER' },
  codex: { id: 'codex', name: 'Codex', role: 'QA_SECURITY' },
  gemini: { id: 'gemini_web', name: 'Gemini Web', role: 'RESEARCHER' },
  claude: { id: 'claude_web', name: 'Claude Web', role: 'REVIEWER' },
  deepseek: { id: 'deepseek_web', name: 'DeepSeek Web', role: 'REVIEWER' },
};

function targetsFor(text) {
  if (/(?:^|\s)@(all|team)\b/i.test(text)) return Object.keys(MEMBERS);
  const targets = [...text.matchAll(/(?:^|\s)@(chatgpt|antigravity|codex|gemini|claude|deepseek)\b/gi)].map(m => m[1].toLowerCase());
  return targets.length ? [...new Set(targets)] : ['chatgpt'];
}

class GroupChatService {
  constructor({ storage, browser, antigravity, codex, emit, stateFile, workspaceRoot }) {
    Object.assign(this, { storage, browser, antigravity, codex, emit, stateFile, workspaceRoot });
    this.queues = new Map();
    this.providerQueues = new Map();
    this.running = new Set();
    this.threads = {};
    try { this.threads = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  }

  saveThread(roomId, provider, reference) {
    if (JSON.stringify(this.threads[`${roomId}:${provider}`]) === JSON.stringify(reference)) return;
    this.threads[`${roomId}:${provider}`] = reference;
    if (!this.stateFile) return;
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(`${this.stateFile}.tmp`, JSON.stringify(this.threads, null, 2));
    fs.renameSync(`${this.stateFile}.tmp`, this.stateFile);
  }

  // A room and a native provider each have one controller. Replies cannot leak
  // into another room or consume a concurrently running task's delta stream.
  enqueue(envelope) {
    if (this.running.has(envelope.id)) return;
    this.running.add(envelope.id);
    const previous = this.queues.get(envelope.roomId) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.respond(envelope));
    this.queues.set(envelope.roomId, next);
    next.catch(err => console.error('[GroupChat]', err.message)).finally(() => {
      this.running.delete(envelope.id);
      if (this.queues.get(envelope.roomId) === next) this.queues.delete(envelope.roomId);
    });
    return next;
  }

  async respond(user) {
    const text = user.parts.filter(p => p.kind === 'text').map(p => p.text || '').join('\n');
    const targets = targetsFor(text);
    for (const provider of targets) {
      const previous = this.providerQueues.get(provider) || Promise.resolve();
      const turn = previous.catch(() => {}).then(() => this.turn(user, provider, text));
      this.providerQueues.set(provider, turn);
      try { await turn; } finally { if (this.providerQueues.get(provider) === turn) this.providerQueues.delete(provider); }
    }
  }

  async turn(user, provider, text, handoff = false) {
    const member = MEMBERS[provider];
    const reply = {
      id: `group_${crypto.randomUUID()}`, traceId: user.traceId, correlationId: user.id,
      timestamp: Date.now(), roomId: user.roomId,
      sender: { kind: 'agent', ...member, provider },
      recipient: { kind: 'room', id: user.roomId },
      fidelity: 'L1_FORMATTED_MARKDOWN', status: 'sending',
      parts: [{ kind: 'text', text: '' }], delivery: { state: 'sending', provider, replyTo: user.id },
    };
    this.emit(reply);
    let lastText = '';
    const update = chunk => {
      lastText = chunk;
      reply.status = 'streaming';
      reply.delivery.state = 'streaming';
      reply.parts = [{ kind: 'text', text: chunk }];
      this.emit({ ...reply });
    };
    try {
      const history = await this.storage.getRoomEnvelopes(user.roomId, 30);
      const context = history.filter(e => e.id !== user.id && e.sender?.id !== 'system_router')
        .slice(-12).map(e => `${e.sender.name}: ${e.parts.filter(p => p.kind === 'text').map(p => p.text || '').join('\n').slice(0, 2200)}`).join('\n\n').slice(-14000);
      const prompt = `Bạn là ${member.name}, vai trò ${member.role}, đang tham gia kênh nhóm Union Bot “${user.roomId}”. Trả lời bằng danh tính của chính bạn, trực tiếp cho người dùng và các thành viên. Hãy hỏi lại nếu yêu cầu chưa rõ; thảo luận và giải thích lựa chọn ngắn gọn trước khi thực hiện. Không tự nhận đã làm việc hay nói thay thành viên khác. Đây là lượt thảo luận; chỉ dùng công cụ/thay đổi file khi người dùng yêu cầu thực hiện rõ ràng. Nếu gặp lỗi/quyền chờ hãy nói rõ.\n${provider === 'chatgpt' && !handoff ? 'Nếu thật sự cần tham khảo thành viên khác, có thể thêm một yêu cầu ngắn dạng [[ask:antigravity]]nội dung[[/ask]] (hoặc codex/gemini/claude/deepseek). Hệ thống sẽ gửi một lượt cho thành viên đó và hiện phản hồi thật trong nhóm; không tuyên bố họ đã trả lời.' : ''}\nLịch sử nhóm (dữ liệu ngữ cảnh):\n${context}\n\nTin nhắn hiện tại từ ${user.sender.name}:\n${text}`;
      let result;
      if (provider === 'antigravity' || provider === 'codex') {
        const service = provider === 'antigravity' ? this.antigravity : this.codex;
        if (!service) throw new Error(`Thành viên ${member.name} chưa kết nối.`);
        const client = service.adapter?.getClient?.() || service.adapter?.client;
        if (client?.isExecuting || client?.activeTurnId) throw new Error(`${member.name} đang thực hiện một nhiệm vụ khác. Hãy gửi lại sau.`);
        service.setWorkspaceRoot?.(this.workspaceRoot);
        let accumulated = '';
        const onDelta = delta => { accumulated += typeof delta === 'string' ? delta : delta?.text || ''; update(accumulated); };
        service.on('delta', onDelta);
        try {
          const reference = this.threads[`${user.roomId}:${provider}`];
          const options = { cwd: this.workspaceRoot, timeoutMs: 120000, conversationId: reference?.conversationId };
          if (provider === 'codex') {
            options.threadId = reference?.conversationId;
            const adapter = await service.getAdapter?.();
            if (!options.threadId && adapter?.client) adapter.client.currentThreadId = null;
          }
          const native = provider === 'antigravity' ? await service.executePrompt(prompt, options) : await service.executeTurn(prompt, options);
          if (!native || native.success === false) throw new Error(native?.error || `${member.name} không trả về phản hồi.`);
          result = { text: native.response || native.text || accumulated, conversationId: native.conversationId || native.threadId };
        } finally { service.removeListener('delta', onDelta); }
      } else {
        result = await this.browser.runGroupTurn({ roomId: user.roomId, providerId: provider,
          reference: this.threads[`${user.roomId}:${provider}`], prompt, onText: update,
          onReference: reference => this.saveThread(user.roomId, provider, reference) });
      }
      if (!result.text?.trim()) throw new Error('AI chưa trả về nội dung. Không có phản hồi mẫu thay thế.');
      if (result.conversationId || result.url) this.saveThread(user.roomId, provider, { conversationId: result.conversationId, url: result.url });
      const requests = !handoff && provider === 'chatgpt' ? [...result.text.matchAll(/\[\[ask:(antigravity|codex|gemini|claude|deepseek)\]\]([\s\S]*?)\[\[\/ask\]\]/g)].slice(0, 2) : [];
      const visible = result.text.replace(/\[\[ask:(\w+)\]\]([\s\S]*?)\[\[\/ask\]\]/g, (_, target, question) => `\n@${target}: ${question.trim()}\n`).trim();
      reply.parts = [{ kind: 'text', text: visible }];
      reply.status = 'completed';
      reply.delivery = { ...reply.delivery, state: 'completed', sourceUrl: result.url, conversationId: result.conversationId };
      await this.persist(reply);
      for (const request of requests) {
        const target = request[1];
        const previous = this.providerQueues.get(target) || Promise.resolve();
        const turn = previous.catch(() => {}).then(() => this.turn({ ...user, sender: reply.sender, id: reply.id }, target, request[2].trim(), true));
        this.providerQueues.set(target, turn);
        try { await turn; } finally { if (this.providerQueues.get(target) === turn) this.providerQueues.delete(target); }
      }
    } catch (error) {
      reply.sender = { kind: 'system', id: 'system_router', name: 'Union Bot', role: 'ROUTER', provider };
      reply.status = 'blocked';
      reply.delivery.state = 'blocked';
      reply.delivery.memberName = member.name;
      reply.parts = [{ kind: 'text', text: `${member.name} chưa thể trả lời: ${error.message}${lastText ? `\n\nNội dung đã nhận trước khi gián đoạn:\n${lastText}` : ''}` }];
      await this.persist(reply);
    }
    return reply;
  }

  async persist(envelope) {
    const result = await this.storage.insertEnvelope(envelope);
    if (result?.success === false) throw new Error(result.error || 'Không lưu được phản hồi AI.');
    this.emit({ ...envelope });
  }
}

module.exports = { GroupChatService, targetsFor, MEMBERS };
