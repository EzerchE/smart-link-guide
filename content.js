(function runLinkGuide() {
  "use strict";

  if (window.top !== window || !globalThis.LinkGuideEngine) return;
  const Engine = globalThis.LinkGuideEngine;
  const CARD_ID = "smart-link-guide-card";
  const MAX_ANCHORS_TO_SCAN = 400;
  let settings = null;
  let currentPage = null;
  let lastCardSignature = null;
  let fastPassObserver = null;
  let fastPassThrottle = null;
  let scheduledTargetTimer = null;
  let scheduledTargetSignature = null;
  let captchaSubmissionReadyAt = Number.POSITIVE_INFINITY;
  const actionAttempts = new Map();

  function sampleVisibleText(limit = 7000) {
    if (!document.body) return "";
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const chunks = [];
    let length = 0;
    while (length < limit) {
      const node = walker.nextNode();
      if (!node) break;
      const value = String(node.nodeValue || "").trim();
      if (!value) continue;
      const part = value.slice(0, limit - length);
      chunks.push(part);
      length += part.length + 1;
    }
    return chunks.join(" ").toLowerCase();
  }

  function send(message) {
    return chrome.runtime.sendMessage(message).catch(() => ({ ok: false }));
  }

  function addCandidate(target, metadata, output, seen) {
    const normalized = Engine.normalizeUrl(target, location.href);
    if (!normalized) return;
    const key = Engine.canonicalKey(normalized);
    if (!key || key === Engine.canonicalKey(location.href) || seen.has(key)) return;
    const risk = Engine.assessRisk(normalized);
    seen.add(key);
    output.push({
      url: Engine.cleanTracking(normalized),
      score: metadata.score,
      reason: metadata.reason,
      source: metadata.source,
      parameter: metadata.parameter || null,
      final: metadata.final !== false,
      learnable: metadata.learnable !== false,
      risk
    });
  }

  function scanPage() {
    const candidates = [];
    const seen = new Set();
    const urlAnalysis = Engine.analyzeUrl(location.href);
    for (const candidate of urlAnalysis.candidates) addCandidate(candidate.url, candidate, candidates, seen);

    const bodyText = sampleVisibleText();
    const markerPatterns = [
      /\bcontinue\b/, /get\s*link/, /skip\s*(?:ad|advert)/, /please\s*wait/,
      /unlock\s*link/, /proceed\s*to/, /click\s*to\s*proceed/, /bağlantıya\s*git/, /devam\s*et/,
      /linki\s*aç/, /geri\s*sayım/, /bekleyin/, /\bredirect(?:ing|ion)?\b/,
      /protected\s*(?:link|download)/
    ];
    const markerCount = markerPatterns.filter((pattern) => pattern.test(bodyText)).length;
    const hasCaptcha = /captcha|i['’]?m\s+a\s+human|ben\s+insanım/.test(bodyText) ||
      Boolean(document.querySelector('[class*="captcha" i], [id*="captcha" i], iframe[src*="captcha" i], iframe[src*="recaptcha" i]'));
    const captchaWidgets = [...document.querySelectorAll([
      'iframe[src*="recaptcha" i]', 'iframe[src*="hcaptcha" i]', 'iframe[src*="captcha" i]',
      'textarea[name*="captcha" i]', 'input[name*="captcha" i]', '.g-recaptcha', '.h-captcha',
      '.cf-turnstile', '.pow-captcha', '[class*="cutcaptcha" i]', '[id*="cutcaptcha" i]'
    ].join(","))];
    const hasCaptchaResponse = [...document.querySelectorAll([
      'textarea[name*="captcha-response" i]', 'input[name*="captcha-response" i]',
      'input[name="cf-turnstile-response"]'
    ].join(","))].some((element) => String(element.value || "").trim().length > 0);
    const hasCaptchaWidget = !hasCaptchaResponse && captchaWidgets.some((element) => {
      if (!isVisible(element)) return false;
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        return !captchaFieldLooksComplete(element);
      }
      if (element.matches('.pow-captcha[data-state="done"], .pow-captcha[data-state="confirmed"]')) return false;
      if (element.querySelector?.('[role="checkbox"][aria-checked="true"]')) return false;
      return true;
    });
    const hasPasswordField = [...document.querySelectorAll('input[type="password"]')].some(isVisible);
    const hasPaymentField = [...document.querySelectorAll([
      'input[autocomplete^="cc-"]', 'input[name*="card" i]', 'input[name*="iban" i]',
      'input[name*="payment" i]'
    ].join(","))].some(isVisible);
    const hardVerification = hasCaptchaWidget || hasPasswordField || hasPaymentField;
    const likelyLogin = hasPasswordField &&
      /\b(?:sign\s*in|log\s*in|login|giriş\s*yap)\b/.test(bodyText);
    const forms = document.forms.length;
    const lastPathPart = location.pathname.split("/").filter(Boolean).at(-1) || "";
    const tokenLikePath = /^[A-Za-z0-9_-]{6,32}(?:\.html)?$/.test(lastPathPart);
    const semanticGatePath = /\/(?:go|out|redirect|link|container|protected|p\d+)(?:\/|$)/i.test(location.pathname);
    let gateScore = Math.min(40, urlAnalysis.candidates.length * 40) +
      Math.min(24, markerCount * 8) +
      (hasCaptcha ? 25 : 0) +
      (forms ? 6 : 0) +
      (tokenLikePath ? 8 : 0) +
      (semanticGatePath ? 18 : 0);
    if (likelyLogin && !urlAnalysis.candidates.length) gateScore = Math.min(gateScore, 20);

    const metaRefresh = document.querySelector('meta[http-equiv="refresh" i]')?.content || "";
    const metaMatch = metaRefresh.match(/(?:^|;)\s*url\s*=\s*["']?([^"']+)/i);
    if (metaMatch) {
      addCandidate(metaMatch[1].trim(), {
        score: 98,
        reason: "Sayfanın meta yönlendirme hedefi",
        source: "meta-refresh"
      }, candidates, seen);
      gateScore += 20;
    }

    if (gateScore >= 15) {
      const anchors = [...document.querySelectorAll("a[href]")].slice(0, MAX_ANCHORS_TO_SCAN);
      for (const anchor of anchors) {
        const href = Engine.normalizeUrl(anchor.href, location.href);
        if (!href) continue;
        const text = `${anchor.textContent || ""} ${anchor.getAttribute("aria-label") || ""}`.trim().toLowerCase();
        const parsedHref = new URL(href);
        const external = parsedHref.hostname !== location.hostname;
        const visibleTransition = !external && /\/(?:link|out|redirect)\/[^/]+/i.test(parsedHref.pathname) &&
          isVisible(anchor) && Boolean(elementLabel(anchor));
        if (external && isLikelyResultAnchor(anchor, text)) {
          addCandidate(href, {
            score: 84,
            reason: `Sonuç bağlantısı: ${text.slice(0, 60) || new URL(href).hostname}`,
            source: "result-anchor",
            final: true
          }, candidates, seen);
        } else if (visibleTransition) {
          addCandidate(href, {
            score: 80,
            reason: "Container tarafından üretilen görünür geçiş bağlantısı",
            source: "transition-result",
            final: true,
            learnable: false
          }, candidates, seen);
        }
      }
    }

    candidates.sort((left, right) => right.score - left.score);
    return {
      url: location.href,
      title: document.title,
      gateScore: Math.min(100, gateScore),
      hasCaptcha,
      hardVerification,
      candidates: candidates.slice(0, 8)
    };
  }

  function removeCard(resetSignature = true) {
    document.getElementById(CARD_ID)?.remove();
    if (resetSignature) lastCardSignature = null;
  }

  function makeButton(label, primary, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.cssText = primary
      ? "border:0;border-radius:9px;padding:9px 12px;background:#0f766e;color:#fff;font:700 12px system-ui;cursor:pointer;"
      : "border:1px solid #cbd5e1;border-radius:9px;padding:9px 12px;background:#fff;color:#334155;font:700 12px system-ui;cursor:pointer;";
    button.addEventListener("click", onClick);
    return button;
  }

  function showCard({ title, text, target, primaryLabel, onPrimary, secondaryLabel, onSecondary, tone = "info" }) {
    if (!settings?.showAssistant) return;
    const signature = `${title}|${text}|${target || ""}|${primaryLabel || ""}`;
    if (signature === lastCardSignature && document.getElementById(CARD_ID)) return;
    removeCard(false);
    lastCardSignature = signature;

    const host = document.createElement("div");
    host.id = CARD_ID;
    host.style.cssText = "all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483647;width:min(360px,calc(100vw - 36px));";
    const shadow = host.attachShadow({ mode: "closed" });
    const card = document.createElement("section");
    const border = tone === "danger" ? "#fecaca" : tone === "success" ? "#a7f3d0" : "#bae6fd";
    card.style.cssText = `box-sizing:border-box;border:1px solid ${border};border-radius:15px;padding:14px;background:rgba(255,255,255,.97);box-shadow:0 18px 50px rgba(15,23,42,.25);color:#17211d;font-family:Inter,system-ui,sans-serif;`;

    const heading = document.createElement("strong");
    heading.textContent = title;
    heading.style.cssText = "display:block;font-size:14px;line-height:1.35;";
    const description = document.createElement("p");
    description.textContent = text;
    description.style.cssText = "margin:5px 0 0;color:#52605a;font-size:12px;line-height:1.45;";
    card.append(heading, description);

    if (target) {
      const destination = document.createElement("code");
      destination.textContent = target;
      destination.title = target;
      destination.style.cssText = "display:block;overflow:hidden;margin-top:9px;padding:7px 8px;border-radius:8px;background:#f1f5f3;color:#24564b;font:11px ui-monospace,monospace;text-overflow:ellipsis;white-space:nowrap;";
      card.append(destination);
    }

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;flex-wrap:wrap;gap:7px;margin-top:11px;";
    if (primaryLabel && onPrimary) actions.append(makeButton(primaryLabel, true, onPrimary));
    if (secondaryLabel && onSecondary) actions.append(makeButton(secondaryLabel, false, onSecondary));
    actions.append(makeButton("Kapat", false, removeCard));
    card.append(actions);
    shadow.append(card);
    (document.documentElement || document.body).append(host);
  }

  function safeNavigate(target, automatic = false) {
    const normalized = Engine.normalizeUrl(target);
    const risk = Engine.assessRisk(normalized);
    if (!normalized || !risk.safe) return;
    const loopKey = `${Engine.canonicalKey(location.href)}>${Engine.canonicalKey(normalized)}`;
    const previous = sessionStorage.getItem("slg_last_auto") || "";
    if (automatic && previous.startsWith(loopKey)) return;
    if (automatic) {
      sessionStorage.setItem("slg_last_auto", `${loopKey}:${Date.now()}`);
      send({ type: "AUTO_SKIP_USED" });
    }
    location.replace(normalized);
  }

  function uniqueSafeTargets(values) {
    const seen = new Set();
    const targets = [];
    for (const value of values || []) {
      const normalized = Engine.cleanTracking(Engine.normalizeUrl(value, location.href));
      const key = Engine.canonicalKey(normalized);
      if (!normalized || !key || seen.has(key) || !Engine.assessRisk(normalized).safe) continue;
      seen.add(key);
      targets.push(normalized);
      if (targets.length >= 12) break;
    }
    return targets;
  }

  async function openTargetGroup(values, { learnBundle = false } = {}) {
    const targets = uniqueSafeTargets(values);
    if (!targets.length) return;
    clearTimeout(scheduledTargetTimer);
    scheduledTargetTimer = null;
    scheduledTargetSignature = null;

    if (targets.length === 1) {
      if (learnBundle) await send({ type: "LEARN_BUNDLE", sourceUrl: location.href, targets });
      send({ type: "START_JOURNEY", sourceUrl: location.href, targetUrl: location.href });
      safeNavigate(targets[0], true);
      return;
    }

    const response = await send({
      type: "OPEN_URLS",
      urls: targets,
      learnSource: learnBundle ? location.href : null
    });
    if (response?.ok) {
      showCard({
        title: `${targets.length} hedef açıldı`,
        text: "Sonuç bağlantıları ayrı sekmelerde açıldı ve bu container yerel olarak öğrenildi.",
        tone: "success"
      });
    }
  }

  function scheduleTargetGroup(values, { learnBundle = false, reason = "Hedef bulundu" } = {}) {
    const targets = uniqueSafeTargets(values);
    if (!targets.length) return;
    const signature = targets.map(Engine.canonicalKey).join("|");
    if (scheduledTargetSignature === signature && scheduledTargetTimer) return;
    clearTimeout(scheduledTargetTimer);
    scheduledTargetSignature = signature;
    scheduledTargetTimer = setTimeout(() => openTargetGroup(targets, { learnBundle }), 3000);

    showCard({
      title: targets.length > 1 ? `${targets.length} hedef bulundu` : "Hedef bulundu",
      text: `${reason}. ${targets.length > 1 ? "Tümü" : "Hedef"} 3 saniye sonra otomatik açılacak.`,
      target: targets.length === 1 ? targets[0] : `${targets.length} doğrulanabilir dış bağlantı`,
      primaryLabel: targets.length > 1 ? "Tümünü şimdi aç" : "Şimdi aç",
      onPrimary: () => openTargetGroup(targets, { learnBundle }),
      secondaryLabel: "Otomatiği durdur",
      onSecondary: () => {
        clearTimeout(scheduledTargetTimer);
        scheduledTargetTimer = null;
        scheduledTargetSignature = null;
        removeCard();
      },
      tone: "success"
    });
  }

  function showDecision(decision) {
    const targets = uniqueSafeTargets(decision?.targets || (decision?.target ? [decision.target] : []));
    if (!targets.length) return;
    if (decision.auto) {
      openTargetGroup(targets);
      return;
    }
    showCard({
      title: decision.learned ? "Öğrenilmiş hedef bulundu" : "Açık hedef bulundu",
      text: decision.reason || "Yönlendirme adresinden olası hedef çıkarıldı.",
      target: targets.length === 1 ? targets[0] : `${targets.length} hedef`,
      primaryLabel: targets.length === 1 ? "Hedefe git" : "Tüm hedefleri aç",
      onPrimary: () => openTargetGroup(targets),
      secondaryLabel: "Normal devam",
      onSecondary: () => {
        removeCard();
      },
      tone: decision.risk?.level === "warning" ? "danger" : "success"
    });
  }

  function showConfirmation(pending) {
    showCard({
      title: "Doğru hedefe ulaştınız mı?",
      text: "Onaylarsanız bu tam geçiş yalnız bilgisayarınızda öğrenilir ve sonraki karşılaşmada otomatik açılabilir.",
      target: pending.to,
      primaryLabel: "Evet, bunu öğren",
      onPrimary: async () => {
        const response = await send({ type: "CONFIRM_JOURNEY", destinationUrl: location.href });
        if (response?.ok) {
          showCard({
            title: "Geçiş öğrenildi",
            text: "Aynı bağlantı sonraki karşılaşmada doğrudan açılacak.",
            target: pending.to,
            tone: "success"
          });
        }
      },
      secondaryLabel: "Hayır, öğrenme",
      onSecondary: () => {
        send({ type: "DISMISS_JOURNEY" });
        removeCard();
      },
      tone: "success"
    });
  }

  function looksLikeShortLink(urlValue) {
    try {
      const url = new URL(urlValue);
      const label = url.hostname.split(".")[0];
      const token = url.pathname.split("/").filter(Boolean).at(-1) || "";
      return label.length <= 7 && /^[A-Za-z0-9_-]{6,24}$/.test(token);
    } catch {
      return false;
    }
  }

  function isLikelyResultAnchor(anchor, labelValue = "") {
    if (!(anchor instanceof HTMLAnchorElement) || !isVisible(anchor)) return false;
    if (anchor.closest("nav,header,footer,aside,.top_ad,[class*='advert' i],[class~='ad-container' i],[data-ad-slot]")) return false;
    const href = Engine.normalizeUrl(anchor.href, location.href);
    if (!href) return false;
    const url = new URL(href);
    if (url.hostname === location.hostname) return false;
    if (url.searchParams.has("refer") || url.searchParams.has("sub3") || /facebook|twitter|instagram|linkedin/i.test(url.hostname)) return false;

    const label = String(labelValue || elementLabel(anchor)).toLowerCase();
    if (!label || label.length > 240) return false;
    const semanticClass = /(?:^|\s)(?:purl|direct|live|download|result|out-link|protected-link)(?:\s|$)/i
      .test(`${anchor.className || ""} ${anchor.parentElement?.className || ""}`);
    const looksLikeAddress = /https?:\/\/|\b[a-z0-9-]+\.(?:com|net|org|io|co|cc|to|me|tv|xyz|cloud|download)\b/i.test(label);
    const resultArea = anchor.closest("main,article,section,table,.card,.panel,.container");
    const resultContext = /protected\s*links?|download\s*links?|generated\s*links?|results?|direct\s*links?|korumalı\s*bağlantı/i
      .test(String(resultArea?.textContent || "").slice(0, 1200));
    return semanticClass || looksLikeAddress || resultContext;
  }

  function elementLabel(element) {
    const labels = element.labels ? [...element.labels].map((label) => label.textContent || "").join(" ") : "";
    const wrappingLabel = element.closest("label")?.textContent || "";
    const imageAlts = [...element.querySelectorAll?.("img[alt]") || []].map((image) => image.alt).join(" ");
    return `${element.textContent || ""} ${element.value || ""} ${element.getAttribute("aria-label") || ""} ${element.title || ""} ${labels} ${wrappingLabel} ${imageAlts}`
      .replace(/\s+/g, " ")
      .trim();
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function formIsSensitive(form) {
    return Boolean(form?.querySelector([
      'input[type="password"]', 'input[type="file"]', 'input[autocomplete^="cc-"]',
      'input[name*="card" i]', 'input[name*="iban" i]', 'input[name*="payment" i]'
    ].join(",")));
  }

  function captchaFieldLooksComplete(field) {
    return Date.now() >= captchaSubmissionReadyAt && Engine.isPlausibleCaptchaAnswer(field?.value, {
      minLength: field?.minLength,
      maxLength: field?.maxLength,
      pattern: field?.pattern
    });
  }

  function formHasCompletedVerification(form) {
    if (!form) return false;
    const fields = [...form.querySelectorAll([
      'input[name*="captcha" i]', 'input[id*="captcha" i]',
      'textarea[name*="captcha" i]', 'textarea[id*="captcha" i]'
    ].join(","))].filter(isVisible);
    return fields.length > 0 && fields.every(captchaFieldLooksComplete);
  }

  function removeObviousGateAds() {
    if (!settings?.hideGateAds || currentPage?.gateScore < 35) return;
    const selectors = [
      "ins.adsbygoogle", 'iframe[src*="doubleclick" i]', 'iframe[src*="googlesyndication" i]',
      '[id^="ad_" i]', '[id^="ads_" i]', '[id^="advert" i]',
      '[class~="advertisement" i]', '[class~="ad-container" i]', '[class~="adsbox" i]',
      '[data-ad-slot]', '[data-ad-client]'
    ];
    for (const element of [...document.querySelectorAll(selectors.join(","))].slice(0, 80)) {
      if (element.closest('[class*="captcha" i], [id*="captcha" i]')) continue;
      element.style.setProperty("display", "none", "important");
    }

    for (const element of [...document.querySelectorAll("body *")].slice(0, 500)) {
      if (!(element instanceof HTMLElement) || element.children.length > 8) continue;
      const style = getComputedStyle(element);
      if (!['fixed', 'absolute'].includes(style.position) || Number.parseInt(style.zIndex, 10) < 1000) continue;
      const rect = element.getBoundingClientRect();
      const coversPage = rect.width >= innerWidth * 0.8 && rect.height >= innerHeight * 0.8;
      const nearlyInvisible = Number(style.opacity || 1) < 0.15 || style.backgroundColor === "rgba(0, 0, 0, 0)";
      const hasUsefulText = String(element.textContent || "").trim().length > 12;
      if (coversPage && nearlyInvisible && !hasUsefulText) {
        element.style.setProperty("pointer-events", "none", "important");
      }
    }
  }

  function eligibleActions() {
    const elements = [...document.querySelectorAll([
      "button", 'input[type="submit"]', 'input[type="button"]', 'input[type="checkbox"]', 'a[href]', '[role="button"]', '[role="checkbox"]'
    ].join(","))].slice(0, 500);
    const actions = [];

    for (const element of elements) {
      if (element.closest('[class*="captcha" i], [id*="captcha" i]')) continue;
      const label = elementLabel(element);
      const form = element.form || element.closest("form");
      let classification = Engine.classifyActionText(label);
      if (!classification.eligible && formHasCompletedVerification(form) && /\b(?:submit|verify|check|doğrula|gönder)\b/i.test(label)) {
        classification = { eligible: true, score: 99, reason: "Tamamlanan doğrulamayı gönderme" };
      }
      if (!classification.eligible || !isVisible(element)) continue;
      if (formIsSensitive(form)) continue;
      actions.push({ element, form, ...classification });
    }

    return actions.sort((left, right) => right.score - left.score);
  }

  function triggerAction(action) {
    const { element, form } = action;
    const href = element instanceof HTMLAnchorElement
      ? Engine.normalizeUrl(element.href, location.href)
      : null;
    const signature = `${element.tagName}:${elementLabel(element).toLowerCase()}:${href || form?.action || ""}`;
    const attempts = actionAttempts.get(signature) || 0;
    if (attempts >= 3) return false;
    actionAttempts.set(signature, attempts + 1);

    element.removeAttribute("disabled");
    element.removeAttribute("aria-disabled");
    element.classList.remove("disabled", "btn-disabled", "is-disabled");
    if ("disabled" in element) {
      try { element.disabled = false; } catch {}
    }

    if (href && Engine.shouldFollowActionHref(href, location.href)) {
      const risk = Engine.assessRisk(href);
      if (!risk.safe) return false;
      send({ type: "START_JOURNEY", sourceUrl: location.href, targetUrl: location.href });
      safeNavigate(href, true);
      return true;
    }

    try {
      element.click();
      return true;
    } catch {}

    if (form && !formIsSensitive(form)) {
      try {
        if (form.requestSubmit && element instanceof HTMLElement) form.requestSubmit(element);
        else form.submit();
        return true;
      } catch {}
    }
    return false;
  }

  function tryFallbackForm() {
    const forms = [...document.forms].filter((form) => !formIsSensitive(form));
    for (const form of forms) {
      const actionUrl = Engine.normalizeUrl(form.action || location.href, location.href);
      if (!actionUrl) continue;
      const action = new URL(actionUrl);
      const sameOrigin = action.origin === location.origin;
      const transitionPath = /\/(?:go|out|redirect|link|continue|unlock)(?:\/|$)/i.test(action.pathname);
      const classifiedForm = Engine.classifyActionText(elementLabel(form));
      if ((!sameOrigin && !transitionPath) || (!transitionPath && !classifiedForm.eligible)) continue;
      const signature = `FORM:${actionUrl}`;
      const attempts = actionAttempts.get(signature) || 0;
      if (attempts >= 2) continue;
      actionAttempts.set(signature, attempts + 1);
      try {
        if (form.requestSubmit) form.requestSubmit();
        else form.submit();
        return true;
      } catch {}
    }
    return false;
  }

  function attemptFastPass() {
    if (!settings?.enabled || !settings.aggressiveFastPass || currentPage?.gateScore < 35) return;
    currentPage = scanPage();
    removeObviousGateAds();
    if (currentPage.hardVerification) {
      document.documentElement.removeAttribute("data-smart-link-guide-aggressive");
      return;
    }
    document.documentElement.setAttribute("data-smart-link-guide-aggressive", "active");
    if (!settings.autoSubmitSteps) return;

    const action = eligibleActions()[0];
    if (action) triggerAction(action);
    else tryFallbackForm();
  }

  function startFastPassAutomation() {
    if (fastPassObserver || !document.body) return;
    const delays = [0, 120, 350, 800, 1500, 2600, 4200];
    for (const delay of delays) setTimeout(attemptFastPass, delay);

    fastPassObserver = new MutationObserver(() => {
      clearTimeout(fastPassThrottle);
      fastPassThrottle = setTimeout(attemptFastPass, 80);
    });
    fastPassObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "class", "style", "href", "data-state", "aria-checked"]
    });
    setTimeout(() => {
      fastPassObserver?.disconnect();
      fastPassObserver = null;
    }, 30_000);
  }

  document.addEventListener("click", (event) => {
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!anchor || !settings?.enabled) return;
    const targetUrl = Engine.normalizeUrl(anchor.href, location.href);
    if (!targetUrl) return;

    const candidate = Engine.analyzeUrl(targetUrl).candidates[0] || null;
    if (candidate?.risk?.safe && settings.showAssistant) {
      event.preventDefault();
      event.stopPropagation();
      send({ type: "START_JOURNEY", sourceUrl: location.href, targetUrl });
      showCard({
        title: "Yönlendirme hedefi bağlantıda bulundu",
        text: candidate.reason,
        target: candidate.url,
        primaryLabel: "Hedefe git",
        onPrimary: () => safeNavigate(candidate.url),
        secondaryLabel: "Normal bağlantıyı aç",
        onSecondary: () => { location.href = targetUrl; },
        tone: "success"
      });
      return;
    }

    if (looksLikeShortLink(targetUrl)) {
      send({ type: "START_JOURNEY", sourceUrl: location.href, targetUrl });
    }
  }, true);

  document.addEventListener("input", () => {
    if (!settings?.enabled || !settings.aggressiveFastPass) return;
    captchaSubmissionReadyAt = Date.now() + 2500;
    clearTimeout(fastPassThrottle);
    fastPassThrottle = setTimeout(() => {
      currentPage = scanPage();
      attemptFastPass();
      reportPage();
    }, 2500);
  }, true);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.settings?.newValue) return;
    settings = { ...settings, ...changes.settings.newValue };
    if (!settings.enabled || !settings.blockPopupsOnGatePages) {
      document.documentElement.removeAttribute("data-smart-link-guide-popup-guard");
    }
    if (!settings.enabled || !settings.aggressiveFastPass) {
      document.documentElement.removeAttribute("data-smart-link-guide-aggressive");
      fastPassObserver?.disconnect();
      fastPassObserver = null;
      clearTimeout(scheduledTargetTimer);
      scheduledTargetTimer = null;
      scheduledTargetSignature = null;
    }
    if (!settings.enabled || !settings.showAssistant) removeCard();
  });

  async function reportPage() {
    currentPage = scanPage();
    const response = await send({ type: "PAGE_STATE", page: currentPage });
    if (!response?.ok) return;
    settings = response.settings;
    if (!settings.enabled) return;
    if (settings.blockPopupsOnGatePages && currentPage.gateScore >= 35) {
      document.documentElement.setAttribute("data-smart-link-guide-popup-guard", "active");
    } else {
      document.documentElement.removeAttribute("data-smart-link-guide-popup-guard");
    }
    if (settings.aggressiveFastPass && currentPage.gateScore >= 35) {
      if (currentPage.hardVerification) {
        document.documentElement.removeAttribute("data-smart-link-guide-aggressive");
      } else {
        document.documentElement.setAttribute("data-smart-link-guide-aggressive", "active");
      }
      startFastPassAutomation();
    } else {
      document.documentElement.removeAttribute("data-smart-link-guide-aggressive");
    }
    const finalCandidates = currentPage.candidates.filter((candidate) => candidate.final !== false && candidate.risk?.safe);
    const finalTargets = uniqueSafeTargets(finalCandidates.map((candidate) => candidate.url));
    if (response.pendingConfirmation) showConfirmation(response.pendingConfirmation);
    else if (response.decision?.target || response.decision?.targets?.length) {
      if (response.decision.auto) showDecision(response.decision);
      else if (settings.aggressiveFastPass && !currentPage.hardVerification && (response.decision.score || 0) >= 90) {
        scheduleTargetGroup(response.decision.targets || [response.decision.target], {
          reason: response.decision.reason,
          learnBundle: false
        });
      } else showDecision(response.decision);
    }
    else if (currentPage.hardVerification && currentPage.gateScore >= 35) {
      showCard({
        title: "İnsan doğrulaması gerekiyor",
        text: "Gerçek CAPTCHA/parola adımını tamamlayın; kaybolduğu anda FastPass kalan adımları otomatik çalıştıracak.",
        tone: "info"
      });
    } else if (finalTargets.length) {
      if (settings.aggressiveFastPass) {
        scheduleTargetGroup(finalTargets, {
          reason: finalTargets.length > 1 ? "Container birden çok sonuç üretti" : finalCandidates[0].reason,
          learnBundle: Engine.isContainerPage(location.href) && finalCandidates.every((candidate) => candidate.learnable !== false)
        });
      } else {
        showDecision({
          target: finalTargets[0],
          targets: finalTargets,
          reason: finalCandidates[0].reason,
          learned: false,
          auto: false
        });
      }
    }
  }

  reportPage().then(() => {
    if (currentPage?.gateScore >= 25) {
      setTimeout(reportPage, 1500);
      setTimeout(reportPage, 4000);
    }
  });
})();
