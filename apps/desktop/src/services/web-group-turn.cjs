const { PROVIDER_REGISTRY, isAllowedForProvider } = require('../../../../packages/browser-manager/src/browser-manager.cjs');

function readPage(marker, providerId) {
  const visible = el => el && (!el.getClientRects || el.getClientRects().length > 0);
  const roots = [document];
  if (providerId === 'gemini') {
    // Gemini has used a rich-textarea shadow root for its composer. Search the
    // provider's known web components without walking the entire document.
    for (const host of document.querySelectorAll('rich-textarea, message-content, model-response')) {
      if (host.shadowRoot) roots.push(host.shadowRoot);
    }
  }
  const queryAll = selector => [...new Set(roots.flatMap(root => [...root.querySelectorAll(selector)]))];
  const assistantRoles = queryAll('[data-message-author-role="assistant"], [data-role="assistant"]').filter(visible);
  const responseSelectors = providerId === 'gemini'
    ? ['model-response', '[data-test-id*="model-response"]', '[data-testid*="response"]', '.model-response-text', 'message-content', '[class*="MarkdownRoot-"]']
    : providerId === 'claude'
      ? ['.font-claude-response', '[data-testid="conversation-turn-assistant"]', '[data-message-author-role="assistant"]']
      : providerId === 'deepseek'
        ? ['[data-message-author-role="assistant"]', '[data-role="assistant"]', '.ds-markdown']
        : ['[data-message-author-role="assistant"]', '[data-role="assistant"]', '.model-response-text', '.font-claude-response', '[class*="MarkdownRoot-"]'];
  let messages = assistantRoles;
  if (!messages.length) {
    for (const selector of responseSelectors) {
      const candidates = queryAll(selector).filter(visible).filter(el =>
        !el.closest('[data-message-author-role="user"], [data-role="user"], .rich-text-user-turn') &&
        (!marker || !(el.textContent || '').includes(marker)));
      if (candidates.length) { messages = candidates; break; }
    }
  }
  // ChatGPT's October 2026 UI renders MarkdownRoot blocks without author roles.
  // Exclude the submitted prompt, then require a new block after its marker.
  if (providerId === 'chatgpt' && !assistantRoles.length) messages = queryAll('[class*="MarkdownRoot-"]')
    .filter(el => visible(el) && !el.classList.contains('rich-text-user-turn') && (!marker || !(el.textContent || '').includes(marker)));
  const latest = messages[messages.length - 1];
  const users = queryAll('[data-message-author-role="user"], [data-role="user"]');
  const markerNodes = marker ? queryAll('p, div, span').filter(el => (el.textContent || '').includes(marker) &&
    ![...el.children].some(child => (child.textContent || '').includes(marker)) && !messages.some(message => message.contains(el))) : [];
  const lastUser = users[users.length - 1] || markerNodes[markerNodes.length - 1];
  const editors = queryAll('#prompt-textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"].ProseMirror, [contenteditable="true"], textarea');
  const eligible = editors.filter(el => visible(el) && !el.disabled && (el.isContentEditable || el.tagName === 'TEXTAREA'));
  const editor = eligible.find(el => el.closest('[data-composer-body], [data-testid*="composer"], form')) || eligible[eligible.length - 1];
  const sendCandidates = queryAll('#composer-submit-button, button[data-testid="send-button"], button[data-testid*="send"], button[aria-label="Send"], button[aria-label="Send message"], button[aria-label="Send prompt"], button[aria-label="Send Message"], button.send-button, [role="button"][aria-label="Send"], [role="button"][aria-label="Send message"]');
  const form = editor?.closest('form');
  const send = sendCandidates.find(candidate => form?.contains(candidate)) || sendCandidates[sendCandidates.length - 1] || form?.querySelector('button[type="submit"], input[type="submit"]');
  return {
    count: messages.length,
    messageId: latest?.getAttribute('data-message-id') || latest?.closest('[data-message-id]')?.getAttribute('data-message-id') || latest?.id || null,
    text: latest?.innerText || '',
    lastUserText: lastUser?.innerText || '',
    hasPromptMarker: !!lastUser && !!marker && (lastUser.textContent || '').includes(marker),
    assistantAfterUser: !!(lastUser && latest && (lastUser.compareDocumentPosition(latest) & Node.DOCUMENT_POSITION_FOLLOWING)),
    editor: !!editor,
    login: queryAll('button, a, [role="button"]').some(el => visible(el) && /^(log in|sign in|đăng nhập)$/i.test((el.innerText || '').trim())),
    challenge: /just a moment|security verification/i.test(document.title),
    generating: !!document.querySelector('button[data-testid="stop-button"], button[aria-label="Stop"], button[aria-label="Stop generating"], button[aria-label="Stop streaming"], button[aria-label="Stop response"]'),
    sendReady: !!send && !send.disabled && send.getAttribute('aria-disabled') !== 'true',
    url: location.href,
  };
}

