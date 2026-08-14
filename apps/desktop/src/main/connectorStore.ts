/**
 * connectorStore - 连接器注册表（~/EveryBuddy/connectors.json）。
 *
 * 连接器是最外层可扩展接入点：type 开放枚举（mcp/http-api/datasource/filesystem/custom），
 * capabilities 与 tags 预留，status 区分 connected/disconnected/error/reserved。
 *  - reserved 态：允许「注册并打标签」，运行时注入先 stub（用户可先建目录，逐步激活）。
 *  - mcp / filesystem：test 会真实探测（拉起进程 / 检查根目录）。
 *  - 其余类型仅注册，注入预留。
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  Connector,
  ConnectorStatus,
  CreateConnectorRequest,
  TestConnectorRequest,
  UpdateConnectorRequest,
} from "@everybuddy/ipc-contract";
import { APP_ROOT, ensureAppDirs } from "./configStore";
import { probeMcpConnector } from "./mcpTools";

export const CONNECTORS_PATH = path.join(APP_ROOT, "connectors.json");

/** 每类型能力建议（UI 提示用；保留可扩展） */
export const CONNECTOR_TYPE_HINTS: Record<string, string[]> = {
  mcp: ["tools", "actions"],
  filesystem: ["context", "actions"],
  "http-api": ["knowledge", "actions"],
  datasource: ["knowledge"],
  custom: [],
};

interface ConnectorShape {
  connectors: Connector[];
}

function emptyShape(): ConnectorShape {
  return { connectors: [] };
}

export class ConnectorStore {
  private data: ConnectorShape = emptyShape();
  private loaded = false;

  constructor(private filePath: string = CONNECTORS_PATH) {}

  private load(): void {
    if (this.loaded) return;
    ensureAppDirs();
    const fresh = !existsSync(this.filePath);
    if (existsSync(this.filePath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.filePath, "utf-8")) as Partial<ConnectorShape>;
        this.data = { connectors: parsed.connectors ?? [] };
      } catch {
        this.data = emptyShape();
      }
    }
    // 首次创建时种子一个 GitHub MCP 示例（reserved 态：登记但不自动激活）
    if (fresh) this.seedBuiltinExample();
    this.loaded = true;
  }

  /** 首次启动种子：GitHub MCP 示例（enabled=false + reserved，需用户激活）。
   *  用托管安装（package + 版本固定），绕开 npx 临时安装漏装依赖的问题。 */
  private seedBuiltinExample(): void {
    const now = new Date().toISOString();
    this.data.connectors.push({
      id: "github-mcp",
      name: "GitHub MCP",
      type: "mcp",
      icon: "hub",
      description: "仓库 / Issue / PR 能力（MCP server，预留示例）",
      config: {
        transport: "stdio",
        package: "@modelcontextprotocol/server-github",
        version: "2025.4.8",
        env: { GITHUB_TOKEN: "" },
      },
      tags: ["source:builtin"],
      capabilities: ["tools", "actions"],
      boundExpertIds: [],
      boundSkillIds: [],
      enabled: false,
      status: "reserved",
      createdAt: now,
      updatedAt: now,
    });
    this.save();
  }

  private save(): void {
    ensureAppDirs();
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
  }

  list(): Connector[] {
    this.load();
    return this.data.connectors;
  }

  get(id: string): Connector | undefined {
    this.load();
    return this.data.connectors.find((c) => c.id === id);
  }

  create(req: CreateConnectorRequest): Connector {
    this.load();
    const now = new Date().toISOString();
    const connector: Connector = {
      id: randomUUID(),
      name: req.name,
      type: req.type,
      icon: req.icon ?? "hub",
      description: req.description ?? "",
      config: req.config ?? {},
      tags: req.tags ?? [],
      capabilities: req.capabilities ?? CONNECTOR_TYPE_HINTS[req.type] ?? [],
      boundExpertIds: req.boundExpertIds ?? [],
      boundSkillIds: req.boundSkillIds ?? [],
      enabled: true,
      status: "reserved",
      createdAt: now,
      updatedAt: now,
    };
    this.data.connectors.push(connector);
    this.save();
    return connector;
  }

  update(req: UpdateConnectorRequest): Connector | undefined {
    this.load();
    const idx = this.data.connectors.findIndex((c) => c.id === req.id);
    const existing = this.data.connectors[idx];
    if (!existing) return undefined;
    const merged: Connector = {
      ...existing,
      name: req.name ?? existing.name,
      type: req.type ?? existing.type,
      icon: req.icon ?? existing.icon,
      description: req.description ?? existing.description,
      config: req.config !== undefined ? req.config : existing.config,
      tags: req.tags ?? existing.tags,
      capabilities: req.capabilities ?? existing.capabilities,
      boundExpertIds: req.boundExpertIds ?? existing.boundExpertIds,
      boundSkillIds: req.boundSkillIds ?? existing.boundSkillIds,
      enabled: req.enabled ?? existing.enabled,
      status: req.status ?? existing.status,
      updatedAt: new Date().toISOString(),
    };
    this.data.connectors[idx] = merged;
    this.save();
    return merged;
  }

  delete(id: string): void {
    this.load();
    this.data.connectors = this.data.connectors.filter((c) => c.id !== id);
    this.save();
  }

  /** 测试连接：真实探测 mcp/filesystem；reserved 及其余类型返回提示 */
  async test(
    req: TestConnectorRequest,
  ): Promise<{ status: ConnectorStatus; message: string; tools?: number }> {
    const connector = this.get(req.id);
    if (!connector) throw new Error("连接器不存在");
    if (
      connector.status === "reserved" &&
      connector.type !== "mcp" &&
      connector.type !== "filesystem"
    ) {
      return { status: "reserved", message: "已注册·待激活，运行时接入即将推出" };
    }
    if (connector.type === "mcp") {
      const result = await probeMcpConnector(connector.config);
      const status: ConnectorStatus = result.ok ? "connected" : "error";
      this.update({ id: connector.id, status });
      return { status, message: result.message, tools: result.tools };
    }
    if (connector.type === "filesystem") {
      const rootDir = typeof connector.config.rootDir === "string" ? connector.config.rootDir : "";
      if (!rootDir) {
        this.update({ id: connector.id, status: "disconnected" });
        return { status: "disconnected", message: "未配置白名单根目录（config.rootDir）" };
      }
      const ok = existsSync(rootDir);
      const status: ConnectorStatus = ok ? "connected" : "error";
      this.update({ id: connector.id, status });
      return {
        status,
        message: ok ? "根目录可访问" : `根目录不存在：${rootDir}`,
      };
    }
    return {
      status: connector.status === "connected" ? "connected" : "reserved",
      message: `${connector.type} 类型仅注册，运行时接入后续实现`,
    };
  }
}

export const connectorStore = new ConnectorStore();
