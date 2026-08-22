(function installFastPassMainGuard() {
  "use strict";

  const nativeOpen = window.open;
  const nativeAlert = window.alert;
  const nativeFormSubmit = globalThis.HTMLFormElement?.prototype?.submit;
  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeSetInterval = window.setInterval.bind(window);
  const nativeClearInterval = window.clearInterval.bind(window);
  const managedIntervals = new Map();
  const COUNTDOWN_NAMES = [
    "count", "counter", "countdown", "timer", "seconds", "timeLeft",
    "timeleft", "remaining", "remainingTime", "waitTime"
  ];
  let accelerator = null;
  let acceleratorStopsAt = 0;

  function popupGuardActive() {
    return document.documentElement?.getAttribute("data-smart-link-guide-popup-guard") === "active";
  }

  function aggressiveActive() {
    return document.documentElement?.getAttribute("data-smart-link-guide-aggressive") === "active" &&
      document.documentElement?.getAttribute("data-smart-link-guide-natural-timing") !== "active";
  }

  function localCounterActive() {
    return document.documentElement?.getAttribute("data-smart-link-guide-local-counter") === "active";
  }

  function transitionCallback(callback) {
    try {
      const source = typeof callback === "function"
        ? Function.prototype.toString.call(callback)
        : String(callback);
      return /count|timer|second|wait|redirect|location|href|continue|unlock|disabled|button|click|submit|get.?link/i.test(source);
    } catch {
      return false;
    }
  }

  function acceleratedDelay(callback, delay, interval = false) {
    const numericDelay = Number(delay) || 0;
    if (!aggressiveActive() || (!transitionCallback(callback) && !localCounterActive())) return numericDelay;
    if (interval && numericDelay >= 250 && numericDelay <= 5000) return 50;
    if (!interval && numericDelay >= 500 && numericDelay <= 60000) return 25;
    return numericDelay;
  }

  window.open = function guardedWindowOpen(...args) {
    if (popupGuardActive()) {
      window.dispatchEvent(new CustomEvent("smart-link-guide-popup-blocked"));
      return null;
    }
    return nativeOpen.apply(this, args);
  };

  window.alert = function guardedAlert(...args) {
    if (popupGuardActive()) {
      window.dispatchEvent(new CustomEvent("smart-link-guide-dialog-blocked"));
      return undefined;
    }
    return nativeAlert?.apply(this, args);
  };

  if (nativeFormSubmit) {
    globalThis.HTMLFormElement.prototype.submit = function guardedFormSubmit(...args) {
      if (popupGuardActive() && /^_(?:blank|new)$/i.test(this.target || "")) this.target = "_self";
      return nativeFormSubmit.apply(this, args);
    };
  }

  window.setTimeout = function fastPassTimeout(callback, delay, ...args) {
    return nativeSetTimeout(callback, acceleratedDelay(callback, delay, false), ...args);
  };

  window.setInterval = function fastPassInterval(callback, delay, ...args) {
    const originalDelay = Number(delay) || 0;
    const currentDelay = acceleratedDelay(callback, originalDelay, true);
    const logicalId = nativeSetInterval(callback, currentDelay, ...args);
    managedIntervals.set(logicalId, { callback, originalDelay, args, currentDelay, currentId: logicalId });
    return logicalId;
  };

  window.clearInterval = function fastPassClearInterval(logicalId) {
    const record = managedIntervals.get(logicalId);
    if (record) {
      managedIntervals.delete(logicalId);
      return nativeClearInterval(record.currentId);
    }
    return nativeClearInterval(logicalId);
  };

  function reconcileManagedIntervals() {
    for (const record of managedIntervals.values()) {
      const targetDelay = acceleratedDelay(record.callback, record.originalDelay, true);
      if (targetDelay === record.currentDelay) continue;
      nativeClearInterval(record.currentId);
      record.currentId = nativeSetInterval(record.callback, targetDelay, ...record.args);
      record.currentDelay = targetDelay;
    }
  }

  function resetKnownCountdowns() {
    if (!aggressiveActive()) return;
    for (const name of COUNTDOWN_NAMES) {
      try {
        if (typeof window[name] === "number" && Number.isFinite(window[name]) && window[name] > 0 && window[name] <= 600) {
          window[name] = 0;
        }
      } catch {}
    }
  }

  function startAccelerator() {
    acceleratorStopsAt = Date.now() + 20_000;
    resetKnownCountdowns();
    reconcileManagedIntervals();
    if (accelerator) return;
    accelerator = nativeSetInterval(() => {
      if (!aggressiveActive() || Date.now() >= acceleratorStopsAt) {
        nativeClearInterval(accelerator);
        accelerator = null;
        return;
      }
      resetKnownCountdowns();
    }, 75);
  }

  const attributeObserver = new MutationObserver(() => {
    if (aggressiveActive()) startAccelerator();
    else reconcileManagedIntervals();
  });

  function observeRoot() {
    if (!document.documentElement) return;
    attributeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-smart-link-guide-aggressive", "data-smart-link-guide-natural-timing", "data-smart-link-guide-local-counter"]
    });
    if (aggressiveActive()) startAccelerator();
  }

  if (document.documentElement) observeRoot();
  else document.addEventListener("readystatechange", observeRoot, { once: true });
})();