function isFreshReply(before, current) {
  return !!current.text?.trim() && (current.count > before.count ||
    (!!current.messageId && !!before.messageId && current.messageId !== before.messageId));
}

async function runGroupTurn(browser, { roomId, providerId, reference, prompt, onText, onReference, timeoutMs = 180000 }) {
  const marker = `UNION_TURN_${require('node:crypto').randomUUID()}`;
  prompt = `Mã liên kết lượt (không cần nhắc lại): ${marker}\n\n${prompt}`;
  const registry = PROVIDER_REGISTRY[providerId];
  if (!registry) throw new Error('Nhà cung cấp chưa được hỗ trợ.');
  const referenceUrl = reference?.url;
  if (referenceUrl && !isAllowedForProvider(providerId, referenceUrl)) throw new Error('Liên kết hội thoại không thuộc nhà cung cấp này.');
  let tab = referenceUrl ? browser.getState().tabs.find(t => t.providerId === providerId && t.url.split(/[?#]/)[0] === referenceUrl) : null;
  // Dedicated room tabs prevent the next message from being sent into an
  // unrelated conversation the operator happens to have open.
  if (!tab) {
    const created = browser.createTab(providerId, referenceUrl || registry.defaultUrl, `${registry.name} · ${roomId}`);
    if (!created.success) throw new Error(created.error || 'Không mở được hội thoại.');
    tab = created.tab;
  }
  const view = browser.views.get(tab.id);
  if (!view) throw new Error('Không tìm thấy tab AI trong app.');
  browser.selectTab(tab.id);
  const web = view.webContents;
  const deadline = Date.now() + timeoutMs;
  const execute = async code => {
    const result = await web.executeJavaScript(`(() => { try { return { ok: true, value: ${code} }; } catch (error) { return { ok: false, error: String(error.message || error) }; } })()`);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };
  const snapshot = () => execute(`(${readPage.toString()})(${JSON.stringify(marker)}, ${JSON.stringify(providerId)})`);
  const pause = () => new Promise(resolve => setTimeout(resolve, 650));
  let before;
  let ready = false;
  while (Date.now() < deadline) {
    if (web.isDestroyed()) throw new Error('Tab AI đã đóng trong lúc gửi.');
    before = await snapshot();
    if (before.challenge) throw new Error('Trang AI đang yêu cầu xác minh. Mở AI Browser để xử lý.');
    if (before.login && !before.editor && !web.isLoading()) throw new Error('Cần đăng nhập trong AI Browser trước khi trả lời nhóm.');
    if (before.editor && !web.isLoading() && !(providerId === 'chatgpt' && referenceUrl && before.count === 0)) { ready = true; break; }
    await pause();
  }
  if (!ready) throw new Error('Trang AI chưa tải xong hội thoại hoặc ô nhập trong thời gian chờ. Mở AI Browser để kiểm tra trang.');
  if (referenceUrl && new URL(before.url).pathname !== new URL(referenceUrl).pathname) throw new Error('Không mở được đúng hội thoại đã gắn vào nhóm. Mở AI Browser và gắn lại hội thoại trước khi gửi.');
  if (before.generating) throw new Error('Hội thoại đang có phản hồi khác. Hãy chờ AI trả lời xong.');
  const initialOrigin = new URL(before.url).origin;
  await execute(`(() => {
    const roots = [document];
    ${providerId === 'gemini' ? "for (const host of document.querySelectorAll('rich-textarea, message-content, model-response')) if (host.shadowRoot) roots.push(host.shadowRoot);" : ''}
    const queryAll = selector => [...new Set(roots.flatMap(root => [...root.querySelectorAll(selector)]))];
    const editors = queryAll('#prompt-textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"].ProseMirror, [contenteditable="true"], textarea').filter(el => el.getClientRects().length > 0 && !el.disabled && (el.isContentEditable || el.tagName === 'TEXTAREA'));
    const editor = editors.find(el => el.closest('[data-composer-body], [data-testid*="composer"], form')) || editors[editors.length - 1];
    if (!editor) throw new Error('Không tìm thấy ô nhập');
    const draft = typeof editor.value === 'string' ? editor.value : (editor.textContent || '');
    if (draft.trim()) throw new Error('Tab có bản nháp chưa gửi. Hãy gửi hoặc dọn bản nháp trong AI Browser trước. [' + editor.tagName + ', editable=' + editor.isContentEditable + ', id=' + editor.id + ', length=' + draft.length + ']');
    editor.focus();
  })()`);
  await web.insertText(prompt);
  await pause();
  let clicked = false;
  const sendDeadline = Math.min(deadline, Date.now() + 15000);
  while (!clicked && Date.now() < sendDeadline) {
    clicked = await execute(`(() => {
      const roots = [document];
      ${providerId === 'gemini' ? "for (const host of document.querySelectorAll('rich-textarea, message-content, model-response')) if (host.shadowRoot) roots.push(host.shadowRoot);" : ''}
      const queryAll = selector => [...new Set(roots.flatMap(root => [...root.querySelectorAll(selector)]))];
      const sendCandidates = queryAll('#composer-submit-button, button[data-testid="send-button"], button[data-testid*="send"], button[aria-label="Send"], button[aria-label="Send message"], button[aria-label="Send prompt"], button[aria-label="Send Message"], button.send-button, [role="button"][aria-label="Send"], [role="button"][aria-label="Send message"]');
      const editors = queryAll('#prompt-textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"].ProseMirror, [contenteditable="true"], textarea').filter(el => el.getClientRects().length > 0 && !el.disabled && (el.isContentEditable || el.tagName === 'TEXTAREA'));
      const editor = editors.find(el => el.closest('[data-composer-body], [data-testid*="composer"], form')) || editors[editors.length - 1];
      const form = editor?.closest('form');
      const send = sendCandidates.find(candidate => form?.contains(candidate)) || sendCandidates[sendCandidates.length - 1] || form?.querySelector('button[type="submit"], input[type="submit"]');
      if (send && !send.disabled && send.getAttribute('aria-disabled') !== 'true') { send.click(); return true; }
      if (form && typeof form.requestSubmit === 'function') { form.requestSubmit(); return true; }
      return false;
    })()`);
    if (!clicked) await pause();
  }
  if (!clicked) throw new Error('Đã nhập bản nháp nhưng không tìm được nút gửi đang sẵn sàng. Mở tab gốc trong AI Browser để kiểm tra; bản nháp được giữ lại.');
  let previousText = '';
  let stable = 0;
  while (Date.now() < deadline) {
    await pause();
    if (web.isDestroyed()) throw new Error('Tab AI đã đóng trong lúc trả lời.');
    const current = await snapshot();
    if (new URL(current.url).origin !== initialOrigin || !isAllowedForProvider(providerId, current.url)) throw new Error('Hội thoại đã chuyển sang trang khác.');
    if (referenceUrl && new URL(current.url).pathname !== new URL(referenceUrl).pathname) throw new Error('Hội thoại đã đổi trong lúc nhận phản hồi. Không lấy nội dung của cuộc chat khác.');
    if (current.login || current.challenge) throw new Error('Phiên AI yêu cầu đăng nhập hoặc xác minh lại trong AI Browser.');
    // ChatGPT virtualizes long threads; the rendered message count can shrink
    // while a new answer arrives. The unique submitted marker establishes the
    // turn boundary without relying on how many old messages remain mounted.
    if (providerId === 'chatgpt') {
      if (!current.assistantAfterUser || !current.hasPromptMarker || !current.text.trim()) continue;
    } else if (!isFreshReply(before, current)) continue;
    if (current.text !== previousText) { previousText = current.text; stable = 0; onText?.(current.text); }
    else stable++;
    const url = new URL(current.url); url.search = ''; url.hash = '';
    const conversationId = providerId === 'chatgpt' ? url.pathname.match(/^\/c\/([^/]+)/)?.[1] : url.pathname;
    if (conversationId) onReference?.({ url: url.href, conversationId });
    if (!current.generating && stable >= 4) return { text: current.text, url: url.href, conversationId };
  }
  throw new Error('AI chưa hoàn tất phản hồi trong thời gian chờ. Kiểm tra tab gốc trong AI Browser trước khi thử lại.');
}

module.exports = { runGroupTurn, isFreshReply, readPage };
