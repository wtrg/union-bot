import React from "react";
import { MemberMentions } from "./MemberMentions.tsx";

// Render text as React nodes: model output never becomes executable HTML.
function inline(text: string): React.ReactNode[] {
  return text
    .split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g)
    .map((part, i) => {
      if (part.startsWith("`") && part.endsWith("`"))
        return <code key={i}>{part.slice(1, -1)}</code>;
      if (part.startsWith("**") && part.endsWith("**"))
        return <strong key={i}><MemberMentions text={part.slice(2, -2)} /></strong>;
      const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (link)
        return (
          <a key={i} href={link[2]} target="_blank" rel="noreferrer">
            {link[1]}
          </a>
        );
      return <MemberMentions key={i} text={part} />;
    });
}
export const MessageContent = React.memo(function MessageContent({
  text,
}: {
  text: string;
}) {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const blockStart = i;
    const line = lines[i];
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      while (++i < lines.length && !lines[i].startsWith("```"))
        code.push(lines[i]);
      const value = code.join("\n");
      nodes.push(
        <section className="ub-code" key={blockStart}>
          <header>
            {language || "code"}
            <CopyButton text={value} />
          </header>
          <pre>
            <code>{value}</code>
          </pre>
        </section>,
      );
    } else if (/^#{1,6}\s/.test(line)) {
      nodes.push(
        <h3 key={blockStart}>{inline(line.replace(/^#{1,6}\s+/, ""))}</h3>,
      );
    } else if (
      /^\s*\|.+\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:|\-]+\|\s*$/.test(lines[i + 1])
    ) {
      const cells = (row: string) =>
        row
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
      const heads = cells(line);
      const rows: string[][] = [];
      i++;
      while (i + 1 < lines.length && /^\s*\|.+\|\s*$/.test(lines[i + 1]))
        rows.push(cells(lines[++i]));
      nodes.push(
        <div className="ub-table" key={blockStart}>
          <table>
            <thead>
              <tr>
                {heads.map((v, j) => (
                  <th key={j}>{inline(v)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, j) => (
                <tr key={j}>
                  {r.map((v, k) => (
                    <td key={k}>{inline(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (/^\s*([-*•]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [line.replace(/^\s*([-*•]|\d+\.)\s+/, "")];
      while (
        i + 1 < lines.length &&
        (ordered ? /^\s*\d+\.\s+/ : /^\s*[-*•]\s+/).test(lines[i + 1])
      )
        items.push(lines[++i].replace(/^\s*([-*•]|\d+\.)\s+/, ""));
      const Tag = ordered ? "ol" : "ul";
      nodes.push(
        <Tag key={blockStart}>
          {items.map((item, j) => (
            <li key={j}>{inline(item)}</li>
          ))}
        </Tag>,
      );
    } else if (line.startsWith(">"))
      nodes.push(
        <blockquote key={blockStart}>
          {inline(line.replace(/^>\s?/, ""))}
        </blockquote>,
      );
    else if (line.trim()) nodes.push(<p key={blockStart}>{inline(line)}</p>);
  }
  return <div className="ub-prose">{nodes}</div>;
});
export function CopyButton({ text }: { text: string }) {
  const [state, setState] = React.useState("Sao chép");
  React.useEffect(() => {
    if (state === "Sao chép") return;
    const timer = setTimeout(() => setState("Sao chép"), 2000);
    return () => clearTimeout(timer);
  }, [state]);
  return (
    <button
      type="button"
      disabled={!text.trim()}
      aria-label={state === "Sao chép" ? "Sao chép nội dung" : state}
      onClick={async () => {
        try {
          if (window.unionBotAPI?.clipboardWriteText) {
            const result = await window.unionBotAPI.clipboardWriteText(text);
            if (!result.success) throw Error(result.error || "Không chép được");
          } else await navigator.clipboard.writeText(text);
          setState("Đã chép");
        } catch {
          setState("Không chép được");
        }
      }}
    >
      <span aria-live="polite">{state}</span>
    </button>
  );
}
