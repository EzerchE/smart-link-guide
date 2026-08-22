(function installFastPassMainGuard() {
  "use strict";

  const nativeOpen = window.open;
  const nativeAlert = window.alert;
  const nativeFormSubmit = globalThis.HTMLFormElement?.prototype?.submit;
  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeSetInterval = window.setInterval.bind(window);
  const nativeClearInterval = window.clearInterval.bind(window);
  const managedIntervals = new Map();
  const AD_GEOMETRY_SELECTOR = [
    ".adsbox", ".ad-banner", ".banner-inner", ".ad-element", ".clever-core-ads-offerwall",
    'ins[data-sizes-desktop]', 'ins[data-sizes-mobile]', '[data-ad-slot]', '[data-ad-client]',
    'ins[class^="adv-" i]',
    '[id^="ad_" i]', '[id^="ads_" i]', '[id^="advert" i]',
    '[class~="ad-container" i]', '[class~="advertisement" i]'
  ].join(",");
  const COUNTDOWN_NAMES = [
    "count", "counter", "countdown", "timer", "seconds", "timeLeft",
    "timeleft", "remaining", "remainingTime", "waitTime"
  ];
  let accelerator = null;
  let acceleratorStopsAt = 0;
  let captchaResetAttempts = 0;

  function likelyMonetizedGateUrl() {
    const href = String(globalThis.location?.href || "");
    const path = String(globalThis.location?.pathname || "");
    const lastPart = path.split("/").filter(Boolean).at(-1) || "";
    return /(?:[?&])src=[^&#]+/i.test(href) && /^[A-Za-z0-9_-]{5,32}$/.test(lastPart);
  }

  function installSignedAntiAdblockCompatibility() {
    if (!likelyMonetizedGateUrl() || Object.getOwnPropertyDescriptor(window, "app_vars")) return;
    let capturedValue;
    Object.defineProperty(window, "app_vars", {
      configurable: true,
      enumerable: true,
      get() { return capturedValue; },
      set(nextValue) {
        if (nextValue && typeof nextValue === "object" &&
          Object.hasOwn(nextValue, "force_disable_adblock") &&
          Object.hasOwn(nextValue, "adblock_allowed") &&
          Object.hasOwn(nextValue, "please_disable_adblock")) {
          nextValue.force_disable_adblock = "0";
          nextValue.adblock_allowed = true;
          document.documentElement?.setAttribute("data-smart-link-guide-adblock-compatible", "active");
        }
        capturedValue = nextValue;
      }
    });
  }

  installSignedAntiAdblockCompatibility();

  function markCaptchaFailure(reason) {
    const message = String(reason?.message || reason || "");
    if (!/(?:recaptcha|captcha).*(?:timeout|network|failed)|(?:timeout|network|failed).*(?:recaptcha|captcha)/i.test(message)) return false;
    const root = document.documentElement;
    root?.setAttribute("data-smart-link-guide-captcha-error", /timeout/i.test(message) ? "timeout" : "network");
    root?.removeAttribute("data-smart-link-guide-popup-guard");
    root?.removeAttribute("data-smart-link-guide-aggressive");
    root?.removeAttribute("data-smart-link-guide-local-counter");
    if (captchaResetAttempts < 1) {
      captchaResetAttempts += 1;
      try { globalThis.grecaptcha?.reset?.(); } catch {}
    }
    return true;
  }

  function declaredAdDimension(element, axis, fallback) {
    const declared = `${element.getAttribute?.("data-sizes-desktop") || ""},${element.getAttribute?.("data-sizes-mobile") || ""}`
      .match(/\b(\d{2,4})x(\d{2,4})\b/i);
    if (!declared) return fallback;
    return axis === "width" ? Math.min(970, Number(declared[1])) : Math.min(600, Number(declared[2]));
  }

  function installAdGeometryShim(prototype, property, axis, fallback) {
    if (!prototype) return;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
    if (!descriptor?.configurable || typeof descriptor.get !== "function") return;
    Object.defineProperty(prototype, property, {
      ...descriptor,
      get() {
        const measured = descriptor.get.call(this);
        try {
          if (gateSurfaceActive() && measured < 25 && this.matches?.(AD_GEOMETRY_SELECTOR)) {
            return declaredAdDimension(this, axis, fallback);
          }
        } catch {}
        return measured;
      }
    });
  }

  installAdGeometryShim(globalThis.HTMLElement?.prototype, "offsetWidth", "width", 300);
  installAdGeometryShim(globalThis.HTMLElement?.prototype, "offsetHeight", "height", 90);
  installAdGeometryShim(globalThis.Element?.prototype, "clientWidth", "width", 300);
  installAdGeometryShim(globalThis.Element?.prototype, "clientHeight", "height", 90);

  window.addEventListener?.("blur", () => {
    if (!localCounterActive()) return;
    Promise.resolve().then(() => {
      try { window.blurred = false; } catch {}
    });
  }, true);

  window.addEventListener?.("unhandledrejection", (event) => {
    markCaptchaFailure(event.reason);
  }, true);

  window.addEventListener?.("error", (event) => {
    if (markCaptchaFailure(event.error || event.message)) return;
    const target = event.target;
    if (target?.tagName !== "SCRIPT" || !/^https?:/i.test(target.src || "")) return;
    const captchaResource = /(?:google\.com|gstatic\.com|recaptcha\.net)\/.*recaptcha/i.test(target.src);
    if (captchaResource) {
      document.documentElement?.setAttribute("data-smart-link-guide-resource-blocked", "captcha");
      markCaptchaFailure("reCAPTCHA network failed");
    } else if (gateSurfaceActive()) {
      document.documentElement?.setAttribute("data-smart-link-guide-resource-blocked", "script");
    }
  }, true);

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

  function gateSurfaceActive() {
    const root = document.documentElement;
    const activeAttribute = [
      "data-smart-link-guide-popup-guard",
      "data-smart-link-guide-aggressive",
      "data-smart-link-guide-local-counter"
    ].some((name) => root?.getAttribute(name) === "active");
    if (activeAttribute) return true;
    const bodyClass = String(document.body?.className || "");
    const path = String(globalThis.location?.pathname || "");
    return /(?:^|\s)(?:banner|interstitial)[-_]page(?:\s|$)|shortlink|adlink/i.test(bodyClass) ||
      /\/(?:go|goto|out|redirect|links?\/go)(?:\/|$)/i.test(path);
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
    if (transitionCallback(callback) || gateSurfaceActive()) {
      managedIntervals.set(logicalId, { callback, originalDelay, args, currentDelay, currentId: logicalId });
    }
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
    if (localCounterActive()) {
      try { window.blurred = false; } catch {}
    }
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
