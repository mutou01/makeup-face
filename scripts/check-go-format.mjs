import { spawnSync } from "node:child_process";

const result = spawnSync("gofmt", ["-l", "."], { encoding: "utf8" });
if (result.error) throw result.error;
if (result.stderr) process.stderr.write(result.stderr);
if (result.stdout)
  process.stderr.write(`请先格式化以下 Go 文件：\n${result.stdout}`);
process.exitCode = result.status === 0 && !result.stdout ? 0 : 1;
