"use strict";
const fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const { temporaryDirectory, installedCodexExtension, vscodeExecutable } = require("./helpers");
const manifest = require("../package.json");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  if (process.platform !== "win32") throw new Error("The VS Code integration check currently runs on Windows only.");
  const code = vscodeExecutable(), codex = installedCodexExtension();
  const root = temporaryDirectory("codex-vscode-test-");
  const extensions = path.join(root, "extensions"), data = path.join(root, "user-data");
  const harness = path.join(extensions, "local.codex-account-test-1.0.0"), workspace = path.join(root, "workspace");
  fs.mkdirSync(harness, { recursive: true });
  fs.mkdirSync(path.join(data, "User"), { recursive: true });
  fs.mkdirSync(workspace);
  // These are disposable, signed-out profiles. No real account or history is used.
  const homes = ["account-a", "account-b"].map(name => path.join(root, name));
  homes.forEach(home => fs.mkdirSync(home));
  const managerId = manifest.publisher + "." + manifest.name;
  fs.writeFileSync(path.join(root, "test-config.json"), JSON.stringify({ homes, managerId }));
  fs.writeFileSync(path.join(harness, "package.json"), JSON.stringify({
    name: "codex-account-test", publisher: "local", version: "1.0.0", engines: manifest.engines,
    main: "./extension.js", activationEvents: ["onStartupFinished"]
  }));
  fs.copyFileSync(path.join(__dirname, "vscode-harness.js"), path.join(harness, "extension.js"));
  fs.symlinkSync(codex, path.join(extensions, path.basename(codex)), "junction");
  fs.symlinkSync(path.resolve(__dirname, ".."), path.join(extensions, managerId + "-" + manifest.version), "junction");
  const storage = path.join(data, "User", "globalStorage", managerId, "launcher");
  fs.mkdirSync(storage, { recursive: true });
  const launcher = path.join(storage, "codex-profile-" + manifest.version + ".exe");
  fs.copyFileSync(path.join(__dirname, "..", "bin", "codex-profile-launcher.exe"), launcher);
  fs.writeFileSync(path.join(storage, "profile.json"), JSON.stringify({ home: homes[0], executable: path.join(extensions, path.basename(codex), "bin", "windows-x86_64", "codex.exe") }));
  fs.writeFileSync(path.join(data, "User", "settings.json"), JSON.stringify({
    "codexAccountManager.profiles": homes.map((home, i) => ({ label: "Test account " + i, home })),
    "codexAccountManager.activeProfileHome": homes[0],
    "codexAccountManager.shareSessionHistory": false,
    "chatgpt.cliExecutable": launcher,
    "security.workspace.trust.enabled": false,
    "window.title": "Codex account integration test",
    "workbench.startupEditor": "none",
    "workbench.enableExperiments": false,
    "telemetry.telemetryLevel": "off",
    "extensions.autoUpdate": false,
    "files.hotExit": "onExitAndWindowClose"
  }, null, 2));
  const env = { ...process.env, CAM_TEST_ROOT: root, CODEX_HOME: homes[0] };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(code, ["--user-data-dir", data, "--extensions-dir", extensions, "--new-window", "--skip-welcome", "--skip-release-notes", workspace], { env, stdio: "ignore", windowsHide: true });
  let launchError;
  child.once("error", error => { launchError = error; });
  console.log("Isolated VS Code test files: " + root);
  const deadline = Date.now() + 120000;
  try {
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (fs.existsSync(path.join(root, "failure.txt"))) throw new Error(fs.readFileSync(path.join(root, "failure.txt"), "utf8"));
      const reportFile = path.join(root, "report.json");
      if (fs.existsSync(reportFile)) {
        const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
        if (report.done) {
          console.log("PASS: two account switches and disconnect preserved the main process and unsaved text.");
          return;
        }
      }
      if (child.exitCode !== null) throw new Error("Test window exited before completing its report.");
      await pause(500);
    }
    throw new Error("Timed out waiting for the isolated test window.");
  } finally {
    // Only the process created above can be terminated here. Reports stay in temp.
    if (child.exitCode === null) {
      await pause(1500);
      if (child.exitCode === null) child.kill();
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
