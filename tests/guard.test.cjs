const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

(async () => {

let originalOpenCalls = 0;
let originalAlertCalls = 0;
let observerCallback = null;
let captchaResets = 0;
const timeoutDelays = [];
const intervalDelays = [];
const eventListeners = new Map();
const attributes = new Map();
const document = {
  documentElement: {
    getAttribute(name) { return attributes.get(name) || null; },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); }
  },
  addEventListener() {}
};
class HTMLFormElement {
  constructor() {
    this.target = "";
    this.submitted = 0;
  }
  submit() { this.submitted += 1; }
}
const window = {
  count: 5,
  open(...args) { originalOpenCalls += 1; return { args }; },
  alert() { originalAlertCalls += 1; },
  setTimeout(callback, delay) { timeoutDelays.push(delay); return timeoutDelays.length; },
  setInterval(callback, delay) { intervalDelays.push(delay); return intervalDelays.length; },
  clearInterval() {},
  addEventListener(type, callback) { eventListeners.set(type, callback); },
  dispatchEvent() {}
};
class MutationObserver {
  constructor(callback) { observerCallback = callback; }
  observe() {}
}

vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "..", "guard-main.js"), "utf8"),
  {
    window, document, HTMLFormElement, CustomEvent: class CustomEvent {}, MutationObserver, Date, Number, Function,
    grecaptcha: { reset() { captchaResets += 1; } }
  }
);

assert.ok(window.open("https://normal.example"));
assert.equal(originalOpenCalls, 1);
window.setTimeout(function countdownRedirect() {}, 3000);
assert.equal(timeoutDelays.at(-1), 3000);

attributes.set("data-smart-link-guide-popup-guard", "active");
attributes.set("data-smart-link-guide-aggressive", "active");
attributes.set("data-smart-link-guide-local-counter", "active");
observerCallback();
assert.equal(window.count, 0);
window.blurred = true;
eventListeners.get("blur")();
await Promise.resolve();
assert.equal(window.blurred, false);
assert.equal(window.open("https://popup.example"), null);
assert.equal(originalOpenCalls, 1);
window.alert("completed");
assert.equal(originalAlertCalls, 0);
const popupForm = new HTMLFormElement();
popupForm.target = "_blank";
popupForm.submit();
assert.equal(popupForm.target, "_self");
assert.equal(popupForm.submitted, 1);

window.setTimeout(function countdownRedirect() {}, 3000);
window.setInterval(function updateTimer() {}, 1000);
assert.equal(timeoutDelays.at(-1), 25);
assert.equal(intervalDelays.at(-1), 50);

window.count = 5;
attributes.set("data-smart-link-guide-natural-timing", "active");
observerCallback();
assert.equal(window.count, 5);
window.setTimeout(function countdownRedirect() {}, 3000);
window.setInterval(function updateTimer() {}, 1000);
assert.equal(timeoutDelays.at(-1), 3000);
assert.equal(intervalDelays.at(-1), 1000);

eventListeners.get("unhandledrejection")({ reason: new Error("reCAPTCHA Timeout") });
assert.equal(attributes.get("data-smart-link-guide-captcha-error"), "timeout");
assert.equal(attributes.has("data-smart-link-guide-popup-guard"), false);
assert.equal(attributes.has("data-smart-link-guide-aggressive"), false);
assert.equal(attributes.has("data-smart-link-guide-local-counter"), false);
assert.equal(captchaResets, 1);

process.stdout.write("guard tests passed\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
