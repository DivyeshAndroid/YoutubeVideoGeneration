import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("an empty model setting uses the project default instead of a machine-wide Codex model", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    "import { config } from './src/config.ts'; console.log(config.CODEX_MODEL);"], {
    env: { ...process.env, CODEX_MODEL: "", EDGE_TTS_VOICE: "en-US-AriaNeural", CLIPCHAMP_VOICE_NAME: "Aria" },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "gpt-6.1-sol");
});
