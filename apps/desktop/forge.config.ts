import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig, IForgePlugin } from "@electron-forge/shared-types";

const execFileAsync = promisify(execFile);

// 图标用绝对路径：electron-packager 按 process.cwd() 解析相对路径，跨 npm workspace 调用时不可靠
const ICON_BASE = path.resolve(__dirname, "assets", "icons", "icon");
const BUNDLE_ID = "com.everybuddy.app";

// 运行时被外部化（vite.main.config.ts 的 external）、依赖 import() 从 node_modules 加载的包。
// npm workspace 把这些包提升到仓库根 node_modules，electron-packager 从 app 目录拷贝会全部丢失，
// 需在 afterCopy 阶段连同传递依赖一并拷入打包产物（见 collectExternalRuntimeDeps）。
const EXTERNAL_RUNTIME_PKGS = [
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "unpdf",
  "mammoth",
  "xlsx",
  "jszip",
  "typebox",
  "@modelcontextprotocol/sdk",
];

/** 从 fromDir 向上沿 node_modules 逐级查找包目录（不依赖 require/package.json exports 语义） */
function findPackageDir(spec: string, fromDir: string): string | null {
  let cur = path.resolve(fromDir);
  for (;;) {
    const candidate = path.join(cur, "node_modules", spec, "package.json");
    if (existsSync(candidate)) return path.dirname(candidate);
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

/**
 * 收集外部化运行时包及其传递依赖在根 node_modules 下的物理目录。
 * 种子列表见 EXTERNAL_RUNTIME_PKGS；@everybuddy/* 等 workspace 包已随 Vite alias 内联进
 * main.js，不在运行时解析，故不在此列。
 */
function collectExternalRuntimeDeps(): string[] {
  const ROOT_DIR = path.resolve(__dirname, "../..");
  const seen = new Set<string>();
  const dirs: string[] = [];
  const visit = (spec: string, fromDir: string): void => {
    const pkgDir = findPackageDir(spec, fromDir);
    if (!pkgDir || seen.has(pkgDir)) return;
    seen.add(pkgDir);
    dirs.push(pkgDir);
    const manifest = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>;
    };
    for (const dep of Object.keys(manifest.dependencies ?? {})) visit(dep, pkgDir);
  };
  for (const spec of EXTERNAL_RUNTIME_PKGS) visit(spec, ROOT_DIR);
  return dirs;
}

/**
 * ad-hoc 签名插件。
 * electron-packager 不签名会残留 Electron 的 linker 签名（Identifier=Electron），
 * LaunchServices 校验不过可能导致部分环境拒绝启动。@electron/osx-sign 集成在无证书
 * 环境会挂起（已实测），故用原生 codesign 在 postPackage 阶段签名，identifier 与
 * CFBundleIdentifier 对齐。正式发布替换为开发者证书（见 docs/architecture.md §11.3）。
 */
const adhocSignPlugin: IForgePlugin = {
  __isElectronForgePlugin: true,
  name: "adhoc-sign",
  init: () => {},
  getHooks() {
    return {
      postPackage: async (_forgeConfig, { outputPaths }) => {
        if (process.platform !== "darwin") return;
        // outputPaths 是 out/<name>-<platform>-<arch>/ 目录（内含 .app）
        const appPaths: string[] = [];
        for (const p of outputPaths) {
          if (p.endsWith(".app")) {
            appPaths.push(p);
          } else {
            for (const entry of readdirSync(p)) {
              if (entry.endsWith(".app")) appPaths.push(path.join(p, entry));
            }
          }
        }
        for (const appPath of appPaths) {
          await execFileAsync("codesign", [
            "--force",
            "--deep",
            "--sign",
            "-",
            "-i",
            BUNDLE_ID,
            "--timestamp=none",
            appPath,
          ]);
        }
      },
    };
  },
};

const config: ForgeConfig = {
  packagerConfig: {
    name: "EveryBuddy",
    // 图标不带扩展名，electron-packager 按平台自动补 .icns / .ico / .png
    icon: ICON_BASE,
    appBundleId: BUNDLE_ID,
    appCategoryType: "public.app-category.productivity",
    // 运行时窗口图标（Win/Linux 任务栏），打包后拷入 resources 根目录
    extraResource: [`${ICON_BASE}.png`],
    // electron zip 已缓存在 ~/Library/Caches/electron，但 @electron/get 每次打包仍
    // 会"不缓存校验和、在线拉取 SHASUMS256.txt"（validateArtifact 的 cacheMode: Bypass），
    // 网络超时拖慢构建。显式提供本地校验和即可完全离线且保留完整性校验：
    download: {
      checksums: {
        // 缓存 zip 的 sha256（首次下载时已通过官方校验，此后不再联网）
        "electron-v43.2.0-darwin-arm64.zip":
          "ad4a0ae3c37ee05aa06c7e2ed0627608389790f0505a2b0d20319efbe33ffe28",
        "electron-v43.2.0-win32-x64.zip":
          "eba5f5088af40ecb364fe258809c79a5234c6ece5a75c64722772eba01b02786",
      },
    },
    // TODO: 正式签名（见 docs/architecture.md §11.3）

    // monorepo：运行时依赖被提升到根 node_modules，packager 默认的 prune（galactus 从 app 目录
    // 解析依赖树）在此结构下解析不到、keep 集为空，导致 node_modules 整体丢失。故关掉 prune，
    // 由 afterCopy 把外部化的运行时依赖从根 node_modules 拷入产物（Vite 插件的 ignore 已保证
    // 源拷贝只保留 .vite，node_modules 不会从 app 目录拷入）。
    prune: false,
    // 注意：钩子必须是 callback 风格。forge 用 util.promisify 包装钩子，若返回 Promise
    // 不会 resolve（事件循环空转、进程以 0 退出、打包静默中断），故拷贝用同步 cpSync + done()。
    afterCopy: [
      (
        buildPath: string,
        _electronVersion: string,
        _platform: string,
        _arch: string,
        done: (err?: Error | null) => void,
      ) => {
        try {
          const ROOT_NM = path.resolve(__dirname, "../../node_modules");
          const appNm = path.join(buildPath, "node_modules");
          for (const pkgDir of collectExternalRuntimeDeps()) {
            const rel = path.relative(ROOT_NM, pkgDir);
            if (rel.startsWith("..")) continue; // 解析到根 node_modules 之外，跳过
            const dest = path.join(appNm, rel);
            mkdirSync(path.dirname(dest), { recursive: true });
            cpSync(pkgDir, dest, { recursive: true, force: true });
          }
          done();
        } catch (err) {
          done(err as Error);
        }
      },
    ],
  },
  makers: [
    // maker-dmg 默认仅 darwin 平台执行；maker-zip 限定 darwin
    new MakerDMG({ icon: `${ICON_BASE}.icns` }),
    new MakerZIP({}, ["darwin"]),
    // maker-squirrel 默认仅 win32 平台执行，产出 Squirrel Setup 安装包。
    // name 默认取 npm 包名（@everybuddy/desktop）——含 "/"，会被当路径分隔符导致
    // nuspec 文件路径错误（ENOENT），故显式指定应用名，与 appName/exe 保持一致。
    new MakerSquirrel({
      name: "EveryBuddy",
      // nuspec 的 <authors> 是 NuGet 必填项；electron-winstaller 默认从 app
      // package.json 的 author 字段取，而本工作区 package.json 未声明，故显式指定
      authors: "EveryBuddy",
      setupIcon: `${ICON_BASE}.ico`,
    }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        { entry: "src/main/index.ts", config: "vite.main.config.ts" },
        { entry: "src/preload/index.ts", config: "vite.preload.config.ts" },
      ],
      renderer: [{ name: "main_window", config: "vite.renderer.config.ts" }],
    }),
    adhocSignPlugin,
  ],
};

export default config;
