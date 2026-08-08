/**
 * toolAvailability - Agent 工具的平台/运行时可用性探测。
 *
 * 背景：SDK（@earendil-works/pi-coding-agent）内置工具的 bash 解析在 Windows 上
 * 存在缺陷（见 node_modules/.../dist/utils/shell.js getShellConfig）：
 *  1. 只查 %ProgramFiles%\Git\bin\bash.exe（新版 Git 的 bash 实际在 usr\bin，会漏）；
 *  2. 回退到 `where bash.exe` 取第一个匹配，而 Electron 主进程 PATH 中 System32
 *     排在 Git 之前，会命中 C:\Windows\System32\bash.exe（WSL stub）。
 * 本模块探测真实的 Git Bash（跳过 WSL stub），并探测 grep/find 依赖的 rg/fd 二进制
 * 是否可用，供 agentRuntime 决定：bash 用我们解析的路径覆盖、grep/find 在缺 rg/fd
 * 时降级为纯 Node 实现。
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** 机器级工具可用性快照（进程内探测一次，缓存） */
export interface ToolAvailability {
  bashAvailable: boolean;
  /** Windows 上解析到的真实 Git Bash 绝对路径；POSIX 或未找到时为 undefined */
  bashShellPath?: string;
  /** rg 在 PATH 或 SDK bin 目录（~/.pi/agent/bin）可用 */
  rgAvailable: boolean;
  /** fd（或 fdfind）可用 */
  fdAvailable: boolean;
}

/** 传给 createAgentSession 的动态工具方案 */
export interface ToolPlan {
  /** tools allowlist（createAgentSession.tools） */
  tools: string[];
  /** 存在时 agentRuntime 用它构造 bash 工具覆盖（注入 shellPath） */
  bashShellPath?: string;
  /** rg 缺失 → 注入纯 Node grep 工具覆盖内置 */
  useNodeGrep: boolean;
  /** fd 缺失 → 注入纯 Node find operations 覆盖内置 */
  useNodeFind: boolean;
}

/** 探测边界（单测注入点；默认走真实 fs/spawn） */
export interface ProbeDeps {
  platform: NodeJS.Platform;
  existsSync: (p: string) => boolean;
  /** 执行 where/which，返回路径行；未命中返回 [] */
  which: (cmd: string) => string[];
  programFiles?: string;
  programFilesX86?: string;
  homeDir: string;
  /** PI_CODING_AGENT_DIR，SDK getAgentDir() 同样尊重它 */
  agentDirEnv?: string;
}

/** 恒可用（纯 Node 实现，跨平台无外部依赖）的工具 */
export const STATIC_TOOLS = ["read", "write", "edit", "ls", "parse_attachment"] as const;

/** 归一化：斜杠→反斜杠、小写（便于 WSL stub 正则） */
export function normalizeWinPath(p: string): string {
  return p.replace(/\//g, "\\").toLowerCase();
}

/**
 * WSL bash stub 判定，覆盖：
 *  - C:\Windows\System32\bash.exe / winbash.exe（经典 WSL 启动器）
 *  - C:\Windows\Sysnative\bash.exe（32 位进程重定向）
 *  - ...\WindowsApps\bash.exe（应用执行别名）
 */
export function isWslStubBashPath(p: string): boolean {
  const n = normalizeWinPath(p);
  return (
    /^[a-z]:\\windows\\(?:system32|sysnative)\\(?:bash|winbash)\.exe$/.test(n) ||
    /\\windowsapps\\bash\.exe$/.test(n)
  );
}

/** 枚举已知 Git Bash 位置（bin\ 与 usr\bin\ 都查，SDK 只查 bin\）；返回第一个存在者 */
export function findKnownGitBash(
  programFiles: string | undefined,
  programFilesX86: string | undefined,
  exists: (p: string) => boolean = existsSync,
): string | undefined {
  const roots = [programFiles, programFilesX86].filter((r): r is string => !!r);
  for (const root of roots) {
    for (const segments of [
      ["Git", "bin", "bash.exe"],
      ["Git", "usr", "bin", "bash.exe"],
    ]) {
      const p = path.join(root, ...segments);
      if (exists(p)) return p;
    }
  }
  return undefined;
}

/** 从 where 输出中跳过 WSL stub、取第一个真实存在的 bash */
export function pickRealBashFromWhere(
  lines: string[],
  exists: (p: string) => boolean = existsSync,
): string | undefined {
  for (const line of lines) {
    const p = line.trim();
    if (!p) continue;
    if (isWslStubBashPath(p)) continue;
    if (exists(p)) return p;
  }
  return undefined;
}

/** 默认 which/where 执行器（win32 用 where，其余用 which） */
export function runWhich(cmd: string): string[] {
  const runner = process.platform === "win32" ? "where" : "which";
  try {
    const r = spawnSync(runner, [cmd], { encoding: "utf-8", timeout: 5000, windowsHide: true });
    if (r.status === 0 && r.stdout) return r.stdout.trim().split(/\r?\n/).filter(Boolean);
  } catch {
    // 命令不可用/超时，视为未命中
  }
  return [];
}

/** 探测工具可用性（deps 可注入，默认取真实环境） */
export function detectToolAvailability(deps: Partial<ProbeDeps> = {}): ToolAvailability {
  const d: ProbeDeps = {
    platform: process.platform,
    existsSync,
    which: runWhich,
    programFiles: process.env.ProgramFiles,
    programFilesX86: process.env["ProgramFiles(x86)"],
    homeDir: homedir(),
    agentDirEnv: process.env.PI_CODING_AGENT_DIR,
    ...deps,
  };

  // bash：POSIX 恒可用（SDK getShellConfig 兜底 /bin/bash 或 sh）；Windows 先已知路径再 where 跳 WSL stub
  let bashAvailable: boolean;
  let bashShellPath: string | undefined;
  if (d.platform === "win32") {
    bashShellPath =
      findKnownGitBash(d.programFiles, d.programFilesX86, d.existsSync) ??
      pickRealBashFromWhere(d.which("bash.exe"), d.existsSync);
    bashAvailable = !!bashShellPath;
  } else {
    bashAvailable = true;
  }

  // rg/fd：先查 SDK bin 目录（与 SDK getToolPath 一致），再查 PATH
  const binDir = path.join(d.agentDirEnv || path.join(d.homeDir, ".pi", "agent"), "bin");
  const ext = d.platform === "win32" ? ".exe" : "";
  const rgInBin = d.existsSync(path.join(binDir, `rg${ext}`));
  const fdInBin = d.existsSync(path.join(binDir, `fd${ext}`));
  const rgAvailable = rgInBin || d.which("rg").length > 0;
  const fdAvailable = fdInBin || d.which("fd").length > 0 || d.which("fdfind").length > 0;

  return { bashAvailable, bashShellPath, rgAvailable, fdAvailable };
}

/** 由可用性快照生成动态工具方案（grep/find 恒保留，缺 rg/fd 时降级 Node） */
export function buildToolPlan(avail: ToolAvailability): ToolPlan {
  const tools: string[] = [...STATIC_TOOLS];
  if (avail.bashAvailable) tools.push("bash");
  // grep/find 恒可用：有 rg/fd 走 SDK 内置，缺失走纯 Node 覆盖
  tools.push("grep", "find");
  return {
    tools,
    bashShellPath: avail.bashShellPath,
    useNodeGrep: !avail.rgAvailable,
    useNodeFind: !avail.fdAvailable,
  };
}
