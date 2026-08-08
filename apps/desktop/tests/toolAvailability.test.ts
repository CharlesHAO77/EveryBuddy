/**
 * toolAvailability 单元测试——注入 ProbeDeps，不触碰真实环境。
 * 重点覆盖核心根因：where bash.exe 命中 WSL stub 时跳过并选中真实 Git Bash。
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildToolPlan,
  detectToolAvailability,
  findKnownGitBash,
  isWslStubBashPath,
  type ProbeDeps,
  pickRealBashFromWhere,
  type ToolAvailability,
} from "../src/main/tools/toolAvailability";

/** 构造探测依赖（默认全缺失/未命中） */
function makeDeps(overrides: Partial<ProbeDeps>): ProbeDeps {
  return {
    platform: "win32",
    existsSync: () => false,
    which: () => [],
    programFiles: "C:\\Program Files",
    programFilesX86: "C:\\Program Files (x86)",
    homeDir: "C:\\Users\\test",
    ...overrides,
  };
}

describe("isWslStubBashPath", () => {
  it("识别 System32 / Sysnative 的 bash.exe 与 winbash.exe", () => {
    expect(isWslStubBashPath("C:\\Windows\\System32\\bash.exe")).toBe(true);
    expect(isWslStubBashPath("c:\\windows\\sysnative\\bash.exe")).toBe(true);
    expect(isWslStubBashPath("C:\\Windows\\System32\\winbash.exe")).toBe(true);
  });

  it("识别 WindowsApps 应用执行别名", () => {
    expect(
      isWslStubBashPath("C:\\Users\\x\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe"),
    ).toBe(true);
  });

  it("斜杠/大小写归一化后仍识别", () => {
    expect(isWslStubBashPath("c:/windows/system32/bash.exe")).toBe(true);
  });

  it("真实 Git Bash / MSYS2 / Cygwin 路径判定为否", () => {
    expect(isWslStubBashPath("E:\\Program Files\\Git\\usr\\bin\\bash.exe")).toBe(false);
    expect(isWslStubBashPath("C:\\Program Files\\Git\\bin\\bash.exe")).toBe(false);
    expect(isWslStubBashPath("C:\\msys64\\usr\\bin\\bash.exe")).toBe(false);
  });
});

describe("findKnownGitBash", () => {
  it("bin 优先于 usr\\bin（两个都存在时返回 bin）", () => {
    const bin = path.join("C:\\Program Files", "Git", "bin", "bash.exe");
    const usrBin = path.join("C:\\Program Files", "Git", "usr", "bin", "bash.exe");
    const existing = new Set([bin, usrBin]);
    const result = findKnownGitBash("C:\\Program Files", undefined, (p) => existing.has(p));
    expect(result).toBe(bin);
  });

  it("无 bin 时回退 usr\\bin", () => {
    const usrBin = path.join("E:\\Program Files", "Git", "usr", "bin", "bash.exe");
    const existing = new Set([usrBin]);
    const result = findKnownGitBash("E:\\Program Files", undefined, (p) => existing.has(p));
    expect(result).toBe(usrBin);
  });

  it("全部缺失返回 undefined", () => {
    expect(
      findKnownGitBash("C:\\Program Files", "C:\\Program Files (x86)", () => false),
    ).toBeUndefined();
  });
});

describe("pickRealBashFromWhere", () => {
  it("跳过 WSL stub，选中真实 Git Bash（核心根因用例）", () => {
    const wsl = "C:\\Windows\\System32\\bash.exe";
    const git = path.join("E:\\Program Files", "Git", "usr", "bin", "bash.exe");
    const existing = new Set([wsl, git]);
    const result = pickRealBashFromWhere([wsl, git], (p) => existing.has(p));
    expect(result).toBe(git);
  });

  it("全部为 WSL stub 返回 undefined", () => {
    const lines = [
      "C:\\Windows\\System32\\bash.exe",
      "C:\\Users\\x\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe",
    ];
    expect(pickRealBashFromWhere(lines, () => true)).toBeUndefined();
  });

  it("空列表返回 undefined", () => {
    expect(pickRealBashFromWhere([], () => true)).toBeUndefined();
  });
});

