const { test } = require("node:test");
const assert = require("node:assert/strict");
const { writeClipboardText } = require("../src/services/clipboard-service.cjs");
test("clipboard preserves multilingual text and code exactly", () => {
  let value;
  const text = "Thiết kế giao diện\n<script>chỉ là văn bản</script>\n  a\tb";
  assert.deepEqual(
    writeClipboardText(
      {
        writeText: (t) => {
          value = t;
        },
      },
      text,
    ),
    { success: true },
  );
  assert.equal(value, text);
});
test("invalid or oversized clipboard payloads are rejected before writing", () => {
  let calls = 0;
  const clipboard = { writeText: () => calls++ };
  for (const value of [null, {}, 42, "é".repeat(1048577)])
    assert.equal(writeClipboardText(clipboard, value).success, false);
  assert.equal(calls, 0);
});
test("OS clipboard failure is reported without leaking copied text", () => {
  const result = writeClipboardText(
    {
      writeText: () => {
        throw Error("private copied text");
      },
    },
    "private copied text",
  );
  assert.equal(result.success, false);
  assert.equal(result.error.includes("private"), false);
});
