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
import { buildExpertIdentityPrompt } from "../src/main/expertPrompt";
import { ExpertStore, expertToAgentConfig } from "../src/main/expertStore";
import { buildSkillMd, parseSkillFrontmatter, SkillStore } from "../src/main/skillStore";
import { BUILTIN_TEAMS, TeamStore } from "../src/main/teamStore";

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
    // 内置示例 3 个（办公/编码/项目协调员）+ 自定义 1 个
    expect(store.list()).toHaveLength(4);
    expect(store.list()[3].id).toBe(e.id);
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
    expect(store.getBuiltinMerged("coding")?.description).toBe(
      "读取与修改代码、执行命令、完成开发任务",
    );
    const custom = store.create({ name: "自定义" });
    expect(() => store.reset(custom.id)).toThrow(/errors\.expertResetBuiltinOnly/);
  });

  it("内置专家 delete 仍抛错", () => {
    const store = new ExpertStore(path.join(dir, "experts.json"));
    expect(() => store.delete("coding")).toThrow(/errors\.expertDeleteBuiltinOnly/);
  });

  it("delete 仅移除自定义", () => {
    const store = new ExpertStore(path.join(dir, "experts.json"));
    const e = store.create({ name: "测试" });
    store.delete(e.id);
    expect(store.list().some((x) => x.id === e.id)).toBe(false);
  });

  it("expertToAgentConfig 自定义专家显式工具集为权威（不再叠加 base）", () => {
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
    expect(cfg.tools).toEqual(["understand_image"]); // 权威集，不并入 base.tools
    expect(cfg.restrictTools).toBe(true);
    expect(cfg.defaultModelProviderId).toBe("override");
    expect(base.defaultModelProviderId).toBe("base"); // 不改动 base
  });

  it("expertToAgentConfig 自定义专家未选工具 → 精简集（空 tools + restrictTools + 空扩展）", () => {
    const cfg = expertToAgentConfig(
      {
        id: "x",
        name: "x",
        icon: "briefcase",
        description: "",
        mode: "daily",
        tools: [],
        extensions: [],
        tags: [],
        source: "custom",
        createdAt: "",
        updatedAt: "",
      },
      {},
    );
    expect(cfg.tools).toEqual([]);
    expect(cfg.restrictTools).toBe(true);
    // 扩展同样权威：空 = 不加载 plan-mode/todo，避免其注册 todo 工具
    expect(cfg.extensions).toEqual([]);
  });

  it("expertToAgentConfig 自定义专家 extensions 权威（空=不回落模式默认扩展）", () => {
    const cfg = expertToAgentConfig(
      {
        id: "x",
        name: "x",
        icon: "briefcase",
        description: "",
        mode: "daily",
        extensions: [],
        tags: [],
        source: "custom",
        createdAt: "",
        updatedAt: "",
      },
      { extensions: ["plan-mode"] }, // base 模式默认，不应被采用
    );
    expect(cfg.extensions).toEqual([]);
  });

  it("expertToAgentConfig 内置专家保持追加语义、不限定工具", () => {
    const cfg = expertToAgentConfig(
      {
        id: "daily",
        name: "办公助理",
        icon: "briefcase",
        description: "",
        mode: "daily",
        tools: ["understand_image"],
        tags: [],
        source: "builtin",
        createdAt: "",
        updatedAt: "",
      },
      { tools: ["bash"] },
    );
    expect(cfg.tools).toEqual(["bash", "understand_image"]);
    expect(cfg.restrictTools).toBeUndefined();
  });

  it("create 空 systemPrompt 自动生成人格提示词；显式填写则保留", () => {
    const store = new ExpertStore(path.join(dir, "experts.json"));
    const auto = store.create({ name: "产品经理", description: "需求拆解" });
    expect(auto.systemPrompt).toBe(buildExpertIdentityPrompt("产品经理", "需求拆解"));
    expect(auto.systemPrompt).toContain("「产品经理」");
    const explicit = store.create({ name: "定制", systemPrompt: "自定义内容" });
    expect(explicit.systemPrompt).toBe("自定义内容");
    const blank = store.create({ name: "空白", systemPrompt: "   " });
    expect(blank.systemPrompt).toContain("「空白」"); // 纯空白 → 自动生成
  });

  it("buildExpertIdentityPrompt 确定性、含名称/描述、无描述也非空", () => {
    const a = buildExpertIdentityPrompt("翻译助手", "中英互译");
    expect(a).toBe(buildExpertIdentityPrompt("翻译助手", "中英互译"));
    expect(a).toContain("翻译助手");
    expect(a).toContain("中英互译");
    expect(buildExpertIdentityPrompt("极简").trim().length).toBeGreaterThan(0);
  });

  it("update 改名且提示词仍为自动 → 重新生成", () => {
    const store = new ExpertStore(path.join(dir, "experts.json"));
    const e = store.create({ name: "旧名", description: "定位" });
    const updated = store.update({ id: e.id, name: "新名" });
    expect(updated?.systemPrompt).toBe(buildExpertIdentityPrompt("新名", "定位"));
  });

  it("update 改名但提示词被用户编辑过 → 不重新生成", () => {
    const store = new ExpertStore(path.join(dir, "experts.json"));
    const e = store.create({ name: "旧名", description: "定位" });
    store.update({ id: e.id, systemPrompt: "手工内容" });
    const renamed = store.update({ id: e.id, name: "新名" });
    expect(renamed?.systemPrompt).toBe("手工内容");
  });

  it("update 仅改描述且提示词仍为自动 → 重新生成", () => {
    const store = new ExpertStore(path.join(dir, "experts.json"));
    const e = store.create({ name: "专家", description: "旧定位" });
    const updated = store.update({ id: e.id, description: "新定位" });
    expect(updated?.systemPrompt).toContain("新定位");
  });

  it("update 无名称/描述变更 → 提示词不动", () => {
    const store = new ExpertStore(path.join(dir, "experts.json"));
    const e = store.create({ name: "专家", description: "定位" });
    const before = e.systemPrompt;
    const updated = store.update({ id: e.id, tags: ["x"] });
    expect(updated?.systemPrompt).toBe(before);
  });

  it("update 旧版空提示词自定义专家改名 → 补齐人格（legacy backfill）", () => {
    const file = path.join(dir, "experts.json");
    writeFileSync(
      file,
      JSON.stringify({
        experts: [
          {
            id: "legacy",
            name: "旧专家",
            mode: "daily",
            source: "custom",
            tags: [],
            createdAt: "",
            updatedAt: "",
          },
        ],
        overrides: {},
      }),
    );
    const s2 = new ExpertStore(file);
    const updated = s2.update({ id: "legacy", name: "新专家" });
    expect(updated?.systemPrompt).toContain("新专家");
  });

  it("update 内置专家不受影响（不生成身份提示词）", () => {
    const store = new ExpertStore(path.join(dir, "experts.json"));
    store.update({ id: "daily", description: "新描述" });
    expect(store.getBuiltinMerged("daily")?.systemPrompt).toBeUndefined();
  });
});

