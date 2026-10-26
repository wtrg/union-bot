const {
  PROVIDER_REGISTRY,
  isAllowedForProvider,
} = require("../../../../packages/browser-manager/src/browser-manager.cjs");

function readPage(marker, providerId) {
  const visible = (el) =>
    el && (!el.getClientRects || el.getClientRects().length > 0);
  const roots = [document];
  if (providerId === "gemini") {
    // Gemini has used a rich-textarea shadow root for its composer. Search the
    // provider's known web components without walking the entire document.
    for (const host of document.querySelectorAll(
      "rich-textarea, message-content, model-response",
    )) {
      if (host.shadowRoot) roots.push(host.shadowRoot);
    }
  }
  const queryAll = (selector) => [
    ...new Set(roots.flatMap((root) => [...root.querySelectorAll(selector)])),
  ];
  const assistantRoles = queryAll(
    '[data-message-author-role="assistant"], [data-role="assistant"]',
  ).filter(visible);
  const responseSelectors =
    providerId === "gemini"
      ? [
          "model-response",
          '[data-test-id*="model-response"]',
          '[data-testid*="response"]',
          ".model-response-text",
          "message-content",
          '[class*="MarkdownRoot-"]',
        ]
      : providerId === "claude"
        ? [
            ".font-claude-response",
            '[data-testid="conversation-turn-assistant"]',
            '[data-message-author-role="assistant"]',
          ]
        : providerId === "deepseek"
          ? [
              '[data-message-author-role="assistant"]',
              '[data-role="assistant"]',
              ".ds-markdown",
            ]
          : [
              '[data-message-author-role="assistant"]',
              '[data-role="assistant"]',
              ".model-response-text",
              ".font-claude-response",
              '[class*="MarkdownRoot-"]',
            ];
  let messages = assistantRoles;
  if (!messages.length) {
    for (const selector of responseSelectors) {
      const candidates = queryAll(selector)
        .filter(visible)
        .filter(
          (el) =>
            !el.closest(
              '[data-message-author-role="user"], [data-role="user"], .rich-text-user-turn',
            ) &&
            (!marker || !(el.textContent || "").includes(marker)),
        );
      if (candidates.length) {
        messages = candidates;
        break;
      }
    }
  }
  // ChatGPT's October 2026 UI renders MarkdownRoot blocks without author roles.
  // Exclude the submitted prompt, then require a new block after its marker.
  if (providerId === "chatgpt" && !assistantRoles.length)
    messages = queryAll('[class*="MarkdownRoot-"]').filter(
      (el) =>
        visible(el) &&
        !el.classList.contains("rich-text-user-turn") &&
        (!marker || !(el.textContent || "").includes(marker)),
    );
  const latest = messages[messages.length - 1];
  const users = queryAll(
    '[data-message-author-role="user"], [data-role="user"]',
  );
  const markerNodes = marker
    ? queryAll("p, div, span").filter(
        (el) =>
          (el.textContent || "").includes(marker) &&
          ![...el.children].some((child) =>
            (child.textContent || "").includes(marker),
          ) &&
          !el.closest('[contenteditable="true"], textarea') &&
          !messages.some((message) => message.contains(el)),
      )
    : [];
  const lastUser =
    users[users.length - 1] || markerNodes[markerNodes.length - 1];
  const editors = queryAll(
    '#prompt-textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"].ProseMirror, [contenteditable="true"], textarea',
  );
  const eligible = editors.filter(
    (el) =>
      visible(el) &&
      !el.closest('.ql-clipboard, [aria-hidden="true"]') &&
      !el.disabled &&
      (el.isContentEditable || el.tagName === "TEXTAREA"),
  );
  const editor =
    eligible.find(
      (el) =>
        el.getAttribute("role") === "textbox" ||
        el.id === "prompt-textarea" ||
        el.classList.contains("ql-editor"),
    ) ||
    eligible.find((el) =>
      el.closest('[data-composer-body], [data-testid*="composer"], form'),
    ) ||
    eligible[eligible.length - 1];
  const sendCandidates = queryAll(
    '#composer-submit-button, button[data-testid="send-button"], button[data-testid*="send"], button[aria-label="Send"], button[aria-label="Send message"], button[aria-label="Send prompt"], button[aria-label="Send Message"], button[aria-label="Gửi tin nhắn"], button[aria-label="Gửi"], button.send-button, [role="button"][aria-label="Send"], [role="button"][aria-label="Send message"]',
  ).filter(candidate => visible(candidate) && !candidate.disabled && candidate.getAttribute('aria-disabled') !== 'true');
  const form = editor?.closest("form");
  const send =
    sendCandidates.find((candidate) => form?.contains(candidate)) ||
    sendCandidates[sendCandidates.length - 1] ||
    form?.querySelector('button[type="submit"], input[type="submit"]');
  return {
    count: messages.length,
    messageId:
      latest?.getAttribute("data-message-id") ||
      latest?.closest("[data-message-id]")?.getAttribute("data-message-id") ||
      latest?.id ||
      null,
    text: latest?.innerText || latest?.textContent || "",
    lastUserText: lastUser?.innerText || lastUser?.textContent || "",
    hasPromptMarker:
      !!lastUser && !!marker && (lastUser.textContent || "").includes(marker),
    assistantAfterUser: !!(
      lastUser &&
      latest &&
      lastUser.compareDocumentPosition(latest) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ),
    editor: !!editor,
    draftPresent: !!editor && !!(typeof editor.value === 'string' ? editor.value : editor.innerText || editor.textContent || '').trim(),
    login:
      /^(?:sign in|log in|đăng nhập)(?:\s*[-–|].*)?$/i.test(document.title) ||
      /^\/(?:login|sign-?in)(?:\/|$)/i.test(location.pathname || "") ||
      queryAll('button, a, [role="button"]').some(
        (el) =>
          visible(el) &&
          /^(log in|sign in|đăng nhập)$/i.test((el.innerText || "").trim()),
      ),
    challenge: /just a moment|security verification/i.test(document.title),
    generating: !!document.querySelector(
      'button[data-testid="stop-button"], button[aria-label="Stop"], button[aria-label="Stop generating"], button[aria-label="Stop streaming"], button[aria-label="Stop response"]',
    ),
    sendReady:
      !!send && !send.disabled && send.getAttribute("aria-disabled") !== "true",
    url: location.href,
  };
}

