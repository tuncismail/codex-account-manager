"use strict";

const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ensureSharedSessions } = require("./shared-sessions");
const { normalizeHome, samePath, normalizeProfiles, validateLabel } = require("./profiles");

const OWN = "codexAccountManager";
const DEFAULT_HOME = path.join(os.homedir(), ".codex");
let context, statusBar, output, windowHome;
let switching = false;

// Account directories are machine settings. Never consume workspace overrides.
function setting(key, fallback) {
  const value = vscode.workspace.getConfiguration(OWN).inspect(key);
  return value?.globalValue ?? value?.defaultValue ?? fallback;
}
function selectedHome() {
  const home = normalizeHome(setting("activeProfileHome", ""));
  return path.isAbsolute(home) ? home : "";
}
function activeHome() {
  const inherited = normalizeHome(process.env.CODEX_HOME);
  return selectedHome() || (path.isAbsolute(inherited) ? inherited : DEFAULT_HOME);
}
function profiles() { return normalizeProfiles(setting("profiles", [])); }
function writeSetting(key, value) { return vscode.workspace.getConfiguration(OWN).update(key, value, vscode.ConfigurationTarget.Global); }
function labelFor(home) { return profiles().find(profile => samePath(profile.home, home))?.label || "Select account"; }
function disconnected() { return context?.globalState.get("integrationDisabled", false); }

async function reloadWindow() {
  try { await vscode.commands.executeCommand("workbench.action.reloadWindow"); }
  catch (error) {
    // The command's RPC can be cancelled as its own extension host shuts down.
    if (error?.name !== "Canceled" && error?.name !== "CancellationError") throw error;
  }
}

function bundledCli() {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("This release supports Windows x64 only.");
  if (vscode.env.remoteName || vscode.workspace.getConfiguration("chatgpt").get("runCodexInWindowsSubsystemForLinux")) {
    throw new Error("Use a local Windows window with Codex's WSL mode disabled. Remote and WSL sessions are not supported yet.");
  }
  const codex = vscode.extensions.getExtension("openai.chatgpt");
  const executable = codex && path.join(codex.extensionPath, "bin", "windows-x86_64", "codex.exe");
  if (!executable || !fs.existsSync(executable)) throw new Error("Install or enable the official OpenAI Codex extension for Windows first.");
  return executable;
}

