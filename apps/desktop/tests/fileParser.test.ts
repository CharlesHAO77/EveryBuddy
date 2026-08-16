/**
 * fileParser 单元测试（附件暂存 + 按需解析 + 清单回放）。
 * 临时目录注入模式（与 modelStore.test.ts 一致），不触碰真实 ~/EveryBuddy。
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildManifestText,
  categoryFromName,
  parseFileContent,
  resolveInUploads,
  splitFileMarkers,
  stageAttachments,
} from "../src/main/services/fileParser";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "eb-fileparser-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(name: string, data: Buffer | string): string {
  const p = path.join(root, name);
  writeFileSync(p, data);
  return p;
}

/** 生成一个带指定文本的最小合法 PDF（xref 偏移精确计算，unpdf 可解析） */
function minimalPdf(text: string): Buffer {
  const content = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const parts: string[] = ["%PDF-1.4\n"];
  const offsets: number[] = [];
  const addObj = (body: string) => {
    offsets.push(Buffer.byteLength(parts.join("")));
    parts.push(`${offsets.length} 0 obj\n${body}\nendobj\n`);
  };
  addObj("<< /Type /Catalog /Pages 2 0 R >>");
  addObj("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  addObj(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
  );
  addObj(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  parts.push(`xref\n0 ${offsets.length + 1}\n`);
  parts.push("0000000000 65535 f \n");
  for (const off of offsets) parts.push(`${String(off).padStart(10, "0")} 00000 n \n`);
  parts.push(
    `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${Buffer.byteLength(
      parts.join(""),
    )}\n%%EOF\n`,
  );
  return Buffer.from(parts.join(""), "binary");
}

async function makeXlsx(): Promise<Buffer> {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([
    ["Name", "Age"],
    ["Alice", 30],
    ["Bob", 25],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function makeDocx(): Promise<Buffer> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello DOCX</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function makePptx(): Promise<Buffer> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Hello PPTX</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("categoryFromName", () => {
  it("识别各格式", () => {
    expect(categoryFromName("a.txt")).toBe("text");
    expect(categoryFromName("a.md")).toBe("text");
    expect(categoryFromName("a.tsx")).toBe("text");
    expect(categoryFromName("a.png")).toBe("image");
    expect(categoryFromName("a.JPG")).toBe("image");
    expect(categoryFromName("a.pdf")).toBe("pdf");
    expect(categoryFromName("a.docx")).toBe("docx");
    expect(categoryFromName("a.xlsx")).toBe("xlsx");
    expect(categoryFromName("a.pptx")).toBe("pptx");
    expect(categoryFromName("a.exe")).toBe("unsupported");
  });
});

describe("stageAttachments", () => {
  it("复制到 uploads/ 并返回暂存信息", async () => {
    const src = write("报告.txt", "hello");
    const staged = await stageAttachments([{ name: "报告.txt", path: src, size: 5 }], root);
    expect(staged).toHaveLength(1);
    expect(staged[0]!.skipped).toBe(false);
    expect(staged[0]!.uploadName).toBe("报告.txt");
    expect(staged[0]!.uploadPath).toBe(path.join(root, "uploads", "报告.txt"));
    expect(staged[0]!.category).toBe("text");
    expect(staged[0]!.error).toBeUndefined();
  });

  it("重名时 -2/-3 去重", async () => {
    const a = write("a.txt", "one");
    const b = write("a.txt", "two");
    const staged = await stageAttachments(
      [
        { name: "a.txt", path: a, size: 3 },
        { name: "a.txt", path: b, size: 3 },
      ],
      root,
    );
    expect(staged[0]!.uploadName).toBe("a.txt");
    expect(staged[1]!.uploadName).toBe("a-2.txt");
  });

  it("缺失文件记为 skipped + error，不影响其它", async () => {
    const good = write("ok.txt", "fine");
    const staged = await stageAttachments(
      [
        { name: "ok.txt", path: good, size: 4 },
        { name: "gone.txt", path: path.join(root, "gone.txt"), size: 0 },
      ],
      root,
    );
    expect(staged[0]!.skipped).toBe(false);
    expect(staged[1]!.skipped).toBe(true);
    expect(staged[1]!.error).toBeTruthy();
  });

  it("超大文件跳过", async () => {
    const big = write("big.txt", "x".repeat(1024));
    const staged = await stageAttachments([{ name: "big.txt", path: big, size: 1024 }], root, {
      maxFileBytes: 100,
    });
    expect(staged[0]!.skipped).toBe(true);
    expect(staged[0]!.error).toContain("上限");
  });
});

describe("parseFileContent", () => {
  it("文本：解析内容并截断", async () => {
    const p = write("note.txt", "你好，世界");
    const { content } = await parseFileContent(p, { maxTextChars: 100 });
    expect(content[0]).toEqual({ type: "text", text: "你好，世界" });
  });

  it("文本：超过限制截断并标注", async () => {
    const p = write("long.txt", "x".repeat(50));
    const { content } = await parseFileContent(p, { maxTextChars: 20 });
    const text = content[0]!.type === "text" ? content[0]!.text : "";
    expect(text.length).toBeLessThanOrEqual(20 + 20);
    expect(text).toContain("已截断");
  });

  it("二进制伪装 .txt（含 NUL）→ 报错不崩溃", async () => {
    const p = write("evil.txt", Buffer.from([0x00, 0x01, 0x41, 0x42]));
    const { content } = await parseFileContent(p);
    expect(content[0]!.type).toBe("text");
    expect((content[0] as { text: string }).text).toContain("errors.binaryAsText");
  });

  it("图片：魔数识别 + base64 视觉内容（resizeImages:false 避免 CI worker）", async () => {
    const p = write("pic.png", Buffer.from(PNG_1PX, "base64"));
    const { content } = await parseFileContent(p, { resizeImages: false });
    expect(content[0]!.type).toBe("image");
    const img = content[0] as { type: "image"; data: string; mimeType: string };
    expect(img.mimeType).toBe("image/png");
    expect(img.data.length).toBeGreaterThan(0);
  });

  it("unsupported 格式 → 报错文本", async () => {
    const p = write("foo.exe", "MZ...");
    const { content } = await parseFileContent(p);
    expect((content[0] as { text: string }).text).toContain("无法解析");
  });

  it("PDF：抽取文本", async () => {
    const p = write("doc.pdf", minimalPdf("Hello PDF World"));
    const { content } = await parseFileContent(p);
    expect((content[0] as { text: string }).text).toContain("Hello PDF World");
  });

  it("DOCX：mammoth 抽取文本", async () => {
    const p = write("doc.docx", await makeDocx());
    const { content } = await parseFileContent(p);
    expect((content[0] as { text: string }).text).toContain("Hello DOCX");
  });

  it("XLSX：逐 sheet 转 CSV", async () => {
    const p = write("data.xlsx", await makeXlsx());
    const { content } = await parseFileContent(p);
    const text = (content[0] as { text: string }).text;
    expect(text).toContain("Sheet1");
    expect(text).toContain("Alice");
    expect(text).toContain("Bob");
  });

  it("PPTX：抽取 <a:t> 文本", async () => {
    const p = write("deck.pptx", await makePptx());
    const { content } = await parseFileContent(p);
    expect((content[0] as { text: string }).text).toContain("Hello PPTX");
  });
});

describe("resolveInUploads", () => {
  it("约束在 uploads 目录内，防逃逸", () => {
    const uploadDir = path.join(root, "uploads");
    expect(resolveInUploads(uploadDir, "a.pdf")).toBe(path.join(uploadDir, "a.pdf"));
    expect(resolveInUploads(uploadDir, "uploads/a.pdf")).toBe(path.join(uploadDir, "a.pdf"));
    expect(resolveInUploads(uploadDir, "../secret")).toBeNull();
    expect(resolveInUploads(uploadDir, "/etc/passwd")).toBeNull();
  });
});

describe("buildManifestText + splitFileMarkers", () => {
  it("manifest 含自闭合 <file/> 标记与提示", async () => {
    const src = write("报告.pdf", minimalPdf("x"));
    const staged = await stageAttachments([{ name: "报告.pdf", path: src, size: 3 }], root);
    const manifest = buildManifestText(staged);
    expect(manifest).toContain(`<file name="uploads/报告.pdf" size="${staged[0]!.size}"/>`);
    expect(manifest).toContain("parse_attachment");
  });

  it("splitFileMarkers 拆出 file chips + 文本", () => {
    const blocks = splitFileMarkers(
      '<file name="uploads/报告.pdf" size="1234"/>\n请总结\n<file name="uploads/a.png" size="5"/>',
    );
    expect(blocks).toEqual([
      { id: "f0", kind: "file", name: "报告.pdf", size: 1234, done: true },
      { id: "t0", kind: "text", content: "请总结", done: true },
      { id: "f1", kind: "file", name: "a.png", size: 5, done: true },
    ]);
  });

  it("splitFileMarkers 纯文本 → 单个文本块", () => {
    const blocks = splitFileMarkers("只有一句话");
    expect(blocks).toEqual([{ id: "t0", kind: "text", content: "只有一句话", done: true }]);
  });

  it("imageHint 替换默认图片提示行（主模型无视觉时）", async () => {
    const img = write("pic.png", Buffer.from(PNG_1PX, "base64"));
    const txt = write("note.txt", "hi");
    const staged = await stageAttachments(
      [
        { name: "pic.png", path: img, size: 68 },
        { name: "note.txt", path: txt, size: 2 },
      ],
      root,
    );
    const manifest = buildManifestText(staged, {
      imageHint: "当前模型不支持视觉，图片请用 understand_image 工具调用视觉模型理解",
    });
    expect(manifest).toContain("当前模型不支持视觉");
    expect(manifest).not.toContain("会以视觉方式展示");
    // 其余提示保留
    expect(manifest).toContain("文本文件可用 read");
  });
});
