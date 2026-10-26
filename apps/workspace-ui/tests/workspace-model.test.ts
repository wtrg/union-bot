import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isTaskActive,
  taskProgress,
  taskState,
  mergeEnvelope,
  roomActivity,
  runIdOf,
  providerOf,
} from "../src/utils/workspace-model.ts";
import type { EnvelopeView, TaskItem } from "../src/types.ts";
const envelope = (id: string, state: string, roomId = "a"): EnvelopeView => ({
  id,
  roomId,
  traceId: "t",
  timestamp: 1,
  status: state,
  fidelity: "L0_RAW_TEXT",
  sender: { kind: "agent", id: "codex", name: "Codex" },
  recipient: { kind: "room", id: roomId },
  parts: [{ kind: "text", text: state }],
});
test("task states and zero progress remain truthful", () => {
  for (const state of [
    "pending",
    "failed",
    "blocked",
    "cancelled",
    "waiting_input",
    "paused",
  ]) {
    const task = { status: state, progress: 0 } as TaskItem;
    assert.equal(taskState(task), state);
    assert.equal(taskProgress(task), 0);
    assert.equal(isTaskActive(task), false);
  }
  assert.equal(taskProgress({}), undefined);
  assert.equal(isTaskActive({ status: "running" }), true);
});
test("stale history/queue cannot replace a live or completed response", () => {
  const streamed = envelope("one", "streaming");
  const completed = envelope("one", "completed");
  assert.deepEqual(mergeEnvelope([streamed], envelope("one", "queued")), [
    streamed,
  ]);
  assert.deepEqual(mergeEnvelope([completed], streamed), [completed]);
  assert.deepEqual(mergeEnvelope([streamed], completed), [completed]);
  assert.equal(mergeEnvelope([completed], envelope("two", "queued")).length, 2);
});
test("room activity is derived from individual turns, errors stop being busy", () => {
  const rows = [
    envelope("one", "completed"),
    envelope("two", "queued"),
    envelope("three", "blocked"),
    envelope("four", "sending"),
  ];
  assert.deepEqual(
    roomActivity(rows).map((e) => e.id),
    ["two", "four"],
  );
  const failure = {
    ...envelope("f", "blocked"),
    sender: {
      kind: "system" as const,
      id: "system_router",
      name: "Union Bot",
      provider: "codex",
    },
  };
  assert.equal(providerOf(failure), "codex");
  assert.equal(roomActivity([failure]).length, 0);
});
test("consultations and summaries retain their originating run", () => {
  const response = envelope("summary", "completed");
  response.delivery = {
    state: "completed",
    provider: "chatgpt",
    runId: "original",
    replyTo: "child",
  };
  assert.equal(runIdOf(response), "original");
  assert.equal(runIdOf(envelope("original", "completed")), "original");
});
