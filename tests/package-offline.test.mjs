import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("离线交付包只包含正式版和经校验的模型资源，拒绝缺失或篡改", async () => {
  const dir = await mkdtemp(join(tmpdir(), "makeupmirror-package-"));
  try {
    const source = join(dir, "assets");
    const executable = join(dir, "MakeupMirror.exe");
    const manifest = join(dir, "manifest.json");
    const output = join(dir, "release");
    const model = "face_landmarker.task";
    const bytes = Buffer.from("test model bytes");
    await mkdir(source);
    await writeFile(executable, "test executable");
    await writeFile(
      manifest,
      JSON.stringify({
        assets: {
          [model]: {
            size: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
        },
      }),
    );
    const run = () =>
      spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL("../scripts/package-offline.mjs", import.meta.url),
          ),
          source,
          output,
          executable,
          manifest,
        ],
        { encoding: "utf8" },
      );
    await writeFile(join(source, "private-photo.png"), "outside allowlist");
    await writeFile(join(source, model), bytes);
    const valid = run();
    assert.equal(valid.status, 0, valid.stderr);
    assert.deepEqual((await readdir(output)).sort(), [
      "LICENSE.txt",
      "MakeupMirror.exe",
      "THIRD-PARTY-NOTICES.txt",
      "face-runtime",
    ]);
    assert.deepEqual(await readdir(join(output, "face-runtime")), [model]);
    assert.deepEqual(
      await readFile(join(output, "face-runtime", model)),
      bytes,
    );

    await writeFile(join(source, model), Buffer.alloc(bytes.length));
    const bad = run();
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /校验失败/);
    await rm(join(source, model));
    const missing = run();
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /缺少/);
    assert.deepEqual(
      await readFile(join(output, "face-runtime", model)),
      bytes,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
