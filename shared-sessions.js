"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SHARED_DIRECTORY = "sessions";
const SHARED_FILE = "session_index.jsonl";

function stat(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function identity(file) {
  return fs.realpathSync(file).toLowerCase();
}

function mergeFile(source, target) {
  const sourceStat = stat(source);
  const targetStat = stat(target);
  if (sourceStat && (!sourceStat.isFile() || sourceStat.isSymbolicLink())) {
    throw new Error("Session index is not an ordinary file: " + source);
  }
  if (targetStat && (!targetStat.isFile() || targetStat.isSymbolicLink())) {
    throw new Error("Session index target is not an ordinary file: " + target);
  }
  if (!sourceStat) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!targetStat) fs.writeFileSync(target, "");
    fs.linkSync(target, source);
    return;
  }
  if (targetStat && identity(source) === identity(target)) return;
  if (targetStat) {
    const sourceText = fs.readFileSync(source, "utf8");
    const targetText = fs.readFileSync(target, "utf8");
    const lines = new Set(targetText.split(/\r?\n/).filter(Boolean));
    const additions = sourceText.split(/\r?\n/).filter((line) => line && !lines.has(line));
    if (additions.length) {
      fs.appendFileSync(target, (targetText && !targetText.endsWith("\n") ? "\n" : "") + additions.join("\n") + "\n");
    }
    const backup = source + ".account-switcher-backup-" + crypto.randomUUID();
    fs.renameSync(source, backup);
    try {
      fs.linkSync(target, source);
    } catch (error) {
      fs.renameSync(backup, source);
      throw error;
    }
    return backup;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.linkSync(source, target);
  fs.unlinkSync(source);
  fs.linkSync(target, source);
}

function mergeDirectory(source, target) {
  const sourceStat = stat(source);
  const targetStat = stat(target);
  if (sourceStat && sourceStat.isSymbolicLink() && targetStat && identity(source) === identity(target)) return;
  if (sourceStat && (!sourceStat.isDirectory() || sourceStat.isSymbolicLink())) {
    throw new Error("Sessions path is not an ordinary directory: " + source);
  }
  if (targetStat && (!targetStat.isDirectory() || targetStat.isSymbolicLink())) {
    throw new Error("Shared sessions path is not an ordinary directory: " + target);
  }
  fs.mkdirSync(target, { recursive: true });
  if (!sourceStat) {
    fs.symlinkSync(path.resolve(target), source, process.platform === "win32" ? "junction" : "dir");
    return;
  }
  if (identity(source) === identity(target)) return;
  const backup = source + ".account-switcher-backup-" + crypto.randomUUID();
  fs.renameSync(source, backup);
  try {
    fs.symlinkSync(path.resolve(target), source, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    fs.renameSync(backup, source);
    throw error;
  }
  for (const entry of fs.readdirSync(backup, { withFileTypes: true })) {
    const destination = path.join(target, entry.name);
    if (!stat(destination)) {
      fs.renameSync(path.join(backup, entry.name), destination);
    }
  }
}

function ensureSharedSessions(defaultHome, profileHomes) {
  if (!path.isAbsolute(defaultHome)) throw new Error("Default Codex home must be absolute.");
  fs.mkdirSync(defaultHome, { recursive: true });
  const sharedSessions = path.join(defaultHome, SHARED_DIRECTORY);
  const sharedIndex = path.join(defaultHome, SHARED_FILE);
  const backups = [];
  for (const home of profileHomes.filter(Boolean)) {
    if (!path.isAbsolute(home)) throw new Error("Codex profile home must be absolute.");
    fs.mkdirSync(home, { recursive: true });
    const sessionsBackup = mergeDirectory(path.join(home, SHARED_DIRECTORY), sharedSessions);
    if (sessionsBackup) backups.push(sessionsBackup);
    const indexBackup = mergeFile(path.join(home, SHARED_FILE), sharedIndex);
    if (indexBackup) backups.push(indexBackup);
  }
  return backups;
}

module.exports = { ensureSharedSessions, SHARED_DIRECTORY, SHARED_FILE };
