/**
 * 专家·技能·连接器 stores 单元测试。
 * 覆盖：expertStore（内置+自定义+映射）、teamStore、skillStore（种子/frontmatter/卸载）、
 * connectorStore（种子/测试连接各态）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentConfig } from "../src/main/agentConfigStore";
import { ConnectorStore } from "../src/main/connectorStore";
import { ExpertStore, expertToAgentConfig } from "../src/main/expertStore";
import { buildSkillMd, parseSkillFrontmatter, SkillStore } from "../src/main/skillStore";
import { TeamStore } from "../src/main/teamStore";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "eb-expert-center-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ── expertStore ────────────────────────────────

describe("ExpertStore", () => {
  it("list 返回内置在前 + 自定义在后", () => {
    const store = new ExpertStore(path.join(dir, "experts.json"));
    const all = store.list();
    expect(all[0].id).toBe("daily");
    expect(all[1].id).toBe("coding");
    expect(all.every((e) => e.source === "builtin")).toBe(true);
  });

  it("create 生成 custom 专家并默认 icon/tags", () => {
    const store = new ExpertStore(path.join(dir, "experts.json"));
    const e = store.create({ name: "产品经理", description: "需求拆解", tags: ["domain:product"] });
    expect(e.source).toBe("custom");
    expect(e.icon).toBe("briefcase");
    expect(e.mode).toBe("daily");
    expect(store.list()).toHaveLength(3);
    expect(store.list()[2].id).toBe(e.id);
  });

  it("update 合并字段并 bump updatedAt", () => {
    const store = new ExpertStore(path.join(dir, "experts.json"));
    const e = store.create({ name: "前端专家" });
    const updated = store.update({ id: e.id, description: "性能优化", tags: ["domain:frontend"] });
    expect(updated?.description).toBe("性能优化");
    expect(updated?.tags).toEqual(["domain:frontend"]);
    expect(updated?.name).toBe("前端专家");
    expect(updated ? updated.updatedAt >= e.updatedAt : false).toBe(true);
  });

  it("内置专家 update 写 override（名称/图标/mode 锁定），list/getBuiltinMerged 返回合并结果", () => {
    const store = new ExpertStore(path.join(dir, "experts.json"));
    const updated = store.update({
      id: "daily",
      systemPrompt: "自定义提示词",
      tools: ["understand_image"],
      name: "改名无效",
    });
    expect(updated?.systemPrompt).toBe("自定义提示词");
    expect(updated?.name).toBe("办公助理"); // 名称锁定
    expect(updated?.mode).toBe("daily"); // mode 锁定
    expect(store.getBuiltinMerged("daily")?.systemPrompt).toBe("自定义提示词");
    expect(store.list().find((e) => e.id === "daily")?.tools).toEqual(["understand_image"]);
  });

  it("内置专家 systemPrompt 空串 = 清除覆盖", () => {
    const store = new ExpertStore(path.join(dir, "experts.json"));
    store.update({ id: "daily", systemPrompt: "x" });
    expect(store.getBuiltinMerged("daily")?.systemPrompt).toBe("x");
    const after = store.update({ id: "daily", systemPrompt: "" });
    expect(after?.systemPrompt).toBeUndefined();
    expect(store.getBuiltinMerged("daily")?.systemPrompt).toBeUndefined();
  });

  it("reset 删除内置 override 回退默认；非内置抛错", () => {
    const store = new ExpertStore(path.join(dir, "experts.json"));
    store.update({ id: "coding", description: "改描述" });
    expect(store.getBuiltinMerged("coding")?.description).toBe("改描述");
    const fresh = store.reset("coding");
    expect(fresh.description).toBe("读取与修改代码、执行命令、完成开发任务");
    expect(store.getBuiltinMerged("coding")?.description).toBe("读取与修改代码、执行命令、完成开发任务");
    const custom = store.create({ name: "自定义" });
    expect(() => store.reset(custom.id)).toThrow(/内置专家/);
  });

  it("内置专家 delete 仍抛错", () => {
    const store = new ExpertStore(path.join(dir, "experts.json"));
    expect(() => store.delete("coding")).toThrow(/内置专家/);
  });

  it("delete 仅移除自定义", () => {
    const store = new ExpertStore(path.join(dir, "experts.json"));
    const e = store.create({ name: "测试" });
    store.delete(e.id);
    expect(store.list().some((x) => x.id === e.id)).toBe(false);
  });

  it("expertToAgentConfig 覆盖叠加、保留基础 tools", () => {
    const base: AgentConfig = { tools: ["bash"], defaultModelProviderId: "base" };
    const cfg = expertToAgentConfig(
      {
        id: "x",
        name: "x",
        icon: "code",
        description: "",
        mode: "coding",
        tools: ["understand_image"],
        extensions: ["plan-mode"],
        defaultModelProviderId: "override",
        tags: [],
        source: "custom",
        createdAt: "",
        updatedAt: "",
      },
      base,
    );
    expect(cfg.tools).toEqual(["bash", "understand_image"]);
    expect(cfg.defaultModelProviderId).toBe("override");
    expect(base.defaultModelProviderId).toBe("base"); // 不改动 base
  });
});

// ── teamStore ──────────────────────────────────

describe("TeamStore", () => {
  it("create 默认 routingStrategy=manual，update/delete 正常", () => {
    const store = new TeamStore(path.join(dir, "teams.json"));
    const t = store.create({ name: "研发团", expertIds: ["daily"] });
    expect(t.routingStrategy).toBe("manual");
    expect(t.icon).toBe("users");
    const updated = store.update({ id: t.id, description: "全链路" });
    expect(updated?.description).toBe("全链路");
    store.delete(t.id);
    expect(store.list()).toHaveLength(0);
  });
});

// ── skillStore ─────────────────────────────────

describe("SkillStore", () => {
  function make() {
    const skillsDir = path.join(dir, "skills");
    mkdirSync(skillsDir, { recursive: true });
    return new SkillStore(path.join(dir, "skills.json"), skillsDir);
  }

  it("首次加载种子示例技能（source=installed，同普通已安装技能）", () => {
    const store = make();
    const seeded = store.list().filter((s) => s.source === "installed");
    expect(seeded.map((s) => s.name)).toEqual(
      expect.arrayContaining(["prd-writer", "meeting-notes", "commit-helper"]),
    );
    expect(seeded.every((s) => s.enabled)).toBe(true);
  });

  it("seeded 标记持久化：卸载全部种子后不重新种子", () => {
    const store = make();
    for (const s of store.list().filter((x) => x.source === "installed")) {
      store.uninstall(s.id); // installed 可删除
    }
    expect(store.list().filter((x) => x.source === "installed")).toHaveLength(0);
    // 重新实例化（同一 registry 文件）不再种子
    const store2 = make();
    expect(store2.list().filter((x) => x.source === "installed")).toHaveLength(0);
  });

  it("迁移旧注册表 builtin → installed（「已安装」筛选不再为空）", () => {
    const reg = path.join(dir, "skills.json");
    const skillsDir = path.join(dir, "skills");
    mkdirSync(skillsDir, { recursive: true });
    // 模拟旧注册表：source=builtin + seeded=true
    writeFileSync(
      reg,
      JSON.stringify({
        skills: [{ id: "old-skill", source: "builtin", enabled: true, installedAt: "x" }],
        seeded: true,
      }),
      "utf-8",
    );
    const d = path.join(skillsDir, "old-skill");
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, "SKILL.md"), buildSkillMd("old-skill", "旧技能", "# x"), "utf-8");
    const store = new SkillStore(reg, skillsDir);
    expect(store.list().find((s) => s.id === "old-skill")?.source).toBe("installed");
    const saved = JSON.parse(readFileSync(reg, "utf-8")) as { skills: Array<{ source: string }> };
    expect(saved.skills[0].source).toBe("installed"); // 已持久化
  });

  it("自动发现 skills 目录下未注册的技能文件夹（作为已安装加载）", () => {
    const store = make();
    const manual = path.join(dir, "skills", "manual-skill");
    mkdirSync(manual, { recursive: true });
    writeFileSync(
      path.join(manual, "SKILL.md"),
      buildSkillMd("manual-skill", "手动放入", "# body"),
      "utf-8",
    );
    const hit = store.list().find((s) => s.id === "manual-skill");
    expect(hit?.source).toBe("installed");
    expect(hit?.enabled).toBe(true);
    // 也进入 listEnabled（运行时 skillsOverride 注入源）
    expect(store.listEnabled().some((s) => s.id === "manual-skill")).toBe(true);
  });

  it("parseSkillFrontmatter / buildSkillMd 往返", () => {
    const md = buildSkillMd("demo", "描述", "# 正文\n\n内容");
    const fm = parseSkillFrontmatter(md);
    expect(fm.name).toBe("demo");
    expect(fm.description).toBe("描述");
    expect(fm.body).toContain("# 正文");
  });

  it("create 写 SKILL.md + 注册 custom", () => {
    const store = make();
    const s = store.create({ name: "my-skill", description: "我的技能", content: "# x" });
    expect(s.source).toBe("custom");
    expect(s.enabled).toBe(true);
    expect(path.basename(s.baseDir)).toBe("my-skill");
    expect(store.list().find((x) => x.id === "my-skill")?.description).toBe("我的技能");
  });

  it("enable/disable 切换；listEnabled 只含 enabled", () => {
    const store = make();
    store.enable("prd-writer", false);
    expect(store.listEnabled().some((s) => s.id === "prd-writer")).toBe(false);
    store.enable("prd-writer", true);
    expect(store.listEnabled().some((s) => s.id === "prd-writer")).toBe(true);
  });

  it("uninstall 删除文件 + 注册项（种子已是 installed，可整体卸载）", () => {
    const store = make();
    store.uninstall("prd-writer");
    expect(store.list().some((s) => s.id === "prd-writer")).toBe(false);
    expect(existsSync(path.join(dir, "skills", "prd-writer"))).toBe(false);
    const custom = store.create({ name: "tmp-x", description: "d", content: "c" });
    store.uninstall("tmp-x");
    expect(store.list().some((s) => s.id === "tmp-x")).toBe(false);
    expect(existsSync(path.join(dir, "skills", custom.name))).toBe(false);
  });

  it("install 本地技能包", () => {
    const store = make();
    const pkgDir = path.join(dir, "pkg");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      path.join(pkgDir, "SKILL.md"),
      buildSkillMd("installed-skill", "外部包", "# body"),
      "utf-8",
    );
    const s = store.install(pkgDir);
    expect(s.source).toBe("installed");
    expect(s.name).toBe("installed-skill");
  });
});

// ── connectorStore ─────────────────────────────

describe("ConnectorStore", () => {
  function make() {
    return new ConnectorStore(path.join(dir, "connectors.json"));
  }

  it("首次加载种子 GitHub MCP 示例（reserved + enabled=false）", () => {
    const store = make();
    const seeded = store.get("github-mcp");
    expect(seeded?.type).toBe("mcp");
    expect(seeded?.status).toBe("reserved");
    expect(seeded?.enabled).toBe(false);
  });

  it("create 默认 reserved + 能力提示；update 可改 status/lastTools", () => {
    const store = make();
    const c = store.create({ name: "文件", type: "filesystem" });
    expect(c.status).toBe("reserved");
    expect(c.capabilities).toContain("context");
    const updated = store.update({
      id: c.id,
      status: "connected",
      enabled: true,
      lastTools: ["read_file", "write_file"],
    });
    expect(updated?.status).toBe("connected");
    expect(updated?.lastTools).toEqual(["read_file", "write_file"]);
  });

  it("test reserved 类型返回待激活提示", async () => {
    const store = make();
    const c = store.create({ name: "知识库", type: "http-api" });
    const r = await store.test({ id: c.id });
    expect(r.status).toBe("reserved");
    expect(r.message).toContain("待激活");
  });

  it("test mcp 缺 command 报错（不拉起进程）", async () => {
    const store = make();
    const c = store.create({ name: "mcp", type: "mcp", config: {} });
    const r = await store.test({ id: c.id });
    expect(r.status).toBe("error");
    expect(r.message).toContain("command");
  });

  it("test filesystem 按 rootDir 判定", async () => {
    const store = make();
    const missing = store.create({ name: "fs1", type: "filesystem", config: {} });
    const r1 = await store.test({ id: missing.id });
    expect(r1.status).toBe("disconnected");

    const bad = store.create({
      name: "fs2",
      type: "filesystem",
      config: { rootDir: path.join(dir, "nope") },
    });
    const r2 = await store.test({ id: bad.id });
    expect(r2.status).toBe("error");

    const ok = store.create({ name: "fs3", type: "filesystem", config: { rootDir: dir } });
    const r3 = await store.test({ id: ok.id });
    expect(r3.status).toBe("connected");
  });

  it("delete 移除", () => {
    const store = make();
    const c = store.create({ name: "x", type: "custom" });
    store.delete(c.id);
    expect(store.get(c.id)).toBeUndefined();
  });
});
