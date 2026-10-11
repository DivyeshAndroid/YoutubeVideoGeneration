import fs from "node:fs";
import { spawnSync } from "node:child_process";

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  console.error(`Node.js 20+ is required; found ${process.version}.`);
  process.exit(1);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (args) => {
  const result = spawnSync(npm, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run(["ci"]);
for (const directory of ["output", "work", "secrets"]) fs.mkdirSync(directory, { recursive: true });
if (!fs.existsSync(".env")) {
  fs.copyFileSync(".env.example", ".env");
  console.log("Created .env from .env.example. Review provider and upload settings before running.");
} else {
  console.log("Existing .env preserved.");
}
run(["run", "check"]);
console.log("Bootstrap complete. Run 'npm run doctor' to validate configured services.");
