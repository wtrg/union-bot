const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  GroupChatService,
  targetsFor,
} = require("../src/services/group-chat-service.cjs");
const {
  isFreshReply,
  readPage,
  runGroupTurn,
  prepareComposer,
  replyIsComplete,
} = require("../src/services/web-group-turn.cjs");
const vm = require("node:vm");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { StorageServiceClient } = require("../src/storage-service.cjs");

const user = (id = "u1", roomId = "r1", text = "hello") => ({
  id,
  roomId,
  traceId: `trace_${id}`,
  sender: { kind: "user", id: "local-user", name: "User" },
  parts: [{ kind: "text", text }],
});

test("an unresponsive renderer times out or cancels and releases the controller exactly once", async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController();
    let release = 0, calls = 0;
    let resolvePage;
    const web = { isDestroyed: () => false, isLoading: () => false,
      executeJavaScript: () => { calls++; return new Promise(resolve => { resolvePage = resolve; }); } };
    const browser = {
      getState: () => ({tabs: [{id: 'hung', providerId: 'chatgpt', url: 'https://chatgpt.com/c/hung'}]}),
      views: new Map([['hung', {webContents: web}]]),
      controlBridge: {
        acquireControllerLease: () => ({success: true, leaseToken: 'lease'}),
        renewControllerLease: () => ({success: true}),
        releaseControllerLease: () => { release++; },
      },
    };
    const turn = runGroupTurn(browser, {roomId: 'r', providerId: 'chatgpt', reference: {url: 'https://chatgpt.com/c/hung'}, prompt: 'probe', timeoutMs: 40, signal: controller.signal});
    const timer = cancel ? setTimeout(() => controller.abort(), 10) : null;
    try { await assert.rejects(turn, cancel ? /hủy/ : /ERR_WEB_OPERATION_TIMEOUT/); }
    finally { clearTimeout(timer); }
    assert.equal(release, 1);
    resolvePage({ok: true, value: {editor: true}});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1, 'late response must not start a send');
    assert.equal(release, 1);
  }
});
function fixture(browser) {
  const saved = [],
    emitted = [];
  const group = new GroupChatService({
    storage: {
      getRoomEnvelopes: async () => saved,
      insertEnvelope: async (e) => {
        saved.push(structuredClone(e));
        return { success: true };
      },
    },
    browser,
    emit: (e) => emitted.push(structuredClone(e)),
    workspaceRoot: process.cwd(),
  });
  return { group, saved, emitted };
}

test("default leader and explicit member routing are predictable", () => {
  assert.deepEqual(targetsFor("hello"), ["chatgpt"]);
  assert.deepEqual(targetsFor("@Antigravity @codex @antigravity hello"), [
    "antigravity",
    "codex",
  ]);
  assert.equal(targetsFor("@all hello").length, 6);
  assert.deepEqual(targetsFor("mail user@codex.example"), ["chatgpt"]);
  assert.deepEqual(targetsFor("@antigravity sửa lỗi lượt @all trước đó"), ["antigravity"]);
  assert.deepEqual(targetsFor("Mô tả ví dụ @all và @codex"), ["chatgpt"]);
  assert.deepEqual(targetsFor("`@all` là ví dụ trong tài liệu"), ["chatgpt"]);
});

test("Gemini continuation sends only new group context with a proven completed reply in the same URL", async () => {
  const prompts={};
  for (const kind of ['continued','new-url','missing-cursor','blocked','partial','inconsistent-state','wrong-room','review','summary']) {
    const url='https://gemini.google.com/app/proven';
    const previousUser=user('previous','r','PREVIOUS_USER_CONTEXT '.repeat(40));
    const current=user('current','r','CURRENT_REQUEST_UNTRUNCATED');
    if(kind==='review')current.metadata={collaborationMode:'review'};
    const {group}=fixture({runGroupTurn:async({prompt})=>{prompts[kind]=prompt;return{text:'real reply',url};}});
    group.threads['r:gemini']={url};
    const previousReply={...group.replyEnvelope(previousUser,'gemini','completed'),parts:[{kind:'text',text:'PREVIOUS_GEMINI_REPLY'}]};
    previousReply.delivery.sourceUrl=kind==='new-url'?'https://gemini.google.com/app/other':url;
    if(kind==='blocked')previousReply.status='blocked';
    if(kind==='partial')previousReply.status='streaming';
    if(kind==='inconsistent-state')previousReply.delivery.state='blocked';
    if(kind==='wrong-room')previousReply.roomId='other-room';
    const otherReply={...group.replyEnvelope(previousUser,'claude','completed'),parts:[{kind:'text',text:'NEW_OTHER_MEMBER_EVIDENCE'}]};
    const history=[...(kind==='missing-cursor'?[]:[previousUser]),previousReply,otherReply,current];
    await group.turn(current,'gemini',current.parts[0].text,{history,phase:kind==='summary'?'summary':undefined});
    assert.match(prompts[kind],/NEW_OTHER_MEMBER_EVIDENCE/);
    assert.match(prompts[kind],/CURRENT_REQUEST_UNTRUNCATED/);
    if(kind==='continued') {
      assert.doesNotMatch(prompts[kind],/PREVIOUS_USER_CONTEXT|PREVIOUS_GEMINI_REPLY/);
    } else {
      assert.match(prompts[kind],/PREVIOUS_GEMINI_REPLY/);
    }
  }
  assert.ok(prompts.continued.length < prompts['new-url'].length / 2);
});

