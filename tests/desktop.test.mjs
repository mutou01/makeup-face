import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { createServer as createHTTPServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
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
    await run(page, profile);
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
          .getByText("请先配置云端人脸分析接口和密钥", { exact: false })
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

test("供应商默认关闭，只保存 HTTPS 设置且不回填密钥", { timeout: 45_000 }, () =>
  withDesktop(async (page, profile) => {
    const settings = page.getByRole("region", { name: "AI 解释设置" });
    const enabled = settings.getByRole("checkbox", { name: "启用 AI 解释" });
    const endpoint = settings.getByLabel("HTTPS 接口", { exact: true });
    const model = settings.getByLabel("模型编号", { exact: true });
    const key = settings.getByLabel("供应商密钥", { exact: true });
    const save = settings.getByRole("button", { name: "保存供应商设置" });
    const file = join(profile, "provider.json");
    const marker = `fixture-${randomUUID()}`;
    await enabled.waitFor({ timeout: 5_000 });
    assert.equal(await enabled.isChecked(), false);
    assert.equal(await key.inputValue(), "");
    await endpoint.fill("http://fixture.test/v1/chat/completions");
    await model.fill("fixture-model");
    await enabled.check({ timeout: 5_000 });
    await key.fill(marker);
    await save.click({ timeout: 5_000 });
    await settings
      .getByText("仅支持 HTTPS", { exact: false })
      .waitFor({ timeout: 5_000 });
    await assert.rejects(access(file), { code: "ENOENT" });

    const uri = "https://fixture.test/v1/chat/completions";
    await endpoint.fill(uri);
    await key.fill(marker);
    await save.click({ timeout: 5_000 });
    await settings
      .getByText("供应商设置已保存。", { exact: true })
      .waitFor({ timeout: 5_000 });
    const disk = await readFile(file, "utf8");
    assert.equal(JSON.parse(disk).endpoint, uri);
    assert.equal(JSON.parse(disk).enabled, true);
    assert.ok(!disk.includes(marker), "本机设置文件不应写入密钥");
    assert.equal(await key.inputValue(), "");

    await page.reload({ timeout: 10_000 });
    await settings
      .getByText("密钥已保存", { exact: true })
      .waitFor({ timeout: 5_000 });
    assert.equal(await key.inputValue(), "");
    assert.equal(await endpoint.inputValue(), uri);
    assert.equal(await enabled.isChecked(), true);
    await endpoint.fill("https://another.test/v1/chat/completions");
    await save.click({ timeout: 5_000 });
    await settings
      .getByText("更换接口须重新填写密钥", { exact: false })
      .waitFor({ timeout: 5_000 });
    assert.equal(await readFile(file, "utf8"), disk);

    await settings
      .getByRole("button", { name: "清除已保存密钥" })
      .click({ timeout: 5_000 });
    await settings
      .getByText("已清除密钥，AI 解释已关闭。", { exact: true })
      .waitFor({ timeout: 5_000 });
    assert.equal(await enabled.isChecked(), false);
    assert.equal(
      JSON.parse(await readFile(file, "utf8")).credentialId,
      undefined,
    );
  }),
);

test(
  "AI 解释只按点击发送三个允许字段，失败保留本地理由且关闭项目会取消",
  { timeout: 45_000 },
  async () => {
    const calls = [];
    const marker = `fixture-${randomUUID()}`;
    const held = Promise.withResolvers();
    const canceled = Promise.withResolvers();
    const server = createHTTPServer(async (req, res) => {
      let body = "";
      for await (const part of req) body += part.toString("utf8");
      calls.push({
        url: req.url,
        method: req.method,
        auth: req.headers.authorization,
        body,
      });
      if (calls.length === 1) {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            choices: [{ message: { content: "<em>模拟供应商说明</em>" } }],
          }),
        );
      } else if (calls.length === 2) {
        res
          .writeHead(302, { Location: "https://fixture.test/redirected" })
          .end();
      } else if (calls.length === 3) {
        res.end("invalid json");
      } else if (calls.length === 4) {
        res.on("close", () => canceled.resolve(true));
        held.resolve(true);
      } else {
        res.writeHead(500).end();
      }
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      await withDesktop(
        async (page) => {
          const settings = page.getByRole("region", { name: "AI 解释设置" });
          const panel = page.getByRole("region", { name: "妆容推荐" });
          const generate = panel.getByRole("button", {
            name: "生成莓果夜妆的 AI 解释",
          });
          await panel
            .getByRole("heading", { name: "莓果夜妆" })
            .waitFor({ timeout: 5_000 });
          assert.equal(await generate.count(), 0);
          await settings
            .getByLabel("HTTPS 接口", { exact: true })
            .fill("https://fixture.test/v1/chat/completions");
          await settings
            .getByLabel("模型编号", { exact: true })
            .fill("fixture-model");
          await settings.getByLabel("供应商密钥", { exact: true }).fill(marker);
          await settings
            .getByRole("checkbox", { name: "启用 AI 解释" })
            .check({ timeout: 5_000 });
          await settings
            .getByRole("button", { name: "保存供应商设置" })
            .click({ timeout: 5_000 });
          await settings
            .getByText("供应商设置已保存。", { exact: true })
            .waitFor({ timeout: 5_000 });
          await panel
            .getByLabel("场景", { exact: true })
            .selectOption({ label: "聚会" });
          await panel
            .getByLabel("妆感偏好", { exact: true })
            .selectOption({ label: "暖色" });
          await panel
            .getByText("fixture.test", { exact: false })
            .waitFor({ timeout: 5_000 });
          assert.equal(calls.length, 0);
          const reason = panel.getByText("符合聚会场景", { exact: false });
          await generate.click({ timeout: 5_000 });
          await panel
            .getByText("<em>模拟供应商说明</em>", { exact: true })
            .waitFor({ timeout: 5_000 });
          assert.equal(await panel.locator("em").count(), 0);
          await reason.waitFor({ timeout: 5_000 });
          assert.equal(calls.length, 1);
          assert.equal(calls[0].url, "/v1/chat/completions");
          assert.equal(calls[0].method, "POST");
          assert.ok(
            calls[0].auth === `Bearer ${marker}`,
            "仅在鉴权头发送测试密钥",
          );
          const payload = JSON.parse(calls[0].body);
          assert.deepEqual(Object.keys(payload).sort(), [
            "max_tokens",
            "messages",
            "model",
            "stream",
          ]);
          assert.equal(payload.model, "fixture-model");
          assert.deepEqual(
            payload.messages.map((message) => message.role),
            ["system", "user"],
          );
          assert.deepEqual(JSON.parse(payload.messages[1].content), {
            scene: "party",
            look: "warm",
            preset_id: "party-berry",
          });
          assert.ok(!calls[0].body.includes(marker));

          const fallback = panel.getByText(
            "AI 解释暂不可用，仍可参考本地说明。",
            { exact: true },
          );
          for (const count of [2, 3]) {
            await generate.click({ timeout: 5_000 });
            await fallback.waitFor({ timeout: 5_000 });
            await reason.waitFor({ timeout: 5_000 });
            assert.equal(calls.length, count, "失败不重试、不跟随重定向");
          }

          const project = page.getByRole("region", { name: "本机项目" });
          await project
            .getByRole("button", { name: "新建项目" })
            .click({ timeout: 5_000 });
          await project
            .getByText("项目已新建。", { exact: true })
            .waitFor({ timeout: 5_000 });
          await generate.click({ timeout: 5_000 });
          assert.equal(
            await Promise.race([
              held.promise,
              delay(5_000, false, { ref: false }),
            ]),
            true,
          );
          await project
            .getByRole("button", { name: "关闭项目" })
            .click({ timeout: 5_000 });
          assert.equal(
            await Promise.race([
              canceled.promise,
              delay(5_000, false, { ref: false }),
            ]),
            true,
          );
          await settings
            .getByRole("checkbox", { name: "启用 AI 解释" })
            .uncheck({ timeout: 5_000 });
          await settings
            .getByRole("button", { name: "保存供应商设置" })
            .click({ timeout: 5_000 });
          await generate.waitFor({ state: "hidden", timeout: 5_000 });
          assert.equal(calls.length, 4);
        },
        async (profile) => {
          const directory = join(profile, "ai-workspace");
          await mkdir(directory);
          return {
            MAKEUPMIRROR_SMOKE_PROJECT_DIRS: JSON.stringify([directory]),
            MAKEUPMIRROR_SMOKE_PROVIDER_ADDR: `127.0.0.1:${server.address().port}`,
          };
        },
      );
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

test(
  "云端定位逐次确认，保存后离线重开复用关键点",
  { timeout: 45_000 },
  async () => {
    const sent = [];
    const server = createHTTPServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      sent.push({
        path: req.url,
        authorization: req.headers.authorization,
        payload,
      });
      const fixture = makeFaceFixture({
        width: payload.width,
        height: payload.height,
      });
      const points = Array.from(
        { length: 478 },
        (_, i) => fixture.faceLandmarks[0]?.[i] ?? { x: 0.5, y: 0.5 },
      );
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          topology: "mediapipe-478-v1",
          width: payload.width + (sent.length === 1 ? 1 : 0),
          height: payload.height,
          faces: [{ points, pose: fixture.facialTransformationMatrixes[0] }],
        }),
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      await withDesktop(
        async (page, profile) => {
          const settings = page.getByRole("region", {
            name: "云端人脸分析设置",
          });
          await settings
            .getByLabel("人脸网格 HTTPS 接口", { exact: true })
            .fill("https://fixture.test/v1/face-mesh", { timeout: 5_000 });
          await settings
            .getByLabel("人脸分析密钥", { exact: true })
            .fill("fixture-face-key");
          await settings
            .getByRole("button", { name: "保存分析设置" })
            .click({ timeout: 5_000 });
          await settings
            .getByText("分析设置已保存。", { exact: true })
            .waitFor({ timeout: 5_000 });
          const select = page.getByRole("button", { name: "选择本机照片" });
          await select.click({ timeout: 5_000 });
          const original = page.getByRole("img", { name: "本机原图预览" });
          await original.waitFor({ timeout: 5_000 });
          const analyze = page.getByRole("button", {
            name: "分析面部",
            exact: true,
          });
          const dialog = page.getByRole("dialog", { name: "确认发送照片" });
          await analyze.click({ timeout: 5_000 });
          await dialog
            .getByText("https://fixture.test/v1/face-mesh", { exact: false })
            .waitFor({ timeout: 5_000 });
          await dialog
            .getByRole("button", { name: "取消" })
            .click({ timeout: 5_000 });
          assert.equal(sent.length, 0, "取消不上传");
          await analyze.click({ timeout: 5_000 });
          await dialog
            .getByRole("button", { name: "发送照片并分析" })
            .click({ timeout: 5_000 });
          await page
            .getByRole("status", { name: "照片处理状态" })
            .filter({ hasText: "关键点响应不符合约定" })
            .waitFor({ timeout: 5_000 });
          await original.waitFor({ timeout: 5_000 });
          assert.equal(sent.length, 1);
          await analyze.click({ timeout: 5_000 });
          assert.equal(sent.length, 1, "重试也必须先确认");
          await dialog
            .getByRole("button", { name: "发送照片并分析" })
            .click({ timeout: 5_000 });
          await page
            .getByRole("img", { name: "试妆预览" })
            .waitFor({ timeout: 5_000 });
          assert.equal(sent.length, 2);
          assert.equal(sent[1].path, "/v1/face-mesh");
          assert.equal(sent[1].authorization, "Bearer fixture-face-key");
          const payload = sent[1].payload;
          assert.deepEqual(Object.keys(payload).sort(), [
            "height",
            "image",
            "topology",
            "width",
          ]);
          assert.equal(payload.topology, "mediapipe-478-v1");
          const image = Buffer.from(payload.image, "base64");
          assert.equal(image.readUInt32BE(16), 240);
          assert.equal(image.readUInt32BE(20), 240);
          assert.ok(
            !image.includes("eXIf") && !image.includes("PRIVATE_TEST_TAG"),
          );
          const workspace = page.getByRole("region", { name: "本机项目" });
          const click = (name) =>
            workspace
              .getByRole("button", { name, exact: true })
              .click({ timeout: 5_000 });
          const canvas = page.getByRole("img", { name: "试妆预览" });
          await page
            .getByRole("button", { name: "应用日常豆沙" })
            .click({ timeout: 5_000 });
          const applied = await pixels(canvas);
          await click("新建项目");
          await click("保存项目");
          await workspace
            .getByText("项目已保存。", { exact: true })
            .waitFor({ timeout: 5_000 });
          const projectPath = join(profile, "cloud-project", "project.json");
          const saved = JSON.parse(await readFile(projectPath, "utf8"));
          assert.equal(saved.draft.mesh.topology, "mediapipe-478-v1");
          assert.equal(saved.draft.mesh.faces[0].points.length, 478);
          assert.match(saved.draft.photoSha256, /^[a-f0-9]{64}$/);
          assert.ok(!JSON.stringify(saved).includes("fixture-face-key"));
          await click("关闭项目");
          await settings
            .getByRole("button", { name: "清除人脸分析密钥" })
            .click({ timeout: 5_000 });
          await settings
            .getByText("已清除人脸分析密钥。", { exact: true })
            .waitFor({ timeout: 5_000 });
          await click("打开项目");
          await canvas.waitFor({ timeout: 5_000 });
          assert.ok(
            (await pixels(canvas)).bytes.equals(applied.bytes),
            "无供应商凭据时仍能逐像素恢复",
          );
          assert.equal(sent.length, 2, "重开不得上传照片");
          await click("关闭项目");
          saved.photo.bytes = fixturePNG(240, 240, () => [10, 20, 30]).toString(
            "base64",
          );
          await writeFile(projectPath, JSON.stringify(saved));
          await click("打开项目");
          await workspace
            .getByText("该目录没有可读取的妆容项目，或项目文件已损坏。", {
              exact: true,
            })
            .waitFor({ timeout: 5_000 });
          assert.equal(sent.length, 2, "项目照片与关键点不匹配不得上传或恢复");
        },
        async (profile) => {
          const path = join(profile, "cloud-input.png");
          const workspace = join(profile, "cloud-project");
          await mkdir(workspace);
          await writeFile(
            path,
            fixturePNG(240, 240, detailRGB, [
              [
                "eXIf",
                Buffer.from(
                  "4d4d002a000000080002011200030000000100010000013b0002000000110000002600000000505249564154455f544553545f5441470000",
                  "hex",
                ),
              ],
            ]),
          );
          return {
            MAKEUPMIRROR_SMOKE_PHOTO_SELECTIONS: JSON.stringify([path]),
            MAKEUPMIRROR_SMOKE_PROVIDER_ADDR: `127.0.0.1:${server.address().port}`,
            MAKEUPMIRROR_SMOKE_PROJECT_DIRS: JSON.stringify([
              workspace,
              workspace,
              workspace,
            ]),
          };
        },
      );
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
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
  "本机项目只在空目录新建，手动保存后可恢复照片、妆容与偏好",
  { timeout: 60_000 },
  () =>
    withDesktop(
      async (page, profile) => {
        const panel = page.getByRole("region", { name: "本机项目" });
        const create = panel.getByRole("button", { name: "新建项目" });
        const save = panel.getByRole("button", { name: "保存项目" });
        const open = panel.getByRole("button", { name: "打开项目" });
        const close = panel.getByRole("button", { name: "关闭项目" });
        const projectFile = join(profile, "workspace", "project.json");
        await create.click({ timeout: 5_000 });
        await panel
          .getByText("请选择空目录", { exact: false })
          .waitFor({ timeout: 5_000 });
        assert.equal(
          await readFile(join(profile, "occupied", "keep.txt"), "utf8"),
          "keep",
        );
        await assert.rejects(
          access(join(profile, "occupied", "project.json")),
          { code: "ENOENT" },
        );
        await create.click({ timeout: 5_000 });
        await panel
          .getByText("项目已新建", { exact: false })
          .waitFor({ timeout: 5_000 });

        await page
          .getByRole("button", { name: "选择本机照片" })
          .click({ timeout: 5_000 });
        await page
          .getByRole("button", { name: "分析面部" })
          .click({ timeout: 5_000 });
        const canvas = page.getByRole("img", { name: "试妆预览" });
        await canvas.waitFor({ timeout: 5_000 });
        const scene = page.getByLabel("场景", { exact: true });
        const look = page.getByLabel("妆感偏好", { exact: true });
        await scene.selectOption({ label: "聚会" }, { timeout: 5_000 });
        await look.selectOption({ label: "暖色" }, { timeout: 5_000 });
        await page
          .getByRole("button", { name: "应用莓果夜妆" })
          .click({ timeout: 5_000 });
        const lipstick = page.getByRole("slider", { name: "口红强度" });
        await lipstick.press("ArrowLeft", { timeout: 5_000 });
        const beforeSave = await pixels(canvas);
        assert.equal(
          JSON.parse(await readFile(projectFile, "utf8")).photo,
          undefined,
          "选择照片不应自动写入项目",
        );
        await save.click({ timeout: 5_000 });
        await panel
          .getByText("项目已保存", { exact: false })
          .waitFor({ timeout: 5_000 });
        const onDisk = await readFile(projectFile, "utf8");
        const saved = JSON.parse(onDisk);
        assert.equal(saved.version, 1);
        assert.deepEqual(
          Buffer.from(saved.photo.bytes, "base64"),
          await readFile(join(profile, "portrait.png")),
        );
        assert.equal(saved.draft.layers.lipstick.strength, 75);

        await close.click({ timeout: 5_000 });
        await canvas.waitFor({ state: "hidden", timeout: 5_000 });
        await open.click({ timeout: 5_000 });
        await panel
          .getByText("项目已打开", { exact: false })
          .waitFor({ timeout: 5_000 });
        await canvas.waitFor({ timeout: 10_000 });
        assert.equal(await lipstick.inputValue(), "75");
        assert.equal(await scene.inputValue(), "party");
        assert.equal(await look.inputValue(), "warm");
        assert.ok(
          (await pixels(canvas)).bytes.equals(beforeSave.bytes),
          "重开应恢复相同的试妆画布",
        );

        await writeFile(projectFile, `${onDisk}\n`);
        await save.click({ timeout: 5_000 });
        await panel
          .getByText("项目文件已被修改", { exact: false })
          .waitFor({ timeout: 5_000 });
        assert.equal(await readFile(projectFile, "utf8"), `${onDisk}\n`);
      },
      async (profile) => {
        const occupied = join(profile, "occupied");
        const workspace = join(profile, "workspace");
        await mkdir(occupied);
        await mkdir(workspace);
        await writeFile(join(occupied, "keep.txt"), "keep");
        return {
          ...(await makeupFixture(profile, ["portrait"])),
          MAKEUPMIRROR_SMOKE_PROJECT_DIRS: JSON.stringify([
            occupied,
            workspace,
            workspace,
          ]),
        };
      },
    ),
);

test(
  "导出 PNG 与当前试妆像素一致，去除原图元数据且不覆盖文件",
  { timeout: 45_000 },
  () =>
    withDesktop(
      async (page, profile) => {
        const exportButton = page.getByRole("button", { name: "导出预览" });
        await exportButton.waitFor({ timeout: 5_000 });
        assert.equal(await exportButton.isDisabled(), true);
        await page
          .getByRole("button", { name: "选择本机照片" })
          .click({ timeout: 5_000 });
        await page
          .getByRole("button", { name: "分析面部" })
          .click({ timeout: 5_000 });
        const canvas = page.getByRole("img", { name: "试妆预览" });
        await canvas.waitFor({ timeout: 5_000 });
        await page
          .getByRole("button", { name: "应用莓果夜妆" })
          .click({ timeout: 5_000 });

        await exportButton.click({ timeout: 5_000 });
        await page
          .getByText("文件已存在，未覆盖", { exact: false })
          .waitFor({ timeout: 5_000 });
        assert.equal(
          await readFile(join(profile, "existing.png"), "utf8"),
          "keep me",
        );
        await exportButton.click({ timeout: 5_000 });
        await page
          .getByText("预览已导出", { exact: false })
          .waitFor({ timeout: 5_000 });
        const raw = await readFile(join(profile, "exported.png"));
        assert.equal(raw.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
        const source = await readFile(join(profile, "portrait.png"));
        assert.ok(
          source.includes("eXIf") && source.includes("PRIVATE_TEST_TAG"),
        );
        const chunks = [];
        for (let at = 8; at < raw.length;) {
          const size = raw.readUInt32BE(at);
          chunks.push(raw.toString("ascii", at + 4, at + 8));
          at += size + 12;
        }
        assert.deepEqual([...new Set(chunks)], ["IHDR", "IDAT", "IEND"]);
        assert.ok(
          await canvas.evaluate(
            async (expected, bytes) => {
              const bitmap = await createImageBitmap(
                new Blob([Uint8Array.from(bytes)], { type: "image/png" }),
              );
              if (
                bitmap.width !== expected.width ||
                bitmap.height !== expected.height
              )
                return false;
              const copy = document.createElement("canvas");
              copy.width = bitmap.width;
              copy.height = bitmap.height;
              const ctx = copy.getContext("2d");
              ctx.drawImage(bitmap, 0, 0);
              bitmap.close();
              const actual = ctx.getImageData(
                0,
                0,
                copy.width,
                copy.height,
              ).data;
              const wanted = expected
                .getContext("2d")
                .getImageData(0, 0, copy.width, copy.height).data;
              return actual.every((n, i) => n === wanted[i]);
            },
            [...raw],
          ),
          "导出的 PNG 解码像素应与当前画布相同",
        );
      },
      async (profile) => {
        const env = await makeupFixture(profile, ["portrait"]);
        await writeFile(
          join(profile, "portrait.png"),
          fixturePNG(240, 240, detailRGB, [
            [
              "eXIf",
              Buffer.from(
                "4d4d002a000000080002011200030000000100010000013b0002000000110000002600000000505249564154455f544553545f5441470000",
                "hex",
              ),
            ],
          ]),
        );
        const existing = join(profile, "existing.png");
        await writeFile(existing, "keep me");
        return {
          ...env,
          MAKEUPMIRROR_SMOKE_EXPORT_PATHS: JSON.stringify([
            existing,
            join(profile, "exported.png"),
          ]),
        };
      },
    ),
);

test(
  "移除项目照片只清除保存副本和妆容，保留原件、偏好和其他文件",
  { timeout: 45_000 },
  () =>
    withDesktop(
      async (page, profile) => {
        const project = page.getByRole("region", { name: "本机项目" });
        const remove = project.getByRole("button", { name: "移除项目照片" });
        await remove.waitFor({ timeout: 5_000 });
        assert.equal(await remove.isDisabled(), true);
        const original = join(profile, "portrait.png");
        const bytes = await readFile(original);
        const workspace = join(profile, "workspace");
        const snapshot = join(workspace, "project.json");
        const other = join(workspace, "notes.txt");
        await project
          .getByRole("button", { name: "新建项目" })
          .click({ timeout: 5_000 });
        await project
          .getByText("项目已新建。", { exact: true })
          .waitFor({ timeout: 5_000 });
        await writeFile(other, "untouched");
        await page
          .getByRole("button", { name: "选择本机照片" })
          .click({ timeout: 5_000 });
        await page
          .getByRole("button", { name: "分析面部" })
          .click({ timeout: 5_000 });
        await page
          .getByRole("button", { name: "应用蜜桃暖妆" })
          .click({ timeout: 5_000 });
        const scene = page.getByLabel("场景", { exact: true });
        const look = page.getByLabel("妆感偏好", { exact: true });
        await scene.selectOption({ label: "拍照" }, { timeout: 5_000 });
        await look.selectOption({ label: "暖色" }, { timeout: 5_000 });
        await project
          .getByRole("button", { name: "保存项目" })
          .click({ timeout: 5_000 });
        await project
          .getByText("项目已保存。", { exact: true })
          .waitFor({ timeout: 5_000 });
        assert.ok(
          JSON.parse(await readFile(snapshot, "utf8")).draft.layers.eyeshadow
            .enabled,
        );

        await page
          .getByRole("button", { name: "清除预览" })
          .click({ timeout: 5_000 });
        await page
          .getByText("已清除预览。", { exact: true })
          .waitFor({ timeout: 5_000 });
        assert.ok(
          JSON.parse(await readFile(snapshot, "utf8")).photo,
          "清除预览不应移除保存照片",
        );
        await remove.click({ timeout: 5_000 });
        await project
          .getByText("项目照片和妆容已移除。", { exact: true })
          .waitFor({ timeout: 5_000 });
        const remaining = JSON.parse(await readFile(snapshot, "utf8"));
        assert.equal(remaining.photo, undefined);
        assert.equal(remaining.draft, undefined);
        assert.deepEqual(remaining.preferences, {
          scene: "photo",
          look: "warm",
        });
        assert.deepEqual(await readFile(original), bytes);
        assert.equal(await readFile(other, "utf8"), "untouched");

        await project
          .getByRole("button", { name: "关闭项目" })
          .click({ timeout: 5_000 });
        await project
          .getByRole("button", { name: "打开项目" })
          .click({ timeout: 5_000 });
        await project
          .getByText("项目已打开。", { exact: true })
          .waitFor({ timeout: 5_000 });
        await page
          .getByRole("img", { name: "本机原图预览" })
          .waitFor({ state: "hidden", timeout: 5_000 });
        assert.equal(await scene.inputValue(), "photo");
        assert.equal(await look.inputValue(), "warm");
        assert.equal(await remove.isDisabled(), true);
      },
      async (profile) => {
        const workspace = join(profile, "workspace");
        await mkdir(workspace);
        return {
          ...(await makeupFixture(profile, ["portrait"])),
          MAKEUPMIRROR_SMOKE_PROJECT_DIRS: JSON.stringify([
            workspace,
            workspace,
          ]),
        };
      },
    ),
);

test(
  "人脸太小、贴边或姿态不合适时保留原图并阻止试妆",
  { timeout: 45_000 },
  () =>
    withDesktop(
      async (page) => {
        const pick = page.getByRole("button", { name: "选择本机照片" });
        const analyse = page.getByRole("button", { name: "分析面部" });
        const original = page.getByRole("img", { name: "本机原图预览" });
        const preview = page.getByRole("img", { name: "试妆预览" });
        const apply = page.getByRole("button", { name: "应用日常豆沙" });
        for (const message of [
          "人脸太小",
          "人脸靠近照片边缘",
          "头部侧转过大",
          "头部俯仰过大",
          "无法判断头部姿态",
        ]) {
          await pick.click({ timeout: 5_000 });
          await analyse.click({ timeout: 5_000 });
          await page
            .getByRole("status", { name: "照片处理状态" })
            .filter({ hasText: message })
            .waitFor({ timeout: 5_000 });
          await original.waitFor({ timeout: 5_000 });
          await preview.waitFor({ state: "hidden", timeout: 5_000 });
          assert.equal(await apply.isDisabled(), true);
        }
        await pick.click({ timeout: 5_000 });
        await analyse.click({ timeout: 5_000 });
        await preview.waitFor({ timeout: 5_000 });
        assert.equal(await apply.isEnabled(), true);
      },
      (profile) =>
        makeupFixture(profile, [
          "too-small",
          "edge",
          "yaw",
          "pitch",
          "no-pose",
          "portrait",
        ]),
    ),
);

test(
  "过暗、过亮和模糊分别提示重拍，已存项目保持不变",
  { timeout: 45_000 },
  () =>
    withDesktop(
      async (page, profile) => {
        const project = page.getByRole("region", { name: "本机项目" });
        const projectFile = join(profile, "quality-workspace", "project.json");
        const pick = page.getByRole("button", { name: "选择本机照片" });
        const analyse = page.getByRole("button", { name: "分析面部" });
        const original = page.getByRole("img", { name: "本机原图预览" });
        const preview = page.getByRole("img", { name: "试妆预览" });
        const apply = page.getByRole("button", { name: "应用日常豆沙" });
        await project
          .getByRole("button", { name: "新建项目" })
          .click({ timeout: 5_000 });
        await project
          .getByText("项目已新建。", { exact: true })
          .waitFor({ timeout: 5_000 });
        await pick.click({ timeout: 5_000 });
        await analyse.click({ timeout: 5_000 });
        await preview.waitFor({ timeout: 5_000 });
        await apply.click({ timeout: 5_000 });
        const savedPreview = await pixels(preview);
        await project
          .getByRole("button", { name: "保存项目" })
          .click({ timeout: 5_000 });
        await project
          .getByText("项目已保存。", { exact: true })
          .waitFor({ timeout: 5_000 });
        const saved = await readFile(projectFile);

        for (const message of ["脸部过暗", "脸部过亮", "照片明显模糊"]) {
          await pick.click({ timeout: 5_000 });
          await analyse.click({ timeout: 5_000 });
          await page
            .getByRole("status", { name: "照片处理状态" })
            .filter({ hasText: message })
            .waitFor({ timeout: 5_000 });
          await original.waitFor({ timeout: 5_000 });
          await preview.waitFor({ state: "hidden", timeout: 5_000 });
          assert.equal(await apply.isDisabled(), true);
          assert.deepEqual(await readFile(projectFile), saved);
        }
        await project
          .getByRole("button", { name: "关闭项目" })
          .click({ timeout: 5_000 });
        await project
          .getByRole("button", { name: "打开项目" })
          .click({ timeout: 5_000 });
        await preview.waitFor({ timeout: 5_000 });
        assert.ok(
          (await pixels(preview)).bytes.equals(savedPreview.bytes),
          "合格照片仍可恢复相同试妆",
        );
      },
      async (profile) => {
        const workspace = join(profile, "quality-workspace");
        await mkdir(workspace);
        return {
          ...(await makeupFixture(profile, [
            "portrait",
            "dark",
            "bright",
            "blurred",
          ])),
          MAKEUPMIRROR_SMOKE_PROJECT_DIRS: JSON.stringify([
            workspace,
            workspace,
          ]),
        };
      },
    ),
);

function detailRGB(x, y) {
  const offset = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 18 : -18;
  return [167 + offset, 95 + offset, 100 + offset];
}

function fixturePNG(width, height, rgbAt, extraChunks = []) {
  function chunk(name, bytes) {
    const out = Buffer.alloc(12 + bytes.length);
    out.writeUInt32BE(bytes.length);
    out.write(name, 4, "ascii");
    bytes.copy(out, 8);
    out.writeUInt32BE(
      crc32(out.subarray(4, 8 + bytes.length)),
      8 + bytes.length,
    );
    return out;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const stride = width * 3 + 1;
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++)
      rows.set(rgbAt(x, y), y * stride + 1 + x * 3);
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    ...extraChunks.map(([name, bytes]) => chunk(name, bytes)),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test(
  "每层范围只向安全边界内收缩，保存重开兼容旧项目",
  { timeout: 60_000 },
  () =>
    withDesktop(
      async (page, profile) => {
        const project = page.getByRole("region", { name: "本机项目" });
        const click = (name) =>
          project
            .getByRole("button", { name, exact: true })
            .click({ timeout: 5_000 });
        const wait = (message) =>
          project
            .getByText(message, { exact: true })
            .waitFor({ timeout: 5_000 });
        const canvas = page.getByRole("img", { name: "试妆预览" });
        await click("新建项目");
        await wait("项目已新建。");
        await page
          .getByRole("button", { name: "选择本机照片" })
          .click({ timeout: 5_000 });
        await page
          .getByRole("button", { name: "分析面部" })
          .click({ timeout: 5_000 });
        await canvas.waitFor({ timeout: 5_000 });
        await page
          .getByRole("button", { name: "应用莓果夜妆" })
          .click({ timeout: 5_000 });
        const full = await pixels(canvas);
        const names = ["口红", "腮红", "眼影"];
        const ranges = names.map((name) =>
          page.getByRole("slider", { name: `${name}范围`, exact: true }),
        );
        const toggles = names.map((name) =>
          page.getByRole("checkbox", { name: `启用${name}`, exact: true }),
        );
        for (let layer = 0; layer < names.length; layer++) {
          const range = ranges[layer];
          await range.waitFor({ timeout: 5_000 });
          assert.equal(await range.inputValue(), "100");
          await toggles[layer].uncheck({ timeout: 5_000 });
          const otherLayers = await pixels(canvas);
          await toggles[layer].check({ timeout: 5_000 });
          await range.press("Home", { timeout: 5_000 });
          assert.equal(await range.inputValue(), "50");
          const narrowed = await pixels(canvas);
          let fullCount = 0;
          let narrowedCount = 0;
          for (let i = 0; i < full.bytes.length; i += 4) {
            const original = otherLayers.bytes.readUInt32LE(i);
            const changedAtFull = full.bytes.readUInt32LE(i) !== original;
            if (changedAtFull) fullCount++;
            if (narrowed.bytes.readUInt32LE(i) !== original) {
              assert.ok(changedAtFull, `${names[layer]}不能改变原范围外的像素`);
              narrowedCount++;
            }
          }
          assert.ok(
            narrowedCount > 0 && narrowedCount < fullCount,
            `${names[layer]}应保留部分着色并缩小作用范围`,
          );
          await range.press("End", { timeout: 5_000 });
          assert.ok((await pixels(canvas)).bytes.equals(full.bytes));
        }
        for (const range of ranges)
          await range.press("Home", { timeout: 5_000 });
        const saved = await pixels(canvas);
        await click("保存项目");
        await wait("项目已保存。");
        const file = join(profile, "coverage-workspace", "project.json");
        const projectData = JSON.parse(await readFile(file, "utf8"));
        for (const layer of Object.values(projectData.draft.layers))
          assert.equal(layer.coverage, 50);
        await click("关闭项目");
        await click("打开项目");
        await canvas.waitFor({ timeout: 10_000 });
        for (const range of ranges)
          assert.equal(await range.inputValue(), "50");
        assert.ok((await pixels(canvas)).bytes.equals(saved.bytes));

        await click("关闭项目");
        projectData.draft.layers.lipstick.coverage = 101;
        await writeFile(file, JSON.stringify(projectData));
        await click("打开项目");
        await wait("该目录没有可读取的妆容项目，或项目文件已损坏。");
        await canvas.waitFor({ state: "hidden", timeout: 5_000 });
        for (const layer of Object.values(projectData.draft.layers))
          delete layer.coverage;
        await writeFile(file, JSON.stringify(projectData));
        await click("打开项目");
        await canvas.waitFor({ timeout: 10_000 });
        for (const range of ranges)
          assert.equal(await range.inputValue(), "100");
        assert.ok(
          (await pixels(canvas)).bytes.equals(full.bytes),
          "旧项目应恢复原安全范围",
        );
      },
      async (profile) => {
        const workspace = join(profile, "coverage-workspace");
        await mkdir(workspace);
        return {
          ...(await makeupFixture(profile, ["portrait"])),
          MAKEUPMIRROR_SMOKE_PROJECT_DIRS: JSON.stringify([
            workspace,
            workspace,
            workspace,
            workspace,
          ]),
        };
      },
    ),
);

test(
  "原图切换不改妆容，两个显示模式均按当前画布导出",
  { timeout: 45_000 },
  () =>
    withDesktop(
      async (page, profile) => {
        const compare = page.getByRole("checkbox", {
          name: "查看原图",
          exact: true,
        });
        const canvas = page.getByRole("img", { name: "试妆预览" });
        const pick = page.getByRole("button", { name: "选择本机照片" });
        const analyse = page.getByRole("button", { name: "分析面部" });
        const exportButton = page.getByRole("button", { name: "导出预览" });
        const photoStatus = page.getByRole("status", { name: "照片处理状态" });
        await compare.waitFor({ state: "hidden", timeout: 5_000 });
        await pick.click({ timeout: 5_000 });
        await analyse.click({ timeout: 5_000 });
        await canvas.waitFor({ timeout: 5_000 });
        const original = await pixels(canvas);
        await page
          .getByRole("button", { name: "应用莓果夜妆" })
          .click({ timeout: 5_000 });
        const strength = page.getByRole("slider", {
          name: "口红强度",
          exact: true,
        });
        const range = page.getByRole("slider", {
          name: "口红范围",
          exact: true,
        });
        await range.press("Home", { timeout: 5_000 });
        const madeUp = await pixels(canvas);
        assert.ok(!madeUp.bytes.equals(original.bytes));

        await compare.check({ timeout: 5_000 });
        assert.ok((await pixels(canvas)).bytes.equals(original.bytes));
        assert.equal(
          await page.getByRole("checkbox", { name: "启用口红" }).isChecked(),
          true,
        );
        assert.equal(await strength.inputValue(), "76");
        assert.equal(await range.inputValue(), "50");
        await strength.press("ArrowLeft", { timeout: 5_000 });
        assert.ok(
          (await pixels(canvas)).bytes.equals(original.bytes),
          "查看原图时手动调整不应把妆容画回原图",
        );
        await exportButton.click({ timeout: 5_000 });
        await photoStatus
          .filter({ hasText: "预览已导出。" })
          .waitFor({ timeout: 5_000 });
        await assertPNG(canvas, join(profile, "original.png"));

        await compare.uncheck({ timeout: 5_000 });
        assert.equal(await strength.inputValue(), "75");
        await strength.press("ArrowRight", { timeout: 5_000 });
        assert.ok(
          (await pixels(canvas)).bytes.equals(madeUp.bytes),
          "切回应保留所有妆容参数",
        );
        await exportButton.click({ timeout: 5_000 });
        await photoStatus
          .filter({ hasText: "预览已导出。" })
          .waitFor({ timeout: 5_000 });
        await assertPNG(canvas, join(profile, "made-up.png"));

        await compare.check({ timeout: 5_000 });
        await pick.click({ timeout: 5_000 });
        await analyse.click({ timeout: 5_000 });
        await compare.waitFor({ timeout: 5_000 });
        assert.equal(
          await compare.isChecked(),
          false,
          "换图后退出原图对比模式",
        );
      },
      async (profile) => ({
        ...(await makeupFixture(profile, ["portrait", "portrait"])),
        MAKEUPMIRROR_SMOKE_EXPORT_PATHS: JSON.stringify([
          join(profile, "original.png"),
          join(profile, "made-up.png"),
        ]),
      }),
    ),
);

async function assertPNG(canvas, path) {
  const png = await readFile(path);
  assert.ok(
    await canvas.evaluate(async (expected, encoded) => {
      const bitmap = await createImageBitmap(
        new Blob([Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0))], {
          type: "image/png",
        }),
      );
      const copy = document.createElement("canvas");
      copy.width = bitmap.width;
      copy.height = bitmap.height;
      if (copy.width !== expected.width || copy.height !== expected.height) {
        bitmap.close();
        return false;
      }
      const ctx = copy.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const actual = ctx.getImageData(0, 0, copy.width, copy.height).data;
      const wanted = expected
        .getContext("2d")
        .getImageData(0, 0, copy.width, copy.height).data;
      return actual.every((n, i) => n === wanted[i]);
    }, png.toString("base64")),
    "导出的 PNG 应与当前画布逐像素一致",
  );
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
        async (page, profile) => {
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
              `真实模型未生成预览：${await page.getByRole("status", { name: "照片处理状态" }).textContent()}；${runtimeFailures.join("；")}`,
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

          if (blushBounds && eyeshadowBounds) {
            const regions = [
              region,
              ...pairOfRegions(blushBounds),
              ...pairOfRegions(eyeshadowBounds),
            ];
            await page
              .getByRole("button", { name: "应用日常豆沙", exact: true })
              .click({ timeout: 5_000 });
            const combined = countChanges(
              original,
              await pixels(canvas),
              regions,
            );
            assert.ok(
              combined.inside.every((count) => count > 0),
              `预设未覆盖所有定位区域：${combined.inside}`,
            );
            assert.equal(combined.outside, 0, "真人一键应用不影响妆容范围外");
            assert.deepEqual(external, []);
            console.log(
              `真人预设验收：唇部、双颊和双眼共五处变化 ${combined.inside.join("、")} 个像素，范围外 0。`,
            );
            const fullPreview = await pixels(canvas);
            const ranges = ["口红", "腮红", "眼影"].map((name) =>
              page.getByRole("slider", { name: `${name}范围`, exact: true }),
            );
            for (const range of ranges)
              await range.press("Home", { timeout: 5_000 });
            const narrowed = await pixels(canvas);
            const changes = countChanges(original, narrowed, regions);
            const total = (counts) =>
              counts.reduce((sum, count) => sum + count, 0);
            assert.ok(
              changes.inside.every((count) => count > 0),
              "真人照片收缩后仍保留妆容",
            );
            assert.equal(changes.outside, 0);
            assert.ok(
              total(changes.inside) < total(combined.inside),
              "真人照片的着色范围应缩小",
            );
            const compare = page.getByRole("checkbox", {
              name: "查看原图",
              exact: true,
            });
            await compare.check({ timeout: 5_000 });
            assert.ok((await pixels(canvas)).bytes.equals(original.bytes));
            await compare.uncheck({ timeout: 5_000 });
            assert.ok((await pixels(canvas)).bytes.equals(narrowed.bytes));
            for (const range of ranges)
              await range.press("End", { timeout: 5_000 });
            assert.ok((await pixels(canvas)).bytes.equals(fullPreview.bytes));
            console.log(
              `真人精调验收：着色像素从 ${total(combined.inside)} 缩至 ${total(changes.inside)}，原图与妆后切换逐像素一致。`,
            );
          }
          if (process.env.MAKEUPMIRROR_REAL_PROJECT === "1") {
            const workspace = page.getByRole("region", { name: "本机项目" });
            const click = (name) =>
              workspace
                .getByRole("button", { name, exact: true })
                .click({ timeout: 5_000 });
            const wait = (message) =>
              workspace
                .getByText(message, { exact: true })
                .waitFor({ timeout: 10_000 });
            const prior = await pixels(canvas);
            await click("新建项目");
            await wait("项目已新建。");
            await click("保存项目");
            await wait("项目已保存。");
            await page
              .getByRole("button", { name: "导出预览" })
              .click({ timeout: 5_000 });
            await page
              .getByText("预览已导出。", { exact: true })
              .waitFor({ timeout: 10_000 });
            const exported = await readFile(join(profile, "real-export.png"));
            assert.equal(exported.readUInt32BE(16), prior.width);
            assert.equal(exported.readUInt32BE(20), prior.height);
            await click("关闭项目");
            await click("打开项目");
            await wait("项目已打开。");
            await canvas.waitFor({ timeout: 10_000 });
            assert.ok((await pixels(canvas)).bytes.equals(prior.bytes));
            await click("移除项目照片");
            await wait("项目照片和妆容已移除。");
            const remaining = JSON.parse(
              await readFile(
                join(profile, "real-workspace", "project.json"),
                "utf8",
              ),
            );
            assert.equal(remaining.photo, undefined);
            assert.equal(remaining.draft, undefined);
            assert.deepEqual(external, []);
            console.log(
              `真人项目验收：恢复 ${prior.width} × ${prior.height} 画布一致，导出 ${exported.length} 字节 PNG，项目照片和草稿可移除。`,
            );
          }
        },
        async (profile) => {
          const env = {
            MAKEUPMIRROR_SMOKE_PHOTO_SELECTIONS: JSON.stringify([realPhoto]),
            MAKEUPMIRROR_SMOKE_FACE_DIR: realRuntime,
          };
          if (process.env.MAKEUPMIRROR_REAL_PROJECT === "1") {
            const workspace = join(profile, "real-workspace");
            await mkdir(workspace);
            env.MAKEUPMIRROR_SMOKE_PROJECT_DIRS = JSON.stringify([
              workspace,
              workspace,
            ]);
            env.MAKEUPMIRROR_SMOKE_EXPORT_PATHS = JSON.stringify([
              join(profile, "real-export.png"),
            ]);
          }
          return env;
        },
      ),
  );
}

