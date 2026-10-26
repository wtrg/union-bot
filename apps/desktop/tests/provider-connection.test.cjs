const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  ProviderConnectionService,
} = require("../src/services/provider-connection-service.cjs");
function fixture({
  tabs = [],
  page = {},
  loading = false,
  url = "https://chat.deepseek.com/",
} = {}) {
  const calls = { created: 0, selected: [], scripts: [] };
  const browser = {
    getState: () => ({ tabs }),
    views: new Map(),
    createTab(providerId, target) {
      calls.created++;
      const tab = {
        id: "new",
        providerId,
        url: target,
        partition: "persist:mcb-web-deepseek",
      };
      tabs.push(tab);
      return { success: true, tab };
    },
    selectTab(id) {
      calls.selected.push(id);
      return true;
    },
    stateManager: {
      updateTab(id, patch) {
        Object.assign(
          tabs.find((tab) => tab.id === id),
          patch,
        );
      },
    },
    _notifyRenderer() {},
  };
  for (const tab of tabs)
    browser.views.set(tab.id, {
      webContents: {
        isDestroyed: () => false,
        isLoading: () => loading,
        getURL: () => url,
        executeJavaScript: async (script) => {
          calls.scripts.push(script);
          return page;
        },
      },
    });
  return {
    service: new ProviderConnectionService(browser),
    browser,
    calls,
    tabs,
  };
}
test("DeepSeek login reuses its isolated provider tab instead of creating duplicate tabs", () => {
  const { service, calls, tabs } = fixture({
    tabs: [
      {
        id: "d",
        providerId: "deepseek",
        partition: "persist:mcb-web-deepseek",
      },
    ],
  });
  assert.equal(service.open("deepseek").tabId, "d");
  assert.equal(service.open("deepseek").tabId, "d");
  assert.equal(calls.created, 0);
  assert.deepEqual(calls.selected, ["d", "d"]);
  assert.equal(tabs[0].partition, "persist:mcb-web-deepseek");
});
test("DeepSeek missing tab is created at the official provider URL", () => {
  const { service, tabs, calls } = fixture();
  assert.equal(service.open("deepseek").success, true);
  assert.equal(calls.created, 1);
  assert.equal(new URL(tabs[0].url).hostname, "chat.deepseek.com");
});
test("login and challenge states are explicit and never called ready", async () => {
  for (const [page, expected] of [
    [{ login: true }, "LOGIN_REQUIRED"],
    [{ challenge: true }, "CHALLENGE_REQUIRED"],
    [{ editor: false }, "LOADING"],
    [{ editor: true, draftPresent: true }, "DRAFT_PRESENT"],
    [{ editor: true, generating: true }, "BUSY"],
  ]) {
    const { service } = fixture({
      tabs: [{ id: "d", providerId: "deepseek" }],
      page,
    });
    assert.equal((await service.check("deepseek", "d")).status, expected);
  }
});
test("session recheck after login updates stale login status but never exposes page contents", async () => {
  const { service, tabs } = fixture({
    tabs: [{ id: "d", providerId: "deepseek", authStatus: "LOGIN_REQUIRED" }],
    page: {
      editor: true,
      login: false,
      text: "private reply",
      lastUserText: "private draft",
    },
  });
  const status = await service.check("deepseek", "d");
  assert.equal(status.status, "READY_TO_CHAT");
  assert.equal(tabs[0].authStatus, "READY_OR_LANDING");
  assert.equal(tabs[0].connection.status, "READY_TO_CHAT");
  assert.equal(JSON.stringify(status).includes("private"), false);
});
test("invalid providers and foreign tabs are rejected without navigation or execution", async () => {
  const { service, calls } = fixture({
    tabs: [{ id: "foreign", providerId: "claude" }],
  });
  assert.throws(
    () => service.open("https://evil.example"),
    /không được hỗ trợ/,
  );
  await assert.rejects(service.check("deepseek", "foreign"), /không thuộc/);
  assert.equal(calls.created, 0);
  assert.equal(calls.scripts.length, 0);
});
test("login never takes over a tab with an active worker", () => {
  const { service, calls } = fixture({
    tabs: [{ id: "d", providerId: "deepseek", worker: "group:r" }],
  });
  assert.throws(() => service.open("deepseek"), /AI đang dùng/);
  assert.equal(calls.selected.length, 0);
});