test("composer recovery discards only an exact owned draft with no possible send", () => {
  class Textarea {
    constructor(value) { this._value = value; }
    get value() { return this._value; }
    set value(value) { this._value = value; }
  }
  const text = 'UNION_TURN_owned\n\nold task';
  for (const kind of ['owned', 'unknown', 'edited', 'send-uncertain', 'other-page']) {
    const editor = Object.assign(new Textarea(kind === 'edited' ? text + ' user edit' : text), {
      tagName: 'TEXTAREA', disabled: false, classList: {contains: () => false},
      focus() {}, dispatchEvent() {}, getClientRects: () => [1],
      getAttribute: () => 'textbox', closest: () => null,
    });
    const document = {querySelectorAll: () => [editor]};
    const owned = kind === 'unknown' ? null : {text, url: kind === 'other-page' ? 'https://chatgpt.com/c/other' : 'https://chatgpt.com/c/owned', mayHaveSent: kind === 'send-uncertain'};
    const run = () => vm.runInNewContext(`(${prepareComposer.toString()})('chatgpt', ${JSON.stringify(owned)})`, {
      document, location: {href: 'https://chatgpt.com/c/owned'}, HTMLTextAreaElement: Textarea, Event: class {},
    });
    if (kind === 'owned') { run(); assert.equal(editor.value, ''); }
    else { const before = editor.value; assert.throws(run, /bản nháp/); assert.equal(editor.value, before); }
  }
});

test("cold provider navigation completes before any page script is requested", async () => {
  let loading = true, scripts = 0;
  const web = {
    isDestroyed: () => false, isLoading: () => loading,
    executeJavaScript: async () => { scripts++; assert.equal(loading, false); throw Error('READY_PAGE_PROBE'); },
  };
  const browser = {
    getState: () => ({tabs: [{id: 'cold', providerId: 'gemini', url: 'https://gemini.google.com/app'}]}),
    views: new Map([['cold', {webContents: web}]]),
  };
  const turn = runGroupTurn(browser, {roomId:'r', providerId:'gemini', reference:{url:'https://gemini.google.com/app'}, prompt:'probe', timeoutMs: 2000});
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(scripts, 0);
  loading = false;
  await assert.rejects(turn, /READY_PAGE_PROBE/);
  assert.equal(scripts, 1);
});

test("owned rich-text draft survives visibility serialization changes but rejects DOM edits", () => {
  const editor={tagName:'DIV',isContentEditable:true,innerText:'MARKERFirstSecond',textContent:'MARKERFirstSecond',innerHTML:'<p>MARKER</p><p>First</p><p>Second</p>',
    classList:{contains:()=>false},getClientRects:()=>[1],closest:()=>null,getAttribute:()=> 'textbox',focus(){},dispatchEvent(){}};
  const document={querySelectorAll:()=>[editor],
    getSelection:()=>({removeAllRanges(){},addRange(){}}),createRange:()=>({selectNodeContents(){}}),
    execCommand(){editor.innerText=editor.textContent=editor.innerHTML='';}};
  const context={document,location:{href:'https://chatgpt.com/c/test'},Event:class{}};
  const captured=vm.runInNewContext(`(${prepareComposer.toString()})('chatgpt',null,'MARKER\\nFirst\\nSecond',true)`,context);
  const owned={...captured,url:'https://chatgpt.com/c/test',mayHaveSent:false};
  editor.innerText='MARKER\nFirst\nSecond';
  vm.runInNewContext(`(${prepareComposer.toString()})('chatgpt',${JSON.stringify(owned)})`,context);
  assert.equal(editor.textContent,'');
  editor.innerText=editor.textContent='MARKERFirstSecond';
  editor.innerHTML='<p>MARKER</p><p>First</p><p></p><p>Second</p>';
  assert.throws(()=>vm.runInNewContext(`(${prepareComposer.toString()})('chatgpt',${JSON.stringify(owned)})`,context),/bản nháp/);
  assert.ok(editor.innerHTML.includes('<p></p>'));
});

test("an existing conversation waits for history hydration before inserting a draft", async () => {
  let hydrated = false, prepared = false;
  const url='https://chatgpt.com/c/loading-history';
  const web={isDestroyed:()=>false,isLoading:()=>false,
    executeJavaScript:async code=> {
      if(code.includes('function readPage')) return {ok:true,value:{editor:true,url,conversationReady:hydrated}};
      prepared=true; assert.equal(hydrated,true); throw Error('HYDRATED_COMPOSER');
    }};
  const browser={getState:()=>({tabs:[{id:'hydrate',providerId:'chatgpt',url}]}),views:new Map([['hydrate',{webContents:web}]])};
  const turn=runGroupTurn(browser,{roomId:'r',providerId:'chatgpt',reference:{url},prompt:'probe',timeoutMs:2000});
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(prepared,false);
  hydrated=true;
  await assert.rejects(turn,/HYDRATED_COMPOSER/);
});

test("unrelated subresource loads do not hold a ready composer in the loading queue", async () => {
  let scripts = 0;
  const url = 'https://gemini.google.com/app/test';
  const web = {
    isDestroyed:()=>false, isLoading:()=>true, isLoadingMainFrame:()=>false,
    executeJavaScript:async code => {
      scripts++;
      if (code.includes('function readPage')) return {ok:true,value:{editor:true,url}};
      throw Error('COMPOSER_READY_WITH_SUBRESOURCES');
    },
  };
  const browser={getState:()=>({tabs:[{id:'loaded',providerId:'gemini',url}]}),views:new Map([['loaded',{webContents:web}]])};
  await assert.rejects(runGroupTurn(browser,{roomId:'r',providerId:'gemini',reference:{url},prompt:'probe',timeoutMs:200}), /COMPOSER_READY_WITH_SUBRESOURCES/);
  assert.equal(scripts, 2);
});

test("hidden composer paragraph serialization is accepted without accepting changed words", () => {
  const expected = 'MARKER\n\nFirst line\nSecond line';
  const editor = {
    tagName: 'DIV', isContentEditable: true, textContent: expected.replace(/\n/g, ''),
    classList: {contains: () => false}, getClientRects: () => [1], closest: () => null,
    getAttribute: () => 'textbox',
  };
  const run = () => vm.runInNewContext(`(${prepareComposer.toString()})('chatgpt', null, ${JSON.stringify(expected)})`, {document:{querySelectorAll: () => [editor]}});
  assert.equal(run(), editor.textContent);
  editor.textContent = 'MARKERFirst lineWRONG';
  assert.throws(run, /Ô nhập đã thay đổi/);
});

