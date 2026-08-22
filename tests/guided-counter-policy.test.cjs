const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

assert.match(content, /hasLocalCountdown/);
assert.match(content, /hasCountdownValue\s*&&\s*hasCountdownContext/);
assert.match(content, /hasLocalCountdown\s*\?\s*22\s*:\s*0/);
assert.match(content, /serverTimingRequired/);
assert.match(content, /form\.id\s*===\s*"go-link"/);
assert.match(content, /step\\s\*\\d\+\\s\*\\\/\\s\*\\d\+/);
assert.match(content, /counterStarter\s*=\s*eligibleActions\(\)\.find/);
assert.match(content, /singleShot\s*=\s*action\.reason\s*===\s*"Sayaç başlatma adımı"/);
assert.match(content, /\[onclick\]/);
assert.match(content, /Doğru geçiş düğmesi/);
assert.match(content, /data-smart-link-guide-recommended/);
assert.match(content, /data-smart-link-guide-local-counter/);
assert.match(content, /gateActionScore\s*>=\s*96/);
assert.match(content, /tokenLikePath\s*&&\s*markerCount\s*>=\s*2/);
assert.match(content, /forms\s*&&\s*markerCount/);
assert.match(content, /activeGate\s*&&\s*!currentPage\.hardVerification/);
assert.match(content, /data-smart-link-guide-captcha-error/);

process.stdout.write("guided counter policy tests passed\n");
