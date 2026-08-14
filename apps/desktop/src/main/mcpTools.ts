/**
 * mcpTools - MCP 连接器桥接（SDK 0.83 无内置 MCP，经 @modelcontextprotocol/sdk 自建）。
 *
 * 把 status=connected 的 MCP 连接器变成 ToolDefinition[] 注入 session 的 customTools：
 *  - StdioClientTransport 拉起 server 进程（config.command/args/env）
 *  - listTools() 列出能力，把 JSON Schema inputSchema 转 TypeBox schema
 *  - execute 代理到 client.callTool，文本/结构化结果归一为 { type:"text" }
 *
 * 生命周期：连接建立后 client 常驻（MCP server 进程保持运行），
 * 应用退出时 closeAllMcpClients() 统一关闭（main/index.ts 注册 app quit 钩子）。
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Connector } from "@everybuddy/ipc-contract";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

type McpToolResult = Awaited<ReturnType<Client["callTool"]>>;

const openClients = new Set<Client>();

/** 应用退出时统一关闭所有 MCP client（终止 server 进程） */
export function closeAllMcpClients(): void {
  for (const c of openClients) void c.close().catch(() => {});
  openClients.clear();
}

/** 探测一个 MCP 连接器：拉起进程、listTools、关闭 */
export async function probeMcpConnector(config: Record<string, unknown>): Promise<{
  ok: boolean;
  message: string;
  tools?: number;
}> {
  const command = typeof config.command === "string" ? config.command.trim() : "";
  if (!command) return { ok: false, message: "缺少 MCP server 命令（config.command）" };
  const args = Array.isArray(config.args)
    ? config.args.filter((a): a is string => typeof a === "string")
    : [];
  const env = mergeEnv(config.env);
  const client = new Client({ name: "everybuddy", version: "1.0.0" }, { capabilities: {} });
  try {
    const transport = new StdioClientTransport({ command, args, env });
    await client.connect(transport);
    const res = await client.listTools();
    return { ok: true, message: `已连接，发现 ${res.tools.length} 个工具`, tools: res.tools.length };
  } catch (e) {
    return { ok: false, message: `连接失败：${e instanceof Error ? e.message : String(e)}` };
  } finally {
    void client.close().catch(() => {});
  }
}

/**
 * 把一个 MCP 连接器展开为 ToolDefinition[]（列表为空表示连接失败/未配置）。
 * 失败时静默返回空数组：让 session 正常建立，工具缺失由模型自行绕过。
 */
export async function buildMcpTools(connector: Connector): Promise<ToolDefinition[]> {
  const config = connector.config ?? {};
  const command = typeof config.command === "string" ? config.command.trim() : "";
  if (!command) return [];
  const args = Array.isArray(config.args)
    ? config.args.filter((a): a is string => typeof a === "string")
    : [];
  const env = mergeEnv(config.env);
  const { Type } = await import("typebox");
  const client = new Client({ name: "everybuddy", version: "1.0.0" }, { capabilities: {} });
  try {
    const transport = new StdioClientTransport({ command, args, env });
    await client.connect(transport);
    openClients.add(client);
    const { tools } = await client.listTools();
    const defs: ToolDefinition[] = [];
    for (const tool of tools) {
      const parameters = (await jsonSchemaToTypeBox(tool.inputSchema, Type)) as TSchema;
      defs.push({
        name: tool.name,
        label: tool.title ?? tool.name,
        description: tool.description ?? `MCP 工具 ${tool.name}（${connector.name}）`,
        parameters,
        execute: async (_toolCallId: string, params: unknown) => {
          const res: McpToolResult = await client.callTool({
            name: tool.name,
            arguments: params as Record<string, unknown>,
          });
          return { content: [{ type: "text", text: formatMcpResult(res) }], details: {} };
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

function mergeEnv(configEnv: unknown): Record<string, string> {
  const base = { ...(process.env as Record<string, string>) };
  if (configEnv && typeof configEnv === "object") {
    for (const [k, v] of Object.entries(configEnv)) {
      if (typeof v === "string") base[k] = v;
    }
  }
  return base;
}

type McpContentBlock = {
  type?: string;
  text?: string;
  mimeType?: string;
  data?: string;
};

function formatMcpResult(res: McpToolResult): string {
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

/** 递归把 MCP JSON Schema 转 TypeBox schema（覆盖常用 string/number/boolean/array/object/enum；其余兜底 Any） */
async function jsonSchemaToTypeBox(schema: unknown, Type: any): Promise<unknown> {
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
      const required = new Set(
        Array.isArray(s.required) ? (s.required as string[]) : [],
      );
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
