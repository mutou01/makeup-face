import { lstat, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = await realpath(fileURLToPath(new URL("..", import.meta.url)));
for (const directory of ["dist", "frontend/dist"]) {
  const path = join(root, directory);
  const stat = await lstat(path).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (!stat) continue;
  const resolved = await realpath(path);
  const within = relative(root, resolved);
  if (
    !within ||
    isAbsolute(within) ||
    within === ".." ||
    within.startsWith(`..${sep}`)
  ) {
    throw new Error(`拒绝清理项目外路径：${resolved}`);
  }
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    within !== relative(root, path)
  ) {
    throw new Error(`拒绝清理非构建目录：${resolved}`);
  }
  await rm(path, { recursive: true, force: true });
}
