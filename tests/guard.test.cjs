const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

let originalOpenCalls = 0;
let observerCallback = null;
const timeoutDelays = [];
const intervalDelays = [];
const attributes = new Map();
const document = {
  documentElement: {
    getAttribute(name) { return attributes.get(name) || null; }
  },
  addEventListener() {}
};
const window = {
  count: 5,
  open(...args) { originalOpenCalls += 1; return { args }; },
  setTimeout(callback, delay) { timeoutDelays.push(delay); return timeoutDelays.length; },
  setInterval(callback, delay) { intervalDelays.push(delay); return intervalDelays.length; },
  clearInterval() {},
  dispatchEvent() {}
};
class MutationObserver {
  constructor(callback) { observerCallback = callback; }
  observe() {}
}

vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "..", "guard-main.js"), "utf8"),
  { window, document, CustomEvent: class CustomEvent {}, MutationObserver, Date, Number, Function }
);

assert.ok(window.open("https://normal.example"));
assert.equal(originalOpenCalls, 1);
window.setTimeout(function countdownRedirect() {}, 3000);
assert.equal(timeoutDelays.at(-1), 3000);

attributes.set("data-smart-link-guide-popup-guard", "active");
attributes.set("data-smart-link-guide-aggressive", "active");
observerCallback();
assert.equal(window.count, 0);
assert.equal(window.open("https://popup.example"), null);
assert.equal(originalOpenCalls, 1);

window.setTimeout(function countdownRedirect() {}, 3000);
window.setInterval(function updateTimer() {}, 1000);
assert.equal(timeoutDelays.at(-1), 25);
assert.equal(intervalDelays.at(-1), 50);

process.stdout.write("guard tests passed\n");
