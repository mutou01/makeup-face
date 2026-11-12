import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { directory: { type: "string" }, model: { type: "string" } },
});
const cache = process.env.LOCALAPPDATA;
const directory =
  values.directory ??
  (cache && join(cache, "MakeupMirror", "face-runtime", "v1"));
if (!directory || !isAbsolute(directory))
  throw new Error("请提供模型安装目录的绝对路径。");

const manifest = JSON.parse(
  await readFile(new URL("../face-runtime.json", import.meta.url), "utf8"),
);
const vendor = new URL(
  "../node_modules/@mediapipe/tasks-vision/",
  import.meta.url,
);
const vendorPackage = JSON.parse(
  await readFile(new URL("package.json", vendor), "utf8"),
);
if (vendorPackage.version !== manifest.packageVersion)
  throw new Error("模型运行组件版本不符，请先执行 npm run setup。");

const modelName = "face_landmarker.task";
const assets = new Map();
for (const [name, spec] of Object.entries(manifest.assets)) {
  let data;
  if (name !== modelName) {
    data = await readFile(new URL(spec.source ?? name, vendor));
  } else if (values.model) {
    data = await readFile(values.model);
  } else {
    const response = await fetch(manifest.modelURL, {
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`模型下载失败（${response.status}）。`);
    data = Buffer.from(await response.arrayBuffer());
  }
  if (
    data.length !== spec.size ||
    createHash("sha256").update(data).digest("hex") !== spec.sha256
  ) {
    throw new Error(`校验失败：${name}`);
  }
  assets.set(name, data);
}

await mkdir(directory, { recursive: true });
for (const [name, data] of assets) await writeFile(join(directory, name), data);
console.log("本机人脸模型与运行组件已安装并通过 SHA-256 校验。");
