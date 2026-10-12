import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectDir = fileURLToPath(new URL("..", import.meta.url));
const logDir = path.join(projectDir, "work", "logs");
fs.mkdirSync(logDir, { recursive: true });
const once = process.argv.includes("--run-once");
const authenticate = once && process.argv.includes("--authenticate");
const logFile = path.join(logDir, once ? "job-now.log" : "scheduler.log");
if (fs.existsSync(logFile)) {
  const existing = fs.readFileSync(logFile);
  // Migrate logs previously written as UTF-16 by Windows PowerShell.
  if (existing[0] === 0xff && existing[1] === 0xfe) fs.writeFileSync(logFile, existing.subarray(2).toString("utf16le"), "utf8");
}
const log = fs.openSync(logFile, "a");
const run = (args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { cwd: projectDir, env: { ...process.env, LEONARDO_INTERACTIVE_AUTH: String(authenticate) }, stdio: ["ignore", log, log], windowsHide: true });
  child.once("error", reject);
  child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
});
let exitCode = 1;
try {
  fs.writeSync(log, `\n[${new Date().toISOString()}] ${once ? "Immediate job" : "Scheduler"} starting.\n`);
  exitCode = await run([path.join(projectDir, "node_modules", "typescript", "bin", "tsc"), "-p", path.join(projectDir, "tsconfig.json")]);
  if (exitCode === 0) exitCode = await run([path.join(projectDir, "dist", "cli.js"), once ? "generate" : "scheduler"]);
} catch (error) {
  exitCode = 1;
  fs.writeSync(log, `${error.stack ?? error}\n`);
} finally {
  fs.writeSync(log, `[${new Date().toISOString()}] Process exited with code ${exitCode}.\n`);
  fs.closeSync(log);
}
process.exitCode = exitCode;