test("retry reuses the failed room tab before a conversation URL exists", async () => {
  let created = 0, reference;
  const tabs = [];
  const browser = {
    getState: () => ({tabs}), views: new Map(),
    createTab(providerId, url) {
      created++;
      const tab = {id:'room-tab', providerId, url};
      tabs.push(tab);
      browser.views.set(tab.id, {webContents:{isDestroyed:()=>false,isLoading:()=>false,executeJavaScript:async()=>{throw Error('PRE_SEND_FAIL');}}});
      return {success:true,tab};
    },
  };
  for (let round = 0; round < 2; round++) {
    await assert.rejects(runGroupTurn(browser, {roomId:'r',providerId:'gemini',reference,prompt:'probe',onReference:value=>{reference=value;}}), /PRE_SEND_FAIL/);
  }
  assert.equal(created, 1);
  assert.deepEqual(reference, {tabId:'room-tab'});
});

test("worker viewport retains a corner pixel without opening the dock or changing the selected tab", () => {
  const Module = require('node:module');
  const load = Module._load;
  let BrowserService;
  try {
    Module._load = function(name, ...args) { return name === 'electron' ? {} : load.call(this, name, ...args); };
    ({ BrowserService } = require('../src/browser-service.cjs'));
  } finally { Module._load = load; }
  const children = [];
  const mainWindow = { isDestroyed: () => false, contentView: {children, addChildView: view => children.push(view)} };
  const browser = new BrowserService(mainWindow, null, null, process.cwd());
  let dockOpen = false;
  const selected = 'operator-tab';
  browser.stateManager = {getState:()=>({activeTabId:selected,bounds:{x:80,y:80,width:800,height:600}}),isEffectiveVisible:()=>dockOpen};
  const worker = {setBounds(value){this.bounds=value;},setVisible(value){this.visible=value;}};
  const operator = {setBounds(value){this.bounds=value;},setVisible(value){this.visible=value;}};
  browser.views = new Map([['worker-tab',worker],[selected,operator]]);
  browser.controlBridge = {controllerLeases: new Map([['worker-tab',{expiresAt:Date.now()+60000}]])};
  browser.updateLayout();
  assert.equal(dockOpen, false);
  assert.equal(browser.stateManager.getState().activeTabId, selected);
  assert.equal(worker.visible, true);
  assert.equal(worker.bounds.x + worker.bounds.width, 1);
  assert.equal(worker.bounds.y + worker.bounds.height, 1);
  assert.equal(operator.visible, false);
  dockOpen = true;
  browser.updateLayout();
  assert.equal(operator.visible, true);
  assert.equal(operator.bounds.x, 80);
  assert.ok(worker.bounds.x < 0);
  browser.controlBridge.controllerLeases.clear();
  browser.updateLayout();
  assert.equal(worker.visible, false);
  assert.equal(operator.visible, true);
});

test("Gemini network timing diagnostics never log queries, cookies or bodies", () => {
  const Module=require('node:module');
  const originalLoad=Module._load;
  const filename=require.resolve('../src/browser-service.cjs');
  const previousModule=require.cache[filename];
  const previousEnv=process.env.UNION_BOT_GROUP_DIAGNOSTICS;
  const originalLog=console.log;
  const logs=[], listeners={};
  const webRequest={onBeforeRequest(){}};
  for(const [api,event] of [['onSendHeaders','sent'],['onResponseStarted','headers'],['onCompleted','completed'],['onErrorOccurred','error']])
    webRequest[api]=(_filter,listener)=>{listeners[event]=listener;};
  try {
    process.env.UNION_BOT_GROUP_DIAGNOSTICS='1';
    delete require.cache[filename];
    Module._load=function(name,...args){return name==='electron'?{session:{fromPartition:()=>({setPermissionRequestHandler(){},webRequest})}}:originalLoad.call(this,name,...args);};
    const {BrowserService}=require(filename);
    const browser=new BrowserService(null,null,null,process.cwd());
    browser._ensurePartitionConfigured('persist:mcb-web-gemini');
    console.log=(...args)=>logs.push(args.join(' '));
    listeners.sent({id:1,method:'POST',url:'https://gemini.google.com/StreamGenerate?token=PRIVATE_QUERY',requestHeaders:{Cookie:'PRIVATE_COOKIE'},uploadData:[{bytes:'PRIVATE_BODY'}]});
    listeners.headers({id:1,statusCode:200});
    listeners.completed({id:1,statusCode:200});
    listeners.error({id:1,error:'SHOULD_BE_IGNORED_AFTER_COMPLETION'});
    assert.equal(logs.length,3);
    assert.ok(logs.every(line=>!line.includes('PRIVATE')&&!line.includes('SHOULD_BE_IGNORED')));
    assert.match(logs[0],/"route":"generation"/);
    assert.match(logs[1],/"status":200/);
  } finally {
    Module._load=originalLoad;
    console.log=originalLog;
    if(previousModule) require.cache[filename]=previousModule; else delete require.cache[filename];
    if(previousEnv===undefined)delete process.env.UNION_BOT_GROUP_DIAGNOSTICS;else process.env.UNION_BOT_GROUP_DIAGNOSTICS=previousEnv;
  }
});

test("live leader deltas appear under its own identity, final reply is durable", async () => {
  const { group, saved, emitted } = fixture({
    runGroupTurn: async ({ onText }) => {
      onText("Xin");
      onText("Xin chào");
      return {
        text: "Xin chào",
        url: "https://chatgpt.com/c/test",
        conversationId: "test",
      };
    },
  });
  await group.enqueue(user());
  assert.equal(emitted[0].delivery.state, "queued");
  assert.equal(emitted[1].delivery.state, "sending");
  assert.equal(emitted[2].delivery.state, "streaming");
  assert.equal(emitted[2].sender.id, "chatgpt_web");
  assert.equal(new Set(emitted.map((e) => e.id)).size, 1);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].parts[0].text, "Xin chào");
  assert.equal(saved[0].delivery.state, "completed");
  assert.equal(saved[0].delivery.replyTo, "u1");
});

