import path from "node:path";
import { readdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ForgeConfig, IForgePlugin } from "@electron-forge/shared-types";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";

const execFileAsync = promisify(execFile);

// 图标用绝对路径：electron-packager 按 process.cwd() 解析相对路径，跨 npm workspace 调用时不可靠
const ICON_BASE = path.resolve(__dirname, "assets", "icons", "icon");
const BUNDLE_ID = "com.everybuddy.app";

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
        "electron-v43.2.0-darwin-arm64.zip": "ad4a0ae3c37ee05aa06c7e2ed0627608389790f0505a2b0d20319efbe33ffe28",
        "electron-v43.2.0-win32-x64.zip": "eba5f5088af40ecb364fe258809c79a5234c6ece5a75c64722772eba01b02786",
      },
    },
    // TODO: 正式签名（见 docs/architecture.md §11.3）
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
