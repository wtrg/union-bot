import { useEffect, useRef, useState } from "react";
import { AGENT_NAMES } from "../utils/workspace-model.ts";

export function ProviderSessionControls({
  providerId,
  tabId,
  onOpen,
}: {
  providerId: string;
  tabId?: string;
  onOpen: () => void;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const current = useRef({ providerId, tabId });
  current.current = { providerId, tabId };
  const lock = useRef(false);
  useEffect(() => {
    setMessage("");
  }, [providerId, tabId]);
  async function act(action: "open" | "check") {
    if (lock.current) return;
    const api = window.unionBotAPI;
    if (!api?.providerOpenLogin || !api?.providerCheckSession) {
      setMessage("Mở lại ứng dụng để dùng luồng đăng nhập mới.");
      return;
    }
    const selectedProvider = providerId,
      selectedTab = tabId;
    lock.current = true;
    setBusy(true);
    try {
      const result =
        action === "open"
          ? await api.providerOpenLogin({ providerId })
          : await api.providerCheckSession({ providerId, tabId });
      if (!result.success)
        throw Error(result.error || "Không kiểm tra được phiên");
      if (
        current.current.providerId !== selectedProvider ||
        (action === "check" && current.current.tabId !== selectedTab)
      )
        return;
      setMessage(result.message || "Đã mở phiên nhà cung cấp.");
      if (action === "open") onOpen();
    } catch (error) {
      if (current.current.providerId === selectedProvider)
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
