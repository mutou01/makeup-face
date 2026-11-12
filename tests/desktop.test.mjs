import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const executable = fileURLToPath(
  new URL("../dist/MakeupMirror-smoke.exe", import.meta.url),
);

async function freePort() {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function connect(endpoint, getExit) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const exit = getExit();
    assert.equal(exit, undefined, `桌面应用提前退出：${exit}`);
    const ready = await fetch(`${endpoint}/json/version`, {
      signal: AbortSignal.timeout(1_000),
    })
      .then((response) => response.ok)
      .catch(() => false);
    if (ready) return chromium.connectOverCDP(endpoint, { timeout: 5_000 });
    await delay(150);
  }
  assert.fail("桌面应用未在 20 秒内打开 WebView2 调试连接");
}

test(
  "Windows 桌面窗口显示 MakeupMirror 与中文使用说明",
  { timeout: 45_000 },
  async () => {
    await assert.doesNotReject(
      access(executable),
      "缺少待验收的 MakeupMirror 桌面程序",
    );

    const port = await freePort();
    const tempRoot = await realpath(tmpdir());
    const profile = await mkdtemp(join(tempRoot, "makeupmirror-smoke-"));
    let child;
    let exited;
    let browser;
    let exit;
    try {
      child = spawn(executable, [], {
        env: {
          ...process.env,
          MAKEUPMIRROR_SMOKE_PORT: String(port),
          MAKEUPMIRROR_SMOKE_PROFILE: profile,
        },
        stdio: ["ignore", "ignore", "inherit"],
        windowsHide: true,
      });
      exited = new Promise((resolve) => {
        child.once("exit", (code, signal) => {
          exit = String(signal ?? code);
          resolve();
        });
        child.once("error", (error) => {
          exit = error.message;
          resolve();
        });
      });
      browser = await connect(`http://127.0.0.1:${port}`, () => exit);
      const context = browser.contexts()[0];
      const page =
        context.pages()[0] ??
        (await context.waitForEvent("page", { timeout: 5_000 }));
      await page
        .getByRole("heading", { name: "MakeupMirror", exact: true })
        .waitFor({ timeout: 5_000 });
      await page
        .getByRole("heading", { name: "如何开始", exact: true })
        .waitFor({ timeout: 5_000 });
      await page
        .getByText("导入一张正面照", { exact: false })
        .waitFor({ timeout: 5_000 });
    } finally {
      await browser?.close().catch(() => {});
      if (child && exit === undefined) child.kill();
      await exited;
      assert.equal(dirname(await realpath(profile)), tempRoot);
      await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    }
  },
);