// ── teamStore ──────────────────────────────────

describe("TeamStore", () => {
  it("create 默认 routingStrategy=manual source=custom；list 合并内置示例团队", () => {
    const store = new TeamStore(path.join(dir, "teams.json"));
    // 无自定义时 list 返回 2 个内置示例（auto 调度 + workflow 编排）
    expect(store.list()).toHaveLength(BUILTIN_TEAMS.length);
    const t = store.create({ name: "研发团", expertIds: ["daily"] });
    expect(t.routingStrategy).toBe("manual");
    expect(t.source).toBe("custom");
    expect(store.list()).toHaveLength(BUILTIN_TEAMS.length + 1);
    expect(store.listCustom()).toHaveLength(1);
  });

  it("内置示例团队只读；update/delete 抛错，可复制为自定义", () => {
    const store = new TeamStore(path.join(dir, "teams.json"));
    const builtin = BUILTIN_TEAMS[0];
    expect(store.isBuiltin(builtin.id)).toBe(true);
    expect(() => store.update({ id: builtin.id, description: "x" })).toThrow();
    expect(() => store.delete(builtin.id)).toThrow();
    const copy = store.duplicateAsCustom(builtin.id);
    expect(copy.id).not.toBe(builtin.id);
    expect(copy.source).toBe("custom");
    expect(copy.routingStrategy).toBe(builtin.routingStrategy);
  });

  it("内置 workflow 示例团队携带完整 workflow 字面量", () => {
    const store = new TeamStore(path.join(dir, "teams.json"));
    const wfTeam = store.get("team-example-workflow");
    expect(wfTeam?.routingStrategy).toBe("workflow");
    expect(wfTeam?.workflow?.steps.length).toBeGreaterThan(0);
  });

  it("自定义团队 update/delete 正常", () => {
    const store = new TeamStore(path.join(dir, "teams.json"));
    const t = store.create({ name: "研发团", expertIds: ["daily"] });
    const updated = store.update({ id: t.id, description: "全链路" });
    expect(updated?.description).toBe("全链路");
    store.delete(t.id);
    expect(store.list()).toHaveLength(BUILTIN_TEAMS.length);
  });

  it("auto 团队 create/update 透传主 agent 与角色", () => {
    const store = new TeamStore(path.join(dir, "teams.json"));
    const t = store.create({
      name: "调度团",
      routingStrategy: "auto",
      leadExpertId: "project-coordinator",
      expertIds: ["daily", "coding"],
      roles: { "project-coordinator": "协调者", daily: "办公执行", coding: "编码执行" },
    });
    expect(t.leadExpertId).toBe("project-coordinator");
    expect(t.roles?.daily).toBe("办公执行");
    const updated = store.update({ id: t.id, leadExpertId: null, roles: null });
    expect(updated?.leadExpertId).toBeUndefined();
    expect(updated?.roles).toBeUndefined();
  });

  it("内置 auto 示例团队含主 agent + 角色，计数=成员+主 agent", () => {
    const store = new TeamStore(path.join(dir, "teams.json"));
    const dispatcher = store.get("team-example-dispatcher");
    expect(dispatcher?.leadExpertId).toBe("project-coordinator");
    expect(dispatcher?.roles?.["project-coordinator"]).toBe("协调者");
    // 团队人数 = 成员 2 + 主 agent 1 = 3
    expect((dispatcher?.expertIds.length ?? 0) + (dispatcher?.leadExpertId ? 1 : 0)).toBe(3);
  });

  it("workflow（含 conditional）create/update 往返 + layout 持久化 + 清除", () => {
    const store = new TeamStore(path.join(dir, "teams.json"));
    const wf = {
      id: "wf-1",
      name: "门禁流程",
      steps: [
        { kind: "serial", id: "analysis", expertId: "daily", prompt: "分析 {user}" },
        {
          kind: "conditional",
          id: "gate",
          logic: "and",
          rules: [{ var: "analysis", op: "contains", value: "通过" }],
          thenSteps: [{ kind: "serial", id: "publish", expertId: "coding", prompt: "发布" }],
          elseSteps: [{ kind: "serial", id: "fix", expertId: "coding", prompt: "修复" }],
        },
      ],
      layout: { analysis: { x: 10, y: 20 } },
      summarizerExpertId: "daily",
    };
    const t = store.create({ name: "研发团", routingStrategy: "workflow", workflow: wf });
    expect(t.workflow?.steps[1]).toMatchObject({ kind: "conditional", logic: "and" });
    expect(t.workflow?.layout?.analysis).toEqual({ x: 10, y: 20 });

    const updated = store.update({
      id: t.id,
      workflow: {
        ...wf,
        steps: [{ kind: "serial", id: "only", expertId: "daily", prompt: "x" }],
      },
    });
    expect(updated?.workflow?.steps).toHaveLength(1);

    const cleared = store.update({ id: t.id, workflow: null });
    expect(cleared?.workflow).toBeUndefined(); // null 清除 → 回退运行时默认
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
    expect(r.message).toContain("errors.mcpCommandMissing");
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
