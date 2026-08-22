const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

assert.doesNotMatch(background, /chrome\.tabs\.create\s*\(/);
assert.doesNotMatch(content, /type:\s*["']OPEN_URLS["']/);
assert.match(content, /if\s*\(await completeVisibleResults\(visibleResults\)\)\s*return;/);
assert.equal(manifest.permissions.includes("tabs"), false);

process.stdout.write("visible results policy tests passed\n");
