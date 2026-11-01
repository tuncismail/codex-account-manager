"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), { spawn, spawnSync } = require("child_process");
const { temporaryDirectory, removeTemporaryDirectory } = require("./helpers");

test("native launcher forwards environment, arguments, streams and process lifecycle", { skip: process.platform !== "win32", timeout: 30000 }, async t => {
  const root = temporaryDirectory("codex-launcher-test-"); t.after(() => removeTemporaryDirectory(root));
  const compiler = ["Framework64", "Framework"].map(name => path.join(process.env.WINDIR, "Microsoft.NET", name, "v4.0.30319", "csc.exe")).find(file => fs.existsSync(file));
  assert(compiler, "Windows .NET Framework compiler is required.");
  const fixture = path.join(root, "fixture cli.exe"), launcher = path.join(root, "launcher.exe");
  const compile = spawnSync(compiler, ["/nologo", "/target:exe", "/r:System.Web.Extensions.dll", "/out:" + fixture, path.join(__dirname, "fixtures", "cli.cs")], { encoding: "utf8", windowsHide: true });
  assert.equal(compile.status, 0, compile.stdout + compile.stderr);
  fs.copyFileSync(path.join(__dirname, "..", "bin", "codex-profile-launcher.exe"), launcher);
  const home = path.join(root, "selected account"), stale = path.join(root, "stale account");
  fs.mkdirSync(home);
  const config = path.join(root, "profile.json");
  fs.writeFileSync(config, JSON.stringify({ home, executable: fixture }));
  await t.test("explicit home wins and protocol output is unmodified", () => {
    const args = ["space here", 'quote"here', "trailing\\", "", "& $() ; test"];
    const result = spawnSync(launcher, args, { env: { ...process.env, CODEX_HOME: stale }, input: "request line\n", encoding: "utf8", windowsHide: true, timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { home, arguments: args, input: "request line" });
    assert.equal(result.stderr.trim(), "fixture stderr");
  });
  await t.test("child exit status is preserved", () => {
    const result = spawnSync(launcher, ["exit-seven"], { input: "\n", encoding: "utf8", windowsHide: true, timeout: 5000 });
    assert.equal(result.status, 7);
  });
  await t.test("killing the launcher terminates its child", async () => {
    const child = spawn(launcher, ["hold"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    child.stderr.resume();
    const pid = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Fixture did not start.")), 5000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.stdout.once("data", data => { clearTimeout(timer); resolve(Number(data.toString().trim())); });
    });
    assert(Number.isInteger(pid) && pid > 0);
    child.kill();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try { process.kill(pid, 0); } catch (error) { if (error.code === "ESRCH") return; throw error; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail("Codex child remained alive after its launcher exited.");
  });
  await t.test("invalid configuration fails on stderr without protocol output", () => {
    fs.writeFileSync(config, JSON.stringify({ home, executable: launcher }));
    const result = spawnSync(launcher, [], { encoding: "utf8", windowsHide: true, timeout: 5000 });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /cannot launch itself/);
  });
});
