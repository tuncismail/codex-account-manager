"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), path = require("path");
const { normalizeHome, samePath, normalizeProfiles, validateLabel } = require("../profiles");
test("invalid settings cannot introduce relative paths or duplicate accounts", () => {
  const home = path.resolve("account-a");
  assert.deepEqual(normalizeProfiles([null, false, {}, { home: "relative" }, { label: "Work", home }, { label: "Duplicate", home: home + path.sep }]), [{ label: "Work", home }]);
  assert.equal(normalizeHome("bad\npath"), "");
  assert.equal(normalizeHome(path.parse(home).root), path.parse(home).root);
  assert.equal(samePath(home, home + path.sep), true);
  assert.equal(samePath("", ""), false);
});
test("rename allows current name and rejects duplicate labels", () => {
  const first = { label: "Work", home: path.resolve("account-a") };
  const second = { label: "Personal", home: path.resolve("account-b") };
  assert.equal(validateLabel(" Work ", [first, second], first.home), undefined);
  assert.match(validateLabel("personal", [first, second], first.home), /already/);
  assert.match(validateLabel(" ", []), /Enter/);
});
