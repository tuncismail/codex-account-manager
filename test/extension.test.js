"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("fs"), path = require("path"), Module = require("module");
const { temporaryDirectory, removeTemporaryDirectory } = require("./helpers");
const manifest = require("../package.json");

function harness(t, options = {}) {
  const root = temporaryDirectory();
  const envHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = path.join(root, "inherited");
  const global = { "codexAccountManager.profiles": [], ...options.global };
  const state = new Map(Object.entries(options.state || {}));
  const commands = new Map(), calls = [], messages = [], lines = [];
  const status = { show() {}, hide() {}, dispose() {} };
  let input;
  const config = section => ({
    inspect: key => ({
      globalValue: global[section + "." + key],
      defaultValue: manifest.contributes.configuration.properties[section + "." + key]?.default,
      workspaceValue: options.workspace?.[section + "." + key]
    }),
    get: key => options.workspace?.[section + "." + key] ?? global[section + "." + key],
    update: async (key, value) => {
      if (options.failSetting === section + "." + key) throw new Error("Simulated settings failure");
      if (value === undefined) delete global[section + "." + key]; else global[section + "." + key] = value;
    }
  });
  const cliRoot = path.join(root, "official-codex");
  fs.mkdirSync(path.join(cliRoot, "bin", "windows-x86_64"), { recursive: true });
  fs.writeFileSync(path.join(cliRoot, "bin", "windows-x86_64", "codex.exe"), "fixture only");
  const context = {
    extensionPath: path.resolve(__dirname, ".."), extension: { packageJSON: manifest },
    globalStorageUri: { fsPath: path.join(root, "storage") }, subscriptions: [],
    globalState: { get: (key, fallback) => state.has(key) ? state.get(key) : fallback, update: async (key, value) => { state.set(key, value); } }
  };
  const fake = {
    version: "test", env: {},
    ConfigurationTarget: { Global: 1 }, StatusBarAlignment: { Right: 2 },
    MarkdownString: class { constructor() { this.value = ""; } appendText(value) { this.value += value; } },
    workspace: { getConfiguration: config, onDidChangeConfiguration: () => ({ dispose() {} }) },
    extensions: { getExtension: () => ({ extensionPath: cliRoot, packageJSON: { version: "fixture" } }) },
    commands: {
      registerCommand: (name, fn) => { commands.set(name, fn); return { dispose() {} }; },
      executeCommand: async name => calls.push(name)
    },
    window: {
      createStatusBarItem: () => status,
      createOutputChannel: () => ({ clear: () => { lines.length = 0; }, appendLine: value => lines.push(value), show() {}, dispose() {} }),
      showErrorMessage: async message => messages.push(message),
      showInformationMessage: async message => messages.push(message),
      showWarningMessage: async message => messages.push(message),
      showInputBox: async () => input
    }
  };
  const filename = path.resolve(__dirname, "..", "src", "extension.js");
  const loader = new Module(filename, module);
  const realRequire = Module.createRequire(filename);
  loader.filename = filename;
  loader.require = name => name === "vscode" ? fake : name === "os" ? { homedir: () => path.join(root, "user") } : realRequire(name);
  loader._compile(fs.readFileSync(filename, "utf8"), filename);
  t.after(() => {
    loader.exports.deactivate();
    if (envHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = envHome;
    removeTemporaryDirectory(root);
  });
  return { root, api: loader.exports.__internals, activate: () => loader.exports.activate(context), global, state, calls, messages, lines, status, setInput: value => { input = value; } };
}

test("fresh installation does not change Codex settings or reload the editor", async t => {
  const h = harness(t);
  await h.activate();
  assert.deepEqual(h.calls, []);
  assert.equal(h.global["chatgpt.cliExecutable"], undefined);
  assert.equal(h.global["codexAccountManager.shareSessionHistory"], undefined);
  assert.equal(h.state.get("sharingMigrated"), true);
});
test("workspace settings cannot redirect the selected account", t => {
  const h = harness(t, { workspace: { "codexAccountManager.activeProfileHome": path.resolve("untrusted"), "codexAccountManager.profiles": [{ label: "untrusted", home: path.resolve("untrusted") }] } });
  assert.equal(h.api.selectedHome(), "");
  assert.deepEqual(h.api.profiles(), []);
});
test("rename changes only the display name, and removal retains credentials", async t => {
  const h = harness(t); await h.activate();
  const home = path.join(h.root, "personal");
  await h.api.saveProfile("Personal", home);
  fs.writeFileSync(path.join(home, "auth.json"), "fixture only");
  h.setInput("Work");
  await h.api.renameProfile(h.api.profiles()[0]);
  assert.deepEqual(h.api.profiles(), [{ label: "Work", home }]);
  await h.api.removeProfile(h.api.profiles()[0]);
  assert.deepEqual(h.api.profiles(), []);
  assert.equal(fs.readFileSync(path.join(home, "auth.json"), "utf8"), "fixture only");
});
test("switch persists selection, uses only reloadWindow and disconnect restores custom CLI", { skip: process.platform !== "win32" }, async t => {
  const h = harness(t, { global: { "chatgpt.cliExecutable": path.resolve("custom-cli.exe") } });
  await h.activate();
  const profile = await h.api.saveProfile("Work", path.join(h.root, "work"));
  await h.api.switchCommand(profile.home);
  assert.equal(h.global["codexAccountManager.activeProfileHome"], profile.home);
  assert.deepEqual(h.calls, ["workbench.action.reloadWindow"]);
  const launcher = h.global["chatgpt.cliExecutable"];
  assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(launcher), "profile.json"))).home, profile.home);
  await h.api.removeProfile(profile);
  assert.equal(h.api.profiles().length, 1, "active account cannot be removed accidentally");
  h.api.diagnosticsCommand();
  assert(!h.lines.join("").includes(h.root));
  assert(!h.lines.join("").includes("Work"));
  await h.api.disconnectCommand();
  assert.equal(h.global["chatgpt.cliExecutable"], path.resolve("custom-cli.exe"));
  assert.equal(h.state.get("integrationDisabled"), true);
  assert.equal(h.global["codexAccountManager.activeProfileHome"], undefined);
  await h.activate();
  assert.equal(h.global["chatgpt.cliExecutable"], path.resolve("custom-cli.exe"));
  assert.deepEqual(h.calls, ["workbench.action.reloadWindow", "workbench.action.reloadWindow"]);
});
test("failed selection never triggers a reload", { skip: process.platform !== "win32" }, async t => {
  const h = harness(t, { failSetting: "codexAccountManager.activeProfileHome" }); await h.activate();
  const profile = await h.api.saveProfile("Work", path.join(h.root, "work"));
  const before = h.api.activeHome();
  await assert.rejects(h.api.switchCommand(profile.home), /settings failure/);
  assert.deepEqual(h.calls, []);
  assert.equal(h.api.activeHome(), before);
  assert.equal(h.global["chatgpt.cliExecutable"], undefined, "failed setup restores the previous CLI setting");
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.root, "storage", "launcher", "profile.json"))).home, before);
});
