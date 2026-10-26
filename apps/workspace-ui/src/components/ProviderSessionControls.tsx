import { useEffect, useRef, useState } from "react";
import { AGENT_NAMES } from "../utils/workspace-model.ts";

export function ProviderSessionControls({
  providerId,
  tabId,
  roomId,
  onOpen,
}: {
  providerId: string;
  tabId?: string;
  roomId?: string;
  onOpen: () => void;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const current = useRef({ providerId, tabId, roomId });
  current.current = { providerId, tabId, roomId };
  const lock = useRef(false);
  useEffect(() => {
    setMessage("");
  }, [providerId, tabId, roomId]);
  async function act(action: "open" | "check") {
    if (lock.current) return;
    const api = window.unionBotAPI;
    if (!api?.providerOpenLogin || !api?.providerCheckSession) {
      setMessage("Mở lại ứng dụng để dùng luồng đăng nhập mới.");
      return;
    }
    const selectedProvider = providerId,
      selectedTab = tabId,
      selectedRoom = roomId;
    lock.current = true;
    setBusy(true);
    try {
      let checkTab = tabId;
      if (action === "check" && roomId && api.getGroupBindings) {
        const bindings = await api.getGroupBindings({roomId});
        if (!bindings.success) throw Error(bindings.error || "Không đọc được hội thoại của phòng.");
        const binding = bindings.bindings?.[providerId];
        if (binding?.url || binding?.tabId) {
          if (!api.browserGetState) throw Error("Mở lại ứng dụng để kiểm tra đúng hội thoại của phòng.");
          const state = await api.browserGetState();
          const linked = state.tabs.find(tab => tab.providerId === providerId && (binding.url
            ? tab.url.split(/[?#]/)[0] === binding.url.split(/[?#]/)[0]
            : tab.id === binding.tabId));
          if (!linked) throw Error("Hội thoại của phòng chưa mở. Bấm Mở tab gốc rồi kiểm tra lại phiên.");
          checkTab = linked.id;
        }
      }
      const result =
        action === "open"
          ? await api.providerOpenLogin({ providerId })
          : await api.providerCheckSession({ providerId, tabId: checkTab });
      if (!result.success)
        throw Error(result.error || "Không kiểm tra được phiên");
      if (
        current.current.providerId !== selectedProvider ||
        current.current.roomId !== selectedRoom ||
        (action === "check" && current.current.tabId !== selectedTab)
      )
        return;
      setMessage(result.message || "Đã mở phiên nhà cung cấp.");
      if (action === "open") onOpen();
    } catch (error) {
      if (current.current.providerId === selectedProvider && current.current.roomId === selectedRoom)
        setMessage(String(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div
      className="ub-session-controls"
      data-testid={`provider-session-${providerId}`}
    >
      <div>
        <button type="button" disabled={busy} onClick={() => act("open")}>
          Đăng nhập {AGENT_NAMES[providerId]}
        </button>
        <button type="button" disabled={busy} onClick={() => act("check")}>
          {busy ? "Đang kiểm tra…" : "Kiểm tra lại phiên"}
        </button>
      </div>
      {message && <small role="status">{message}</small>}
    </div>
  );
}
