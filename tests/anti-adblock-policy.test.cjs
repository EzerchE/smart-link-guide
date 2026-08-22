const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const guard = fs.readFileSync(path.join(root, "guard-main.js"), "utf8");
const adHider = content.match(/function removeObviousGateAds\(\)[\s\S]*?function dismissAntiAdblockOverlay/)?.[0] || "";

assert.match(background, /dismissAntiAdblockOverlays:\s*true/);
assert.match(adHider, /setProperty\("display",\s*"block",\s*"important"\)/);
assert.match(adHider, /setProperty\("opacity",\s*"0",\s*"important"\)/);
assert.match(adHider, /data-sizes-desktop/);
assert.match(adHider, /rect\.height\s*<\s*25/);
assert.doesNotMatch(adHider, /setProperty\("height",\s*"1px"/);
assert.doesNotMatch(adHider, /setProperty\("display",\s*"none"/);
assert.match(content, /hasBlockedResource/);
assert.match(content, /Geçiş bileşeni ağ filtresinde engellendi/);
assert.match(guard, /data-smart-link-guide-resource-blocked/);
assert.match(guard, /installAdGeometryShim/);
assert.match(guard, /"offsetHeight",\s*"height",\s*90/);
assert.match(guard, /"clientWidth",\s*"width",\s*300/);
assert.match(guard, /gateSurfaceActive\(\)\s*&&\s*measured\s*<\s*25/);
assert.match(guard, /transitionCallback\(callback\)\s*\|\|\s*gateSurfaceActive\(\)/);
assert.match(guard, /function markCaptchaFailure/);
assert.match(guard, /"unhandledrejection"/);
assert.match(guard, /grecaptcha\?\.reset/);
assert.match(guard, /installSignedAntiAdblockCompatibility/);
assert.match(guard, /Object\.hasOwn\(nextValue,\s*"force_disable_adblock"\)/);
assert.match(guard, /nextValue\.adblock_allowed\s*=\s*true/);
assert.match(guard, /ins\[class\^=\\?"adv-/);
assert.match(adHider, /\.ad-element/);
assert.match(adHider, /\.clever-core-ads-offerwall/);

process.stdout.write("anti-adblock policy tests passed\n");
