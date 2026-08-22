(function initializeLinkGuideEngine(root) {
  "use strict";

  const DESTINATION_PARAMS = new Set([
    "url", "u", "uri", "target", "dest", "destination", "redirect",
    "redirect_url", "redirect_uri", "to", "go", "out", "link",
    "continue", "return", "return_to", "next", "r"
  ]);

  const TRACKING_PARAMS = new Set([
    "fbclid", "gclid", "dclid", "msclkid", "igshid", "mc_cid", "mc_eid",
    "ref_src", "ref_url"
  ]);

  const DANGEROUS_EXTENSIONS = /\.(?:exe|msi|msp|scr|com|bat|cmd|ps1|vbs|vbe|js|jse|jar|apk|dmg|pkg|iso)(?:$|[?#])/i;
  const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

  function normalizeUrl(value, baseUrl) {
    try {
      const url = baseUrl ? new URL(String(value), baseUrl) : new URL(String(value));
      if (!HTTP_PROTOCOLS.has(url.protocol)) return null;
      url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
      return url.href;
    } catch {
      return null;
    }
  }

  function isPrivateHost(hostname) {
    const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
    if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;

    const parts = host.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    return parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] === 0;
  }

  function decodeBase64Url(value) {
    const compact = String(value || "").trim().replace(/\s+/g, "");
    if (compact.length < 12 || !/^[A-Za-z0-9+/_=-]+$/.test(compact)) return null;
    try {
      const normalized = compact.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
      const bytes = atob(padded);
      const decoded = decodeURIComponent([...bytes]
        .map((character) => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join(""));
      return decoded;
    } catch {
      return null;
    }
  }

  function decodeDestinationValue(value, baseUrl) {
    const queue = [String(value || "").trim().replace(/&amp;/gi, "&")];
    const seen = new Set();

    for (let depth = 0; depth < 4 && queue.length; depth += 1) {
      const current = queue.shift();
      if (!current || seen.has(current)) continue;
      seen.add(current);

      const looksLikeAbsoluteUrl = /^(?:https?:)?\/\//i.test(current);
      if (looksLikeAbsoluteUrl) {
        const normalized = normalizeUrl(current, baseUrl);
        if (normalized) return normalized;
      }

      try {
        const decoded = decodeURIComponent(current.replace(/\+/g, "%20"));
        if (decoded !== current) queue.push(decoded);
      } catch {}

      const base64 = decodeBase64Url(current);
      if (base64 && base64 !== current) queue.push(base64);
    }

    return null;
  }

  function cleanTracking(urlValue) {
    const normalized = normalizeUrl(urlValue);
    if (!normalized) return null;
    const url = new URL(normalized);
    for (const key of [...url.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (lower.startsWith("utm_") || TRACKING_PARAMS.has(lower)) url.searchParams.delete(key);
    }
    return url.href;
  }

  function canonicalKey(urlValue) {
    const cleaned = cleanTracking(urlValue);
    if (!cleaned) return null;
    const url = new URL(cleaned);
    url.hash = "";
    url.searchParams.sort();
    return url.href;
  }

  function assessRisk(urlValue) {
    const normalized = normalizeUrl(urlValue);
    if (!normalized) return { safe: false, level: "danger", reasons: ["Geçersiz veya desteklenmeyen adres"] };
    const url = new URL(normalized);
    const reasons = [];
    let level = "safe";

    if (isPrivateHost(url.hostname)) return { safe: false, level: "danger", reasons: ["Yerel/özel ağ adresi"] };
    if (DANGEROUS_EXTENSIONS.test(`${url.pathname}${url.search}`)) {
      level = "danger";
      reasons.push("Çalıştırılabilir veya yüksek riskli dosya türü");
    }
    if (url.protocol !== "https:") {
      if (level !== "danger") level = "warning";
      reasons.push("Şifrelenmemiş HTTP bağlantısı");
    }
    if (url.username || url.password) {
      if (level !== "danger") level = "warning";
      reasons.push("Adres içinde kullanıcı bilgisi bulunuyor");
    }
    if (url.hostname.startsWith("xn--") || url.hostname.includes(".xn--")) {
      if (level !== "danger") level = "warning";
      reasons.push("Uluslararasılaştırılmış/punycode alan adı");
    }
    if (url.port && !["80", "443"].includes(url.port)) {
      if (level !== "danger") level = "warning";
      reasons.push("Standart dışı port");
    }

    return { safe: level !== "danger", level, reasons };
  }

  function analyzeUrl(urlValue) {
    const normalized = normalizeUrl(urlValue);
    if (!normalized) return { url: null, candidates: [] };
    const source = new URL(normalized);
    const sourceKey = canonicalKey(normalized);
    const candidates = [];
    const seen = new Set();

    for (const [key, rawValue] of source.searchParams.entries()) {
      const decoded = decodeDestinationValue(rawValue, normalized);
      if (!decoded) continue;
      const cleaned = cleanTracking(decoded);
      const candidateKey = canonicalKey(cleaned);
      if (!candidateKey || candidateKey === sourceKey || seen.has(candidateKey)) continue;
      seen.add(candidateKey);

      const knownParameter = DESTINATION_PARAMS.has(key.toLowerCase());
      candidates.push({
        url: cleaned,
        parameter: key,
        source: "query",
        score: knownParameter ? 95 : 72,
        reason: knownParameter ? `Bilinen hedef parametresi: ${key}` : `URL içeren parametre: ${key}`,
        risk: assessRisk(cleaned)
      });
    }

    return {
      url: normalized,
      candidates: candidates.sort((left, right) => right.score - left.score)
    };
  }

  function classifyActionText(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!text || text.length > 140) return { eligible: false, score: 0, reason: "" };
    if (/login|log\s*in|sign\s*in|sign\s*up|register|subscribe|purchase|buy\s*now|payment|pay\s*now|install|notification|bildirim|satın\s*al|kayıt\s*ol|giriş\s*yap/.test(text)) {
      return { eligible: false, score: 0, reason: "Hassas veya kapsam dışı eylem" };
    }

    const rules = [
      { pattern: /\b(?:(?:i['’]?m|i\s+am)\s+(?:a\s+)?human|ben\s+insanım)\b/, score: 100, reason: "Basit insan onay adımı" },
      { pattern: /get\s*(?:the\s*)?link|linki\s*(?:al|göster)/, score: 98, reason: "Hedef bağlantıyı alma" },
      { pattern: /skip\s*(?:ad|advertisement)|reklamı\s*geç/, score: 96, reason: "Reklam adımını geçme" },
      { pattern: /click\s*(?:here\s*)?to\s*(?:continue|proceed)|continue|proceed|devam\s*et|sonraki\s*adım/, score: 92, reason: "Devam adımı" },
      { pattern: /unlock\s*(?:link|content)|access\s*(?:link|content)|view\s*(?:the\s*)?link|bağlantının\s*kilidini\s*aç|içeriğe\s*eriş/, score: 90, reason: "İçerik kilidini açma" },
      { pattern: /open\s*(?:the\s*)?(?:link|destination)|visit\s*(?:link|site)|hedefe\s*git|linki\s*aç/, score: 86, reason: "Hedefi açma" },
      { pattern: /generate\s*(?:the\s*)?link|create\s*(?:download\s*)?link/, score: 82, reason: "Bağlantı üretme" }
    ];
    const match = rules.find((rule) => rule.pattern.test(text));
    return match
      ? { eligible: true, score: match.score, reason: match.reason }
      : { eligible: false, score: 0, reason: "" };
  }

  function shouldFollowActionHref(hrefValue, currentUrlValue) {
    const href = normalizeUrl(hrefValue, currentUrlValue);
    const current = normalizeUrl(currentUrlValue);
    if (!href || !current) return false;
    return canonicalKey(href) !== canonicalKey(current);
  }

  function isContainerPage(urlValue) {
    const normalized = normalizeUrl(urlValue);
    if (!normalized) return false;
    return /\/(?:container|protected|p\d+)(?:\/|$)/i.test(new URL(normalized).pathname);
  }

  function isPlausibleCaptchaAnswer(value, constraints = {}) {
    const answer = String(value || "").trim();
    const explicitMin = Number(constraints.minLength);
    const explicitMax = Number(constraints.maxLength);
    const minimum = Number.isInteger(explicitMin) && explicitMin >= 2 && explicitMin <= 12
      ? explicitMin
      : Number.isInteger(explicitMax) && explicitMax >= 4 && explicitMax <= 12
        ? explicitMax
        : 4;
    if (answer.length < minimum) return false;
    if (Number.isInteger(explicitMax) && explicitMax >= minimum && answer.length > explicitMax) return false;
    if (constraints.pattern) {
      try {
        if (!new RegExp(`^(?:${constraints.pattern})$`).test(answer)) return false;
      } catch {}
    }
    return true;
  }

  root.LinkGuideEngine = Object.freeze({
    DESTINATION_PARAMS,
    normalizeUrl,
    cleanTracking,
    canonicalKey,
    decodeDestinationValue,
    assessRisk,
    analyzeUrl,
    classifyActionText,
    shouldFollowActionHref,
    isContainerPage,
    isPlausibleCaptchaAnswer,
    isPrivateHost
  });
})(globalThis);
