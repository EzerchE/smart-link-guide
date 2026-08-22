const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

assert.match(content, /click\\s\+\(\?:the/);
assert.match(content, /step\\s\*\\d\+\\s\*\\\/\\s\*\\d\+/);
assert.match(content, /counterStarter\s*=\s*eligibleActions\(\)\.find/);
assert.match(content, /singleShot\s*=\s*action\.reason\s*===\s*"Sayaç başlatma adımı"/);
assert.match(content, /\[onclick\]/);

process.stdout.write("guided counter policy tests passed\n");
