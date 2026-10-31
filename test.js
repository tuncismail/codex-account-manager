"use strict";
const assert = require("assert");
const path = require("path");
const os = require("os");
const fs = require("fs");
const Module = require("module");
const vscode = {
  workspace: { getConfiguration: () => ({ get: (key) => key === "environmentSetting" ? "chatgpt.environmentVariables" : [], inspect: () => ({ globalValue: [] }) }) }
};
const load = Module._load;
Module._load = (request, parent, main) => request === "vscode" ? vscode : load(request, parent, main);
const api = require("./extension").__internals;
assert.strictEqual(api.normalizeHome("  C:\\Users\\x\\.codex\\ "), "C:\\Users\\x\\.codex");
assert.strictEqual(api.normalizeHome(""), "");
assert.strictEqual(api.samePath("C:\\X\\.codex", "c:\\x\\.CODEX"), process.platform === "win32");
assert.deepStrictEqual(api.settingParts(), ["chatgpt", "environmentVariables"]);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-manager-"));
fs.writeFileSync(path.join(temp, "session.json"), "test");
assert.strictEqual(api.activity(temp).files, 1);
console.log("All Codex Account Manager tests passed.");
