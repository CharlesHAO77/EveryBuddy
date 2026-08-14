/**
 * mcpTools - MCP 连接器桥接（SDK 0.83 无内置 MCP，经 @modelcontextprotocol/sdk 自建）。
 *
 * 把 status=connected 的 MCP 连接器变成 ToolDefinition[] 注入 session 的 customTools。
 * 支持两种传输：
 *  - stdio：本地 server 进程。优先「托管安装」——npm install 到 ~/EveryBuddy/mcp-servers/
 *    后用本进程（ELECTRON_RUN_AS_NODE）直接 spawn，绕开 npx 临时安装漏装依赖的已知问题；
 *    也兼容任意 command/args（如用户自备可用的 npx 命令）。
 *  - streamable-http：连远程 MCP server URL（携带 headers 鉴权）。
 *
 * 生命周期：连接建立后 client 常驻（MCP server 进程保持运行），
 * 应用退出时 closeAllMcpClients() 统一关闭（main/app.ts before-quit 钩子）。
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Connector } from "@everybuddy/ipc-contract";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { TSchema } from "typebox";
import { APP_ROOT, ensureAppDirs } from "./configStore";

const execFileAsync = promisify(execFile);

/** MCP server 托管安装目录 ~/EveryBuddy/mcp-servers/ */
export const MCP_SERVERS_DIR = path.join(APP_ROOT, "mcp-servers");

type McpToolResult = { content?: unknown; isError?: boolean };

const openClients = new Set<Client>();

/** 应用退出时统一关闭所有 MCP client（终止 server 进程） */
export function closeAllMcpClients(): void {
  for (const c of openClients) void c.close().catch(() => {});
  openClients.clear();
}

/* ── 配置解析 ── */

type McpConfig = {
  transport?: string;
  command?: string;
  args?: unknown;
  package?: string;
  version?: string;
  env?: Record<string, unknown>;
  url?: string;
  headers?: Record<string, unknown>;
};

function readMcpConfig(cfg: Record<string, unknown>): McpConfig {
  return cfg as McpConfig;
}

function asStrMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) if (typeof val === "string") out[k] = val;
  return out;
}

/* ── 托管安装：npm install 到 ~/EveryBuddy/mcp-servers/，spawn 本地 bin ── */

/** 解析包 bin 脚本（package.json.bin，兼容 string 或 {name:path}） */
function resolvePackageBin(pkgDir: string, manifest: { bin?: unknown }): string {
  const bin = manifest.bin;
  let rel: string;
  if (typeof bin === "string") rel = bin;
  else if (bin && typeof bin === "object") rel = Object.values(bin)[0] as string;
  else rel = "dist/index.js";
  return path.join(pkgDir, rel);
}

/** 确保 npm 包已托管安装，返回本地 bin 脚本路径（幂等：已安装则直接返回） */
async function ensureServerInstalled(pkg: string, version?: string): Promise<string> {
  ensureAppDirs();
  const key = `${pkg.split("/").pop()}@${version ?? "latest"}`;
  const installDir = path.join(MCP_SERVERS_DIR, key);
  const pkgDir = path.join(installDir, "node_modules", pkg);
  const marker = path.join(pkgDir, "package.json");
  if (existsSync(marker)) {
    return resolvePackageBin(pkgDir, JSON.parse(readFileSync(marker, "utf-8")));
  }
  mkdirSync(installDir, { recursive: true });
  const spec = `${pkg}@${version ?? "latest"}`;
  // npm 在 PATH（dev 环境）；GUI 启动若缺 PATH 会在错误信息中体现，可后续加 node_modules 内 npm
  await execFileAsync("npm", ["install", "--prefix", installDir, "--no-audit", "--no-fund", spec], {
    cwd: installDir,
    timeout: 120_000,
  });
  if (!existsSync(marker)) throw new Error(`MCP server 安装失败：${spec}`);
  return resolvePackageBin(pkgDir, JSON.parse(readFileSync(marker, "utf-8")));
}

/** stdio 传输的 spawn 参数：托管包 → 本进程当 node 跑；否则用用户给的 command */
async function stdioSpawnConfig(cfg: McpConfig): Promise<{
  command: string;
  args: string[];
  env: Record<string, string>;
}> {
  const env = { ...(process.env as Record<string, string>), ...asStrMap(cfg.env) };
  if (cfg.package) {
    const bin = await ensureServerInstalled(cfg.package, cfg.version);
    // 打包版无 node 在 PATH：用 Electron 自身二进制 + ELECTRON_RUN_AS_NODE 当 node 跑 server
    return { command: process.execPath, args: [bin], env: { ...env, ELECTRON_RUN_AS_NODE: "1" } };
  }
  const command = typeof cfg.command === "string" ? cfg.command.trim() : "";
  if (!command) throw new Error("缺少 MCP server 命令（config.command 或 config.package）");
  const args = Array.isArray(cfg.args)
    ? cfg.args.filter((a): a is string => typeof a === "string")
    : [];
  return { command, args, env };
}