test("provider progress is delivery metadata and never fabricated assistant text", async () => {
  const {group, emitted, saved} = fixture({runGroupTurn: async ({onProgress,onText}) => {
    onProgress('Đang tải và kiểm tra hội thoại…','loading');
    onProgress('Đã bấm gửi · đang chờ phản hồi từ AI…','waiting');
    onText('REAL');
    return {text:'REAL_REPLY'};
  }});
  await group.enqueue(user('progress'));
  const waiting = emitted.find(e=>e.delivery.progressStage==='waiting' && e.status==='sending');
  assert.ok(waiting);
  assert.equal(waiting.parts.some(p=>p.text?.trim()),false);
  assert.equal(saved.at(-1).parts[0].text,'REAL_REPLY');
});

test("native denial is a visible system block, never a fabricated member answer", async () => {
  const { group, saved } = fixture({});
  group.antigravity = Object.assign(new EventEmitter(), {
    executePrompt: async () => ({
      success: false,
      error: "ERR_ANTIGRAVITY_PERMISSION_REQUIRED: command",
    }),
  });
  await group.enqueue(user("u1", "r1", "@antigravity download"));
  assert.equal(saved[0].sender.kind, "system");
  assert.equal(saved[0].delivery.memberName, "Antigravity");
  assert.equal(saved[0].delivery.state, "blocked");
  assert.match(saved[0].parts[0].text, /command/);
});

test("room/provider serialization keeps streamed replies associated with their requests", async () => {
  let active = 0,
    peak = 0;
  const { group, saved } = fixture({
    runGroupTurn: async ({ roomId, onText }) => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 10));
      onText(roomId);
      active--;
      return { text: roomId };
    },
  });
  await Promise.all([
    group.enqueue(user("a", "room-a")),
    group.enqueue(user("b", "room-b")),
  ]);
  assert.equal(peak, 1);
  assert.deepEqual(
    saved.map((e) => [e.roomId, e.parts[0].text]),
    [
      ["room-a", "room-a"],
      ["room-b", "room-b"],
    ],
  );
});

test("leader consultations dispatch one bounded real member turn", async () => {
  const { group, saved } = fixture({
    runGroupTurn: async () => ({
      text: "Cần kiểm tra. [[ask:antigravity]]Bạn đề xuất cách nào?[[/ask]]",
    }),
  });
  let calls = 0;
  group.antigravity = Object.assign(new EventEmitter(), {
    executePrompt: async (prompt) => {
      calls++;
      assert.match(prompt, /Bạn đề xuất cách nào/);
      return { success: true, response: "Tôi đề xuất bước A." };
    },
  });
  await group.enqueue({ ...user(), metadata: { collaborationMode: "review" } });
  assert.equal(calls, 1);
  assert.deepEqual(
    saved.map((e) => e.sender.id),
    ["chatgpt_web", "antigravity", "chatgpt_web"],
  );
  assert.equal(saved[2].delivery.phase, "summary");
  assert.equal(saved[2].delivery.runId, "u1");
  assert.match(saved[0].parts[0].text, /@antigravity/);
  assert.equal(saved[1].delivery.replyTo, saved[0].id);
});

test("web capture rejects old assistant content and accepts only a fresh turn", () => {
  const old = { count: 2, messageId: "old", text: "old answer" };
  assert.equal(isFreshReply(old, old), false);
  assert.equal(
    isFreshReply(old, { ...old, text: "changed old answer" }),
    false,
  );
  assert.equal(
    isFreshReply(old, { ...old, count: 3, text: "new answer" }),
    true,
  );
  assert.equal(
    isFreshReply(old, { ...old, messageId: "new", text: "new answer" }),
    true,
  );
  assert.equal(
    isFreshReply(old, { count: 3, messageId: "new", text: "" }),
    false,
  );
});

test("ChatGPT without author roles excludes the marked user prompt and locates its new reply", () => {
  const element = (text, order, children = []) => ({
    textContent: text,
    innerText: text,
    children,
    id: "",
    classList: { contains: () => false },
    getClientRects: () => [1],
    getAttribute: () => null,
    closest: () => null,
    contains(other) {
      return this === other || children.some((child) => child.contains(other));
    },
    compareDocumentPosition(other) {
      return order < other.order ? 4 : 2;
    },
    order,
  });
  const old = element("previous answer", 1);
  const marker = element("UNION_TURN_TEST", 2);
  const submitted = element("long prompt UNION_TURN_TEST", 2, [marker]);
  const current = element("Which requirement should we discuss?", 3);
  const editor = element("", 4);
  const document = {
    title: "ChatGPT",
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector.includes("MarkdownRoot-")) return [old, submitted, current];
      if (selector === "p, div, span") return [submitted, marker];
      if (selector === "p") return [marker];
      if (selector.includes("#prompt-textarea")) return [editor];
      return [];
    },
  };
  const page = vm.runInNewContext(
    `(${readPage.toString()})('UNION_TURN_TEST')`,
    {
      document,
      location: { href: "https://chatgpt.com/c/test" },
      Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
    },
  );
  assert.equal(page.count, 2);
  assert.equal(page.text, current.innerText);
  assert.equal(page.hasPromptMarker, true);
  assert.equal(page.assistantAfterUser, true);
});

test("Claude current markdown structure reads only the reply after the submitted marker", () => {
  const element = (text, order, user = false) => ({
    textContent: text, innerText: '', children: [], id: '', order,
    classList: {contains: () => false},
    getClientRects: () => [1], getAttribute: () => null,
    closest: selector => user && selector.includes('user-message') ? {} : null,
    contains(other) { return this === other; },
    compareDocumentPosition(other) { return order < other.order ? 4 : 2; },
  });
  const old = element('old reply', 1);
  const submitted = element('UNION_TURN_TEST latest prompt', 2, true);
  const answer = element('UNION_CLAUDE_OK', 3);
  const document = {
    title: 'Claude', querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '.standard-markdown') return [old, submitted, answer];
      if (selector === 'p, div, span') return [submitted];
      if (selector.startsWith('[data-message-author-role="user"]')) return [submitted];
      return [];
    },
  };
  const page = vm.runInNewContext(`(${readPage.toString()})('UNION_TURN_TEST', 'claude')`, {
    document, location:{href:'https://claude.ai/chat/test'}, Node:{DOCUMENT_POSITION_FOLLOWING:4},
  });
  assert.equal(page.count, 2);
  assert.equal(page.text, 'UNION_CLAUDE_OK');
  assert.equal(page.hasPromptMarker, true);
  assert.equal(page.assistantAfterUser, true);
  // An old reply cannot qualify simply because the submitted prompt exists.
  answer.order = 0;
  const stale = vm.runInNewContext(`(${readPage.toString()})('UNION_TURN_TEST', 'claude')`, {
    document, location:{href:'https://claude.ai/chat/test'}, Node:{DOCUMENT_POSITION_FOLLOWING:4},
  });
  assert.equal(stale.assistantAfterUser, false);
});

