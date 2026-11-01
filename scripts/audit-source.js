"use strict";
// A small, offline accidental-disclosure check, not a complete secret scanner.
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const root = path.resolve(__dirname, "..");
const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const rules = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["API credential", /\bsk-[A-Za-z0-9_-]{24,}/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{16,}/],
  ["session-specific path", /[\\/]session-state[\\/][a-f0-9-]{36}/i],
  ["absolute user path", /[A-Z]:[\\/]+Users[\\/]+(?!<|example\b|username\b|x\b)[^\\/\s"']+/i]
];
let failures = 0;
for (const file of new Set(files)) {
  const full = path.join(root, file);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
  if (/(^|\/)(auth\.json|profile\.json|session_index\.jsonl|\.env(?:\..*)?)$/.test(file)) {
    console.error(file + ": private runtime file must not be committed"); failures++;
  }
  if (!/\.(js|json|md|cs|ps1|yml|yaml)$/.test(file)) continue;
  const content = fs.readFileSync(full, "utf8");
  for (const [label, pattern] of rules) {
    if (pattern.test(content)) { console.error(file + ": " + label + " detected (value withheld)"); failures++; }
  }
}
if (failures) process.exitCode = 1;
else console.log("No credential patterns or personal machine paths found in publishable source.");
