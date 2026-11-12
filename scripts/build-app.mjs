import { spawnSync } from "node:child_process";

const smoke = process.argv[2] === "smoke";
const tags = smoke ? "production,desktop_smoke" : "production";
const name = smoke ? "MakeupMirror-smoke.exe" : "MakeupMirror.exe";
const args = [
  "build",
  "-trimpath",
  "-tags",
  tags,
  "-ldflags",
  "-s -w -H=windowsgui",
  "-o",
  `dist/${name}`,
  ".",
];
const result = spawnSync("go", args, {
  stdio: "inherit",
  env: { ...process.env, CGO_ENABLED: "0", GOOS: "windows", GOARCH: "amd64" },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