function launcherDirectory() { return path.join(context.globalStorageUri.fsPath, "launcher"); }
function ownsLauncher(value) {
  return typeof value === "string" && samePath(path.dirname(value), launcherDirectory()) && /^codex-profile-[\w.-]+\.exe$/i.test(path.basename(value));
}
function writeLauncherProfile(home) {
  const executable = bundledCli();
  const directory = launcherDirectory();
  fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  // Versioned filenames allow upgrades while the previous launcher is running.
  const launcher = path.join(directory, "codex-profile-" + context.extension.packageJSON.version + ".exe");
  if (!fs.existsSync(launcher)) fs.copyFileSync(path.join(context.extensionPath, "bin", "codex-profile-launcher.exe"), launcher);
  const configFile = path.join(directory, "profile.json");
  let previous;
  try { previous = JSON.parse(fs.readFileSync(configFile, "utf8")); } catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
  const temporary = configFile + "." + process.pid + ".tmp";
  try {
    fs.writeFileSync(temporary, JSON.stringify({ home, executable }), { mode: 0o600 });
    fs.renameSync(temporary, configFile);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  return { launcher, executableChanged: !samePath(previous?.executable, executable) };
}

async function configureLauncher(home) {
  const { launcher, executableChanged } = writeLauncherProfile(home);
  const config = vscode.workspace.getConfiguration("chatgpt");
  if (samePath(config.get("cliExecutable"), launcher)) return executableChanged;
  if (!ownsLauncher(config.get("cliExecutable"))) {
    await context.globalState.update("previousCliExecutable", config.inspect("cliExecutable")?.globalValue ?? null);
  }
  await config.update("cliExecutable", launcher, vscode.ConfigurationTarget.Global);
  return true;
}

function prepareSharedSessions(home) {
  if (setting("shareSessionHistory", false)) return ensureSharedSessions(DEFAULT_HOME, [home]);
  return [];
}

async function switchToProfile(profile) {
  if (switching) return;
  if (!disconnected() && samePath(profile.home, selectedHome()) && samePath(profile.home, windowHome)) return;
  switching = true;
  const previous = activeHome();
  const cliConfig = vscode.workspace.getConfiguration("chatgpt");
  const previousCli = cliConfig.inspect("cliExecutable")?.globalValue;
  try {
    bundledCli();
    prepareSharedSessions(profile.home);
    try {
      await configureLauncher(profile.home);
      await writeSetting("activeProfileHome", profile.home);
      await context.globalState.update("integrationDisabled", false);
    } catch (error) {
      writeLauncherProfile(previous);
      await cliConfig.update("cliExecutable", previousCli, vscode.ConfigurationTarget.Global);
      throw error;
    }
    process.env.CODEX_HOME = profile.home;
    await reloadWindow();
  } finally { switching = false; }
}

function refresh() {
  if (!statusBar) return;
  if (!setting("showStatusBar", true)) { statusBar.hide(); return; }
  const connected = selectedHome() && !disconnected();
  const pending = connected && !samePath(windowHome, selectedHome());
  statusBar.text = "$(account) Codex: " + (connected ? labelFor(windowHome) : "Select account") + (pending ? " $(sync)" : "");
  const tooltip = new vscode.MarkdownString();
  tooltip.appendText(connected ? "Account in this window: " + labelFor(windowHome) : "Choose or add a Codex account.");
  tooltip.appendText("\n\n" + profiles().length + " saved accounts.");
  if (pending) tooltip.appendText("\n\nAnother window changed the selected account. Select it here to reload this window too.");
  statusBar.tooltip = tooltip;
  statusBar.show();
}

async function chooseProfile(title) {
  const list = profiles();
  if (!list.length) { await vscode.window.showInformationMessage("No saved accounts. Add or import an account first."); return; }
  const picked = await vscode.window.showQuickPick(list.map(profile => ({ label: profile.label, detail: profile.home, profile })), { title, matchOnDetail: true });
  return picked?.profile;
}

function switchPicker() {
  return new Promise(resolve => {
    const picker = vscode.window.createQuickPick();
    const actions = [
      { iconPath: new vscode.ThemeIcon("edit"), tooltip: "Rename account", action: "rename" },
      { iconPath: new vscode.ThemeIcon("sign-in"), tooltip: "Sign in", action: "login" },
      { iconPath: new vscode.ThemeIcon("folder-opened"), tooltip: "Open account folder", action: "reveal" },
      { iconPath: new vscode.ThemeIcon("trash"), tooltip: "Remove from list", action: "remove" }
    ];
    picker.title = "Switch Codex account";
    picker.placeholder = "Choose an account to switch and reload this window";
    picker.matchOnDetail = true;
    picker.items = [...profiles().map(profile => ({
      label: profile.label,
      description: !disconnected() && samePath(profile.home, windowHome) ? "active in this window" : "",
      detail: profile.home, profile, buttons: actions
    })), { label: "$(add) Add an account...", action: "add" }, { label: "$(folder-opened) Import an existing account...", action: "import" }];
    let finished = false;
    const subscriptions = [];
    function finish(result) {
      if (finished) return;
      finished = true;
      subscriptions.forEach(item => item.dispose());
      picker.dispose();
      resolve(result);
    }
    subscriptions.push(picker.onDidAccept(() => finish(picker.selectedItems[0])));
    subscriptions.push(picker.onDidTriggerItemButton(event => finish({ profile: event.item.profile, action: event.button.action })));
    subscriptions.push(picker.onDidHide(() => finish(undefined)));
    picker.show();
  });
}

async function switchCommand(home) {
  if (typeof home === "string") {
    const profile = profiles().find(item => samePath(item.home, home));
    if (!profile) throw new Error("That account is not in your saved profiles.");
    return switchToProfile(profile);
  }
  const picked = await switchPicker();
  if (!picked) return;
  switch (picked.action) {
    case "add": return addCommand();
    case "import": return importCommand();
    case "rename": return renameProfile(picked.profile);
    case "login": return loginProfile(picked.profile);
    case "reveal": return revealProfile(picked.profile);
    case "remove": return removeProfile(picked.profile);
    default: return switchToProfile(picked.profile);
  }
}

function askLabel(existing, profile) {
  return vscode.window.showInputBox({ title: profile ? "Rename Codex account" : "Name your Codex account", value: profile?.label, placeHolder: "Personal", validateInput: value => validateLabel(value, existing, profile?.home) });
}
async function saveProfile(label, home) {
  const profile = { label: label.trim(), home: normalizeHome(home) };
  if (!path.isAbsolute(profile.home)) throw new Error("Use an absolute account directory.");
  const existing = profiles();
  if (existing.some(item => samePath(item.home, profile.home))) throw new Error("That account directory is already saved.");
  const labelError = validateLabel(profile.label, existing);
  if (labelError) throw new Error(labelError);
  fs.mkdirSync(profile.home, { recursive: true });
  await writeSetting("profiles", [...existing, profile]);
  refresh();
  return profile;
}

async function addCommand() {
  const label = await askLabel(profiles());
  if (!label) return;
  const slug = label.trim().normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "account";
  const base = path.join(os.homedir(), ".codex-" + slug);
  let suggested = base, suffix = 2;
  while (fs.existsSync(suggested) || profiles().some(item => samePath(item.home, suggested))) suggested = base + "-" + suffix++;
  const home = await vscode.window.showInputBox({ title: "Codex account directory", value: suggested, prompt: "Credentials and account settings stay in this folder.", validateInput: value => !path.isAbsolute(normalizeHome(value)) ? "Use an absolute path." : profiles().some(item => samePath(item.home, value)) ? "That directory is already saved." : undefined });
  if (!home) return;
  const profile = await saveProfile(label, home);
  const choice = await vscode.window.showInformationMessage("Added " + profile.label + ".", "Sign In", "Switch to Account");
  if (choice === "Sign In") return loginProfile(profile);
  if (choice === "Switch to Account") return switchToProfile(profile);
}

async function importCommand() {
  const folders = await vscode.window.showOpenDialog({ title: "Select an existing Codex account directory", canSelectFolders: true, canSelectFiles: false, canSelectMany: false, defaultUri: vscode.Uri.file(activeHome()), openLabel: "Import account" });
  if (!folders?.length) return;
  const label = await askLabel(profiles());
  if (!label) return;
  const profile = await saveProfile(label, folders[0].fsPath);
  if (await vscode.window.showInformationMessage("Imported " + profile.label + ".", "Switch to Account") === "Switch to Account") await switchToProfile(profile);
}

async function renameProfile(profile) {
  if (!profile) return;
  const label = await askLabel(profiles(), profile);
  if (!label) return;
  await writeSetting("profiles", profiles().map(item => samePath(item.home, profile.home) ? { ...item, label: label.trim() } : item));
  refresh();
}
async function loginProfile(profile) {
  if (!profile) return;
  const executable = bundledCli();
  fs.mkdirSync(profile.home, { recursive: true });
  const terminal = vscode.window.createTerminal({ name: "Codex Login: " + profile.label, cwd: os.homedir(), env: { CODEX_HOME: profile.home }, shellPath: executable, shellArgs: ["login", "--device-auth"] });
  terminal.show();
}
async function removeProfile(profile) {
  if (!profile) return;
  if (!disconnected() && (samePath(profile.home, selectedHome()) || samePath(profile.home, windowHome))) {
    await vscode.window.showWarningMessage("Switch to another account, or run Codex Accounts: Disconnect Account Manager, before removing the active account.");
    return;
  }
  await writeSetting("profiles", profiles().filter(item => !samePath(item.home, profile.home)));
  refresh();
  await vscode.window.showInformationMessage("Removed " + profile.label + " from the list. Its files and credentials are still on disk.");
}
async function revealProfile(profile) {
  const home = profile?.home || windowHome || activeHome();
  if (!fs.existsSync(home)) throw new Error("The account directory does not exist yet.");
  await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(home));
}