test("Gemini Vietnamese stop control prevents completion, while hidden controls do not block a finished turn", () => {
  let shown=true;
  const document={title:'Gemini',querySelectorAll:selector=>selector.includes('Ngừng tạo câu trả lời')?[{getClientRects:()=>shown?[1]:[]}]:[]};
  const context={document,location:{href:'https://gemini.google.com/app/test'}};
  const read=()=>vm.runInNewContext(`(${readPage.toString()})('', 'gemini')`,context);
  assert.equal(read().generating,true);
  shown=false;
  assert.equal(read().generating,false);
  assert.equal(replyIsComplete('gemini',{generating:true},100,true),false);
  assert.equal(replyIsComplete('gemini',{generating:false},1,true),false);
  assert.equal(replyIsComplete('gemini',{generating:false},2,true),true);
  assert.equal(replyIsComplete('gemini',{generating:false},2,false),false);
  assert.equal(replyIsComplete('gemini',{generating:false},8,false),true);
  assert.equal(replyIsComplete('claude',{generating:false},2,true),false);
});

test("Gemini user bubbles avoid whole-document marker scans and still reject an older answer", () => {
  const user={textContent:'UNION_TURN_SCOPED prompt',children:[],order:2,compareDocumentPosition(other){return other.order>this.order?4:2;}};
  const answer={textContent:'new answer',innerText:'new answer',children:[],order:3,id:'',getClientRects:()=>[1],getAttribute:()=>null,closest:()=>null};
  const document={title:'Gemini',querySelectorAll:selector=>{
    if(selector==='.query-text') return [user];
    if(selector==='message-content .markdown-main-panel')return [answer];
    if(selector==='p, div, span')throw Error('Should not scan every node when the provider user bubble exists');
    return [];
  }};
  const context={document,location:{href:'https://gemini.google.com/app/test'},Node:{DOCUMENT_POSITION_FOLLOWING:4}};
  const read=()=>vm.runInNewContext(`(${readPage.toString()})('UNION_TURN_SCOPED','gemini')`,context);
  assert.equal(read().hasPromptMarker,true);
  assert.equal(read().assistantAfterUser,true);
  answer.order=1;
  assert.equal(read().assistantAfterUser,false);
});

test("ChatGPT rich-text user turns avoid whole-document scans and reject replies before the prompt", () => {
  const user = {textContent:'UNION_TURN_SCOPED prompt',children:[],order:2,compareDocumentPosition(other){return other.order > this.order ? 4 : 2;}};
  const answer = {textContent:'new answer',innerText:'new answer',children:[],order:3,id:'',getClientRects:()=>[1],getAttribute:()=>null,closest:()=>null,classList:{contains:()=>false}};
  const document = {title:'ChatGPT',querySelectorAll:selector=>{
    if(selector.includes('rich-text-user-turn') && !selector.includes('contenteditable')) return [user];
    if(selector.includes('MarkdownRoot-')) return [answer];
    if(selector==='p, div, span') throw Error('Should not scan every node when rich-text user turns exist');
    return [];
  }};
  const context = {document,location:{href:'https://chatgpt.com/c/test'},Node:{DOCUMENT_POSITION_FOLLOWING:4}};
  const read = () => vm.runInNewContext(`(${readPage.toString()})('UNION_TURN_SCOPED','chatgpt')`,context);
  assert.equal(read().hasPromptMarker,true);
  assert.equal(read().assistantAfterUser,true);
  answer.order = 1;
  assert.equal(read().assistantAfterUser,false);
});

test("Gemini reads the markdown body without its provider heading or action controls", () => {
  const answer = {
    textContent:'UNION_GEMINI_OK', innerText:'UNION_GEMINI_OK', children:[], id:'',
    getClientRects:()=>[1], getAttribute:()=>null, closest:()=>null, contains:()=>false,
  };
  const document = {
    title:'Gemini', querySelector:()=>null,
    querySelectorAll(selector) {
      if (selector === 'message-content .markdown-main-panel') return [answer];
      if (selector === 'model-response') throw Error('Must prefer the message body over the entire response card');
      return [];
    },
  };
  const page = vm.runInNewContext(`(${readPage.toString()})('', 'gemini')`, {
    document, location:{href:'https://gemini.google.com/app/test'},
  });
  assert.equal(page.text, 'UNION_GEMINI_OK');
});

test("Gemini rich-textarea shadow DOM exposes the composer and model response", () => {
  const element = (text, order) => ({
    textContent: text,
    innerText: text,
    children: [],
    id: "",
    value: "",
    disabled: false,
    isContentEditable: true,
    classList: { contains: () => false },
    getClientRects: () => [1],
    getAttribute: () => null,
    closest: () => null,
    contains(other) {
      return this === other;
    },
    compareDocumentPosition(other) {
      return order < other.order ? 4 : 2;
    },
    order,
  });
  const response = element("Tôi đã tìm được 5 hình Doraemon.", 1);
  const editor = element("", 2);
  const send = element("", 3);
  send.disabled = false;
  const shadowRoot = {
    querySelectorAll(selector) {
      if (selector === "model-response") return [response];
      if (selector.includes('[contenteditable="true"]')) return [editor];
      if (selector.includes('button[data-testid*="send"]')) return [send];
      return [];
    },
  };
  const host = { shadowRoot };
  const document = {
    title: "Gemini",
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === "rich-textarea, message-content, model-response")
        return [host];
      return [];
    },
  };
  const page = vm.runInNewContext(
    `(${readPage.toString()})('UNION_TURN_TEST', 'gemini')`,
    {
      document,
      location: { href: "https://gemini.google.com/app/test" },
      Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
    },
  );
  assert.equal(page.editor, true);
  assert.equal(page.sendReady, true);
  assert.equal(page.text, response.innerText);
});

