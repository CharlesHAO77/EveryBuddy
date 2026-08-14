/**
 * IPC 契约 Zod schema 单元测试（见 AGENTS.md §7.2）。
 * 锁住主进程对渲染进程输入的校验行为——任何未来的 IPC 消费者（主进程、IM Bot、WebUI）都依赖这些 schema。
 */
import { describe, expect, it } from "vitest";
import {
  attachmentRefSchema,
  branchRequestSchema,
  connectorCreateRequestSchema,
  connectorTestRequestSchema,
  connectorUpdateRequestSchema,
  createNamedWorkspaceRequestSchema,
  createScheduleTaskRequestSchema,
  createTaskRequestSchema,
  createWorkspaceRequestSchema,
  expertCreateRequestSchema,
  expertUpdateRequestSchema,
  idRequestSchema,
  modelTypeSchema,
  openPathRequestSchema,
  promptRequestSchema,
  readDirRequestSchema,
  renameTaskRequestSchema,
  saveModelRequestSchema,
  scheduleIdRequestSchema,
  skillCreateRequestSchema,
  skillEnableRequestSchema,
  teamCreateRequestSchema,
  updateScheduleTaskRequestSchema,
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

describe("readDirRequestSchema", () => {
  it("accepts path", () => {
    expect(readDirRequestSchema.safeParse({ path: "/tmp/x" }).success).toBe(true);
  });
  it("rejects empty path", () => {
    expect(readDirRequestSchema.safeParse({ path: "" }).success).toBe(false);
  });
  it("rejects missing path", () => {
    expect(readDirRequestSchema.safeParse({}).success).toBe(false);
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

describe("branchRequestSchema", () => {
  it("accepts taskId + entryId", () => {
    expect(branchRequestSchema.safeParse({ taskId: "t", entryId: "e" }).success).toBe(true);
  });
  it("rejects missing entryId", () => {
    expect(branchRequestSchema.safeParse({ taskId: "t" }).success).toBe(false);
  });
  it("rejects empty entryId", () => {
    expect(branchRequestSchema.safeParse({ taskId: "t", entryId: "" }).success).toBe(false);
  });
  it("rejects missing taskId", () => {
    expect(branchRequestSchema.safeParse({ entryId: "e" }).success).toBe(false);
  });
});

describe("createScheduleTaskRequestSchema", () => {
  const validCron = {
    title: "日报",
    prompt: "总结今日工作",
    spec: { type: "cron", cron: "0 9 * * *" },
  };

  it("accepts title + prompt + cron spec", () => {
    expect(createScheduleTaskRequestSchema.safeParse(validCron).success).toBe(true);
  });
  it("accepts once spec", () => {
    expect(
      createScheduleTaskRequestSchema.safeParse({
        ...validCron,
        spec: { type: "once", runAt: "2026-08-13T07:20:00.000Z" },
      }).success,
    ).toBe(true);
  });
  it("defaults mode to daily and notify to true", () => {
    const result = createScheduleTaskRequestSchema.safeParse(validCron);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe("daily");
      expect(result.data.notify).toBe(true);
    }
  });
  it("rejects empty title", () => {
    expect(createScheduleTaskRequestSchema.safeParse({ ...validCron, title: "" }).success).toBe(
      false,
    );
  });
  it("rejects empty prompt", () => {
    expect(createScheduleTaskRequestSchema.safeParse({ ...validCron, prompt: "" }).success).toBe(
      false,
    );
  });
  it("rejects invalid spec type (not cron/once)", () => {
    expect(
      createScheduleTaskRequestSchema.safeParse({ ...validCron, spec: { type: "bogus" } }).success,
    ).toBe(false);
  });
  it("rejects cron spec with empty cron", () => {
    expect(
      createScheduleTaskRequestSchema.safeParse({ ...validCron, spec: { type: "cron", cron: "" } })
        .success,
    ).toBe(false);
  });
  it("rejects invalid mode", () => {
    expect(createScheduleTaskRequestSchema.safeParse({ ...validCron, mode: "bogus" }).success).toBe(
      false,
    );
  });
});

describe("updateScheduleTaskRequestSchema", () => {
  it("accepts id + partial fields", () => {
    expect(
      updateScheduleTaskRequestSchema.safeParse({ id: "a", enabled: false, notify: true }).success,
    ).toBe(true);
  });
  it("accepts id only", () => {
    expect(updateScheduleTaskRequestSchema.safeParse({ id: "a" }).success).toBe(true);
  });
  it("rejects missing id", () => {
    expect(updateScheduleTaskRequestSchema.safeParse({ title: "x" }).success).toBe(false);
  });
  it("rejects empty title when provided", () => {
    expect(updateScheduleTaskRequestSchema.safeParse({ id: "a", title: "" }).success).toBe(false);
  });
});

describe("scheduleIdRequestSchema", () => {
  it("accepts non-empty id", () => {
    expect(scheduleIdRequestSchema.safeParse({ id: "a" }).success).toBe(true);
  });
  it("rejects empty id", () => {
    expect(scheduleIdRequestSchema.safeParse({ id: "" }).success).toBe(false);
  });
  it("rejects missing id", () => {
    expect(scheduleIdRequestSchema.safeParse({}).success).toBe(false);
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

describe("expertCreateRequestSchema", () => {
  const valid = {
    name: "产品经理",
    description: "需求拆解",
    mode: "daily",
    tags: ["domain:product"],
  };
  it("accepts minimal name + defaults", () => {
    const r = expertCreateRequestSchema.safeParse({ name: "产品经理" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.mode).toBe("daily");
      expect(r.data.icon).toBe("briefcase");
      expect(r.data.tags).toEqual([]);
    }
  });
  it("accepts full fields", () => {
    expect(expertCreateRequestSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects empty name", () => {
    expect(expertCreateRequestSchema.safeParse({ name: "" }).success).toBe(false);
  });
  it("rejects invalid mode", () => {
    expect(expertCreateRequestSchema.safeParse({ ...valid, mode: "bogus" }).success).toBe(false);
  });
});

describe("expertUpdateRequestSchema", () => {
  it("accepts id only", () => {
    expect(expertUpdateRequestSchema.safeParse({ id: "a" }).success).toBe(true);
  });
  it("accepts null model overrides (clear to fallback)", () => {
    expect(
      expertUpdateRequestSchema.safeParse({ id: "a", defaultModelProviderId: null }).success,
    ).toBe(true);
  });
  it("rejects missing id", () => {
    expect(expertUpdateRequestSchema.safeParse({ name: "x" }).success).toBe(false);
  });
});

describe("teamCreateRequestSchema", () => {
  it("accepts minimal + defaults routing to manual", () => {
    const r = teamCreateRequestSchema.safeParse({ name: "研发团" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.routingStrategy).toBe("manual");
  });
  it("rejects reserved strategy only via enum (auto accepted now, runtime gated)", () => {
    expect(
      teamCreateRequestSchema.safeParse({ name: "t", routingStrategy: "workflow" }).success,
    ).toBe(true);
  });
  it("rejects empty name", () => {
    expect(teamCreateRequestSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("skillCreateRequestSchema", () => {
  const valid = { name: "prd-writer", description: "写 PRD", content: "# 正文" };
  it("accepts valid kebab name", () => {
    expect(skillCreateRequestSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects uppercase name", () => {
    expect(skillCreateRequestSchema.safeParse({ ...valid, name: "PRD" }).success).toBe(false);
  });
  it("rejects empty description / content", () => {
    expect(skillCreateRequestSchema.safeParse({ ...valid, description: "" }).success).toBe(false);
    expect(skillCreateRequestSchema.safeParse({ ...valid, content: "" }).success).toBe(false);
  });
});

describe("skillEnableRequestSchema", () => {
  it("accepts id + boolean", () => {
    expect(skillEnableRequestSchema.safeParse({ id: "a", enabled: false }).success).toBe(true);
  });
  it("rejects non-boolean enabled", () => {
    expect(skillEnableRequestSchema.safeParse({ id: "a", enabled: "yes" }).success).toBe(false);
  });
});

describe("connectorCreateRequestSchema", () => {
  it("accepts mcp type + config + defaults", () => {
    const r = connectorCreateRequestSchema.safeParse({
      name: "GitHub MCP",
      type: "mcp",
      config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.icon).toBe("hub");
      expect(r.data.capabilities).toEqual([]);
      expect(r.data.type).toBe("mcp");
    }
  });
  it("accepts reserved type (open enum)", () => {
    expect(connectorCreateRequestSchema.safeParse({ name: "x", type: "custom" }).success).toBe(
      true,
    );
  });
  it("rejects invalid type", () => {
    expect(connectorCreateRequestSchema.safeParse({ name: "x", type: "bogus" }).success).toBe(
      false,
    );
  });
});

describe("connectorUpdateRequestSchema", () => {
  it("accepts id + partial status", () => {
    expect(
      connectorUpdateRequestSchema.safeParse({ id: "a", status: "reserved", enabled: false })
        .success,
    ).toBe(true);
  });
  it("rejects invalid status", () => {
    expect(connectorUpdateRequestSchema.safeParse({ id: "a", status: "bogus" }).success).toBe(
      false,
    );
  });
});

describe("connectorTestRequestSchema", () => {
  it("accepts id", () => {
    expect(connectorTestRequestSchema.safeParse({ id: "a" }).success).toBe(true);
  });
  it("rejects missing id", () => {
    expect(connectorTestRequestSchema.safeParse({}).success).toBe(false);
  });
});
