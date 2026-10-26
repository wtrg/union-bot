import { test } from "node:test";
import assert from "node:assert/strict";
import { createEnvelopeBuffer } from "../src/utils/envelope-buffer.ts";
import type { EnvelopeView } from "../src/types.ts";
const row = (id: string, status: string, text: string) =>
  ({
    id,
    roomId: "r",
    status,
    parts: [{ kind: "text", text }],
    sender: { kind: "agent", id: "codex", name: "Codex" },
  }) as EnvelopeView;
test("token bursts coalesce independently by reply and final delivery flushes immediately", () => {
  const deliveries: EnvelopeView[][] = [];
  const buffer = createEnvelopeBuffer((rows) => deliveries.push(rows), 1000);
  for (let i = 0; i < 100; i++) buffer.push(row("a", "streaming", String(i)));
  buffer.push(row("b", "streaming", "another AI"));
  assert.equal(deliveries.length, 0);
  buffer.push(row("a", "completed", "final"));
  assert.equal(deliveries.length, 1);
  assert.deepEqual(
    deliveries[0].map((e) => e.parts[0].text),
    ["final", "another AI"],
  );
  buffer.dispose();
});
test("cancel flushes partial text and a late queued update cannot replace buffered stream", () => {
  const deliveries: EnvelopeView[][] = [];
  const buffer = createEnvelopeBuffer((rows) => deliveries.push(rows), 1000);
  buffer.push(row("a", "streaming", "partial"));
  buffer.push(row("a", "queued", ""));
  buffer.push(row("b", "cancelled", "kept"));
  assert.equal(deliveries[0][0].parts[0].text, "partial");
  assert.equal(deliveries[0][1].status, "cancelled");
  buffer.dispose();
});
test("a stream-only batch is eventually delivered and disposal drops pending room updates", async () => {
  const deliveries: EnvelopeView[][] = [];
  const buffer = createEnvelopeBuffer((rows) => deliveries.push(rows), 10);
  buffer.push(row("a", "streaming", "visible"));
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(deliveries.length, 1);
  buffer.push(row("a", "streaming", "after unmount"));
  buffer.dispose();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(deliveries.length, 1);
});
