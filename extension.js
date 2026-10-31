"use strict";

const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { ensureSharedSessions } = require("./shared-sessions");

const OWN = "codexAccountManager";
const DEFAULT_HOME = path.join(os.homedir(), ".codex");
const VAR = "CODEX_HOME";
let statusBar;
let disposables = [];

function normalizeHome(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const normalized = path.normalize(trimmed);
  return normalized.length > 3 ? normalized.replace(/[\\/]$/, "") : normalized;
}

function samePath(a, b) {
  const left = normalizeHome(a), right = normalizeHome(b);
  return left && right && (process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right);
}

function settingParts() {
  const configured = vscode.workspace.getConfiguration(OWN).get("environmentSetting") || "";
  const index = configured.lastIndexOf(".");
  return index < 1 ? null : [configured.slice(0, index), configured.slice(index + 1)];
}

function readEnvironment() {
  const setting = settingParts();
  if (!setting) return [];
  const [section, key] = setting;
  const inspected = vscode.workspace.getConfiguration(section).inspect(key);
  const raw = inspected ? inspected.globalValue : undefined;
  if (Array.isArray(raw)) return raw.filter((x) => x && typeof x.name === "string").map((x) => ({ name: x.name, value: String(x.value == null ? "" : x.value) }));
  if (raw && typeof raw === "object") return Object.entries(raw).map(([name, value]) => ({ name, value: String(value == null ? "" : value) }));
  return [];
}

function activeHome() {
  const entry = readEnvironment().find((x) => x.name === VAR);
  return entry && normalizeHome(entry.value) ? normalizeHome(entry.value) : null;
}

async function setActiveHome(home) {
  prepareSharedSessions(home);
  const setting = settingParts();
  if (!setting) {
    const value = home ? normalizeHome(home) : "";
    if (value) {
      execFileSync("reg.exe", ["ADD", "HKCU\\Environment", "/v", VAR, "/t", "REG_SZ", "/d", value, "/f"], { windowsHide: true, stdio: "ignore" });
      process.env[VAR] = value;
    } else {
      execFileSync("reg.exe", ["DELETE", "HKCU\\Environment", "/v", VAR, "/f"], { windowsHide: true, stdio: "ignore" });
      delete process.env[VAR];
    }
    return;
  }
  const [section, key] = setting;
  const kept = readEnvironment().filter((x) => x.name !== VAR);
  const next = home ? kept.concat([{ name: VAR, value: normalizeHome(home) }]) : kept;
  await vscode.workspace.getConfiguration(section).update(key, next, vscode.ConfigurationTarget.Global);
}

function prepareSharedSessions(nextHome) {
  return ensureSharedSessions(DEFAULT_HOME, [
    activeHome(),
    nextHome,
    ...profiles().map((profile) => profile.home),
  ]);
}

function profiles() {
  const raw = vscode.workspace.getConfiguration(OWN).get("profiles");
  if (!Array.isArray(raw)) return [];
  return raw.map((p, index) => ({
    label: typeof p.label === "string" && p.label.trim() ? p.label.trim() : "Profile " + (index + 1),
    home: normalizeHome(p.home), dailyLimit: Number.isFinite(Number(p.dailyLimit)) ? Math.max(0, Number(p.dailyLimit)) : 0
  })).filter((p) => p.home && path.isAbsolute(p.home));
}

async function writeProfiles(value) {
  await vscode.workspace.getConfiguration(OWN).update("profiles", value, vscode.ConfigurationTarget.Global);
}

function activity(home) {
  const root = home || DEFAULT_HOME;
  let files = 0, bytes = 0, newest = 0;
  function walk(dir, depth) {
    if (depth > 3) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      try {
        const stat = fs.statSync(file);
        if (stat.isDirectory()) walk(file, depth + 1);
        else if (stat.isFile()) { files += 1; bytes += stat.size; newest = Math.max(newest, stat.mtimeMs); }
      } catch (_) {}
    }
  }
  walk(root, 0);
  return { files, bytes, newest };
}

function labelFor(home) {
  const match = profiles().find((p) => samePath(p.home, home));
  return match ? match.label : (home ? path.basename(home) : "Default");
}

function refresh() {
  if (!statusBar) return;
  if (!vscode.workspace.getConfiguration(OWN).get("showStatusBar")) { statusBar.hide(); return; }
  const home = activeHome(), info = activity(home);
  statusBar.text = "$(account) Codex: " + labelFor(home);
  statusBar.tooltip = new vscode.MarkdownString("**Active Codex profile: " + labelFor(home) + "**\n\n`" + (home || DEFAULT_HOME) + "`\n\nFiles: " + info.files + "\n\nClick to switch.");
  statusBar.show();
}

async function reloadPrompt(label) {
  const choice = await vscode.window.showInformationMessage("Switched to " + label + ". Restart VS Code so Codex starts with the new CODEX_HOME.", "Restart VS Code", "Later");
  if (choice === "Restart VS Code") await vscode.commands.executeCommand("workbench.action.quit");
}

