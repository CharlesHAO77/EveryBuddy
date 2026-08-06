/**
 * MarkdownText - 极简 Markdown 渲染（无第三方依赖，安全：不使用 dangerouslySetInnerHTML）。
 *
 * 支持：代码块（```lang）、行内代码、粗体、标题、无序列表、段落、换行。
 * 用于 TextCard 渲染助手文本消息（见 §6.4）。
 */
import { type ReactNode, useMemo, useState } from "react";

interface CodeBlockProps {
  code: string;
  lang?: string;
}

function CodeBlock({ code, lang }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="group relative my-2 overflow-hidden rounded-s bg-terminal">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1">
        <span className="text-[10px] text-white/40">{lang || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="text-[10px] text-white/40 transition hover:text-white/80"
        >
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2 text-[12px] leading-relaxed text-terminal-text">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** 渲染行内格式（粗体、行内代码） */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // 按 `code` 和 **bold** 拆分
  const regex = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(
        <code
          key={`${keyPrefix}-c-${i}`}
          className="rounded bg-hover px-1 py-0.5 text-[12px] text-ink"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(
        <strong key={`${keyPrefix}-b-${i}`} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    }
    last = regex.lastIndex;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

interface MarkdownTextProps {
  content: string;
}

export function MarkdownText({ content }: MarkdownTextProps) {
  const blocks = useMemo(() => parseBlocks(content), [content]);
  return (
    <div className="text-[14px] leading-relaxed text-ink">
      {blocks.map((b, i) => {
        if (b.type === "code") {
          return <CodeBlock key={i} code={b.code} lang={b.lang} />;
        }
        if (b.type === "heading") {
          const sizes = ["text-lg", "text-base", "text-[15px]"];
          const cls = sizes[Math.min(b.level - 1, 2)];
          return (
            <div key={i} className={`mt-2 mb-1 font-semibold ${cls}`}>
              {renderInline(b.text, `h${i}`)}
            </div>
          );
        }
        if (b.type === "list") {
          return (
            <ul key={i} className="my-1 list-disc pl-5">
              {b.items.map((item, j) => (
                <li key={j} className="my-0.5">
                  {renderInline(item, `l${i}-${j}`)}
                </li>
              ))}
            </ul>
          );
        }
        // paragraph
        return (
          <p key={i} className="my-1 first:mt-0 last:mb-0 whitespace-pre-wrap">
            {renderInline(b.text, `p${i}`)}
          </p>
        );
      })}
    </div>
  );
}

type Block =
  | { type: "code"; code: string; lang?: string }
  | { type: "heading"; level: number; text: string }
  | { type: "list"; items: string[] }
  | { type: "paragraph"; text: string };

function parseBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    // 代码块
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const lang = fence[1] || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]?.startsWith("```")) {
        codeLines.push(lines[i] ?? "");
        i++;
      }
      i++; // 跳过结束 ```
      blocks.push({ type: "code", code: codeLines.join("\n"), lang });
      continue;
    }
    // 标题
    const heading = line.match(/^(#{1,3})\s+(.*)/);
    if (heading && heading[1] !== undefined && heading[2] !== undefined) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    // 无序列表
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", items });
      continue;
    }
    // 空行
    if (line.trim() === "") {
      i++;
      continue;
    }
    // 段落（连续非空行）
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      !/^```/.test(lines[i] ?? "") &&
      !/^(#{1,3})\s+/.test(lines[i] ?? "") &&
      !/^\s*[-*]\s+/.test(lines[i] ?? "")
    ) {
      paraLines.push(lines[i] ?? "");
      i++;
    }
    blocks.push({ type: "paragraph", text: paraLines.join("\n") });
  }
  return blocks;
}
