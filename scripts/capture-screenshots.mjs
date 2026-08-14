#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
/**
 * Capture marketing screenshots of the everyBuddy desktop app.
 *
 * Prereq: the app must already be running with a remote-debugging port, e.g.
 *   cd apps/desktop && npm run start -- -- --remote-debugging-port=9222
 *
 * Then from the repo root:
 *   node scripts/capture-screenshots.mjs
 *
 * Output: docs/screenshots/{welcome,chat,expert-center,automation}.png
 */
import { chromium } from "playwright";

const OUT = new URL("../docs/screenshots/", import.meta.url).pathname;

async function shot(page, name) {
  const path = `${OUT}${name}.png`;
  await page.screenshot({ path, scale: "css" });
  console.log(`saved ${path}`);
}

async function clickNav(page, label) {
  const btn = page.getByRole("button", { name: label });
  await btn.waitFor({ state: "visible", timeout: 5000 });
  await btn.click();
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const context = browser.contexts()[0];
  const page =
    context.pages().find((p) => p.url().includes("localhost:5173")) || context.pages()[0];

  // Resize the Electron window to a consistent aspect for screenshots.
  try {
    const cdp = await context.newCDPSession(page);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { width: 1280, height: 820 },
    });
    await page.waitForTimeout(600);
  } catch {
    console.warn("window resize skipped");
  }

  // 1. Welcome
  await page.waitForTimeout(800);
  await shot(page, "welcome");

  // 2. Expert / Skill / Connector center
  await clickNav(page, "专家·技能·连接器");
  await page.waitForTimeout(900);
  await shot(page, "expert-center");

  // 3. Automation
  await clickNav(page, "自动化");
  await page.waitForTimeout(900);
  await shot(page, "automation");

  // 4. Chat — open the most recent conversation from the sidebar.
  await page
    .getByText("把png格式的图标转换成electron可能需要的应用图标等", { exact: false })
    .first()
    .click();
  await page.waitForTimeout(1800);
  await shot(page, "chat");

  await browser.close();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
