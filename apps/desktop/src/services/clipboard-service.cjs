function writeClipboardText(clipboard, text) {
  if (
    typeof text !== "string" ||
    Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024
  ) {
    return {
      success: false,
      error: "Nội dung sao chép không hợp lệ hoặc lớn hơn 2 MB.",
    };
  }
  try {
    clipboard.writeText(text);
    return { success: true };
  } catch {
    return { success: false, error: "Không ghi được vào clipboard hệ thống." };
  }
}
module.exports = { writeClipboardText };
