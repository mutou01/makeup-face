import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const [
  source,
  output = join(root, "dist", "MakeupMirror-offline"),
  executable = join(root, "dist", "MakeupMirror.exe"),
  manifest = join(root, "face-runtime.json"),
] = process.argv.slice(2);

try {
  if (!source) throw new Error("请提供包含 MediaPipe 六个文件的本机目录。");
  const { assets } = JSON.parse(await readFile(manifest, "utf8"));
  const verified = [];
  for (const [name, spec] of Object.entries(assets)) {
    if (!/^[a-z0-9_.-]+$/i.test(name) || name === "." || name === "..")
      throw new Error("模型资源清单包含无效文件名。");
    const path = join(source, name);
    const info = await lstat(path).catch((error) => {
      if (error.code === "ENOENT") throw new Error(`缺少资源：${name}`);
      throw error;
    });
    if (!info.isFile() || info.size !== spec.size)
      throw new Error(`资源校验失败：${name}`);
    const bytes = await readFile(path);
    if (createHash("sha256").update(bytes).digest("hex") !== spec.sha256)
      throw new Error(`资源校验失败：${name}`);
    verified.push([name, bytes]);
  }
  if (!verified.length) throw new Error("模型资源清单为空。");
  if (!(await lstat(executable)).isFile())
    throw new Error("请先构建正式版 MakeupMirror.exe。");
  const notices = await readFile(join(root, "docs", "mediapipe-notices.txt"));
  const license = await readFile(join(root, "LICENSE"));
  const outputDir = resolve(output);
  await mkdir(dirname(outputDir), { recursive: true });
  await mkdir(outputDir);
  const runtime = join(outputDir, "face-runtime");
  await mkdir(runtime);
  for (const [name, bytes] of verified)
    await writeFile(join(runtime, name), bytes, { flag: "wx" });
  await writeFile(join(outputDir, "THIRD-PARTY-NOTICES.txt"), notices, {
    flag: "wx",
  });
  await writeFile(join(outputDir, "LICENSE.txt"), license, { flag: "wx" });
  await copyFile(executable, join(outputDir, "MakeupMirror.exe"));
  console.log(`离线交付包：${outputDir}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
