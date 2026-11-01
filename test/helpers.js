"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
function temporaryDirectory(prefix = "codex-manager-test-") {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
}
function removeTemporaryDirectory(root) {
  const resolved = path.resolve(root);
  const parent = fs.realpathSync(os.tmpdir());
  if (path.dirname(resolved).toLowerCase() !== parent.toLowerCase() || !path.basename(resolved).startsWith("codex-")) {
    throw new Error("Refusing to remove a path outside a Codex test directory.");
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
function installedCodexExtension() {
  if (process.env.CAM_CODEX_EXTENSION) return path.resolve(process.env.CAM_CODEX_EXTENSION);
  const directory = path.join(os.homedir(), ".vscode", "extensions");
  const candidates = fs.readdirSync(directory).filter(name => name.startsWith("openai.chatgpt-")).map(name => {
    const full = path.join(directory, name);
    try { return { full, version: JSON.parse(fs.readFileSync(path.join(full, "package.json"), "utf8")).version }; } catch { return null; }
  }).filter(Boolean).sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  if (!candidates.length) throw new Error("Install OpenAI Codex or set CAM_CODEX_EXTENSION.");
  return candidates[0].full;
}
function vscodeExecutable() {
  if (process.env.CAM_VSCODE_EXE) return path.resolve(process.env.CAM_VSCODE_EXE);
  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft VS Code", "Code.exe")
  ].filter(Boolean);
  const found = candidates.find(file => fs.existsSync(file));
  if (!found) throw new Error("Set CAM_VSCODE_EXE to your VS Code executable.");
  return found;
}
module.exports = { temporaryDirectory, removeTemporaryDirectory, installedCodexExtension, vscodeExecutable };
