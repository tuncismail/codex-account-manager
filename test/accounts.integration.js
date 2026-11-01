"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { temporaryDirectory, removeTemporaryDirectory, installedCodexExtension } = require("./helpers");

function readAccount(executable, home) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["app-server"], { env: { ...process.env, CODEX_HOME: home }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let pending = "", settled = false;
    const timer = setTimeout(() => finish(new Error("Codex app-server did not answer within 20 seconds.")), 20000);
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill();
      error ? reject(error) : resolve(result);
    }
    function send(value) { child.stdin.write(JSON.stringify(value) + "\n"); }
    child.on("error", finish);
    child.on("exit", code => { if (!settled) finish(new Error("Codex exited before replying: " + code)); });
    child.stderr.resume(); // Do not expose credentials or other account data.
    child.stdout.on("data", data => {
      pending += data.toString();
      while (pending.includes("\n")) {
        const index = pending.indexOf("\n");
        const line = pending.slice(0, index); pending = pending.slice(index + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.error) return finish(new Error("Codex RPC error: " + message.error.message));
        if (message.id === 1) {
          send({ method: "initialized" });
          send({ id: 2, method: "account/read", params: { refreshToken: false } });
        }
        if (message.id === 2) finish(null, message.result);
      }
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "codex-account-manager-check", version: require("../package.json").version }, capabilities: { experimentalApi: true } } });
  });
}

async function main() {
  const homes = [process.env.CAM_TEST_HOME_A, process.env.CAM_TEST_HOME_B];
  if (homes.some(home => !home || !path.isAbsolute(home) || !fs.existsSync(home))) {
    throw new Error("Set CAM_TEST_HOME_A and CAM_TEST_HOME_B to two existing, signed-in account directories. This optional test reads those accounts through the Codex CLI.");
  }
  const executable = process.env.CAM_CODEX_EXE || path.join(installedCodexExtension(), "bin", "windows-x86_64", "codex.exe");
  const root = temporaryDirectory("codex-accounts-test-");
  try {
    const launcher = path.join(root, "launcher.exe");
    fs.copyFileSync(path.join(__dirname, "..", "bin", "codex-profile-launcher.exe"), launcher);
    const accounts = [];
    for (const home of homes) {
      const expected = await readAccount(executable, home);
      assert(expected.account, "Both test accounts must be signed in.");
      fs.writeFileSync(path.join(root, "profile.json"), JSON.stringify({ home, executable }));
      const actual = await readAccount(launcher, homes.find(value => value !== home));
      assert.deepStrictEqual(actual.account, expected.account, "Launcher selected the wrong account.");
      accounts.push(actual.account);
    }
    assert.notDeepStrictEqual(accounts[0], accounts[1], "Use two different signed-in accounts.");
    console.log("Two real accounts verified. No credentials copied or printed.");
  } finally { removeTemporaryDirectory(root); }
}
module.exports = { readAccount };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