test("web bridge respects an empty textarea value even when its initial DOM text remains", async () => {
  const editor = {
    tagName: "TEXTAREA",
    value: "",
    textContent: "stale initial DOM value",
    id: "prompt-textarea",
    focus() {},
    getAttribute: () => null,
    classList: { contains: () => false },
    closest: () => null,
    getClientRects: () => [1],
  };
  const assistant = {
    textContent: "old answer",
    innerText: "old answer",
    getAttribute: () => "old",
    closest: () => null,
  };
  const document = {
    title: "ChatGPT",
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector.includes("#prompt-textarea")) return [editor];
      if (selector.includes('[data-message-author-role="assistant"]'))
        return [assistant];
      return [];
    },
  };
  let inserted = false;
  const web = {
    isDestroyed: () => false,
    isLoading: () => false,
    executeJavaScript: async (code) =>
      vm.runInNewContext(code, {
        document,
        location: { href: "https://chatgpt.com/c/test" },
      }),
    insertText: async () => {
      inserted = true;
      throw new Error("STOP_AFTER_INSERT");
    },
  };
  let autoOpenEvents = 0;
  const browser = {
    getState: () => ({
      tabs: [
        { id: "t", providerId: "chatgpt", url: "https://chatgpt.com/c/test" },
      ],
    }),
    views: new Map([["t", { webContents: web }]]),
    selectTab() {},
    mainWindow: {
      webContents: {
        send(channel) {
          if (channel === "union-bot:group-browser-needed") autoOpenEvents++;
        },
      },
    },
  };
  await assert.rejects(
    runGroupTurn(browser, {
      roomId: "r1",
      providerId: "chatgpt",
      reference: { url: "https://chatgpt.com/c/test" },
      prompt: "hello",
    }),
    /STOP_AFTER_INSERT/,
  );
  assert.equal(inserted, true);
  assert.equal(
    autoOpenEvents,
    0,
    "a background group turn must not open the browser dock",
  );
});

test("SQLite reload returns the newest room messages in chronological order", async () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "union-group-history-"),
  );
  const storage = new StorageServiceClient(path.join(temporary, "test.db"));
  try {
    await storage.ready;
    for (let i = 0; i < 5; i++) {
      await storage.insertEnvelope({
        ...user(`history-${i}`),
        timestamp: Date.now(),
        recipient: { kind: "room", id: "r1" },
        fidelity: "L0_RAW_TEXT",
      });
    }
    assert.deepEqual(
      (await storage.getRoomEnvelopes("r1", 2)).map((e) => e.id),
      ["history-3", "history-4"],
    );
    assert.equal((await storage.getRoomEnvelopes("r1", -1)).length, 5);
  } finally {
    storage.close();
    assert.ok(
      path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep),
    );
    fs.rmSync(temporary, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
});

test("direct mode does not silently dispatch consultations", async () => {
  const { group, saved } = fixture({
    runGroupTurn: async () => ({ text: "[[ask:codex]]Review[[/ask]]" }),
  });
  await group.enqueue(user());
  assert.equal(saved.length, 1);
});

test("review mode synthesizes after all members including a blocked provider, without nested consultation", async () => {
  const calls = [];
  const { group, saved, emitted } = fixture({
    runGroupTurn: async ({ providerId, prompt }) => {
      calls.push(providerId);
      if (providerId === "claude") throw new Error("LOGIN_REQUIRED");
      if (calls.length === 4) {
        assert.match(prompt, /claude \[blocked\]/);
        assert.match(prompt, /Đã thống nhất/);
        return { text: "## Đã thống nhất\nA\n## Còn bất đồng\nB" };
      }
      return { text: "Evidence " + providerId };
    },
  });
  await group.enqueue({
    ...user("review", "r1", "@chatgpt @claude @gemini compare"),
    metadata: { collaborationMode: "review" },
  });
  assert.deepEqual(
    calls.slice(0, 3).sort(),
    ["chatgpt", "claude", "gemini"].sort(),
  );
  assert.equal(calls[3], "chatgpt");
  assert.equal(saved.length, 4);
  assert.equal(
    saved.find((e) => e.delivery.provider === "claude").sender.kind,
    "system",
  );
  assert.equal(saved[3].delivery.phase, "summary");
  assert.ok(saved.every((e) => e.delivery.runId === "review"));
  assert.equal(emitted.filter((e) => e.status === "queued").length, 4);
});

test("direct @all has no extra summary and runs every requested member once", async () => {
  const calls = [];
  const { group, saved } = fixture({
    runGroupTurn: async ({ providerId }) => {
      calls.push(providerId);
      return { text: providerId };
    },
  });
  const native = (provider) =>
    Object.assign(new EventEmitter(), {
      executePrompt: async () => {
        calls.push(provider);
        return { success: true, response: provider };
      },
      executeTurn: async () => {
        calls.push(provider);
        return { success: true, response: provider };
      },
    });
  group.antigravity = native("antigravity");
  group.codex = native("codex");
  await group.enqueue(user("all", "r1", "@all hello"));
  assert.deepEqual(
    [...calls].sort(),
    ["chatgpt", "antigravity", "codex", "gemini", "claude", "deepseek"].sort(),
  );
  assert.equal(saved.length, 6);
});

