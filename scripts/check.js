"use strict";
const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process");
const root = path.resolve(__dirname, "..");
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (["node_modules", ".git", "bin"].includes(entry.name)) return [];
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : entry.name.endsWith(".js") ? [full] : [];
  });
}
for (const file of walk(root)) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); }
}
const manifest = require("../package.json");
if (manifest.dependencies && Object.keys(manifest.dependencies).length) throw new Error("Runtime dependencies must be reviewed before adding them.");
console.log("JavaScript syntax and zero runtime npm dependencies verified.");
