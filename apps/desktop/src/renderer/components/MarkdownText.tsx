/**
 * MarkdownText - Markdown 渲染（react-markdown + remark-gfm，见 §6.4）。
 *
 * 支持完整 GFM：表格、任务列表、删除线、自动链接、代码块、标题、列表、引用等。
 * 渲染为 React 元素（不用 dangerouslySetInnerHTML），安全。
 * 组件映射保持「温暖纸感」token 体系，并保留代码块复制按钮。
 * 注意：components 对象定义在模块作用域，保证引用稳定、避免 react-markdown 重挂载。
 */

import i18n from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface CodeBlockProps {
  code: string;
  lang?: string;
}

function CodeBlock({ code, lang }: CodeBlockProps) {
  const { t } = useTranslation();
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
        <span className="text-[11px] text-white/40">{lang || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="text-[11px] text-white/40 transition hover:text-white/80"
        >
          {copied ? t("common.copied") : t("common.copy")}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2 text-[13px] leading-relaxed text-terminal-text">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** 图片仅渲染安全来源（http(s) 外链或 data:image 内联），否则降级为 alt 文本 */
function isSafeImageSrc(src: string | undefined): src is string {
  return !!src && (/^https?:\/\//i.test(src) || /^data:image\//i.test(src));
}

const components: Components = {
  // react-markdown 默认块级 code 包在 <pre><code>；CodeBlock 自带容器，剥掉外层 <pre>
  pre({ children }) {
    return <>{children}</>;
  },
  code({ node, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className ?? "");
    const multiLine = node?.position != null && node.position.start.line !== node.position.end.line;
    if (match || multiLine) {
      return <CodeBlock code={String(children).replace(/\n$/, "")} lang={match?.[1]} />;
    }
    return (
      <code className="rounded bg-hover px-1 py-0.5 text-[13px] text-ink" {...props}>
        {children}
      </code>
    );
  },
  // 渲染进程禁导航：链接一律转系统默认浏览器打开
  a({ node: _node, href, children, ...props }) {
    return (
      <a
        href={href}
        rel="noopener noreferrer"
        onClick={(e) => {
          e.preventDefault();
          if (href) void window.electronAPI.system.openExternal(href);
        }}
        {...props}
      >
        {children}
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="my-2 overflow-x-auto">
        <table className="w-full border-collapse text-[14px]">{children}</table>
      </div>
    );
  },
  th({ children }) {
    return (
      <th className="border border-line bg-hover px-2 py-1 text-left font-semibold">{children}</th>
    );
  },
  td({ children }) {
    return <td className="border border-line px-2 py-1 align-top">{children}</td>;
  },
  h1({ children }) {
    return <h1 className="mt-2 mb-1 text-lg font-semibold">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="mt-2 mb-1 text-base font-semibold">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="mt-2 mb-1 text-[16px] font-semibold">{children}</h3>;
  },
  h4({ children }) {
    return <h4 className="mt-2 mb-1 text-[15px] font-semibold">{children}</h4>;
  },
  ul({ children }) {
    return <ul className="my-1 list-disc pl-5">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="my-1 list-decimal pl-5">{children}</ol>;
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-1 border-l-2 border-line-strong pl-3 text-ink-2">
        {children}
      </blockquote>
    );
  },
  img({ src, alt }) {
    // 用 i18next 单例取当前语言（react-markdown 组件覆写按组件渲染，但静态分析不识别小写 renderer，
    // 避免在「非组件」里调 hook；语言变化由父级重渲染驱动）
    if (!isSafeImageSrc(src)) {
      return <span className="text-ink-3">{alt || i18n.t("markdown.imageAlt")}</span>;
    }
    return (
      <img src={src} alt={alt ?? ""} className="my-2 max-w-full rounded-s border border-line" />
    );
  },
  p({ children }) {
    return <p className="my-1 first:mt-0 last:mb-0">{children}</p>;
  },
};

interface MarkdownTextProps {
  content: string;
}

export function MarkdownText({ content }: MarkdownTextProps) {
  return (
    <div className="text-[15px] leading-relaxed text-ink">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
