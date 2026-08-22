const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const listeners = {};
const attributes = new Map();
const navigations = [];

class Element {
  closest() { return this; }
  getAttribute(name) { return name === "aria-label" ? this.ariaLabel || "" : null; }
}
class HTMLFormElement extends Element {}

const document = {
  documentElement: {
    getAttribute(name) { return attributes.get(name) || null; },
    setAttribute(name, value) { attributes.set(name, value); }
  }
};
const window = {
  addEventListener(type, listener) { listeners[type] = listener; }
};
const location = {
  href: "https://gate.example/step",
  assign(url) { navigations.push(url); }
};
const chrome = {
  runtime: {
    async sendMessage() { return { ok: true, active: true }; }
  }
};

vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "..", "early-guard.js"), "utf8"),
  { window, document, location, chrome, Element, HTMLFormElement, URL, Promise }
);

(async () => {
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(attributes.get("data-smart-link-guide-popup-guard"), "active");

  const advertisement = Object.assign(new Element(), {
    target: "_blank",
    href: "https://ads.example/offer",
    textContent: "Advertisement",
    title: ""
  });
  const adEvent = {
    target: advertisement,
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; }
  };
  listeners.click(adEvent);
  assert.equal(adEvent.prevented, true);
  assert.equal(adEvent.stopped, true);
  assert.deepEqual(navigations, []);

  const transition = Object.assign(new Element(), {
    target: "_blank",
    href: "https://next.example/step",
    textContent: "Click here to proceed",
    title: ""
  });
  listeners.click({
    target: transition,
    preventDefault() {},
    stopImmediatePropagation() {}
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(navigations, ["https://next.example/step"]);

  const form = Object.assign(new HTMLFormElement(), { target: "_blank" });
  listeners.submit({ target: form });
  assert.equal(form.target, "_self");

  process.stdout.write("early guard tests passed\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
