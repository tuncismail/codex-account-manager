"use strict";
const vscode = require("vscode"), fs = require("fs"), path = require("path"), assert = require("assert");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

exports.activate = async () => {
  const root = process.env.CAM_TEST_ROOT;
  if (!root) return;
  const reportFile = path.join(root, "report.json");
  try {
    const { homes, managerId } = JSON.parse(fs.readFileSync(path.join(root, "test-config.json"), "utf8"));
    await vscode.extensions.getExtension(managerId).activate();
    const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, "utf8")) : { phase: 0, rootPid: process.ppid, hosts: [], results: [] };
    if (report.done) return;
    assert.strictEqual(process.ppid, report.rootPid, "Main process must survive every reload.");
    assert(!report.hosts.includes(process.pid), "Reload must create a new extension host.");
    report.hosts.push(process.pid);
    if (report.phase < 3) {
      const expected = homes[report.phase % 2];
      assert.strictEqual(vscode.workspace.getConfiguration("codexAccountManager").get("activeProfileHome"), expected);
      const launcher = vscode.workspace.getConfiguration("chatgpt").get("cliExecutable");
      assert(launcher && fs.existsSync(launcher));
      await vscode.commands.executeCommand("chatgpt.openSidebar");
      const logFile = path.join(path.dirname(launcher), "launch.log");
      const started = Date.now();
      let found = false;
      while (Date.now() - started < 20000) {
        if (fs.existsSync(logFile)) {
          const line = fs.readFileSync(logFile, "utf8").trim().split(/\r?\n/).at(-1);
          found = line?.includes("home=" + expected);
          if (found) break;
        }
        await pause(200);
      }
      assert(found, "Official Codex must launch with the selected profile.");
    } else {
      assert(!vscode.workspace.getConfiguration("chatgpt").get("cliExecutable"), "Disconnect must restore the original CLI setting.");
      assert(!vscode.workspace.getConfiguration("codexAccountManager").get("activeProfileHome"));
    }
    const note = vscode.Uri.file(path.join(root, "workspace", "unsaved-note.txt"));
    if (report.phase === 0) {
      fs.writeFileSync(note.fsPath, "Original saved content.");
      const document = await vscode.workspace.openTextDocument(note);
      await vscode.window.showTextDocument(document);
      const edit = new vscode.WorkspaceEdit();
      edit.insert(note, new vscode.Position(0, 0), "This unsaved note must survive.\n");
      await vscode.workspace.applyEdit(edit);
      assert(document.isDirty);
    } else {
      const document = await vscode.workspace.openTextDocument(note);
      await vscode.window.showTextDocument(document);
      assert(document.isDirty && document.getText().includes("This unsaved note must survive."), "Unsaved content must survive.");
    }
    report.results.push({ phase: report.phase, mainProcessPreserved: true, unsavedTextPreserved: true });
    if (report.phase === 3) {
      report.done = true;
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
      await vscode.commands.executeCommand("workbench.action.closeWindow");
      return;
    }
    report.phase++;
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    await pause(1500);
    await vscode.commands.executeCommand(report.phase === 3 ? "codexAccountManager.disconnect" : "codexAccountManager.switch", homes[report.phase % 2]);
  } catch (error) {
    if (error?.name !== "Canceled" && error?.name !== "CancellationError") fs.writeFileSync(path.join(root, "failure.txt"), error.stack);
  }
};