describe("detectToolAvailability (win32)", () => {
  it("已知路径命中真实 Git Bash", () => {
    const git = path.join("E:\\Program Files", "Git", "usr", "bin", "bash.exe");
    const existing = new Set([git]);
    const avail = detectToolAvailability(
      makeDeps({ programFiles: "E:\\Program Files", existsSync: (p) => existing.has(p) }),
    );
    expect(avail.bashAvailable).toBe(true);
    expect(avail.bashShellPath).toBe(git);
  });

  it("where 命中真实 Git Bash 且跳过 WSL stub", () => {
    const git = path.join("E:\\Program Files", "Git", "usr", "bin", "bash.exe");
    const existing = new Set([git]);
    const avail = detectToolAvailability(
      makeDeps({
        programFiles: "C:\\Program Files",
        existsSync: (p) => existing.has(p),
        which: (cmd) => (cmd === "bash.exe" ? ["C:\\Windows\\System32\\bash.exe", git] : []),
      }),
    );
    expect(avail.bashAvailable).toBe(true);
    expect(avail.bashShellPath).toBe(git);
  });

  it("无真实 bash 时 bashAvailable=false", () => {
    const avail = detectToolAvailability(makeDeps({ existsSync: () => false, which: () => [] }));
    expect(avail.bashAvailable).toBe(false);
    expect(avail.bashShellPath).toBeUndefined();
  });

  it("rg 在 PATH 时可用", () => {
    const avail = detectToolAvailability(
      makeDeps({
        existsSync: () => false,
        which: (cmd) => (cmd === "rg" ? ["C:\\tools\\rg.exe"] : []),
      }),
    );
    expect(avail.rgAvailable).toBe(true);
  });

  it("rg 缺失时不可用", () => {
    const avail = detectToolAvailability(makeDeps({ existsSync: () => false, which: () => [] }));
    expect(avail.rgAvailable).toBe(false);
  });

  it("fd 经 fdfind 别名命中", () => {
    const avail = detectToolAvailability(
      makeDeps({
        existsSync: () => false,
        which: (cmd) => (cmd === "fdfind" ? ["/usr/bin/fdfind"] : []),
      }),
    );
    expect(avail.fdAvailable).toBe(true);
  });

  it("rg 位于 SDK bin 目录（~/.pi/agent/bin）时可用", () => {
    const rgPath = path.join("C:\\Users\\test", ".pi", "agent", "bin", "rg.exe");
    const existing = new Set([rgPath]);
    const avail = detectToolAvailability(makeDeps({ existsSync: (p) => existing.has(p) }));
    expect(avail.rgAvailable).toBe(true);
  });
});

describe("detectToolAvailability (POSIX)", () => {
  it("非 win32 恒有 bash", () => {
    const avail = detectToolAvailability({
      platform: "linux",
      existsSync: () => false,
      which: () => [],
      homeDir: "/home/test",
    });
    expect(avail.bashAvailable).toBe(true);
    expect(avail.bashShellPath).toBeUndefined();
  });
});

describe("buildToolPlan", () => {
  it("全可用：含 bash/grep/find，不用 Node 兜底", () => {
    const avail: ToolAvailability = {
      bashAvailable: true,
      bashShellPath: path.join("E:\\Program Files", "Git", "usr", "bin", "bash.exe"),
      rgAvailable: true,
      fdAvailable: true,
    };
    const plan = buildToolPlan(avail);
    expect(plan.tools).toContain("bash");
    expect(plan.tools).toContain("grep");
    expect(plan.tools).toContain("find");
    expect(plan.useNodeGrep).toBe(false);
    expect(plan.useNodeFind).toBe(false);
    expect(plan.bashShellPath).toBe(avail.bashShellPath);
  });

  it("bash 缺失：静默排除，grep/find 仍保留", () => {
    const plan = buildToolPlan({ bashAvailable: false, rgAvailable: false, fdAvailable: false });
    expect(plan.tools).not.toContain("bash");
    expect(plan.tools).toContain("grep");
    expect(plan.tools).toContain("find");
  });

  it("rg/fd 缺失：启用 Node 兜底", () => {
    const plan = buildToolPlan({ bashAvailable: true, rgAvailable: false, fdAvailable: false });
    expect(plan.useNodeGrep).toBe(true);
    expect(plan.useNodeFind).toBe(true);
  });
});