function isFreshReply(before, current) {
  return (
    !!current.text?.trim() &&
    (current.count > before.count ||
      (!!current.messageId &&
        !!before.messageId &&
        current.messageId !== before.messageId))
  );
}

function prepareComposer(providerId, ownedDraft, expected) {
  const roots = [document];
  if (providerId === 'gemini') {
    for (const host of document.querySelectorAll('rich-textarea, message-content, model-response'))
      if (host.shadowRoot) roots.push(host.shadowRoot);
  }
  const queryAll = selector => [...new Set(roots.flatMap(root => [...root.querySelectorAll(selector)]))];
  const editors = queryAll('#prompt-textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"].ProseMirror, [contenteditable="true"], textarea').filter(el => el.getClientRects().length > 0 && !el.closest('.ql-clipboard, [aria-hidden="true"]') && !el.disabled && (el.isContentEditable || el.tagName === 'TEXTAREA'));
  const editor = editors.find(el => el.getAttribute('role') === 'textbox' || el.id === 'prompt-textarea' || el.classList.contains('ql-editor')) || editors.find(el => el.closest('[data-composer-body], [data-testid*="composer"], form')) || editors[editors.length - 1];
  if (!editor) throw new Error('Không tìm thấy ô nhập');
  const readDraft = () => typeof editor.value === 'string' ? editor.value : (editor.innerText || editor.textContent || '');
  const draft = readDraft();
  if (expected !== undefined) {
    const actualText = draft.replace(/\s+/g, ' ').trim();
    const expectedText = expected.replace(/\s+/g, ' ').trim();
    // Hidden contenteditable views can expose textContent without paragraph
    // separators. Only tolerate omission of the original newline separators.
    const collapsedLines = expected.replace(/\r?\n/g, '').replace(/\s+/g, ' ').trim();
    if (!draft || (actualText !== expectedText && actualText !== collapsedLines)) {
      let at = 0;
      while (at < Math.min(actualText.length, expectedText.length) && actualText[at] === expectedText[at]) at++;
      throw new Error('Ô nhập đã thay đổi. Dừng gửi để bảo toàn bản nháp và tránh gửi nhầm. [actual=' + actualText.length + ', expected=' + expectedText.length + ', at=' + at + ', chars=' + actualText.charCodeAt(at) + '/' + expectedText.charCodeAt(at) + ']');
    }
    return draft;
  }
  if (draft.trim()) {
    const owned = ownedDraft && !ownedDraft.mayHaveSent && draft === ownedDraft.text && location.href.split(/[?#]/)[0] === ownedDraft.url;
    // A draft is recoverable only with in-process provenance, exact contents,
    // the same page and proof that no send attempt might have succeeded.
    if (!owned) throw new Error('Tab có bản nháp chưa gửi. Hãy gửi hoặc dọn bản nháp trong AI Browser trước. [' + editor.tagName + ', length=' + draft.length + ']');
    editor.focus();
    if (editor.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!setter) throw new Error('Không thể khôi phục bản nháp của bot.');
      setter.call(editor, '');
      editor.dispatchEvent(new Event('input', {bubbles: true}));
    } else {
      const selection = document.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('delete', false);
      editor.dispatchEvent(new Event('input', {bubbles: true}));
    }
    if (readDraft().trim()) throw new Error('Không thể khôi phục bản nháp của bot.');
  }
  editor.focus();
}

async function runGroupTurn(
  browser,
  {
    roomId,
    providerId,
    reference,
    prompt,
    onText,
    onReference,
    timeoutMs = 180000,
    signal,
    onProgress,
  },
) {
  const marker = `UNION_TURN_${require("node:crypto").randomUUID()}`;
  prompt = `Mã liên kết lượt (không cần nhắc lại): ${marker}\n\n${prompt}`;
  const registry = PROVIDER_REGISTRY[providerId];
  if (!registry) throw new Error("Nhà cung cấp chưa được hỗ trợ.");
  const referenceUrl = reference?.url;
  if (referenceUrl && !isAllowedForProvider(providerId, referenceUrl))
    throw new Error("Liên kết hội thoại không thuộc nhà cung cấp này.");
  let tab = referenceUrl
    ? browser
        .getState()
        .tabs.find(
          (t) =>
            t.providerId === providerId &&
            t.url.split(/[?#]/)[0] === referenceUrl,
        )
    : browser.getState().tabs.find(t => t.id === reference?.tabId && t.providerId === providerId);
  // Dedicated room tabs prevent the next message from being sent into an
  // unrelated conversation the operator happens to have open.
  if (!tab) {
    const created = browser.createTab(
      providerId,
      referenceUrl || registry.defaultUrl,
      `${registry.name} · ${roomId}`,
    );
    if (!created.success)
      throw new Error(created.error || "Không mở được hội thoại.");
    tab = created.tab;
  }
  // Keep a failed or login-required room tab available for a retry. A tab ID
  // alone is not a conversation URL and imposes no false navigation boundary.
  if (reference?.tabId !== tab.id) onReference?.({ ...reference, tabId: tab.id });
  const view = browser.views.get(tab.id);
  if (!view) throw new Error("Không tìm thấy tab AI trong app.");
  // Work through webContents without changing the tab the user is viewing.
  const bridge = browser.controlBridge;
  const lease = bridge?.acquireControllerLease(
    tab.id,
    `group:${roomId}:${marker}`,
  );
  if (lease && !lease.success)
    throw new Error(
      "Tab đang được điều khiển bởi tác vụ khác. Hãy chờ lượt hiện tại kết thúc.",
    );
  browser._notifyRenderer?.();
  try {
    browser.updateLayout?.();
    const web = view.webContents;
    const checkControl = () => {
      if (signal?.aborted) throw new Error("Lượt đã được hủy bởi người dùng.");
      if (
        lease &&
        !bridge.renewControllerLease(tab.id, lease.leaseToken).success
      )
        throw new Error("Mất quyền điều khiển tab. Lượt đã dừng.");
    };
    const deadline = Date.now() + timeoutMs;
    // A renderer can stop answering IPC entirely. Bound each await as well as
    // the polling loop, so cancellation and the room/provider queues can finish.
    const bounded = (operation, maxMs = deadline - Date.now()) => {
      checkControl();
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          if (error) reject(error);
          else resolve(value);
        };
        const onAbort = () => finish(new Error('Lượt đã được hủy bởi người dùng.'));
        const timer = setTimeout(() => finish(new Error('ERR_WEB_OPERATION_TIMEOUT: Trang AI không phản hồi trong thời gian chờ. Trạng thái gửi chưa chắc chắn; kiểm tra hội thoại gốc trước khi gửi lại.')), Math.max(0, Math.min(maxMs, deadline - Date.now())));
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) { onAbort(); return; }
        Promise.resolve().then(() => {
          checkControl();
          if (Date.now() >= deadline) throw new Error('ERR_WEB_OPERATION_TIMEOUT: Đã hết thời gian chờ trang AI.');
          return operation();
        }).then(value => finish(null, value), error => finish(error));
      });
    };
    const execute = async (code) => {
      const result = await bounded(() => web.executeJavaScript(
        `(() => { try { if (Date.now() >= ${deadline}) throw Error('ERR_WEB_OPERATION_TIMEOUT'); return { ok: true, value: ${code} }; } catch (error) { return { ok: false, error: String(error.message || error) }; } })()`,
      ), 15000);
      checkControl();
      if (!result.ok) throw new Error(result.error);
      return result.value;
    };
    let probeState = '';
    const snapshot = async () => {
      const page = await execute(
        `(${readPage.toString()})(${JSON.stringify(marker)}, ${JSON.stringify(providerId)})`,
      );
      if (process.env.UNION_BOT_GROUP_DIAGNOSTICS === '1') {
        const state = JSON.stringify({providerId, editor:page.editor, marker:page.hasPromptMarker, after:page.assistantAfterUser, count:page.count, chars:page.text?.length, generating:page.generating});
        if (state !== probeState) { console.log('[GroupWebProbe]', state); probeState = state; }
      }
      return page;
    };
    const pause = () => bounded(() => new Promise((resolve) => setTimeout(resolve, Math.min(650, Math.max(0, deadline - Date.now())))));
    let before;
    let ready = false;
    onProgress?.('Đang tải và kiểm tra hội thoại…', 'loading');
    while (Date.now() < deadline) {
      if (web.isDestroyed()) throw new Error("Tab AI đã đóng trong lúc gửi.");
      // Electron defers executeJavaScript until navigation completes. Poll the
      // load state first so a cold page does not consume the IPC timeout.
      if (web.isLoading()) { await pause(); continue; }
      before = await snapshot();
      if (before.challenge)
        throw new Error(
          "Trang AI đang yêu cầu xác minh. Mở AI Browser để xử lý.",
        );
      if (before.login && !before.editor && !web.isLoading())
        throw new Error(
          "Cần đăng nhập trong AI Browser trước khi trả lời nhóm.",
        );
      if (before.editor && !web.isLoading()) {
        ready = true;
        break;
      }
      await pause();
    }
    if (!ready)
      throw new Error(
        "Trang AI chưa tải xong hội thoại hoặc ô nhập trong thời gian chờ. Mở AI Browser để kiểm tra trang.",
      );
    if (
      referenceUrl &&
      new URL(before.url).pathname !== new URL(referenceUrl).pathname
    )
      throw new Error(
        "Không mở được đúng hội thoại đã gắn vào nhóm. Mở AI Browser và gắn lại hội thoại trước khi gửi.",
      );
    if (before.generating)
      throw new Error(
        "Hội thoại đang có phản hồi khác. Hãy chờ AI trả lời xong.",
      );
    const initialOrigin = new URL(before.url).origin;
    onProgress?.('Đang chuẩn bị tin nhắn…', 'preparing');
    browser.groupDrafts ||= new Map();
    await execute(`(${prepareComposer.toString()})(${JSON.stringify(providerId)}, ${JSON.stringify(browser.groupDrafts.get(tab.id) || null)})`);
    checkControl();
    const draftRecord = { text: prompt, url: before.url.split(/[?#]/)[0], mayHaveSent: false };
    browser.groupDrafts.set(tab.id, draftRecord);
    await bounded(() => web.insertText(prompt), 5000);
    await pause();
    draftRecord.text = await execute(`(${prepareComposer.toString()})(${JSON.stringify(providerId)}, null, ${JSON.stringify(prompt)})`);
    let clicked = false;
    const sendDeadline = Math.min(deadline, Date.now() + 15000);
    onProgress?.('Đang gửi tin nhắn…', 'sending');
    while (!clicked && Date.now() < sendDeadline) {
      draftRecord.mayHaveSent = true;
      clicked = await execute(`(() => {
      const verifiedDraft = (${prepareComposer.toString()})(${JSON.stringify(providerId)}, null, ${JSON.stringify(prompt)});
      const roots = [document];
      ${providerId === "gemini" ? "for (const host of document.querySelectorAll('rich-textarea, message-content, model-response')) if (host.shadowRoot) roots.push(host.shadowRoot);" : ""}
      const queryAll = selector => [...new Set(roots.flatMap(root => [...root.querySelectorAll(selector)]))];
      const sendCandidates = queryAll('#composer-submit-button, button[data-testid="send-button"], button[data-testid*="send"], button[aria-label="Send"], button[aria-label="Send message"], button[aria-label="Send prompt"], button[aria-label="Send Message"], button[aria-label="Gửi tin nhắn"], button[aria-label="Gửi"], button.send-button, [role="button"][aria-label="Send"], [role="button"][aria-label="Send message"]').filter(candidate => candidate.getClientRects().length > 0 && !candidate.disabled && candidate.getAttribute('aria-disabled') !== 'true');
      const editors = queryAll('#prompt-textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"].ProseMirror, [contenteditable="true"], textarea').filter(el => el.getClientRects().length > 0 && !el.closest('.ql-clipboard, [aria-hidden="true"]') && !el.disabled && (el.isContentEditable || el.tagName === 'TEXTAREA'));
      const editor = editors.find(el => el.getAttribute('role') === 'textbox' || el.id === 'prompt-textarea' || el.classList.contains('ql-editor')) || editors.find(el => el.closest('[data-composer-body], [data-testid*="composer"], form')) || editors[editors.length - 1];
      const draft = editor && (typeof editor.value === 'string' ? editor.value : editor.innerText || editor.textContent || '');
      if (draft !== verifiedDraft) throw Error('Ô nhập đã thay đổi. Dừng gửi để bảo toàn bản nháp và tránh gửi nhầm.');
      const form = editor?.closest('form');
      const send = sendCandidates.find(candidate => form?.contains(candidate)) || sendCandidates[sendCandidates.length - 1] || form?.querySelector('button[type="submit"], input[type="submit"]');
      if (send && send.getClientRects().length > 0 && !send.disabled && send.getAttribute('aria-disabled') !== 'true') { send.click(); return true; }
      return false;
    })()`);
      if (!clicked) draftRecord.mayHaveSent = false;
      if (!clicked) await pause();
    }
    if (!clicked)
      throw new Error(
        "Đã nhập bản nháp nhưng không tìm được nút gửi đang sẵn sàng. Mở tab gốc trong AI Browser để kiểm tra; bản nháp được giữ lại.",
      );
    onProgress?.('Đã bấm gửi · đang chờ phản hồi từ AI…', 'waiting');
    let previousText = "";
    let stable = 0;
    while (Date.now() < deadline) {
      await pause();
      if (web.isDestroyed())
        throw new Error("Tab AI đã đóng trong lúc trả lời.");
      const current = await snapshot();
      if (
        new URL(current.url).origin !== initialOrigin ||
        !isAllowedForProvider(providerId, current.url)
      )
        throw new Error("Hội thoại đã chuyển sang trang khác.");
      if (
        referenceUrl &&
        new URL(current.url).pathname !== new URL(referenceUrl).pathname
      )
        throw new Error(
          "Hội thoại đã đổi trong lúc nhận phản hồi. Không lấy nội dung của cuộc chat khác.",
        );
      if (current.login || current.challenge)
        throw new Error(
          "Phiên AI yêu cầu đăng nhập hoặc xác minh lại trong AI Browser.",
        );
      // Providers can virtualize old messages. Require a submitted marker and
      // an answer after it, rather than relying on a growing rendered count.
      if (!current.assistantAfterUser || !current.hasPromptMarker || !current.text.trim()) continue;
      if (current.text !== previousText) {
        previousText = current.text;
        stable = 0;
        onText?.(current.text);
      } else stable++;
      const url = new URL(current.url);
      url.search = "";
      url.hash = "";
      const conversationId =
        providerId === "chatgpt"
          ? url.pathname.match(/^\/c\/([^/]+)/)?.[1]
          : url.pathname;
      if (conversationId) onReference?.({ url: url.href, conversationId });
      if (!current.generating && stable >= 8) {
        browser.groupDrafts.delete(tab.id);
        return { text: current.text, url: url.href, conversationId };
      }
    }
    throw new Error(
      "AI chưa hoàn tất phản hồi trong thời gian chờ. Kiểm tra tab gốc trong AI Browser trước khi thử lại.",
    );
  } finally {
    if (lease) bridge.releaseControllerLease(tab.id, lease.leaseToken);
    browser.updateLayout?.();
    browser._notifyRenderer?.();
  }
}

module.exports = { runGroupTurn, isFreshReply, readPage, prepareComposer };
