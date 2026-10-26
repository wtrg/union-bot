import type { EnvelopeView } from "../types.ts";
import { mergeEnvelope, messageState } from "./workspace-model.ts";

// Coalesce token bursts without dropping a terminal event or another AI's turn.
export function createEnvelopeBuffer(
  deliver: (rows: EnvelopeView[]) => void,
  delay = 32,
) {
  const pending = new Map<string, EnvelopeView>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    const rows = [...pending.values()];
    pending.clear();
    if (rows.length) deliver(rows);
  };
  return {
    push(row: EnvelopeView) {
      const old = pending.get(row.id);
      pending.set(row.id, old ? mergeEnvelope([old], row)[0] : row);
      if (
        ["completed", "blocked", "failed", "cancelled"].includes(
          messageState(row),
        )
      )
        flush();
      else timer ??= setTimeout(flush, delay);
    },
    dispose() {
      clearTimeout(timer);
      pending.clear();
    },
  };
}