async function disconnectCommand() {
  const config = vscode.workspace.getConfiguration("chatgpt");
  if (ownsLauncher(config.get("cliExecutable"))) {
    await config.update("cliExecutable", context.globalState.get("previousCliExecutable") ?? undefined, vscode.ConfigurationTarget.Global);
  }
  await context.globalState.update("integrationDisabled", true);
  await writeSetting("activeProfileHome", undefined);
  await reloadWindow();
}

function diagnosticsCommand() {
  output.clear();
  const codex = vscode.extensions.getExtension("openai.chatgpt");
  output.appendLine(JSON.stringify({
    managerVersion: context.extension.packageJSON.version,
    vscodeVersion: vscode.version,
    platform: process.platform,
    architecture: process.arch,
    remoteWindow: Boolean(vscode.env.remoteName),
    codexVersion: codex?.packageJSON.version || "not installed",
    savedAccounts: profiles().length,
    selectedAccountSaved: profiles().some(item => samePath(item.home, selectedHome())),
    launcherConnected: ownsLauncher(vscode.workspace.getConfiguration("chatgpt").get("cliExecutable")),
    integrationDisabled: disconnected(),
    sessionSharing: setting("shareSessionHistory", false),
    windowNeedsReload: Boolean(selectedHome() && !samePath(windowHome, selectedHome()))
  }, null, 2));
  output.show();
}

