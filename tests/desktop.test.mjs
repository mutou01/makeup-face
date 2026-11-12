import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
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

async function withDesktop(run, prepare = async () => ({})) {
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
        ...(await prepare(profile)),
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
    await run(page);
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
}

test(
  "本机照片可预览和替换，取消或格式不符时保留原预览，清除后不可再读取",
  { timeout: 45_000 },
  () =>
    withDesktop(
      async (page) => {
        const pick = page.getByRole("button", { name: "选择本机照片" });
        const clear = page.getByRole("button", { name: "清除预览" });
        const preview = page.getByRole("img", { name: "本机原图预览" });
        const assertImage = async (width, height) => {
          await preview.waitFor({ timeout: 5_000 });
          assert.deepEqual(
            await preview.evaluate((img) => [
              img.naturalWidth,
              img.naturalHeight,
            ]),
            [width, height],
          );
          return preview.getAttribute("src");
        };

        await pick.click({ timeout: 5_000 });
        const first = await assertImage(2, 3);
        const response = await page.evaluate(async (url) => {
          const result = await fetch(url);
          return [result.status, result.headers.get("cache-control")];
        }, first);
        assert.deepEqual(response, [200, "no-store"]);

        await pick.click({ timeout: 5_000 });
        await page
          .getByText("未更换照片。", { exact: true })
          .waitFor({ timeout: 5_000 });
        assert.equal(await assertImage(2, 3), first);

        await pick.click({ timeout: 5_000 });
        await page
          .getByText("扩展名必须与文件内容一致", { exact: false })
          .waitFor({ timeout: 5_000 });
        assert.equal(await assertImage(2, 3), first);

        await pick.click({ timeout: 5_000 });
        await page
          .getByText("原图已加载（3 × 2）。", { exact: true })
          .waitFor({ timeout: 5_000 });
        const replacement = await assertImage(3, 2);
        assert.notEqual(first, replacement);
        const responseStatus = (url) =>
          page.evaluate(async (path) => (await fetch(path)).status, url);
        assert.equal(await responseStatus(first), 404);

        await clear.click({ timeout: 5_000 });
        await preview.waitFor({ state: "hidden", timeout: 5_000 });
        assert.equal(await responseStatus(replacement), 404);
      },
      async (profile) => {
        const first = join(profile, "first.png");
        const invalid = join(profile, "renamed.jpg");
        const replacement = join(profile, "replacement.png");
        const portrait = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGOsULJgYGBgYmBgQFAAECoA2HBD9oMAAAAASUVORK5CYII=",
          "base64",
        );
        await writeFile(first, portrait);
        await writeFile(invalid, portrait);
        await writeFile(
          replacement,
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVR4nGNUqrBgYGBgYGBgYoABAA7qANbzEZPkAAAAAElFTkSuQmCC",
            "base64",
          ),
        );
        return {
          MAKEUPMIRROR_SMOKE_PHOTO_SELECTIONS: JSON.stringify([
            first,
            "",
            invalid,
            replacement,
          ]),
        };
      },
    ),
);

test(
  "Windows 桌面窗口显示 MakeupMirror 与中文使用说明",
  { timeout: 45_000 },
  () =>
    withDesktop(async (page) => {
      await page
        .getByRole("heading", { name: "MakeupMirror", exact: true })
        .waitFor({ timeout: 5_000 });
      await page
        .getByRole("heading", { name: "如何开始", exact: true })
        .waitFor({ timeout: 5_000 });
      await page
        .getByText("导入一张正面照", { exact: false })
        .waitFor({ timeout: 5_000 });
    }),
);

async function pixels(canvas) {
  const result = await canvas.evaluate((element) => {
    const { width, height } = element;
    const { data } = element.getContext("2d").getImageData(0, 0, width, height);
    let binary = "";
    for (let i = 0; i < data.length; i += 8192) {
      binary += String.fromCharCode(...data.subarray(i, i + 8192));
    }
    return { width, height, bytes: btoa(binary) };
  });
  return { ...result, bytes: Buffer.from(result.bytes, "base64") };
}

test(
  "合成图口红可开关、改色、调强度，唇区外像素不变",
  { timeout: 45_000 },
  () =>
    withDesktop(async (page) => {
      const preview = page.getByRole("img", { name: "口红试妆预览" });
      const enabled = page.getByRole("checkbox", { name: "启用口红" });
      const color = page.getByLabel("口红颜色");
      const intensity = page.getByRole("slider", { name: "口红强度" });
      await preview.waitFor({ timeout: 5_000 });
      assert.equal(await enabled.isChecked(), false);
      const original = await pixels(preview);
      assert.equal(original.width, 240);
      assert.equal(original.height, 240);

      await enabled.check({ timeout: 5_000 });
      const painted = await pixels(preview);
      let changed = 0;
      let outside = 0;
      for (let y = 0; y < original.height; y++) {
        for (let x = 0; x < original.width; x++) {
          const i = (y * original.width + x) * 4;
          if (original.bytes.readUInt32LE(i) === painted.bytes.readUInt32LE(i))
            continue;
          changed++;
          if (x < 85 || x > 155 || y < 140 || y > 180) outside++;
        }
      }
      assert.ok(changed > 0, "启用后应实际改变唇区像素");
      assert.equal(outside, 0, "唇区之外不得改变任何像素");
      const protectionPoint = (143 * original.width + 91) * 4;
      assert.equal(
        painted.bytes.readUInt32LE(protectionPoint),
        original.bytes.readUInt32LE(protectionPoint),
      );

      await color.fill("#2556bf", { timeout: 5_000 });
      const blue = await pixels(preview);
      const lipPoint = (156 * original.width + 120) * 4;
      assert.ok(blue.bytes[lipPoint] < painted.bytes[lipPoint]);
      assert.ok(blue.bytes[lipPoint + 2] > painted.bytes[lipPoint + 2]);

      await intensity.press("Home", { timeout: 5_000 });
      assert.ok(
        (await pixels(preview)).bytes.equals(original.bytes),
        "零强度恢复原像素",
      );
      await intensity.press("End", { timeout: 5_000 });
      const strongest = await pixels(preview);
      assert.ok(strongest.bytes[lipPoint + 2] > blue.bytes[lipPoint + 2]);
      await enabled.uncheck({ timeout: 5_000 });
      assert.ok(
        (await pixels(preview)).bytes.equals(original.bytes),
        "关闭后恢复原像素",
      );
      await enabled.check({ timeout: 5_000 });
      assert.ok(
        (await pixels(preview)).bytes.equals(strongest.bytes),
        "重新启用不能重复叠涂",
      );
    }),
);
