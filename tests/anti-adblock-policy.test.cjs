const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const adHider = content.match(/function removeObviousGateAds\(\)[\s\S]*?function dismissAntiAdblockOverlay/)?.[0] || "";

assert.match(background, /dismissAntiAdblockOverlays:\s*true/);
assert.match(adHider, /setProperty\("display",\s*"block",\s*"important"\)/);
assert.match(adHider, /setProperty\("opacity",\s*"0",\s*"important"\)/);
assert.match(adHider, /setProperty\("height",\s*"1px",\s*"important"\)/);
assert.doesNotMatch(adHider, /setProperty\("display",\s*"none"/);

process.stdout.write("anti-adblock policy tests passed\n");
