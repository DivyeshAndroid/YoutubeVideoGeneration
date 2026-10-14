import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function checkVoice(edgeVoice: string, clipchampVoice = "Aria") {
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", "import './src/config.ts';"], {
    env: { ...process.env, EDGE_TTS_VOICE: edgeVoice, CLIPCHAMP_VOICE_NAME: clipchampVoice },
    encoding: "utf8"
  });
}

test("narration configuration accepts only approved female Edge voices", () => {
  assert.equal(checkVoice("en-US-AriaNeural").status, 0);
  assert.equal(checkVoice("en-US-JennyNeural", "Jenny").status, 0);
  assert.notEqual(checkVoice("en-US-GuyNeural").status, 0);
  assert.notEqual(checkVoice("en-US-AriaNeural", "Guy").status, 0);
});
