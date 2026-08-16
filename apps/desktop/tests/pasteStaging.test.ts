/**
 * pasteStaging 单元测试——粘贴的剪贴板文件 base64 暂存。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stagePastedFile } from "../src/main/services/pasteStaging";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("stagePastedFile", () => {
  it("写入临时文件并返回可读路径（内容与 base64 一致）", () => {
    const p = stagePastedFile({ name: "screenshot.png", mimeType: "image/png", data: PNG_B64 });
    expect(readFileSync(p)).toEqual(Buffer.from(PNG_B64, "base64"));
    expect(p).toMatch(/\.png$/);
  });

  it("name 无扩展名时按 MIME 推断", () => {
    const p = stagePastedFile({ name: "image", mimeType: "image/webp", data: PNG_B64 });
    expect(p).toMatch(/\.webp$/);
  });

  it("无扩展名且 MIME 未知时回退 .bin", () => {
    const p = stagePastedFile({ name: "blob", data: PNG_B64 });
    expect(p).toMatch(/\.bin$/);
  });

  it("非法文件名字符被清洗（防路径穿越）", () => {
    const p = stagePastedFile({ name: "../../evil.png", data: PNG_B64 });
    // basename 只留 "evil"，路径不含 ".."
    expect(p).not.toContain("..");
    expect(p).toMatch(/evil\.png$/);
  });
});
