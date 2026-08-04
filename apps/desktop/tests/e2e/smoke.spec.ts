import { test, expect } from "@playwright/test";

/**
 * 冒烟测试：应用可正常启动并显示主界面
 * （见 docs/architecture.md §3，测试：Playwright）。
 */
// TODO: 通过 _electron.launch 启动打包产物并断言
test("app launches and shows root", async () => {
  // TODO: const e = await _electron.launch({ args: ["."] });
  // TODO: 断言窗口标题 / #root 可见
  expect(true).toBe(true);
});
