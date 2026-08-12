/**
 * MarkdownText 渲染测试（react-markdown + remark-gfm）。
 * 用 react-dom/server 的 renderToStaticMarkup 在 node 环境渲染，无需 jsdom。
 * 覆盖 GFM 表格/删除线/链接/有序列表/代码块/图片安全来源。
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownText } from "../src/renderer/components/MarkdownText";

function render(content: string): string {
  return renderToStaticMarkup(<MarkdownText content={content} />);
}

describe("MarkdownText", () => {
  it("渲染 GFM 表格", () => {
    const html = render("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("<td");
  });

  it("渲染删除线（~~x~~）", () => {
    expect(render("~~删除~~")).toContain("<del>");
  });

  it("渲染链接并带 rel 属性", () => {
    const html = render("[文档](https://example.com)");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("渲染有序列表", () => {
    const html = render("1. 第一\n2. 第二");
    expect(html).toContain("<ol");
  });

  it("渲染围栏代码块（带语言标签与复制按钮）", () => {
    const html = render("```js\nconst x = 1;\n```");
    expect(html).toContain("复制");
    expect(html).toContain("js");
    expect(html).toContain("<pre");
  });

  it("未闭合代码围栏不崩溃", () => {
    const html = render("```js\nconst x = 1;\n后文未闭合");
    expect(html).toContain("const x = 1;");
  });

  it("渲染粗体与行内代码", () => {
    const html = render("**加粗** 与 `code`");
    expect(html).toContain("<strong>");
    expect(html).toContain("<code");
  });

  it("图片：仅渲染安全来源", () => {
    expect(render("![图](https://example.com/a.png)")).toContain("<img");
    expect(render("![图](file:///etc/passwd)")).not.toContain("<img");
  });

  it("渲染引用与标题", () => {
    const html = render("## 标题\n\n> 引用");
    expect(html).toContain("<h2");
    expect(html).toContain("<blockquote");
  });
});
