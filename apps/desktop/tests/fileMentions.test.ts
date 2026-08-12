/**
 * fileMentions 纯函数单元测试：@token 命中/未命中/去重。
 */
import { describe, expect, it } from "vitest";
import type { MentionFile } from "../src/renderer/fileMentions";
import { parseFileMentions, tokenMatchesFile } from "../src/renderer/fileMentions";

const FILES: [MentionFile, MentionFile, MentionFile, MentionFile] = [
  { path: "/ws/src/auth/login.ts", name: "login.ts", size: 120 },
  { path: "/ws/src/auth/token.ts", name: "token.ts", size: 340 },
  { path: "/ws/package.json", name: "package.json", size: 800 },
  { path: "/ws/设计稿.png", name: "设计稿.png", size: 1024 },
];

describe("tokenMatchesFile", () => {
  it("name 精确命中", () => {
    expect(tokenMatchesFile("login.ts", FILES[0])).toBe(true);
  });
  it("相对路径后缀命中", () => {
    expect(tokenMatchesFile("src/auth/login.ts", FILES[0])).toBe(true);
    expect(tokenMatchesFile("auth/login.ts", FILES[0])).toBe(true);
  });

  it("Windows 反斜杠路径命中", () => {
    const winFile = { path: "D:\\ws\\src\\auth\\login.ts", name: "login.ts", size: 120 };
    expect(tokenMatchesFile("auth/login.ts", winFile)).toBe(true);
    expect(tokenMatchesFile("auth\\login.ts", winFile)).toBe(true);
  });
  it("绝对路径相等命中", () => {
    expect(tokenMatchesFile("/ws/src/auth/login.ts", FILES[0])).toBe(true);
  });
  it("不匹配", () => {
    expect(tokenMatchesFile("login", FILES[0])).toBe(false);
    expect(tokenMatchesFile("other.ts", FILES[0])).toBe(false);
  });
});

describe("parseFileMentions", () => {
  it("剥离命中 token 并生成附件，文本变 clean", () => {
    const r = parseFileMentions("帮我看下 @src/auth/login.ts 的实现思路", FILES);
    expect(r.clean).toBe("帮我看下  的实现思路");
    expect(r.attachments).toEqual([{ name: "login.ts", path: "/ws/src/auth/login.ts", size: 120 }]);
  });

  it("未命中保留字面（@不存在 / @目录）", () => {
    const r = parseFileMentions("@不存在的文件 和 @src/auth 目录", FILES);
    expect(r.clean).toBe("@不存在的文件 和 @src/auth 目录");
    expect(r.attachments).toHaveLength(0);
  });

  it("多处命中按 path 去重", () => {
    const r = parseFileMentions("@login.ts @src/auth/login.ts @token.ts", FILES);
    expect(r.attachments).toHaveLength(2); // login.ts 两种写法只算一次
    expect(r.attachments.map((a) => a.name)).toEqual(["login.ts", "token.ts"]);
  });

  it("中文文件名命中", () => {
    const r = parseFileMentions("根据@设计稿.png 生成背景", FILES);
    expect(r.attachments).toHaveLength(1);
    expect(r.attachments[0]?.name).toBe("设计稿.png");
    expect(r.clean).toBe("根据 生成背景");
  });

  it("无 @ 时原样返回，无附件", () => {
    const r = parseFileMentions("普通消息", FILES);
    expect(r.clean).toBe("普通消息");
    expect(r.attachments).toHaveLength(0);
  });
});
