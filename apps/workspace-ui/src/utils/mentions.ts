export const MEMBER_IDS = ["chatgpt", "gemini", "codex", "antigravity", "claude", "deepseek"] as const;
export function commandMentionTargets(text: string): string[] {
  // Keep the composer hint consistent with the backend's command-prefix router.
  const prefix = text.match(/^\s*((?:@(?:all|team|chatgpt|antigravity|codex|gemini|claude|deepseek)\b\s*)+)/i)?.[1] || "";
  if (/@(?:all|team)\b/i.test(prefix)) return [...MEMBER_IDS];
  return [...new Set([...prefix.matchAll(/(?:^|\s)@(chatgpt|antigravity|codex|gemini|claude|deepseek)\b/gi)].map(m => m[1].toLowerCase()))];
}

export function mentionSegments(text: string): {text: string; member?: string}[] {
  const pattern = /(^|[^\w@/])(@(all|team|chatgpt|gemini|codex|antigravity|claude|deepseek))(?![\w-])/gi;
  const result: {text: string; member?: string}[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index! + match[1].length;
    if (start > cursor) result.push({text: text.slice(cursor, start)});
    result.push({text: match[2], member: match[3].toLowerCase()});
    cursor = start + match[2].length;
  }
  if (cursor < text.length) result.push({text: text.slice(cursor)});
  return result;
}