test(
  "单人照片上三层妆容可独立编辑，眼球、眉毛和其他区域不变",
  { timeout: 45_000 },
  () =>
    withDesktop(async (page) => {
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
          if (original.bytes.readUInt32LE(i) === painted.bytes.readUInt32LE(i))
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
    }, makeupFixture),
);

async function makeupFixture(
  profile,
  order = ["portrait", "no-face", "multiple"],
) {
  const portrait = join(profile, "portrait.png");
  const noFace = join(profile, "no-face.png");
  const multiple = join(profile, "multiple.png");
  const partial = join(profile, "partial.png");
  await writeFile(portrait, fixturePNG(240, 240, detailRGB));
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
  if (order.includes("partial"))
    await writeFile(partial, fixturePNG(240, 239, detailRGB));
  const framing = {
    "too-small": 241,
    edge: 242,
    yaw: 243,
    pitch: 244,
    "no-pose": 245,
  };
  for (const [name, width] of Object.entries(framing)) {
    if (order.includes(name))
      await writeFile(
        join(profile, `${name}.png`),
        fixturePNG(width, 240, () => [167, 95, 100]),
      );
  }
  const imageQuality = {
    dark: [246, 19],
    bright: [247, 249],
    blurred: [248, 125],
  };
  for (const [name, [width, tone]] of Object.entries(imageQuality)) {
    if (order.includes(name))
      await writeFile(
        join(profile, `${name}.png`),
        fixturePNG(width, 240, (x, y) => {
          const value =
            tone + Math.round(4 * Math.sin(x / 23) * Math.cos(y / 31));
          return [value, value, value];
        }),
      );
  }
  await writeFile(join(profile, "face_landmarker.task"), "test boundary only");
  // This module replaces only the external model; the photo, UI and renderer are real.
  await writeFile(
    join(profile, "vision_bundle.mjs"),
    `
        export const FilesetResolver = { forVisionTasks: async () => ({}) };
        export const FaceLandmarker = { createFromOptions: async (_, options) => ({
          detect(image) {
            if (options.numFaces !== 2) throw Error('multi-face detection must be enabled');
            return (${makeFaceFixture.toString()})(image);
          },
          close() {},
        }) };
      `,
  );
  const files = { portrait, "no-face": noFace, multiple, partial };
  for (const name of [...Object.keys(framing), ...Object.keys(imageQuality)])
    files[name] = join(profile, `${name}.png`);
  return {
    MAKEUPMIRROR_SMOKE_PHOTO_SELECTIONS: JSON.stringify(
      order.map((name) => files[name]),
    ),
    MAKEUPMIRROR_SMOKE_FACE_DIR: profile,
    MAKEUPMIRROR_SMOKE_FACE_FIXTURE: "1",
  };
}

