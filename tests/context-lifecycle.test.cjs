const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

assert.match(content, /function stopForInvalidatedContext\s*\(/);
assert.match(content, /function contextIsUsable\s*\(/);
assert.match(content, /extension context invalidated\|message port closed\|receiving end does not exist/i);
assert.match(content, /try\s*\{\s*return Promise\.resolve\(chrome\.runtime\.sendMessage\(message\)\)/);
assert.doesNotMatch(content, /return chrome\.runtime\.sendMessage\(message\)\.catch/);
assert.match(content, /for \(const timerId of lifecycleTimers\) clearTimeout\(timerId\)/);

process.stdout.write("context lifecycle tests passed\n");
