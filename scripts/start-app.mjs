import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const executable = fileURLToPath(
  new URL("../dist/MakeupMirror.exe", import.meta.url),
);
const child = spawn(executable, [], { stdio: "inherit", windowsHide: true });
child.once("error", (error) => {
  console.error(
    `无法启动 MakeupMirror，请先执行 npm run build。${error.message}`,
  );
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
