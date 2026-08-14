/**
 * skillStore - 技能管理（~/EveryBuddy/skills/ 目录 + skills.json 注册表）。
 *
 * 技能 = 一个目录里的 SKILL.md（对齐 pi SDK Skill），每次启动种子内置示例技能。
 *  - 注册表 skills.json：EveryBuddy 管理的技能元数据（source / enabled / tags），
 *    name/description 从 SKILL.md frontmatter 实时读取（编辑后无需改注册表）。
 *  - 内置技能（builtin）：首次启动种子落盘，可停用但不可删除文件。
 *  - 自定义（custom，编辑器创建）/ 已安装（installed，本地技能包导入）：可编辑/卸载。
 *  - 全局技能（global，~/.agents/skills 下 SDK 自动发现的）：只读展示，不可管理。
 *
 * 注入：agentRuntime 的 DefaultResourceLoader.skillsOverride 用 listEnabled() 合并，
 * enabled=false 的技能不进 override（见 agentRuntime.ts §7）。
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { CreateSkillRequest, SkillEntry, UpdateSkillRequest } from "@everybuddy/ipc-contract";
import { APP_ROOT, ensureAppDirs } from "./configStore";

/** EveryBuddy 管理的技能目录 ~/EveryBuddy/skills/ */
export const SKILLS_DIR = path.join(APP_ROOT, "skills");
/** 注册表路径 ~/EveryBuddy/skills.json */
export const SKILLS_REGISTRY_PATH = path.join(APP_ROOT, "skills.json");
/** 全局技能发现目录（对齐 SDK getAgentDir()） */
export const GLOBAL_SKILLS_DIR = path.join(homedir(), ".agents", "skills");

type ManagedSource = "builtin" | "custom" | "installed";

interface RegistryEntry {
  id: string;
  source: ManagedSource;
  enabled: boolean;
  installedAt: string;
  tags?: string[];
}

interface SkillShape {
  skills: RegistryEntry[];
  /** 首次种子已执行标记（持久化：用户卸载全部种子后不再重新种子） */
  seeded?: boolean;
}

const BUILTIN_SEEDS: Array<{ name: string; description: string; body: string }> = [
  {
    name: "prd-writer",
    description: "按模板撰写产品需求文档",
    body: `# prd-writer

当用户输入 /prd-writer 时激活此技能，按结构化模板撰写产品需求文档。

## 步骤
1. 明确产品背景、目标用户与核心问题
2. 按 背景 / 目标 / 用户故事 / 功能列表 / 验收标准 组织
3. 输出 Markdown 文档并给出关键字段说明`,
  },
  {
    name: "meeting-notes",
    description: "整理会议纪要为结构化文档",
    body: `# meeting-notes

当用户输入 /meeting-notes 时激活此技能，把零散会议记录整理为结构化纪要。

## 步骤
1. 提取会议议题与结论
2. 归纳待办事项（责任人 + 截止时间）
3. 输出 议题 / 结论 / 待办 / 风险 四段式纪要`,
  },
  {
    name: "commit-helper",
    description: "生成约定式提交信息",
    body: `# commit-helper

当用户输入 /commit-helper 时激活此技能，根据改动生成约定式提交信息。

## 步骤
1. 查看 git diff 与 status 归纳改动类型
2. 按 Conventional Commits 格式生成 commit message
3. 输出单行标题 + 可选的正文要点`,
  },
];

function emptyShape(): SkillShape {
  return { skills: [] };
}

/** 解析 SKILL.md frontmatter（name/description），返回正文 */
export function parseSkillFrontmatter(md: string): {
  name?: string;
  description?: string;
  body: string;
} {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { body: md.trim() };
  const fm = m[1] ?? "";
  const body = m[2] ?? "";
  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  return { name, description, body: body.trim() };
}

