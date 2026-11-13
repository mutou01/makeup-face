import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";

const profile = process.argv[2];
const mode = await readFile(join(profile, "codex-mode"), "utf8").catch(
  (error) => {
    if (error.code !== "ENOENT") throw error;
    return "";
  },
);
const threadId = "fixture-thread";
const turnId = "fixture-turn";
const send = (message) => console.log(JSON.stringify(message));
let initialized = false;

for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line);
  const reply = (result) => send({ id, result });
  switch (method) {
    case "initialize":
      reply({});
      break;
    case "initialized":
      initialized = true;
      break;
    case "account/read":
      assert.equal(initialized, true);
      reply({ account: mode === "signed-out" ? null : { type: "chatgpt" } });
      break;
    case "thread/start":
      assert.notEqual(mode, "signed-out");
      assert.equal(params.ephemeral, true);
      assert.equal(params.sandbox, "read-only");
      assert.equal(params.approvalPolicy, "never");
      assert.equal(params.modelProvider, "openai");
      assert.equal(params.cwd, process.cwd());
      reply({ thread: { id: threadId } });
      break;
    case "turn/start": {
      assert.equal(params.threadId, threadId);
      const [image, text] = params.input;
      assert.equal(image.type, "localImage");
      assert.equal(
        dirname(image.path).toLowerCase(),
        process.cwd().toLowerCase(),
      );
      assert.equal(basename(image.path), "reference.png");
      assert.equal(text.type, "text");
      const reference = await readFile(image.path);
      await writeFile(
        join(profile, "codex-receipt.json"),
        JSON.stringify({
          dimensions: [reference.readUInt32BE(16), reference.readUInt32BE(20)],
          hasPrivateMetadata: reference.includes("PRIVATE_CODEX_TAG"),
          inputCount: params.input.length,
          prompt: text.text,
        }),
      );
      const sha256 = createHash("sha256").update(reference).digest("hex");
      const result = await readFile(
        join(profile, "codex-result.png"),
        "base64",
      );
      // The app must ignore assistant text and accept only the typed result.
      send({
        method: "item/completed",
        params: {
          threadId,
          turnId,
          item: { type: "agentMessage", text: result },
        },
      });
      send({
        method: "item/completed",
        params: {
          threadId,
          turnId,
          item: {
            type: "imageGeneration",
            status: "completed",
            inputImages: [
              {
                path: image.path,
                sha256: mode === "wrong-image" ? "wrong" : sha256,
              },
            ],
            result,
          },
        },
      });
      reply({ turn: { id: turnId, status: "inProgress" } });
      send({
        method: "turn/completed",
        params: { threadId, turn: { id: turnId, status: "completed" } },
      });
      break;
    }
    default:
      throw new Error(`Unexpected Codex request: ${method}`);
  }
}
