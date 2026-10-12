import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { installedCodexPath } from "../src/platform.js";

test("discovers the newest installed Codex executable without PATH", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-discovery-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const version of ["old", "new", "incomplete"]) fs.mkdirSync(path.join(root, version));
  const old = path.join(root, "old", "codex.exe");
  const newest = path.join(root, "new", "codex.exe");
  fs.writeFileSync(old, "");
  fs.writeFileSync(newest, "");
  fs.utimesSync(old, 1, 1);
  fs.utimesSync(newest, 2, 2);
  assert.equal(installedCodexPath(root), newest);
});

test("missing Codex installation falls back without throwing", () => {
  assert.equal(installedCodexPath(path.join(os.tmpdir(), "missing-codex-installation")), undefined);
});