/** 序列化 SKILL.md（frontmatter + 正文） */
export function buildSkillMd(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body.trim()}\n`;
}

function skillFilePath(skillsDir: string, id: string): string {
  return path.join(skillsDir, id, "SKILL.md");
}

export class SkillStore {
  private data: SkillShape = emptyShape();
  private loaded = false;

  constructor(
    private registryPath: string = SKILLS_REGISTRY_PATH,
    private skillsDir: string = SKILLS_DIR,
  ) {}

  private load(): void {
    if (this.loaded) return;
    ensureAppDirs();
    mkdirSync(this.skillsDir, { recursive: true });
    if (existsSync(this.registryPath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.registryPath, "utf-8")) as Partial<SkillShape>;
        this.data = { skills: parsed.skills ?? [], seeded: parsed.seeded === true };
      } catch {
        this.data = emptyShape();
      }
    }
    this.migrateLegacySources();
    this.loaded = true;
    this.seedBuiltin();
  }

  /** 迁移旧注册表：早期种子 source=builtin → installed（内置归并到「已安装」，避免筛选为空） */
  private migrateLegacySources(): void {
    if (!this.data.skills.some((e) => e.source === "builtin")) return;
    this.data.skills = this.data.skills.map((e) =>
      e.source === "builtin" ? { ...e, source: "installed" } : e,
    );
    this.save();
  }

  private save(): void {
    ensureAppDirs();
    writeFileSync(this.registryPath, JSON.stringify(this.data, null, 2), "utf-8");
  }

  /** 首次启动种子示例技能（source=installed，同普通已安装技能可卸载；seeded 持久化防重种） */
  private seedBuiltin(): void {
    if (this.data.seeded) return;
    for (const seed of BUILTIN_SEEDS) {
      if (this.data.skills.some((s) => s.id === seed.name)) continue;
      const dir = path.join(this.skillsDir, seed.name);
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, "SKILL.md");
      if (!existsSync(file)) {
        writeFileSync(file, buildSkillMd(seed.name, seed.description, seed.body), "utf-8");
      }
      this.data.skills.push({
        id: seed.name,
        source: "installed",
        enabled: true,
        installedAt: new Date().toISOString(),
      });
    }
    this.data.seeded = true;
    this.save();
  }

  private readEntry(entry: RegistryEntry): SkillEntry | null {
    const file = skillFilePath(this.skillsDir, entry.id);
    if (!existsSync(file)) return null;
    const md = readFileSync(file, "utf-8");
    const fm = parseSkillFrontmatter(md);
    return {
      id: entry.id,
      name: fm.name ?? entry.id,
      description: fm.description ?? "",
      filePath: file,
      baseDir: path.dirname(file),
      source: entry.source,
      tags: entry.tags ?? [],
      enabled: entry.enabled,
      installedAt: entry.installedAt,
    };
  }

  /** 读取全局技能目录（~/.agents/skills 下各子目录的 SKILL.md，只读） */
  private listGlobalSkills(): SkillEntry[] {
    if (!existsSync(GLOBAL_SKILLS_DIR)) return [];
    const out: SkillEntry[] = [];
    for (const name of readdirSync(GLOBAL_SKILLS_DIR)) {
      const dir = path.join(GLOBAL_SKILLS_DIR, name);
      if (!statSync(dir).isDirectory()) continue;
      const file = path.join(dir, "SKILL.md");
      if (!existsSync(file)) continue;
      const fm = parseSkillFrontmatter(readFileSync(file, "utf-8"));
      out.push({
        id: name,
        name: fm.name ?? name,
        description: fm.description ?? "",
        filePath: file,
        baseDir: dir,
        source: "global",
        tags: [],
        enabled: true,
      });
    }
    return out;
  }

  /** EveryBuddy 管理 + 全局发现的合并列表 */
  list(): SkillEntry[] {
    this.load();
    const managed = this.data.skills
      .map((e) => this.readEntry(e))
      .filter((e): e is SkillEntry => e !== null);
    return [...managed, ...this.listUnregisteredDirs(), ...this.listGlobalSkills()];
  }

  /** 已启用的 EveryBuddy 技能（skillsOverride 注入源；enabled=false 不进 override） */
  listEnabled(): SkillEntry[] {
    this.load();
    const managed = this.data.skills
      .filter((e) => e.enabled)
      .map((e) => this.readEntry(e))
      .filter((e): e is SkillEntry => e !== null);
    // 手动放入 skills/ 的技能目录（未注册）默认启用，一并注入
    const discovered = this.listUnregisteredDirs().filter((e) => e.enabled);
    return [...managed, ...discovered];
  }

  /** 自动发现 skills 目录下未注册的技能文件夹（手动放入即作为「已安装」加载） */
  private listUnregisteredDirs(): SkillEntry[] {
    const known = new Set(this.data.skills.map((e) => e.id));
    const out: SkillEntry[] = [];
    if (!existsSync(this.skillsDir)) return out;
    for (const name of readdirSync(this.skillsDir)) {
      if (known.has(name)) continue;
      const dir = path.join(this.skillsDir, name);
      if (!statSync(dir).isDirectory()) continue;
      const file = path.join(dir, "SKILL.md");
      if (!existsSync(file)) continue;
      const fm = parseSkillFrontmatter(readFileSync(file, "utf-8"));
      out.push({
        id: name,
        name: fm.name ?? name,
        description: fm.description ?? "",
        filePath: file,
        baseDir: dir,
        source: "installed",
        tags: [],
        enabled: true,
      });
    }
    return out;
  }

  create(req: CreateSkillRequest): SkillEntry {
    this.load();
    const id = req.name;
    const dir = path.join(this.skillsDir, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "SKILL.md"),
      buildSkillMd(id, req.description, req.content),
      "utf-8",
    );
    const entry: RegistryEntry = {
      id,
      source: "custom",
      enabled: true,
      installedAt: new Date().toISOString(),
      tags: req.tags ?? [],
    };
    this.data.skills.push(entry);
    this.save();
    const loaded = this.readEntry(entry);
    if (!loaded) throw new Error(`技能写入失败：${id}`);
    return loaded;
  }

  update(req: UpdateSkillRequest): SkillEntry | undefined {
    this.load();
    const idx = this.data.skills.findIndex((s) => s.id === req.id);
    const existing = this.data.skills[idx];
    if (!existing) return undefined;
    if (req.name && req.name !== req.id) {
      throw new Error("技能不支持重命名，请删除后重新创建");
    }
    const file = skillFilePath(this.skillsDir, req.id);
    if (!existsSync(file)) return undefined;
    const fm = parseSkillFrontmatter(readFileSync(file, "utf-8"));
    writeFileSync(
      file,
      buildSkillMd(
        req.name ?? fm.name ?? req.id,
        req.description ?? fm.description ?? "",
        req.content ?? fm.body,
      ),
      "utf-8",
    );
    if (req.tags) existing.tags = req.tags;
    this.save();
    return this.readEntry(existing) ?? undefined;
  }

  /** 本地技能包（目录含 SKILL.md 或单 SKILL.md 文件）安装到 skills/ */
  install(sourcePath: string): SkillEntry {
    this.load();
    const src = sourcePath;
    const srcStat = statSync(src);
    let name: string;
    let content: string;
    if (srcStat.isDirectory()) {
      const mdPath = path.join(src, "SKILL.md");
      if (!existsSync(mdPath)) throw new Error("技能包目录需包含 SKILL.md");
      name = path.basename(src);
      content = readFileSync(mdPath, "utf-8");
    } else if (src.endsWith("SKILL.md") || src.endsWith("skill.md")) {
      name = path.basename(path.dirname(src));
      content = readFileSync(src, "utf-8");
    } else {
      throw new Error("仅支持技能包目录（含 SKILL.md）或 SKILL.md 文件");
    }
    const fm = parseSkillFrontmatter(content);
    if (fm.name && /^[a-z0-9][a-z0-9_-]*$/.test(fm.name)) name = fm.name;
    const targetDir = path.join(this.skillsDir, name);
    mkdirSync(targetDir, { recursive: true });
    if (srcStat.isDirectory()) {
      cpSync(src, targetDir, { recursive: true, force: true });
    } else {
      writeFileSync(path.join(targetDir, "SKILL.md"), content, "utf-8");
    }
    // 已存在则升级为 installed（保留 enabled 状态）
    const existingIdx = this.data.skills.findIndex((s) => s.id === name);
    const existingEntry = existingIdx >= 0 ? this.data.skills[existingIdx] : undefined;
    const entry: RegistryEntry = {
      id: name,
      source: "installed",
      enabled: existingEntry?.enabled ?? true,
      installedAt: new Date().toISOString(),
    };
    if (existingIdx >= 0) this.data.skills[existingIdx] = entry;
    else this.data.skills.push(entry);
    this.save();
    const loaded = this.readEntry(entry);
    if (!loaded) throw new Error(`技能安装失败：${name}`);
    return loaded;
  }

  /** 卸载：builtin 转停用（文件保留），custom/installed 删除目录 + 注册项 */
  uninstall(id: string): void {
    this.load();
    const idx = this.data.skills.findIndex((s) => s.id === id);
    const entry = idx >= 0 ? this.data.skills[idx] : undefined;
    if (!entry) return;
    if (entry.source === "builtin") {
      this.data.skills[idx] = { ...entry, enabled: false };
    } else {
      const dir = path.join(this.skillsDir, id);
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      this.data.skills = this.data.skills.filter((s) => s.id !== id);
    }
    this.save();
  }

  enable(id: string, enabled: boolean): void {
    this.load();
    const idx = this.data.skills.findIndex((s) => s.id === id);
    const existing = idx >= 0 ? this.data.skills[idx] : undefined;
    if (existing) {
      this.data.skills[idx] = { ...existing, enabled };
      this.save();
    }
  }
}

export const skillStore = new SkillStore();
