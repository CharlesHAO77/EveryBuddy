/**
 * IPC 契约 Zod schema 单元测试（见 AGENTS.md §7.2）。
 * 锁住主进程对渲染进程输入的校验行为——任何未来的 IPC 消费者（主进程、IM Bot、WebUI）都依赖这些 schema。
 */
import { describe, expect, it } from "vitest";
import {
  attachmentRefSchema,
  createNamedWorkspaceRequestSchema,
  createTaskRequestSchema,
  createWorkspaceRequestSchema,
  idRequestSchema,
  modelTypeSchema,
  openPathRequestSchema,
  promptRequestSchema,
  renameTaskRequestSchema,
  saveModelRequestSchema,
} from "./index";

describe("renameTaskRequestSchema", () => {
  it("accepts id + title", () => {
    expect(renameTaskRequestSchema.safeParse({ id: "a", title: "t" }).success).toBe(true);
  });
  it("rejects empty title (parity with old !parsed.title check)", () => {
    expect(renameTaskRequestSchema.safeParse({ id: "a", title: "" }).success).toBe(false);
  });
  it("rejects missing id", () => {
    expect(renameTaskRequestSchema.safeParse({ title: "t" }).success).toBe(false);
  });
  it("rejects non-string title", () => {
    expect(renameTaskRequestSchema.safeParse({ id: "a", title: 123 }).success).toBe(false);
  });
});

describe("createWorkspaceRequestSchema", () => {
  it("accepts name + dirPath", () => {
    expect(createWorkspaceRequestSchema.safeParse({ name: "n", dirPath: "/tmp/x" }).success).toBe(
      true,
    );
  });
  it("rejects empty name", () => {
    expect(createWorkspaceRequestSchema.safeParse({ name: "", dirPath: "/tmp/x" }).success).toBe(
      false,
    );
  });
  it("rejects missing dirPath", () => {
    expect(createWorkspaceRequestSchema.safeParse({ name: "n" }).success).toBe(false);
  });
});

describe("createNamedWorkspaceRequestSchema", () => {
  it("accepts name", () => {
    expect(createNamedWorkspaceRequestSchema.safeParse({ name: "n" }).success).toBe(true);
  });
  it("rejects empty name", () => {
    expect(createNamedWorkspaceRequestSchema.safeParse({ name: "" }).success).toBe(false);
  });
  it("rejects missing name", () => {
    expect(createNamedWorkspaceRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("openPathRequestSchema", () => {
  it("accepts path", () => {
    expect(openPathRequestSchema.safeParse({ path: "/tmp/x" }).success).toBe(true);
  });
  it("rejects empty path", () => {
    expect(openPathRequestSchema.safeParse({ path: "" }).success).toBe(false);
  });
  it("rejects missing path", () => {
    expect(openPathRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("回归：既有 schema", () => {
  it("idRequestSchema accepts non-empty id", () => {
    expect(idRequestSchema.safeParse({ id: "a" }).success).toBe(true);
  });
  it("idRequestSchema rejects empty id", () => {
    expect(idRequestSchema.safeParse({ id: "" }).success).toBe(false);
  });
  it("createTaskRequestSchema accepts temp task", () => {
    expect(createTaskRequestSchema.safeParse({ type: "temp" }).success).toBe(true);
  });
  it("createTaskRequestSchema rejects invalid type", () => {
    expect(createTaskRequestSchema.safeParse({ type: "bogus" }).success).toBe(false);
  });
  it("promptRequestSchema accepts sessionId + text", () => {
    expect(promptRequestSchema.safeParse({ sessionId: "a", text: "hi" }).success).toBe(true);
  });
  it("promptRequestSchema rejects empty text without attachments", () => {
    expect(promptRequestSchema.safeParse({ sessionId: "a", text: "" }).success).toBe(false);
  });
  it("promptRequestSchema accepts empty text with attachments", () => {
    expect(
      promptRequestSchema.safeParse({
        sessionId: "a",
        text: "",
        attachments: [{ name: "a.txt", path: "/tmp/a.txt", size: 1 }],
      }).success,
    ).toBe(true);
  });
  it("promptRequestSchema rejects text+attachments both empty", () => {
    expect(
      promptRequestSchema.safeParse({ sessionId: "a", text: "", attachments: [] }).success,
    ).toBe(false);
  });
});

describe("saveModelRequestSchema", () => {
  const valid = {
    id: "a",
    name: "n",
    baseUrl: "https://x.example",
    model: "m",
    isOpenAiCompatible: true,
  };

  it("accepts valid request with type", () => {
    expect(saveModelRequestSchema.safeParse({ ...valid, type: "vlm" }).success).toBe(true);
  });

  it("modelTypeSchema accepts all three types", () => {
    for (const type of ["llm", "vlm", "image"]) {
      expect(modelTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it("rejects missing type", () => {
    expect(saveModelRequestSchema.safeParse(valid).success).toBe(false);
  });

  it("rejects invalid type", () => {
    expect(saveModelRequestSchema.safeParse({ ...valid, type: "bogus" }).success).toBe(false);
  });

  it("strips unknown capabilities key (旧渲染进程载荷兼容)", () => {
    const result = saveModelRequestSchema.safeParse({
      ...valid,
      type: "llm",
      capabilities: { vision: true, imageGen: false },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("capabilities");
    }
  });
});

describe("attachmentRefSchema", () => {
  it("accepts valid attachment", () => {
    expect(
      attachmentRefSchema.safeParse({ name: "a.pdf", path: "/tmp/a.pdf", size: 10 }).success,
    ).toBe(true);
  });
  it("accepts mimeType", () => {
    expect(
      attachmentRefSchema.safeParse({
        name: "a.png",
        path: "/tmp/a.png",
        size: 10,
        mimeType: "image/png",
      }).success,
    ).toBe(true);
  });
  it("rejects empty name", () => {
    expect(attachmentRefSchema.safeParse({ name: "", path: "/tmp/a", size: 1 }).success).toBe(
      false,
    );
  });
  it("rejects empty path", () => {
    expect(attachmentRefSchema.safeParse({ name: "a", path: "", size: 1 }).success).toBe(false);
  });
  it("rejects negative size", () => {
    expect(attachmentRefSchema.safeParse({ name: "a", path: "/tmp/a", size: -1 }).success).toBe(
      false,
    );
  });
});
