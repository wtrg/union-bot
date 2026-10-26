const {
  PROVIDER_REGISTRY,
  isAllowedForProvider,
} = require("../../../../packages/browser-manager/src/browser-manager.cjs");
const { readPage } = require("./web-group-turn.cjs");
const WEB_PROVIDERS = new Set(["chatgpt", "gemini", "claude", "deepseek"]);

class ProviderConnectionService {
  constructor(browser) {
    this.browser = browser;
  }

  validateProvider(providerId) {
    if (!WEB_PROVIDERS.has(providerId))
      throw new Error("Nhà cung cấp web không được hỗ trợ.");
  }

  chooseTab(providerId, tabId) {
    this.validateProvider(providerId);
    const state = this.browser.getState();
    if (tabId) {
      const tab = state.tabs.find(
        (tab) => tab.id === tabId && tab.providerId === providerId,
      );
      if (!tab) throw new Error("Tab không thuộc nhà cung cấp này.");
      return tab;
    }
    // The original provider tab shares its persistent partition with room tabs.
    // Reuse it instead of creating a new login tab on every click.
    return (
      state.tabs.find(
        (tab) => tab.providerId === providerId && !tab.worker && !tab.crashed,
      ) || state.tabs.find((tab) => tab.providerId === providerId)
    );
  }

  open(providerId) {
    let tab = this.chooseTab(providerId);
    if (!tab) {
      const result = this.browser.createTab(
        providerId,
        PROVIDER_REGISTRY[providerId].defaultUrl,
      );
      if (!result.success || !result.tab)
        throw new Error(result.error || "Không mở được tab đăng nhập.");
      tab = result.tab;
    }
    if (tab.worker)
      throw new Error("AI đang dùng tab này. Dừng lượt trước khi đăng nhập.");
    if (!this.browser.selectTab(tab.id))
      throw new Error("Không chọn được tab đăng nhập.");
    return {
      success: true,
      providerId,
      tabId: tab.id,
      message:
        "Đăng nhập trực tiếp trên trang nhà cung cấp, sau đó bấm Kiểm tra lại phiên. Phiên được giữ trong phân vùng riêng.",
    };
  }

  async check(providerId, tabId) {
    const tab = this.chooseTab(providerId, tabId);
    const checkedAt = Date.now();
    const result = {
      success: true,
      providerId,
      tabId: tab?.id,
      status: "UNAVAILABLE",
      checkedAt,
      message: "Chưa có tab nhà cung cấp. Mở đăng nhập trước.",
    };
    const web = tab && this.browser.views.get(tab.id)?.webContents;
    if (web && !web.isDestroyed() && !tab.crashed) {
      let timer;
      try {
        const url = web.getURL();
        if (!isAllowedForProvider(providerId, url))
          throw new Error("Trang hiện tại không thuộc nhà cung cấp này.");
        const page = await Promise.race([
          web.executeJavaScript(
            `(${readPage.toString()})('', ${JSON.stringify(providerId)})`,
          ),
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    "Không đọc được trạng thái trang trong thời gian chờ.",
                  ),
                ),
              4000,
            );
          }),
        ]);
        if (page.challenge)
          Object.assign(result, {
            status: "CHALLENGE_REQUIRED",
            message:
              "Trang đang yêu cầu xác minh. Hoàn tất trực tiếp trong tab nhà cung cấp.",
          });
        else if (page.login)
          Object.assign(result, {
            status: "LOGIN_REQUIRED",
            message:
              "Chưa có phiên chat sẵn sàng. Hãy đăng nhập trong tab này rồi kiểm tra lại.",
          });
        else if (page.generating)
          Object.assign(result, {
            status: 'BUSY',
            message: 'Hội thoại đang trả lời. Chờ lượt hiện tại kết thúc rồi kiểm tra lại.',
          });
        else if (page.draftPresent)
          Object.assign(result, {
            status: 'DRAFT_PRESENT',
            message: 'Tab có bản nháp chưa gửi. Kiểm tra bản nháp trong AI Browser trước khi gửi yêu cầu mới.',
          });
        else if (page.editor && !web.isLoading())
          Object.assign(result, {
            status: "READY_TO_CHAT",
            message:
              "Đã thấy ô chat sẵn sàng. Gửi một tin nhắn để xác nhận gửi/nhận đầu cuối.",
          });
        else
          Object.assign(result, {
            status: "LOADING",
            message:
              "Trang chưa có ô chat sẵn sàng. Chờ tải xong rồi kiểm tra lại.",
          });
      } catch (error) {
        result.message = error.message;
      } finally {
        clearTimeout(timer);
      }
    }
    if (tab) {
      const patch = {
        connection: {
          status: result.status,
          checkedAt,
          message: result.message,
        },
      };
      if (result.status === "LOGIN_REQUIRED")
        patch.authStatus = "LOGIN_REQUIRED";
      else if (result.status === "READY_TO_CHAT")
        patch.authStatus = "READY_OR_LANDING";
      this.browser.stateManager.updateTab(tab.id, patch);
      this.browser._notifyRenderer?.();
    }
    // No cookie, account identifier, draft or assistant text leaves this service.
    return result;
  }
}
module.exports = { ProviderConnectionService };