function makeFaceFixture(image) {
  const face = [];
  const loops = [
    [
      [
        61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17,
        84, 181, 91, 146,
      ],
      30,
      16,
    ],
    [
      [
        78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317,
        14, 87, 178, 88, 95,
      ],
      15,
      5,
    ],
  ];
  for (const [ids, rx, ry] of loops)
    ids.forEach((id, i) => {
      const angle = (i / ids.length) * Math.PI * 2 + Math.PI;
      face[id] = {
        x: (120 + Math.cos(angle) * rx) / 240,
        y: (160 + Math.sin(angle) * ry) / 240,
      };
    });
  for (const [id, x, y] of [
    [33, 66, 95],
    [263, 174, 95],
    [205, 66, 133],
    [425, 174, 133],
    [234, 45, 133],
    [454, 195, 133],
  ]) {
    face[id] = { x: x / 240, y: y / 240 };
  }
  for (const [upper, brow, start, direction] of [
    [[33, 246, 161, 160, 159, 158, 157, 173, 133], [46, 53, 52, 65, 55], 66, 1],
    [
      [263, 466, 388, 387, 386, 385, 384, 398, 362],
      [276, 283, 282, 295, 285],
      174,
      -1,
    ],
  ]) {
    upper.forEach((id, i) => {
      face[id] = {
        x: (start + direction * 4 * i) / 240,
        y: (95 - 4 * Math.sin((Math.PI * i) / 8)) / 240,
      };
    });
    brow.forEach((id, i) => {
      face[id] = { x: (start + direction * 8 * i) / 240, y: 81 / 240 };
    });
  }
  if (image.height === 239) delete face[46]; // Only the eye layer is unavailable.
  face[10] = { x: 0.5, y: 0.18 };
  face[152] = { x: 0.5, y: 0.81 };
  if (image.width === 241)
    for (const point of face)
      if (point) {
        point.x = 0.5 + (point.x - 0.5) * 0.4;
        point.y = 0.5 + (point.y - 0.5) * 0.4;
      }
  if (image.width === 242) face[234].x = 0.009;
  const yaw = image.width === 243 ? Math.PI / 4 : 0;
  const pitch = image.width === 244 ? Math.PI / 5 : 0;
  const c = Math.cos(yaw),
    s = Math.sin(yaw),
    cp = Math.cos(pitch),
    sp = Math.sin(pitch);
  const matrix = {
    rows: 4,
    columns: 4,
    data: [
      c,
      0,
      -s,
      0,
      s * sp,
      cp,
      c * sp,
      0,
      s * cp,
      -sp,
      c * cp,
      0,
      0,
      0,
      0,
      1,
    ],
  };
  return {
    faceLandmarks:
      image.width >= 240 ? [face] : image.width === 2 ? [] : [face, face],
    facialTransformationMatrixes: image.width === 245 ? [] : [matrix],
  };
}