function guarded(fn) { return async (...args) => { try { return await fn(...args); } catch (error) { await vscode.window.showErrorMessage("Codex Accounts: " + error.message); } }; }

async function activate(extensionContext) {
  context = extensionContext;
  windowHome = activeHome();
  output = vscode.window.createOutputChannel("Codex Accounts");
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, setting("statusBarPriority", 100));
  statusBar.command = "codexAccountManager.switch";
  statusBar.name = "Codex account";
  const commands = {
    switch: switchCommand, add: addCommand, import: importCommand,
    rename: async () => renameProfile(await chooseProfile("Rename Codex account")),
    login: async () => loginProfile(await chooseProfile("Sign in to Codex account")),
    remove: async () => removeProfile(await chooseProfile("Remove Codex account")),
    reveal: revealProfile, disconnect: disconnectCommand, diagnostics: diagnosticsCommand,
    // Compatibility for older keybindings; local file counts were never quota data.
    usage: diagnosticsCommand
  };
  context.subscriptions.push(output, statusBar,
    ...Object.entries(commands).map(([name, action]) => vscode.commands.registerCommand(OWN + "." + name, guarded(action))),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration(OWN)) refresh(); }));
  refresh();
  if (!selectedHome()) {
    await context.globalState.update("sharingMigrated", true);
    return;
  }
  if (disconnected()) return;
  try {
    // Preserve the sharing behavior of installations upgraded from 0.4.
    if (!context.globalState.get("sharingMigrated")) {
      const sharing = vscode.workspace.getConfiguration(OWN).inspect("shareSessionHistory");
      if (sharing?.globalValue === undefined && context.globalState.get("previousCliExecutable") !== undefined) {
        await writeSetting("shareSessionHistory", true);
      }
      await context.globalState.update("sharingMigrated", true);
    }
    bundledCli();
    prepareSharedSessions(selectedHome());
    const changed = await configureLauncher(selectedHome());
    process.env.CODEX_HOME = selectedHome();
    if (changed) await reloadWindow();
  } catch (error) { await vscode.window.showErrorMessage("Codex Accounts setup: " + error.message); }
}

function deactivate() { statusBar = undefined; output = undefined; context = undefined; }
module.exports = { activate, deactivate, __internals: { setting, selectedHome, activeHome, profiles, labelFor, switchCommand, renameProfile, removeProfile, disconnectCommand, diagnosticsCommand, saveProfile } };