async function switchCommand() {
  const list = profiles().map((p) => ({ label: p.label, description: samePath(p.home, activeHome()) ? "$(check) active" : "", detail: p.home, profile: p }));
  list.unshift({ label: "$(home) Default Codex profile", detail: DEFAULT_HOME, profile: { label: "Default", home: null } });
  list.push({ label: "$(add) Add a profile...", profile: null });
  const picked = await vscode.window.showQuickPick(list, { title: "Switch Codex profile", matchOnDetail: true });
  if (!picked) return;
  if (!picked.profile) return addCommand();
  if (samePath(picked.profile.home, activeHome()) || (!picked.profile.home && !activeHome())) return;
  if (picked.profile.home && !fs.existsSync(picked.profile.home)) fs.mkdirSync(picked.profile.home, { recursive: true });
  await setActiveHome(picked.profile.home);
  refresh();
  await reloadPrompt(picked.profile.label);
}

async function addCommand() {
  const existing = profiles();
  const label = await vscode.window.showInputBox({ title: "Add Codex profile", prompt: "Profile name", placeHolder: "Personal", validateInput: (v) => !v.trim() ? "Enter a name." : existing.some((p) => p.label.toLowerCase() === v.trim().toLowerCase()) ? "That name already exists." : null });
  if (!label) return;
  const suggested = path.join(os.homedir(), ".codex-" + label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  const home = await vscode.window.showInputBox({ title: "Codex profile directory", value: suggested, prompt: "Absolute CODEX_HOME directory", validateInput: (v) => !path.isAbsolute(normalizeHome(v)) ? "Use an absolute path." : existing.some((p) => samePath(p.home, v)) ? "That directory is already used." : null });
  if (!home) return;
  const resolved = normalizeHome(home);
  fs.mkdirSync(resolved, { recursive: true });
  await writeProfiles(existing.concat([{ label: label.trim(), home: resolved, dailyLimit: 0 }]));
  prepareSharedSessions(resolved);
  refresh();
  const choice = await vscode.window.showInformationMessage("Added " + label.trim() + ". Switch now?", "Switch Now", "Not Yet");
  if (choice === "Switch Now") { await setActiveHome(resolved); refresh(); await reloadPrompt(label.trim()); }
}

async function removeCommand() {
  const list = profiles();
  if (!list.length) return vscode.window.showInformationMessage("No profiles configured.");
  const picked = await vscode.window.showQuickPick(list.map((p) => ({ label: p.label, detail: p.home, profile: p })), { title: "Remove Codex profile", placeHolder: "The directory and credentials will not be deleted." });
  if (!picked) return;
  await writeProfiles(list.filter((p) => !samePath(p.home, picked.profile.home)));
  refresh();
  vscode.window.showInformationMessage("Removed " + picked.profile.label + " from the list. Its files were not deleted.");
}

async function usageCommand() {
  const home = activeHome(), info = activity(home), profile = profiles().find((p) => samePath(p.home, home));
  const limit = profile ? profile.dailyLimit : 0;
  const message = "Codex activity for " + labelFor(home) + ": " + info.files + " files (" + Math.round(info.bytes / 1024) + " KB) in CODEX_HOME." + (limit ? " Local daily activity limit: " + limit + "." : " No local activity limit configured.");
  vscode.window.showInformationMessage(message);
  if (limit && info.files >= limit && vscode.workspace.getConfiguration(OWN).get("autoFailover")) await failover(profile);
}

async function failover(current) {
  const next = profiles().find((p) => !samePath(p.home, current.home) && (!p.dailyLimit || activity(p.home).files < p.dailyLimit));
  if (!next) return vscode.window.showWarningMessage("No eligible backup Codex profile is available.");
  await setActiveHome(next.home); refresh(); await reloadPrompt(next.label);
}

function revealCommand() {
  const dir = activeHome() || DEFAULT_HOME;
  if (fs.existsSync(dir)) return vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(dir));
  vscode.window.showWarningMessage(dir + " does not exist yet.");
}

function guarded(fn) { return async (...args) => { try { return await fn(...args); } catch (error) { vscode.window.showErrorMessage("Codex account operation failed: " + error.message); } }; }

function activate(context) {
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, vscode.workspace.getConfiguration(OWN).get("statusBarPriority") || 100);
  statusBar.command = "codexAccountManager.switch";
  statusBar.name = "Codex Profile";
  disposables = [statusBar,
    vscode.commands.registerCommand("codexAccountManager.switch", guarded(switchCommand)),
    vscode.commands.registerCommand("codexAccountManager.add", guarded(addCommand)),
    vscode.commands.registerCommand("codexAccountManager.remove", guarded(removeCommand)),
    vscode.commands.registerCommand("codexAccountManager.usage", guarded(usageCommand)),
    vscode.commands.registerCommand("codexAccountManager.reveal", guarded(revealCommand)),
    vscode.workspace.onDidChangeConfiguration((event) => { const setting = settingParts(); if (event.affectsConfiguration(OWN) || (setting && event.affectsConfiguration(setting[0] + "." + setting[1]))) refresh(); })
  ];
  context.subscriptions.push(...disposables);
  try { prepareSharedSessions(activeHome()); }
  catch (error) { vscode.window.showErrorMessage("Could not share Codex sessions: " + error.message); }
  refresh();
}

function deactivate() { disposables.forEach((d) => d.dispose && d.dispose()); disposables = []; statusBar = null; }

module.exports = { activate, deactivate, __internals: { normalizeHome, samePath, activity, profiles, settingParts, prepareSharedSessions } };
