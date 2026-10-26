const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test(
  "workspace UI in Electron: truthful tasks, cancel, routing, grouped stream, drafts, scroll and responsive layout (mock transport)",
  { timeout: 55000 },
  async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "union-ui-"));
    const electron = path.join(
      root,
      "spikes/electron-browser/node_modules/.pnpm/electron@33.4.11/node_modules/electron/dist/electron.exe",
    );
    const childEnv = { ...process.env, UNION_UI_TEST_PROFILE: profile };
    delete childEnv.ELECTRON_RUN_AS_NODE;
    delete childEnv.NODE_TEST_CONTEXT;
    const child = spawn(
      electron,
      [
        path.join(__dirname, "fixtures/workspace-harness.cjs"),
        "--remote-debugging-port=0",
      ],
      { cwd: root, env: childEnv, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stderr.on("data", (data) => (output += data));
    child.stdout.on("data", (data) => (output += data));
    let socket;
    try {
      let match;
      for (let i = 0; i < 120; i++) {
        match = output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
        if (match) break;
        await delay(100);
      }
      assert.ok(match, output);
      let target;
      for (let i = 0; i < 100; i++) {
        const targets = await (
          await fetch(`http://127.0.0.1:${match[1]}/json/list`)
        ).json();
        target = targets.find(
          (t) => t.type === "page" && t.url.includes("/dist/index.html"),
        );
        if (target) break;
        await delay(100);
      }
      assert.ok(target, output);
      socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
      });
      let seq = 0;
      const pending = new Map();
      socket.addEventListener("message", (event) => {
        const data = JSON.parse(event.data);
        if (data.id) {
          const entry = pending.get(data.id);
          pending.delete(data.id);
          if (data.error) entry?.reject(Error(JSON.stringify(data.error)));
          else entry?.resolve(data.result);
        }
      });
      const cdp = (method, params = {}) =>
        new Promise((resolve, reject) => {
          const id = ++seq;
          pending.set(id, { resolve, reject });
          socket.send(JSON.stringify({ id, method, params }));
        });
      const evaluate = async (expression) => {
        const result = await cdp("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
        if (result.exceptionDetails)
          throw Error(JSON.stringify(result.exceptionDetails));
        return result.result?.value;
      };
      const waitFor = async (expression) => {
        for (let i = 0; i < 80; i++) {
          if (await evaluate(expression)) return;
          await delay(75);
        }
        throw Error(
          "Timed out: " +
            expression +
            "\n" +
            (await evaluate("document.body.innerText")),
        );
      };
      const click = (text) =>
        evaluate(
          `(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!button) throw Error('Missing button'); button.click(); })()`,
        );
      const setValue = (selector, value) =>
        evaluate(
          `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`,
        );
      await waitFor("!!document.querySelector('.ub-workspace')");
      assert.equal(
        await evaluate("document.body.innerText.includes('ĐANG THỰC THI')"),
        false,
      );
      assert.equal(
        await evaluate("document.querySelector('.ub-inspector') === null"),
        true,
      );
      assert.equal(
        await evaluate("document.querySelectorAll('.ub-node-button').length"),
        6,
      );
      assert.equal(
        await evaluate(
          "document.querySelector('.ub-signal-stage').getBoundingClientRect().height <= 72",
        ),
        true,
      );
      assert.equal(
        await evaluate("document.querySelector('canvas') === null"),
        true,
      );
      await click("Chi tiết");
      await click("Công việc");
      await waitFor("!!document.querySelector('.ub-task')");
      assert.equal(
        await evaluate("document.querySelector('.ub-task progress').value"),
        0,
      );
      await click("Chạy");
      await waitFor(
        "document.querySelector('.ub-task').innerText.includes('Đang thực thi')",
      );
      await click("Yêu cầu dừng");
      await waitFor(
        "document.querySelector('.ub-task').innerText.includes('Đã hủy')",
      );
      const taskStats = await evaluate("window.__workspaceTest.stats()");
      assert.equal(taskStats.executes.length, 1);
      assert.equal(taskStats.cancels.length, 1);
      await setValue(".ub-composer select", "codex");
      await setValue(
        ".ub-composer-controls label:nth-child(2) select",
        "review",
      );
      await setValue(".ub-composer textarea", "Kiểm tra giao diện, mô tả lỗi lượt @all trước đó");
      await click("Gửi yêu cầu ↑");
      await waitFor(
        "document.querySelector('[data-state=completed] .ub-prose table') !== null",
      );
      const sent = (await evaluate("window.__workspaceTest.stats()")).sends[0];
      assert.equal(sent.parts[0].text, "@codex Kiểm tra giao diện, mô tả lỗi lượt @all trước đó");
      assert.equal(sent.metadata.collaborationMode, "review");
      assert.equal(
        await evaluate(
          "document.querySelectorAll('[data-testid=workspace-run]').length",
        ),
        1,
      );
      assert.equal(
        await evaluate(
          "document.querySelectorAll('[data-testid=workspace-message]').length",
        ),
        2,
      );
      assert.equal(
        await evaluate("document.querySelectorAll('.ub-prose script').length"),
        0,
      );
      // Copy the real code block through the browser clipboard API and verify native contents.
      await cdp("Runtime.evaluate", {
        expression: "document.querySelector('.ub-code button').click()",
        userGesture: true,
      });
      await waitFor(
        "document.querySelector('.ub-code button').textContent === 'Đã chép'",
      );
      assert.equal(
        await evaluate("window.__workspaceTest.readClipboard()"),
        'console.log("<script>safe</script>");',
      );
      await evaluate("window.__workspaceTest.restoreClipboard()");
      const sendsBeforeInput = (
        await evaluate("window.__workspaceTest.stats()")
      ).sends.length;
      await evaluate("document.querySelector('.ub-composer textarea').focus()");
      await cdp("Input.insertText", {
        text: "Tiếng Việt: thiết kế giao diện\n<script>chỉ là văn bản</script>",
      });
      await waitFor(
        "document.querySelector('.ub-composer textarea').value.includes('Tiếng Việt: thiết kế giao diện')",
      );
      await evaluate(
        "(() => { const el=document.querySelector('.ub-composer textarea'); el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})); el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:229,isComposing:true,bubbles:true})); })()",
      );
      await delay(80);
      assert.equal(
        (await evaluate("window.__workspaceTest.stats()")).sends.length,
        sendsBeforeInput,
      );
      await evaluate(
        "document.querySelector('.ub-composer textarea').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))",
      );
      await setValue(".ub-composer textarea", "");
      await click("Hiệu ứng");
      assert.equal(
        await evaluate(
          "document.querySelector('.ub-signal-stage').dataset.paused",
        ),
        "true",
      );
      assert.equal(
        await evaluate(
          "document.querySelector('.ub-workspace').dataset.motion",
        ),
        "off",
      );
      await click("Hiệu ứng");
      await click("Thành viên");
      await click("Đăng nhập DeepSeek");
      await waitFor(
        "!!document.querySelector('[data-testid=browser-panel-container]')",
      );
      assert.equal(
        (await evaluate("window.__workspaceTest.stats()")).loginOpens.at(-1),
        "deepseek",
      );
      await evaluate(
        "document.querySelector('[data-testid=browser-close-panel-btn]').click()",
      );
      await waitFor(
        "!document.querySelector('[data-testid=browser-panel-container]')",
      );
      await evaluate(
        "document.querySelector('[data-testid=provider-session-deepseek] button:nth-child(2)').click()",
      );
      await waitFor(
        "document.querySelector('[data-testid=provider-session-deepseek]').innerText.includes('Chưa đăng nhập')",
      );
      assert.equal(
        (await evaluate("window.__workspaceTest.stats()")).sessionChecks.at(-1),
        "deepseek",
      );
      await cdp("Emulation.setDeviceMetricsOverride", {
        width: 1536,
        height: 864,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await delay(150);
      const cleanShot = await cdp("Page.captureScreenshot", { format: "png" });

      await setValue(".ub-composer textarea", "Bản nháp phòng chung");
      await evaluate(
        "[...document.querySelectorAll('.ub-navigation button')].find(b => b.textContent.includes('Phát triển')).click()",
      );
      await waitFor(
        "document.querySelector('.ub-room-header h1').textContent === 'Phát triển'",
      );
      assert.equal(
        await evaluate("document.querySelector('.ub-composer textarea').value"),
        "",
      );
      await setValue(".ub-composer textarea", "Bản nháp code");
      await evaluate(
        "[...document.querySelectorAll('.ub-navigation button')].find(b => b.textContent.includes('Chung')).click()",
      );
      await waitFor(
        "document.querySelector('.ub-composer textarea').value === 'Bản nháp phòng chung'",
      );
      await evaluate("window.__workspaceTest.failSend(true)");
      await click("Gửi yêu cầu ↑");
      await waitFor("!!document.querySelector('[data-state=failed]')");
      assert.equal(
        await evaluate("document.querySelector('.ub-composer textarea').value"),
        "Bản nháp phòng chung",
      );
      // Appending lines preserves the code DOM identity and native horizontal scroll.
      await evaluate(
        'window.__workspaceTest.emit({"id": "code_probe", "traceId": "t", "timestamp": 1792950000000, "roomId": "orchestration", "fidelity": "L0_RAW_TEXT", "sender": {"kind": "agent", "id": "codex", "name": "Codex"}, "recipient": {"kind": "room", "id": "orchestration"}, "parts": [{"kind": "text", "text": "```ts\\nxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}], "status": "streaming"})',
      );
      await waitFor(
        "[...document.querySelectorAll('.ub-code pre')].some(el=>el.textContent.includes('x'.repeat(100)))",
      );
      await evaluate(
        "(() => { window.__codePre=[...document.querySelectorAll('.ub-code pre')].find(el=>el.textContent.includes('x'.repeat(100))); window.__codePre.scrollLeft=70; })()",
      );
      await evaluate(
        'window.__workspaceTest.emit({"id": "code_probe", "traceId": "t", "timestamp": 1792950000000, "roomId": "orchestration", "fidelity": "L0_RAW_TEXT", "sender": {"kind": "agent", "id": "codex", "name": "Codex"}, "recipient": {"kind": "room", "id": "orchestration"}, "parts": [{"kind": "text", "text": "```ts\\nxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nNEXT_CODE_LINE\\n```"}], "status": "completed"})',
      );
      await waitFor("window.__codePre.textContent.includes('NEXT_CODE_LINE')");
      assert.equal(await evaluate("window.__codePre.isConnected"), true);
      assert.ok(await evaluate("window.__codePre.scrollLeft >= 69"));
      // A burst from the bridge must preserve final content while coalescing DOM work.
      await evaluate(`(() => {
        const probe={id:'burst_probe',traceId:'t',timestamp:Date.now(),roomId:'orchestration',fidelity:'L0_RAW_TEXT',sender:{kind:'agent',id:'gemini',name:'Gemini'},recipient:{kind:'room',id:'orchestration'},parts:[{kind:'text',text:''}],status:'streaming'};
        window.__burstStart=performance.now(); window.__burstMutations=0;
        window.__burstObserver=new MutationObserver(records=>window.__burstMutations+=records.length);
        window.__burstObserver.observe(document.querySelector('.ub-chat-scroll'),{subtree:true,childList:true,characterData:true});
        for(let i=0;i<1000;i++) window.__workspaceTest.emit({...probe,parts:[{kind:'text',text:'token '+i}]});
        window.__workspaceTest.emit({...probe,status:'completed',parts:[{kind:'text',text:'BURST_FINAL'}]});
      })()`);
      await waitFor(
        "[...document.querySelectorAll('.ub-prose')].some(el=>el.textContent==='BURST_FINAL')",
      );
      const burstMetrics = await evaluate(
        "(() => { window.__burstObserver.disconnect(); return {events:1001,mutations:window.__burstMutations,elapsedMs:performance.now()-window.__burstStart}; })()",
      );
      assert.ok(burstMetrics.mutations < 40, JSON.stringify(burstMetrics));
      assert.equal(
        await evaluate(
          "document.querySelector('[data-status=completed][aria-label^=Gemini]') !== null",
        ),
        true,
      );
      // Populate long history through the same event bridge as production.
      await evaluate(
        `(() => { for(let i=0;i<100;i++) window.__workspaceTest.emit({ id:'scroll_'+i, traceId:'t', timestamp:Date.now(), roomId:'orchestration', fidelity:'L0_RAW_TEXT', sender:{kind:'agent',id:'codex',name:'Codex'}, recipient:{kind:'room',id:'orchestration'}, parts:[{kind:'text',text:'Nội dung kiểm tra cuộn. '.repeat(18)}],status:'completed' }); })()`,
      );
      await delay(200);
      await evaluate(
        "(() => { const el=document.querySelector('.ub-chat-scroll'); el.scrollTop=0; el.dispatchEvent(new Event('scroll')); })()",
      );
      await delay(100);
      await evaluate(
        `window.__workspaceTest.emit({ id:'new_bottom', traceId:'t', timestamp:Date.now(), roomId:'orchestration', fidelity:'L0_RAW_TEXT', sender:{kind:'agent',id:'codex',name:'Codex'}, recipient:{kind:'room',id:'orchestration'}, parts:[{kind:'text',text:'Cập nhật mới'}],status:'completed' })`,
      );
      await waitFor("!!document.querySelector('.ub-new-messages')");
      assert.ok(
        await evaluate(
          "document.querySelector('.ub-chat-scroll').scrollTop < 100",
        ),
      );
      await click("Có cập nhật mới ↓");
      await setValue(".ub-composer textarea", "Dòng tiếng Việt\n".repeat(20));
      await delay(80);
      assert.ok(
        await evaluate(
          "(() => { const el=document.querySelector('.ub-chat-scroll'); return el.scrollHeight-el.scrollTop-el.clientHeight < 5; })()",
        ),
        "Composer expansion keeps bottom anchored",
      );
      await setValue(".ub-composer textarea", "");

      const beforeFont = await evaluate(
        "(() => { const e=document.querySelector('.ub-chat-scroll'); return {top:e.scrollTop,height:e.clientHeight,total:e.scrollHeight,newMessage:!!document.querySelector('.ub-new-messages')}; })()",
      );
      await evaluate("document.querySelector('.ub-view-options').open=true");
      await evaluate(
        "document.querySelector('[aria-label=\"Tăng cỡ chữ\"]').click()",
      );
      await delay(80);
      assert.ok(
        await evaluate(
          "(() => { const el=document.querySelector('.ub-chat-scroll'); return el.scrollHeight-el.scrollTop-el.clientHeight < 5; })()",
        ),
        "Font resize keeps bottom anchored " +
          JSON.stringify({
            beforeFont,
            afterFont: await evaluate(
              "(() => { const e=document.querySelector('.ub-chat-scroll'); return {top:e.scrollTop,height:e.clientHeight,total:e.scrollHeight,newMessage:!!document.querySelector('.ub-new-messages')}; })()",
            ),
          }),
      );
      await evaluate("document.querySelector('.ub-view-options').open=false");
      for (const [width, height] of [
        [1536, 864],
        [1280, 720],
        [960, 640],
        [640, 720],
        [390, 740],
      ]) {
        await cdp("Emulation.setDeviceMetricsOverride", {
          width,
          height,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await delay(120);
        assert.equal(
          await evaluate(
            "document.documentElement.scrollWidth <= window.innerWidth",
          ),
          true,
          `No horizontal overflow at ${width}`,
        );
        const bounds = await evaluate(
          "(() => { const r=document.querySelector('.ub-composer button[type=submit]').getBoundingClientRect(); return {right:r.right,bottom:r.bottom}; })()",
        );
        assert.ok(
          bounds.right <= width && bounds.bottom <= height,
          `Send visible at ${width}`,
        );
      }
      await cdp("Emulation.setDeviceMetricsOverride", {
        width: 1536,
        height: 864,
        deviceScaleFactor: 1,
        mobile: false,
      });
      // Return to the top of the clean view for a reviewable screenshot.
      await click("Thành viên");
      await click("Đảo 3D");
      await waitFor("!!document.querySelector('#sora-canvas')");
      await cdp("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
      await delay(300);
      await click("Ẩn đảo 3D");
      await setValue(".ub-composer textarea", "Bản nháp khôi phục sau mở lại");
      // Reload before the 250 ms debounce; beforeunload must flush the latest edit.
      await cdp("Page.reload");
      await waitFor(
        "document.querySelector('.ub-composer textarea')?.value === 'Bản nháp khôi phục sau mở lại'",
      );
      const evidenceDir = path.join(root, "scratch/workspace-ui");
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(
        path.join(evidenceDir, "workspace-1536.png"),
        Buffer.from(cleanShot.data, "base64"),
      );
      fs.writeFileSync(
        path.join(evidenceDir, "result.json"),
        JSON.stringify(
          {
            mode: "REAL_ELECTRON_MOCK_PRELOAD_NO_EXTERNAL_AI",
            checks: [
              "zero-progress",
              "run-cancel-ipc",
              "review-routing",
              "grouped-stream",
              "safe-markdown",
              "room-drafts",
              "failed-send-recovery",
              "scroll-preservation",
              "responsive-layout",
              "native-clipboard-exact-text",
              "vietnamese-ime-does-not-send",
              "multiline-plain-text-input",
              "motion-toggle",
              "1001-event-stream-batching",
              "composer-resize-bottom-anchor",
              "draft-restored-after-immediate-reload",
              "font-resize-bottom-anchor",
              "streamed-code-keeps-dom-and-horizontal-scroll",
            ],
            passed: true,
            burstMetrics,
          },
          null,
          2,
        ),
      );
    } finally {
      if (socket?.readyState === 1) {
        try {
          socket.send(
            JSON.stringify({
              id: 999999,
              method: "Runtime.evaluate",
              params: {
                expression: "window.__workspaceTest?.restoreClipboard()",
              },
            }),
          );
        } catch {}
      }
      socket?.close();
      if (child.exitCode === null) child.kill();
    }
  },
);
