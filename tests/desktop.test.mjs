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
        MAKEUPMIRROR_SMOKE_FACE_DIR: "",
        MAKEUPMIRROR_SMOKE_FACE_FIXTURE: "",
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

        await page
          .getByRole("button", { name: "分析面部" })
          .click({ timeout: 5_000 });
        await page
          .getByText("本机人脸模型尚未安装", { exact: false })
          .waitFor({ timeout: 5_000 });
        assert.equal(await assertImage(2, 3), first);

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

test(
  "本地推荐始终显示三套预设，并按场景和妆感可复现地排序",
  { timeout: 45_000 },
  () =>
    withDesktop(async (page) => {
      const panel = page.getByRole("region", { name: "妆容推荐" });
      const list = panel.getByRole("list", { name: "推荐方案" });
      const titles = () => list.getByRole("heading").allTextContents();
      await list.waitFor({ timeout: 5_000 });
      const defaultOrder = ["日常豆沙", "蜜桃暖妆", "莓果夜妆"];
      assert.deepEqual(await titles(), defaultOrder);
      const card = list.getByRole("listitem").first();
      for (const color of ["#A55262", "#C97881", "#99716C"]) {
        await card
          .getByText(color, { exact: false })
          .waitFor({ timeout: 5_000 });
      }
      await card
        .getByText("通用推荐", { exact: false })
        .waitFor({ timeout: 5_000 });

      const scene = panel.getByLabel("场景", { exact: true });
      const look = panel.getByLabel("妆感偏好", { exact: true });
      await scene.selectOption({ label: "聚会" });
      await look.selectOption({ label: "暖色" });
      assert.deepEqual(await titles(), ["莓果夜妆", "蜜桃暖妆", "日常豆沙"]);
      await list
        .getByRole("listitem")
        .first()
        .getByText("符合聚会场景", { exact: false })
        .waitFor({ timeout: 5_000 });
      await list
        .getByRole("listitem")
        .filter({
          has: page.getByRole("heading", { name: "蜜桃暖妆", exact: true }),
        })
        .getByText("符合暖色偏好", { exact: false })
        .waitFor({ timeout: 5_000 });
      await scene.selectOption({ label: "不限场景" });
      assert.deepEqual(await titles(), ["蜜桃暖妆", "日常豆沙", "莓果夜妆"]);
      await look.selectOption({ label: "不限妆感" });
      assert.deepEqual(await titles(), defaultOrder);
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

function countChanges(before, after, regions) {
  const inside = regions.map(() => 0);
  let outside = 0;
  for (let i = 0; i < before.bytes.length; i += 4) {
    if (before.bytes.readUInt32LE(i) === after.bytes.readUInt32LE(i)) continue;
    const p = i / 4;
    const x = (p % before.width) / before.width;
    const y = Math.floor(p / before.width) / before.height;
    const region = regions.findIndex(
      ([left, top, right, bottom]) =>
        x >= left && x <= right && y >= top && y <= bottom,
    );
    if (region < 0) outside++;
    else inside[region]++;
  }
  return { inside, outside };
}

function pairOfRegions(bounds) {
  const regions = bounds
    .split(";")
    .map((entry) => entry.split(",").map(Number));
  assert.ok(
    regions.length === 2 &&
      regions.every(
        (box) =>
          box.length === 4 &&
          box.every((n) => Number.isFinite(n) && n >= 0 && n <= 1) &&
          box[0] < box[2] &&
          box[1] < box[3],
      ),
    "请提供两个有效的归一化范围",
  );
  return regions;
}

const realPhoto = process.env.MAKEUPMIRROR_REAL_PHOTO;
const realRuntime = process.env.MAKEUPMIRROR_REAL_FACE_DIR;
if (realPhoto || realRuntime) {
  test(
    "真人照片经本机模型定位后只在人工标定的妆容范围改变像素",
    { timeout: 60_000 },
    () =>
      withDesktop(
        async (page) => {
          const region = (process.env.MAKEUPMIRROR_REAL_LIP_BOUNDS ?? "")
            .split(",")
            .map(Number);
          assert.ok(
            realPhoto &&
              realRuntime &&
              region.length === 4 &&
              region.every((n) => Number.isFinite(n) && n >= 0 && n <= 1) &&
              region[0] < region[2] &&
              region[1] < region[3],
            "请提供本地真人照、真实模型目录与人工唇区范围",
          );
          const pick = page.getByRole("button", { name: "选择本机照片" });
          await pick.waitFor({ timeout: 5_000 });
          const origin = new URL(page.url()).origin;
          const external = [];
          const runtimeFailures = [];
          page.on("request", (request) => {
            const url = new URL(request.url());
            if (
              ["http:", "https:"].includes(url.protocol) &&
              url.origin !== origin
            )
              external.push(url.origin);
          });
          page.on("response", (response) => {
            const path = new URL(response.url()).pathname;
            if (path.startsWith("/local-face-runtime/") && !response.ok())
              runtimeFailures.push(`${response.status()} ${path}`);
          });
          page.on("console", (message) => {
            if (message.type() === "error")
              runtimeFailures.push(message.text());
          });
          await pick.click({ timeout: 5_000 });
          await page
            .getByRole("button", { name: "分析面部" })
            .click({ timeout: 10_000 });
          const canvas = page.getByRole("img", { name: "试妆预览" });
          await canvas.waitFor({ timeout: 25_000 }).catch(async () => {
            assert.fail(
              `真实模型未生成预览：${await page.getByRole("status").textContent()}；${runtimeFailures.join("；")}`,
            );
          });
          const original = await pixels(canvas);
          assert.equal(Math.max(original.width, original.height), 1024);
          const enabled = page.getByRole("checkbox", { name: "启用口红" });
          await enabled.check({ timeout: 5_000 });
          const painted = await pixels(canvas);
          const {
            inside: [changed],
            outside,
          } = countChanges(original, painted, [region]);
          assert.ok(changed >= 25, `实际改变像素太少：${changed}`);
          assert.equal(outside, 0, "人工标定的嘴部范围外必须保持不变");
          await enabled.uncheck({ timeout: 5_000 });
          assert.ok(
            (await pixels(canvas)).bytes.equals(original.bytes),
            "关闭后恢复工作分辨率原图",
          );
          assert.deepEqual(external, []);
          console.log(
            `真人验收：${original.width} × ${original.height}，嘴部范围内 ${changed} 个像素变化，范围外 ${outside}，无外部请求。`,
          );

          const blushBounds = process.env.MAKEUPMIRROR_REAL_BLUSH_BOUNDS;
          if (blushBounds) {
            const cheeks = pairOfRegions(blushBounds);
            await enabled.check({ timeout: 5_000 });
            const lipOnly = await pixels(canvas);
            const blush = page.getByRole("checkbox", { name: "启用腮红" });
            await blush.check({ timeout: 5_000 });
            const both = await pixels(canvas);
            const cheekChanges = countChanges(lipOnly, both, cheeks);
            assert.ok(
              cheekChanges.inside.every((count) => count >= 25),
              `双颊变化不足：${cheekChanges.inside}`,
            );
            assert.equal(
              cheekChanges.outside,
              0,
              "人工标定的双颊范围外必须保持不变",
            );
            await blush.uncheck({ timeout: 5_000 });
            assert.ok(
              (await pixels(canvas)).bytes.equals(lipOnly.bytes),
              "真人照片关闭腮红后口红保持原样",
            );
            assert.deepEqual(external, []);
            console.log(
              `真人腮红验收：双颊范围内分别变化 ${cheekChanges.inside.join("、")} 个像素，范围外 0，关闭后保留口红。`,
            );
          }

          const eyeshadowBounds =
            process.env.MAKEUPMIRROR_REAL_EYESHADOW_BOUNDS;
          if (eyeshadowBounds) {
            const lids = pairOfRegions(eyeshadowBounds);
            await enabled.check({ timeout: 5_000 });
            await page
              .getByRole("checkbox", { name: "启用腮红" })
              .check({ timeout: 5_000 });
            const otherLayers = await pixels(canvas);
            const eyeshadow = page.getByRole("checkbox", { name: "启用眼影" });
            await eyeshadow.check({ timeout: 5_000 });
            const changes = countChanges(
              otherLayers,
              await pixels(canvas),
              lids,
            );
            assert.ok(
              changes.inside.every((count) => count >= 10),
              `两侧上眼睑变化不足：${changes.inside}`,
            );
            assert.equal(
              changes.outside,
              0,
              "人工标定的上眼睑范围外必须保持不变",
            );
            await eyeshadow.uncheck({ timeout: 5_000 });
            assert.ok(
              (await pixels(canvas)).bytes.equals(otherLayers.bytes),
              "真人照片关闭眼影后口红和腮红保持原样",
            );
            assert.deepEqual(external, []);
            console.log(
              `真人眼影验收：双眼上眼睑范围内分别变化 ${changes.inside.join("、")} 个像素，范围外 0，关闭后保留口红和腮红。`,
            );
          }
        },
        async () => ({
          MAKEUPMIRROR_SMOKE_PHOTO_SELECTIONS: JSON.stringify([realPhoto]),
          MAKEUPMIRROR_SMOKE_FACE_DIR: realRuntime,
        }),
      ),
  );
}

test(
  "单人照片上三层妆容可独立编辑，眼球、眉毛和其他区域不变",
  { timeout: 45_000 },
  () =>
    withDesktop(
      async (page) => {
        const pick = page.getByRole("button", { name: "选择本机照片" });
        const analyse = page.getByRole("button", { name: "分析面部" });
        const preview = page.getByRole("img", { name: "试妆预览" });
        const enabled = page.getByRole("checkbox", { name: "启用口红" });
        const color = page.getByLabel("口红颜色");
        const intensity = page.getByRole("slider", { name: "口红强度" });
        await pick.click({ timeout: 5_000 });
        await analyse.click({ timeout: 5_000 });
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
            if (
              original.bytes.readUInt32LE(i) === painted.bytes.readUInt32LE(i)
            )
              continue;
            changed++;
            if (x < 85 || x > 155 || y < 140 || y > 180) outside++;
          }
        }
        assert.ok(changed > 0, "启用后应实际改变唇区像素");
        assert.equal(outside, 0, "唇区之外不得改变任何像素");
        const protectionPoint = (160 * original.width + 120) * 4;
        assert.equal(
          painted.bytes.readUInt32LE(protectionPoint),
          original.bytes.readUInt32LE(protectionPoint),
        );

        await color.fill("#2556bf", { timeout: 5_000 });
        const blue = await pixels(preview);
        const lipPoint = (150 * original.width + 120) * 4;
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

        const blush = page.getByRole("checkbox", { name: "启用腮红" });
        const blushColor = page.getByLabel("腮红颜色");
        const blushStrength = page.getByRole("slider", { name: "腮红强度" });
        await blush.waitFor({ timeout: 5_000 });
        assert.equal(await blush.isChecked(), false);
        await blush.check({ timeout: 5_000 });
        const both = await pixels(preview);
        let left = 0;
        let right = 0;
        let spill = 0;
        for (let y = 0; y < original.height; y++) {
          for (let x = 0; x < original.width; x++) {
            const i = (y * original.width + x) * 4;
            if (both.bytes.readUInt32LE(i) === strongest.bytes.readUInt32LE(i))
              continue;
            if (y >= 117 && y <= 149 && x >= 46 && x <= 86) left++;
            else if (y >= 117 && y <= 149 && x >= 154 && x <= 194) right++;
            else spill++;
          }
        }
        assert.ok(left > 0 && right > 0, "腮红应同时改变两侧脸颊");
        assert.equal(spill, 0, "腮红不应改变双颊之外或口红层的像素");
        const cheekPoint = (133 * original.width + 66) * 4;
        await blushColor.fill("#2556bf", { timeout: 5_000 });
        const blueBlush = await pixels(preview);
        assert.ok(blueBlush.bytes[cheekPoint + 2] > both.bytes[cheekPoint + 2]);
        await blushStrength.press("Home", { timeout: 5_000 });
        assert.ok(
          (await pixels(preview)).bytes.equals(strongest.bytes),
          "腮红归零后只保留口红",
        );
        await blushStrength.press("End", { timeout: 5_000 });
        const fullBlush = await pixels(preview);
        assert.ok(
          fullBlush.bytes[cheekPoint + 2] > blueBlush.bytes[cheekPoint + 2],
        );
        await enabled.uncheck({ timeout: 5_000 });
        assert.equal(
          (await pixels(preview)).bytes.readUInt32LE(cheekPoint),
          fullBlush.bytes.readUInt32LE(cheekPoint),
        );
        await enabled.check({ timeout: 5_000 });
        await blush.uncheck({ timeout: 5_000 });
        assert.ok(
          (await pixels(preview)).bytes.equals(strongest.bytes),
          "关闭腮红后口红保持原样",
        );
        await enabled.uncheck({ timeout: 5_000 });
        assert.ok(
          (await pixels(preview)).bytes.equals(original.bytes),
          "两层关闭后恢复原图",
        );

        await enabled.check({ timeout: 5_000 });
        await blush.check({ timeout: 5_000 });
        const withoutEyeshadow = await pixels(preview);
        const eyeshadow = page.getByRole("checkbox", { name: "启用眼影" });
        const shadowColor = page.getByLabel("眼影颜色");
        const shadowStrength = page.getByRole("slider", { name: "眼影强度" });
        await eyeshadow.waitFor({ timeout: 5_000 });
        assert.equal(await eyeshadow.isChecked(), false);
        await eyeshadow.check({ timeout: 5_000 });
        const withEyeshadow = await pixels(preview);
        const shadowChanges = countChanges(withoutEyeshadow, withEyeshadow, [
          [66 / 240, 82 / 240, 98 / 240, 94 / 240],
          [142 / 240, 82 / 240, 174 / 240, 94 / 240],
        ]);
        assert.ok(
          shadowChanges.inside.every((count) => count > 0),
          "两个上眼睑都应改变",
        );
        assert.equal(
          shadowChanges.outside,
          0,
          "眼影不得改变眼球、眉毛和其他图层的像素",
        );
        for (const x of [82, 158])
          for (const y of [80, 96]) {
            const i = (y * original.width + x) * 4;
            assert.equal(
              withEyeshadow.bytes.readUInt32LE(i),
              withoutEyeshadow.bytes.readUInt32LE(i),
            );
          }
        const lidPoint = (88 * original.width + 82) * 4;
        await shadowColor.fill("#2556bf", { timeout: 5_000 });
        const blueShadow = await pixels(preview);
        assert.ok(
          blueShadow.bytes[lidPoint + 2] > withEyeshadow.bytes[lidPoint + 2],
        );
        await shadowStrength.press("Home", { timeout: 5_000 });
        assert.ok(
          (await pixels(preview)).bytes.equals(withoutEyeshadow.bytes),
          "眼影归零不影响其他层",
        );
        await shadowStrength.press("End", { timeout: 5_000 });
        assert.ok(
          (await pixels(preview)).bytes[lidPoint + 2] >
            blueShadow.bytes[lidPoint + 2],
        );
        await eyeshadow.uncheck({ timeout: 5_000 });
        assert.ok(
          (await pixels(preview)).bytes.equals(withoutEyeshadow.bytes),
          "关闭眼影不影响口红与腮红",
        );
        await enabled.uncheck({ timeout: 5_000 });
        await blush.uncheck({ timeout: 5_000 });
        assert.ok(
          (await pixels(preview)).bytes.equals(original.bytes),
          "三层关闭后恢复原图",
        );

        for (const message of ["没有检测到人脸", "检测到多张人脸"]) {
          await pick.click({ timeout: 5_000 });
          await analyse.click({ timeout: 5_000 });
          await page
            .getByText(message, { exact: false })
            .waitFor({ timeout: 5_000 });
          await preview.waitFor({ state: "hidden", timeout: 5_000 });
          await page
            .getByRole("img", { name: "本机原图预览" })
            .waitFor({ timeout: 5_000 });
        }
      },
      async (profile) => {
        const portrait = join(profile, "portrait.png");
        const noFace = join(profile, "no-face.png");
        const multiple = join(profile, "multiple.png");
        await writeFile(
          portrait,
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAPAAAADwAQMAAAAEm3vRAAAABlBMVEWnX2QAAACveaDXAAAAHklEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAMCnAR0QAAFQm+8DAAAAAElFTkSuQmCC",
            "base64",
          ),
        );
        await writeFile(
          noFace,
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGOsULJgYGBgYmBgQFAAECoA2HBD9oMAAAAASUVORK5CYII=",
            "base64",
          ),
        );
        await writeFile(
          multiple,
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVR4nGNUqrBgYGBgYGBgYoABAA7qANbzEZPkAAAAAElFTkSuQmCC",
            "base64",
          ),
        );
        await writeFile(
          join(profile, "face_landmarker.task"),
          "test boundary only",
        );
        // This module replaces only the external model; the photo, UI and renderer are real.
        await writeFile(
          join(profile, "vision_bundle.mjs"),
          `
        export const FilesetResolver = { forVisionTasks: async () => ({}) };
        export const FaceLandmarker = { createFromOptions: async (_, options) => ({
          detect(image) {
            if (options.numFaces !== 2) throw Error('multi-face detection must be enabled');
            const face = [];
            const loops = [
              [[61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146], 30, 16],
              [[78,191,80,81,82,13,312,311,310,415,308,324,318,402,317,14,87,178,88,95], 15, 5],
            ];
            for (const [ids, rx, ry] of loops) ids.forEach((id, i) => {
              const angle = i / ids.length * Math.PI * 2 + Math.PI;
              face[id] = {x: (120 + Math.cos(angle) * rx) / 240, y: (160 + Math.sin(angle) * ry) / 240};
            });
            for (const [id, x, y] of [[33, 66, 95], [263, 174, 95], [205, 66, 133], [425, 174, 133], [234, 45, 133], [454, 195, 133]]) {
              face[id] = {x: x / 240, y: y / 240};
            }
            for (const [upper, brow, start, direction] of [
              [[33,246,161,160,159,158,157,173,133], [46,53,52,65,55], 66, 1],
              [[263,466,388,387,386,385,384,398,362], [276,283,282,295,285], 174, -1],
            ]) {
              upper.forEach((id, i) => { face[id] = { x: (start + direction * 4 * i) / 240, y: (95 - 4 * Math.sin(Math.PI * i / 8)) / 240 }; });
              brow.forEach((id, i) => { face[id] = { x: (start + direction * 8 * i) / 240, y: 81 / 240 }; });
            }
            return {faceLandmarks: image.width === 240 ? [face] : image.width === 2 ? [] : [face, face]};
          },
          close() {},
        }) };
      `,
        );
        return {
          MAKEUPMIRROR_SMOKE_PHOTO_SELECTIONS: JSON.stringify([
            portrait,
            noFace,
            multiple,
          ]),
          MAKEUPMIRROR_SMOKE_FACE_DIR: profile,
          MAKEUPMIRROR_SMOKE_FACE_FIXTURE: "1",
        };
      },
    ),
);