test("一键应用推荐只改变可用图层，仍可手动编辑", { timeout: 45_000 }, () =>
  withDesktop(
    async (page) => {
      const panel = page.getByRole("region", { name: "妆容推荐" });
      const apply = (name) =>
        panel.getByRole("button", { name: `应用${name}`, exact: true });
      const berry = apply("莓果夜妆");
      await berry.waitFor({ timeout: 5_000 });
      assert.equal(await berry.isDisabled(), true);

      const pick = page.getByRole("button", { name: "选择本机照片" });
      const analyse = page.getByRole("button", { name: "分析面部" });
      const preview = page.getByRole("img", { name: "试妆预览" });
      await pick.click({ timeout: 5_000 });
      await analyse.click({ timeout: 5_000 });
      await preview.waitFor({ timeout: 5_000 });
      const original = await pixels(preview);
      await berry.click({ timeout: 5_000 });
      await panel
        .getByText("已应用「莓果夜妆」", { exact: false })
        .waitFor({ timeout: 5_000 });

      for (const [name, color, strength] of [
        ["口红", "#832d53", "76"],
        ["腮红", "#ba5573", "53"],
        ["眼影", "#725172", "64"],
      ]) {
        assert.ok(
          await page.getByRole("checkbox", { name: `启用${name}` }).isChecked(),
        );
        assert.equal(await page.getByLabel(`${name}颜色`).inputValue(), color);
        assert.equal(
          await page.getByRole("slider", { name: `${name}强度` }).inputValue(),
          strength,
        );
      }
      const applied = await pixels(preview);
      const offsets = [
        [120, 150],
        [66, 133],
        [82, 88],
      ].map(([x, y]) => (y * original.width + x) * 4);
      for (const offset of offsets)
        assert.notEqual(
          applied.bytes.readUInt32LE(offset),
          original.bytes.readUInt32LE(offset),
        );
      await page
        .getByRole("slider", { name: "口红强度" })
        .press("Home", { timeout: 5_000 });
      const edited = await pixels(preview);
      assert.equal(
        edited.bytes.readUInt32LE(offsets[0]),
        original.bytes.readUInt32LE(offsets[0]),
      );
      for (const offset of offsets.slice(1))
        assert.equal(
          edited.bytes.readUInt32LE(offset),
          applied.bytes.readUInt32LE(offset),
        );
      await panel
        .getByLabel("场景", { exact: true })
        .selectOption({ label: "拍照" }, { timeout: 5_000 });
      assert.ok(
        (await pixels(preview)).bytes.equals(edited.bytes),
        "改筛选条件不能覆盖手动编辑",
      );

      await pick.click({ timeout: 5_000 });
      await analyse.click({ timeout: 5_000 });
      await preview.waitFor({ timeout: 5_000 });
      const eyes = page.getByRole("checkbox", { name: "启用眼影" });
      await eyes.waitFor({ state: "hidden", timeout: 5_000 });
      await apply("日常豆沙").click({ timeout: 5_000 });
      await panel
        .getByText("未定位：眼影", { exact: false })
        .waitFor({ timeout: 5_000 });
      assert.ok(
        await page.getByRole("checkbox", { name: "启用口红" }).isChecked(),
      );
      assert.ok(
        await page.getByRole("checkbox", { name: "启用腮红" }).isChecked(),
      );
      await page
        .getByRole("button", { name: "清除预览" })
        .click({ timeout: 5_000 });
      await page
        .getByText("已清除预览。", { exact: true })
        .waitFor({ timeout: 5_000 });
      assert.equal(await apply("日常豆沙").isDisabled(), true);
    },
    (profile) => makeupFixture(profile, ["portrait", "partial"]),
  ),
);
