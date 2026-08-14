/**
 * mcpTools 探测单测。
 *  - 配置错误路径（缺 url / 缺 command）快速、离线，常跑。
 *  - GitHub MCP 托管安装端到端（npm install + spawn）需要网络，设 MCP_E2E=1 才跑。
 */
import { describe, expect, it } from "vitest";
import { probeMcpConnector } from "../src/main/mcpTools";

describe("probeMcpConnector 配置校验", () => {
  it("streamable-http 缺 url 报错", async () => {
    const r = await probeMcpConnector({ transport: "streamable-http" });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("URL");
  });

  it("stdio 缺 package/command 报错", async () => {
    const r = await probeMcpConnector({ transport: "stdio" });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("command");
  });

  it("stdio 用用户自定义命令（不存在 → 连接失败不抛未捕获）", async () => {
    const r = await probeMcpConnector({
      transport: "stdio",
      command: "definitely-not-a-real-binary-xyz",
    });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("连接失败");
  });
});

describe("MCP e2e（需网络，MCP_E2E=1 开启）", () => {
  it.runIf(process.env.MCP_E2E)(
    "GitHub MCP 托管安装 + listTools",
    async () => {
      const r = await probeMcpConnector({
        transport: "stdio",
        package: "@modelcontextprotocol/server-github",
        version: "2025.4.8",
        env: { GITHUB_TOKEN: "" },
      });
      expect(r.ok).toBe(true);
      expect(r.tools ?? 0).toBeGreaterThan(0);
    },
    180_000,
  );
});