test("background group turn never selects the visible tab, even before a send failure", async () => {
  let selected = 0;
  const web = {
    isDestroyed: () => false,
    isLoading: () => false,
    executeJavaScript: async () => {
      throw Error("STOP_BEFORE_SEND");
    },
  };
  const browser = {
    getState: () => ({
      tabs: [
        { id: "t", providerId: "chatgpt", url: "https://chatgpt.com/c/test" },
      ],
    }),
    views: new Map([["t", { webContents: web }]]),
    selectTab() {
      selected++;
    },
  };
  await assert.rejects(
    runGroupTurn(browser, {
      roomId: "r",
      providerId: "chatgpt",
      reference: { url: "https://chatgpt.com/c/test" },
      prompt: "test",
    }),
    /STOP_BEFORE_SEND/,
  );
  assert.equal(selected, 0);
});

test("canceling an active run preserves partial text, stops later members and skips synthesis", async () => {
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const { group, saved } = fixture({
    runGroupTurn: async ({ signal, onText }) => {
      onText("partial");
      started();
      await new Promise((resolve) =>
        signal.addEventListener("abort", resolve, { once: true }),
      );
      throw Error("ABORTED");
    },
  });
  const run = group.enqueue({
    ...user("cancel", "room-a", "@chatgpt @gemini compare"),
    metadata: { collaborationMode: "review" },
  });
  await ready;
  assert.equal(group.cancel("cancel", "wrong-room").success, false);
  assert.equal(group.cancel("cancel", "room-a").success, true);
  await run;
  assert.equal(saved.length, 2);
  assert.ok(saved.every((reply) => reply.status === "cancelled"));
  assert.match(saved[0].parts[0].text, /partial/);
  assert.ok(saved.every((reply) => reply.delivery.phase !== "summary"));
});

test("queued runs are visible immediately and cancel before dispatch without touching a provider", async () => {
  let release, started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  let calls = 0;
  const { group, saved, emitted } = fixture({
    runGroupTurn: async () => {
      calls++;
      started();
      await new Promise((resolve) => {
        release = resolve;
      });
      return { text: "done" };
    },
  });
  const first = group.enqueue(user("first", "r1"));
  await ready;
  const second = group.enqueue(user("second", "r1"));
  assert.ok(
    emitted.some(
      (e) => e.id === "group_second_chatgpt" && e.status === "queued",
    ),
  );
  group.cancel("second", "r1");
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(
    saved.find((e) => e.id === "group_second_chatgpt").status,
    "cancelled",
  );
});

test("browser controller lease is released on a pre-send failure", async () => {
  let acquired = 0,
    released = 0;
  const web = {
    isDestroyed: () => false,
    isLoading: () => false,
    executeJavaScript: async () => {
      throw Error("STOP_BEFORE_SEND");
    },
  };
  const browser = {
    getState: () => ({
      tabs: [
        { id: "t", providerId: "chatgpt", url: "https://chatgpt.com/c/test" },
      ],
    }),
    views: new Map([["t", { webContents: web }]]),
    controlBridge: {
      acquireControllerLease() {
        acquired++;
        return { success: true, leaseToken: "token" };
      },
      renewControllerLease() {
        return { success: true };
      },
      releaseControllerLease(id, token) {
        assert.equal(id, "t");
        assert.equal(token, "token");
        released++;
      },
    },
  };
  await assert.rejects(
    runGroupTurn(browser, {
      roomId: "r",
      providerId: "chatgpt",
      reference: { url: "https://chatgpt.com/c/test" },
      prompt: "test",
    }),
    /STOP_BEFORE_SEND/,
  );
  assert.equal(acquired, 1);
  assert.equal(released, 1);
});

test("a virtualized ChatGPT thread with zero mounted replies can still send into its ready composer", async () => {
  let inserted = false,
    snapshots = 0;
  const web = {
    isDestroyed: () => false,
    isLoading: () => false,
    executeJavaScript: async () => ({
      ok: true,
      value:
        ++snapshots === 1
          ? {
              count: 0,
              editor: true,
              login: false,
              generating: false,
              url: "https://chatgpt.com/c/virtualized",
            }
          : undefined,
    }),
    insertText: async () => {
      inserted = true;
      throw Error("STOP_AFTER_INSERT");
    },
  };
  const browser = {
    getState: () => ({
      tabs: [
        {
          id: "t",
          providerId: "chatgpt",
          url: "https://chatgpt.com/c/virtualized",
        },
      ],
    }),
    views: new Map([["t", { webContents: web }]]),
  };
  await assert.rejects(
    runGroupTurn(browser, {
      roomId: "r",
      providerId: "chatgpt",
      reference: { url: "https://chatgpt.com/c/virtualized" },
      prompt: "test",
    }),
    /STOP_AFTER_INSERT/,
  );
  assert.equal(inserted, true);
});

test("Gemini ignores its editable clipboard and waits for an enabled localized send button", async () => {
  let requests = 0;
  const form = {
    contains: () => true,
    requestSubmit: () => {
      requests++;
    },
    querySelector: () => null,
  };
  const editor = {
    tagName: "DIV",
    isContentEditable: true,
    textContent: "",
    disabled: false,
    focus() {},
    getAttribute: (name) => (name === "role" ? "textbox" : null),
    classList: { contains: (name) => name === "ql-editor" },
    closest: (selector) => (selector === "form" ? form : null),
    getClientRects: () => [1],
  };
  const clipboard = {
    ...editor,
    closest: (selector) =>
      selector.includes("ql-clipboard") ? clipboard : null,
    focus: () => {
      throw Error("WRONG_CLIPBOARD");
    },
  };
  let clicked = false;
  let reads = 0;
  const send = {
    getClientRects: () => [1],
    get disabled() {
      return ++reads < 4;
    },
    getAttribute: () => null,
    click() {
      clicked = true;
      throw Error("STOP_AFTER_LOCALIZED_SEND");
    },
  };
  const document = {
    title: "Google Gemini",
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector.includes("#prompt-textarea")) return [clipboard, editor];
      if (
        selector.includes('button[aria-label="Gửi tin nhắn"]') &&
        editor.textContent
      )
        return [send];
      return [];
    },
  };
  const web = {
    isDestroyed: () => false,
    isLoading: () => false,
    executeJavaScript: async (code) =>
      vm.runInNewContext(code, {
        document,
        location: { href: "https://gemini.google.com/app", pathname: "/app" },
      }),
    insertText: async (text) => { editor.textContent = text; },
  };
  const browser = {
    getState: () => ({
      tabs: [
        {
          id: "localized",
          providerId: "gemini",
          url: "https://gemini.google.com/app",
        },
      ],
    }),
    views: new Map([["localized", { webContents: web }]]),
  };
  await assert.rejects(
    runGroupTurn(browser, {
      roomId: "qa",
      providerId: "gemini",
      reference: { url: "https://gemini.google.com/app" },
      prompt: "probe",
    }),
    /STOP_AFTER_LOCALIZED_SEND/,
  );
  assert.equal(clicked, true);
  assert.equal(requests, 0);
});