/** 打开一个 MCP client（按 transport 分支），未连接/参数缺失抛错 */
async function openMcpClient(cfg: McpConfig): Promise<Client> {
  const client = new Client({ name: "everybuddy", version: "1.0.0" }, { capabilities: {} });
  if (cfg.transport === "streamable-http") {
    if (!cfg.url) throw new Error("缺少 MCP server URL（config.url）");
    const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
      requestInit: { headers: asStrMap(cfg.headers) },
    });
    await client.connect(transport);
    return client;
  }
  const { command, args, env } = await stdioSpawnConfig(cfg);
  const transport = new StdioClientTransport({ command, args, env });
  await client.connect(transport);
  return client;
}

/* ── 探测：测试连接（拉起/连上 → listTools → 关闭） ── */

export async function probeMcpConnector(config: Record<string, unknown>): Promise<{
  ok: boolean;
  message: string;
  tools?: number;
  toolNames?: string[];
}> {
  let client: Client | undefined;
  try {
    client = await openMcpClient(readMcpConfig(config));
    const res = await client.listTools();
    const names = res.tools.map((t) => t.name);
    return {
      ok: true,
      message: `已连接，发现 ${res.tools.length} 个工具`,
      tools: res.tools.length,
      toolNames: names,
    };
  } catch (e) {
    return { ok: false, message: `连接失败：${e instanceof Error ? e.message : String(e)}` };
  } finally {
    if (client) void client.close().catch(() => {});
  }
}

/* ── 展开为 ToolDefinition[]（session 注入用；失败静默返回空数组） ── */

export async function buildMcpTools(connector: Connector): Promise<ToolDefinition[]> {
  let client: Client | undefined;
  try {
    client = await openMcpClient(readMcpConfig(connector.config ?? {}));
  } catch {
    return [];
  }
  openClients.add(client);
  const { Type } = await import("typebox");
  try {
    const { tools } = await client.listTools();
    const defs: ToolDefinition[] = [];
    for (const tool of tools) {
      const parameters = (await jsonSchemaToTypeBox(
        tool.inputSchema,
        Type as TypeBoxLike,
      )) as TSchema;
      defs.push({
        name: tool.name,
        label: tool.title ?? tool.name,
        description: tool.description ?? `MCP 工具 ${tool.name}（${connector.name}）`,
        parameters,
        execute: async (_toolCallId: string, params: unknown) => {
          const res = (await client?.callTool({
            name: tool.name,
            arguments: params as Record<string, unknown>,
          })) as McpToolResult | undefined;
          return {
            content: [{ type: "text", text: formatMcpResult(res) }],
            details: {},
          };
        },
      });
    }
    return defs;
  } catch {
    openClients.delete(client);
    void client.close().catch(() => {});
    return [];
  }
}

type McpContentBlock = {
  type?: string;
  text?: string;
  mimeType?: string;
  data?: string;
};

function formatMcpResult(res: McpToolResult | undefined): string {
  if (!res) return "[无返回]";
  const blocks = (res.content ?? []) as McpContentBlock[];
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "text" && block.text !== undefined) parts.push(block.text);
    else if (block.type === "image")
      parts.push(`[图片 ${block.mimeType ?? ""} ${(block.data ?? "").length}B]`);
    else parts.push(JSON.stringify(block));
  }
  const text = parts.join("\n");
  return res.isError ? `[工具执行错误]\n${text}` : text;
}

/** typebox 子集（仅 jsonSchemaToTypeBox 用到的构造器） */
type TypeBoxLike = {
  Any: () => unknown;
  String: () => unknown;
  Number: () => unknown;
  Integer: () => unknown;
  Boolean: () => unknown;
  Null: () => unknown;
  Array: (item: unknown) => unknown;
  Object: (props: Record<string, unknown>) => unknown;
  Optional: (t: unknown) => unknown;
  Union: (items: unknown[]) => unknown;
  Literal: (v: unknown) => unknown;
};

/** 递归把 MCP JSON Schema 转 TypeBox schema（覆盖常用 string/number/boolean/array/object/enum；其余兜底 Any） */
async function jsonSchemaToTypeBox(schema: unknown, Type: TypeBoxLike): Promise<unknown> {
  if (!schema || typeof schema !== "object") return Type.Any();
  const s = schema as Record<string, unknown>;
  if (Array.isArray(s.enum)) {
    return Type.Union((s.enum as unknown[]).map((v) => Type.Literal(v)));
  }
  switch (s.type) {
    case "string":
      return Type.String();
    case "number":
      return Type.Number();
    case "integer":
      return Type.Integer();
    case "boolean":
      return Type.Boolean();
    case "null":
      return Type.Null();
    case "array": {
      const items = s.items ? await jsonSchemaToTypeBox(s.items, Type) : Type.Any();
      return Type.Array(items);
    }
    case "object": {
      const props: Record<string, unknown> = {};
      const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
      const properties = (s.properties ?? {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(properties)) {
        const t = await jsonSchemaToTypeBox(value, Type);
        props[key] = required.has(key) ? t : Type.Optional(t);
      }
      return Type.Object(props);
    }
    default:
      return Type.Any();
  }
}
