"use strict";

const path = require("path");

function normalizeHome(value) {
  if (typeof value !== "string" || !value.trim() || /[\x00-\x1f]/.test(value)) return "";
  const normalized = path.normalize(value.trim());
  return normalized === path.parse(normalized).root ? normalized : normalized.replace(/[\\/]+$/, "");
}

function samePath(a, b) {
  const left = normalizeHome(a), right = normalizeHome(b);
  return Boolean(left && right && (process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right));
}

function normalizeProfiles(raw) {
  if (!Array.isArray(raw)) return [];
  const result = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const home = normalizeHome(item.home);
    if (!home || !path.isAbsolute(home) || result.some(profile => samePath(profile.home, home))) continue;
    const label = typeof item.label === "string" ? item.label.trim().replace(/[\x00-\x1f]/g, " ").slice(0, 80) : "";
    result.push({ label: label || "Account " + (result.length + 1), home });
  }
  return result;
}

function validateLabel(value, existing, exceptHome) {
  const label = value.trim();
  if (!label) return "Enter a name.";
  if (label.length > 80 || /[\x00-\x1f]/.test(label)) return "Use up to 80 characters without line breaks.";
  if (existing.some(item => !samePath(item.home, exceptHome) && item.label.toLowerCase() === label.toLowerCase())) return "That name already exists.";
  return undefined;
}

module.exports = { normalizeHome, samePath, normalizeProfiles, validateLabel };