test("Claude sign-in page is recognized without waiting for a nonexistent chat composer", () => {
  const document = {
    title: "Sign in - Claude",
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const page = vm.runInNewContext(`(${readPage.toString()})('', 'claude')`, {
    document,
    location: { href: "https://claude.ai/login", pathname: "/login" },
  });
  assert.equal(page.login, true);
  assert.equal(page.editor, false);
});

test(
  "members start concurrently and a fast reply is delivered while another member is still running",
  { timeout: 2000 },
  async () => {
    let releaseSlow;
    const slowGate = new Promise((resolve) => {
      releaseSlow = resolve;
    });
    const started = new Set();
    let allStarted;
    const startGate = new Promise((resolve) => {
      allStarted = resolve;
    });
    const { group, saved } = fixture({
      runGroupTurn: async ({ providerId }) => {
        started.add(providerId);
        if (started.size === 2) allStarted();
        if (providerId === "gemini") await slowGate;
        return { text: providerId };
      },
    });
    const run = group.enqueue(user("parallel", "r", "@chatgpt @gemini hello"));
    await startGate;
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual([...started].sort(), ["chatgpt", "gemini"]);
    assert.ok(
      saved.some(
        (e) => e.delivery.provider === "chatgpt" && e.status === "completed",
      ),
    );
    assert.equal(
      saved.some((e) => e.delivery.provider === "gemini"),
      false,
    );
    releaseSlow();
    await run;
    assert.equal(saved.length, 2);
  },
);

test(
  "parallel members share an immutable context snapshot and synthesis waits for the slowest member",
  { timeout: 2000 },
  async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let secondStarted;
    const started = new Promise((resolve) => {
      secondStarted = resolve;
    });
    const prompts = [];
    const { group, saved } = fixture({
      runGroupTurn: async ({ providerId, prompt }) => {
        prompts.push({ providerId, prompt });
        if (providerId === "gemini") {
          secondStarted();
          await gate;
        }
        return {
          text:
            providerId === "chatgpt"
              ? "FAST_UNIQUE_EVIDENCE"
              : "SLOW_UNIQUE_EVIDENCE",
        };
      },
    });
    const run = group.enqueue({
      ...user("snapshot", "r", "@chatgpt @gemini compare"),
      metadata: { collaborationMode: "review" },
    });
    await started;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(prompts.length, 2);
    assert.ok(
      prompts
        .slice(0, 2)
        .every((item) => !item.prompt.includes("FAST_UNIQUE_EVIDENCE")),
    );
    assert.equal(
      saved.some((e) => e.delivery.phase === "summary"),
      false,
    );
    release();
    await run;
    assert.equal(prompts.length, 3);
    assert.match(prompts[2].prompt, /FAST_UNIQUE_EVIDENCE/);
    assert.match(prompts[2].prompt, /SLOW_UNIQUE_EVIDENCE/);
    assert.equal(saved.at(-1).delivery.phase, "summary");
  },
);

test(
  "a failed member does not block other members or release the room before in-flight work finishes",
  { timeout: 2000 },
  async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const { group } = fixture({});
    const started = [];
    group.turn = async (request, provider) => {
      started.push(request.id + ":" + provider);
      if (request.id === "first" && provider === "chatgpt")
        throw Error("STORAGE_FAIL");
      if (request.id === "first") await gate;
      return { status: "completed", delivery: { provider }, parts: [] };
    };
    const first = group.enqueue(user("first", "r", "@chatgpt @gemini probe"));
    const expectedFailure = assert.rejects(first, /STORAGE_FAIL/);
    const second = group.enqueue(user("second", "r", "@chatgpt probe"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(started.includes("first:gemini"));
    assert.equal(started.includes("second:chatgpt"), false);
    release();
    await expectedFailure;
    await second;
    assert.ok(started.includes("second:chatgpt"));
  },
);

test("Codex recovers a stale persisted thread only before a turn starts", async () => {
  const { group, saved } = fixture({});
  const calls = [];
  const adapter = { client: { currentThreadId: "stale" } };
  group.threads["r1:codex"] = { conversationId: "stale" };
  group.codex = Object.assign(new EventEmitter(), {
    getAdapter: async () => adapter,
    executeTurn: async (_prompt, options) => {
      calls.push({ ...options });
      if (calls.length === 1)
        throw new Error("Codex RPC error (-32600): thread not found: stale");
      assert.equal(adapter.client.currentThreadId, null);
      return { success: true, text: "fresh response", threadId: "fresh" };
    },
  });
  await group.enqueue(user("recover", "r1", "@codex hello"));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].threadId, "stale");
  assert.equal(calls[1].threadId, undefined);
  assert.equal(saved[0].delivery.state, "completed");
  assert.equal(group.threads["r1:codex"].conversationId, "fresh");
});

test("Codex never retries a failed turn that already emitted text", async () => {
  const { group, saved } = fixture({});
  let calls = 0;
  group.threads["r1:codex"] = { conversationId: "stale" };
  group.codex = Object.assign(new EventEmitter(), {
    executeTurn: async () => {
      calls++;
      group.codex.emit("delta", "partial");
      throw new Error("thread not found: stale");
    },
  });
  await group.enqueue(user("partial", "r1", "@codex hello"));
  assert.equal(calls, 1);
  assert.equal(saved.at(-1).delivery.state, "blocked");
});
