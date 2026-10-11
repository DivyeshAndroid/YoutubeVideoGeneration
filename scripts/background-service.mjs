import { spawnSync } from "node:child_process";

const operation = process.argv[2];
if (operation !== "install" && operation !== "uninstall") {
  console.error("Usage: node scripts/background-service.mjs <install|uninstall>");
  process.exit(1);
}

let command;
let args;
if (process.platform === "win32") {
  command = "powershell.exe";
  args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", `scripts/${operation}-background-service.ps1`];
} else if (process.platform === "darwin") {
  command = "zsh";
  args = [`scripts/${operation}-background-service.sh`];
} else {
  console.error("Automatic background-service installation supports Windows and macOS. Use systemd on Linux.");
  process.exit(1);
}

const result = spawnSync(command, args, { stdio: "inherit" });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
