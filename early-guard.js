(function installEarlyGateGuard() {
  "use strict";

  const ROOT_ATTRIBUTE = "data-smart-link-guide-popup-guard";
  const TRANSITION_TEXT = /continue|proceed|get\s*(?:the\s*)?link|skip\s*(?:ad|advert)|unlock|open\s*(?:the\s*)?(?:link|destination)|devam\s*et|linki\s*aç|hedefe\s*git/i;

  function guardActive() {
    return document.documentElement?.getAttribute(ROOT_ATTRIBUTE) === "active";
  }

  function isPopupTarget(target) {
    const value = String(target || "").trim().toLowerCase();
    return Boolean(value && !["_self", "_top", "_parent"].includes(value));
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(value, location.href);
      return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  function blockOrRetargetClick(event) {
    if (!guardActive() || !(event.target instanceof Element)) return;
    const anchor = event.target.closest("a[href]");
    if (!anchor || !isPopupTarget(anchor.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const href = safeHttpUrl(anchor.href);
    const label = `${anchor.textContent || ""} ${anchor.getAttribute("aria-label") || ""} ${anchor.title || ""}`;
    if (href && TRANSITION_TEXT.test(label)) location.assign(href);
  }

  window.addEventListener("click", blockOrRetargetClick, true);
  window.addEventListener("auxclick", blockOrRetargetClick, true);
  window.addEventListener("submit", (event) => {
    if (!guardActive() || !(event.target instanceof HTMLFormElement)) return;
    if (isPopupTarget(event.target.target)) event.target.target = "_self";
  }, true);

  try {
    Promise.resolve(chrome.runtime.sendMessage({ type: "GET_GUARD_STATE", url: location.href }))
      .then((response) => {
        if (response?.active) document.documentElement?.setAttribute(ROOT_ATTRIBUTE, "active");
      })
      .catch(() => {});
  } catch {}
})();
