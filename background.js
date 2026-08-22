importScripts("engine.js");

const Engine = globalThis.LinkGuideEngine;
const SCHEMA_VERSION = 2;
const MAX_LEARNED_LINKS = 250;
const MAX_LEARNED_BUNDLES = 100;
const MAX_JOURNEY_AGE_MS = 10 * 60 * 1000;
const AUTO_RULE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const DEFAULT_STORE = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  settings: {
    enabled: false,
    showAssistant: true,
    autoOpenLearned: true,
    autoOpenLearnedPatterns: true,
    blockPopupsOnGatePages: true,
    aggressiveFastPass: true,
    autoSubmitSteps: true,
    hideGateAds: true,
    dismissAntiAdblockOverlays: true
  },
  learnedLinks: [],
  learnedBundles: [],
  profiles: [],
  stats: {
    confirmedJourneys: 0,
    automaticSkips: 0
  }
});

const tabStates = new Map();
const journeys = new Map();

function mergeSettings(saved) {
  return { ...DEFAULT_STORE.settings, ...(saved || {}) };
}

async function getStore() {
  const saved = await chrome.storage.local.get(DEFAULT_STORE);
  const savedLinks = Array.isArray(saved.learnedLinks) ? saved.learnedLinks : [];
  const learnedLinks = Number(saved.schemaVersion || 0) < 2
    ? savedLinks.filter((item) => !Engine.isContainerPage(item.source))
    : savedLinks;
  return {
    ...DEFAULT_STORE,
    ...saved,
    schemaVersion: SCHEMA_VERSION,
    settings: mergeSettings(saved.settings),
    learnedLinks,
    learnedBundles: Array.isArray(saved.learnedBundles) ? saved.learnedBundles : [],
    profiles: Array.isArray(saved.profiles) ? saved.profiles : [],
    stats: { ...DEFAULT_STORE.stats, ...(saved.stats || {}) }
  };
}

async function initialize() {
  const store = await getStore();
  await chrome.storage.local.set(store);
}

function cleanupJourneys() {
  const cutoff = Date.now() - MAX_JOURNEY_AGE_MS;
  for (const [tabId, journey] of journeys.entries()) {
    if (journey.updatedAt < cutoff) journeys.delete(tabId);
  }
}

function startJourney(tabId, targetUrl, sourceUrl = null) {
  const normalized = Engine.normalizeUrl(targetUrl);
  if (!Number.isInteger(tabId) || !normalized) return null;
  const normalizedSource = Engine.normalizeUrl(sourceUrl);
  const existing = journeys.get(tabId);
  const currentKey = Engine.canonicalKey(existing?.currentUrl);
  const continuesExisting = Boolean(existing && currentKey && (
    Engine.canonicalKey(normalized) === currentKey ||
    Engine.canonicalKey(normalizedSource) === currentKey
  ));
  if (continuesExisting) {
    existing.naturalTiming = Boolean(existing.naturalTiming || Engine.requiresNaturalTiming(normalized));
    return updateJourney(tabId, normalized);
  }
  const now = Date.now();
  const journey = {
    tabId,
    sourceUrl: normalizedSource || null,
    startUrl: normalized,
    startHost: new URL(normalized).hostname,
    currentUrl: normalized,
    chain: [normalized],
    naturalTiming: Engine.requiresNaturalTiming(normalized),
    recoveryAttempts: 0,
    startedAt: now,
    updatedAt: now
  };
  journeys.set(tabId, journey);
  return journey;
}

function updateJourney(tabId, urlValue) {
  const journey = journeys.get(tabId);
  const normalized = Engine.normalizeUrl(urlValue);
  if (!journey || !normalized) return null;
  journey.currentUrl = normalized;
  journey.updatedAt = Date.now();
  if (journey.chain.at(-1) !== normalized && journey.chain.length < 30) journey.chain.push(normalized);
  return journey;
}

function recoveryCheckpoint(journey, rejectedUrl) {
  if (!journey || !Array.isArray(journey.chain)) return null;
  const rejectedKey = Engine.canonicalKey(rejectedUrl);
  const candidates = [];
  const seen = new Set();
  for (let index = journey.chain.length - 1; index >= 0; index -= 1) {
    const candidate = Engine.normalizeUrl(journey.chain[index]);
    const key = Engine.canonicalKey(candidate);
    if (!candidate || !key || key === rejectedKey || seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
  }
  if (!candidates.length) return journey.startUrl || null;
  try {
    const rejectedOrigin = new URL(Engine.normalizeUrl(rejectedUrl)).origin;
    return candidates.find((candidate) => new URL(candidate).origin === rejectedOrigin) || candidates[0];
  } catch {
    return candidates[0];
  }
}

function findLearnedLink(store, urlValue) {
  const key = Engine.canonicalKey(urlValue);
  if (!key) return null;
  return store.learnedLinks.find((item) => item.sourceKey === key) || null;
}

function findLearnedProfile(store, sourceUrl, candidate) {
  if (!candidate?.parameter) return null;
  const source = Engine.normalizeUrl(sourceUrl);
  if (!source) return null;
  const host = new URL(source).hostname;
  return store.profiles.find((profile) =>
    profile.host === host &&
    profile.parameter.toLowerCase() === candidate.parameter.toLowerCase() &&
    profile.confirmations >= 2
  ) || null;
}

async function getDecision(urlValue, hardVerification = false) {
  const store = await getStore();
  const normalized = Engine.normalizeUrl(urlValue);
  if (!normalized || !store.settings.enabled) return { enabled: false };

  const sourceKey = Engine.canonicalKey(normalized);
  const learnedBundle = store.learnedBundles.find((item) => item.sourceKey === sourceKey) || null;
  if (learnedBundle) {
    const targets = learnedBundle.targets.filter((target) => Engine.assessRisk(target).safe);
    const fresh = Date.now() - learnedBundle.confirmedAt <= AUTO_RULE_MAX_AGE_MS;
    if (targets.length) {
      return {
        enabled: true,
        target: targets[0],
        targets,
        reason: `Daha önce doğrulanan ${targets.length} hedeflik container`,
        learned: true,
        auto: Boolean(targets.length === 1 && store.settings.autoOpenLearned && fresh && !hardVerification),
        score: 100,
        risk: { safe: true, level: "safe", reasons: [] }
      };
    }
  }

  const learned = Engine.isContainerPage(normalized) ? null : findLearnedLink(store, normalized);
  if (learned) {
    const risk = Engine.assessRisk(learned.target);
    const fresh = Date.now() - learned.confirmedAt <= AUTO_RULE_MAX_AGE_MS;
    return {
      enabled: true,
      target: learned.target,
      reason: "Daha önce doğruladığınız tam bağlantı",
      learned: true,
      auto: Boolean(store.settings.autoOpenLearned && fresh && risk.safe && !hardVerification),
      score: 100,
      risk
    };
  }

  const candidate = Engine.analyzeUrl(normalized).candidates[0] || null;
  if (!candidate) return { enabled: true, target: null };
  const profile = findLearnedProfile(store, normalized, candidate);
  return {
    enabled: true,
    target: candidate.url,
    reason: candidate.reason,
    learned: Boolean(profile),
    auto: Boolean(profile && store.settings.autoOpenLearnedPatterns && candidate.risk.safe && !hardVerification),
    risk: candidate.risk,
    score: candidate.score,
    parameter: candidate.parameter
  };
}

async function learnBundle(sourceUrl, targetValues) {
  const source = Engine.normalizeUrl(sourceUrl);
  if (!source) throw new Error("Container adresi geçersiz.");
  const seen = new Set();
  const targets = [];
  for (const value of targetValues || []) {
    const target = Engine.cleanTracking(Engine.normalizeUrl(value));
    const key = Engine.canonicalKey(target);
    if (!target || !key || seen.has(key) || !Engine.assessRisk(target).safe) continue;
    seen.add(key);
    targets.push(target);
    if (targets.length >= 12) break;
  }
  if (!targets.length) throw new Error("Öğrenilecek güvenli hedef bulunamadı.");

  const store = await getStore();
  const sourceKey = Engine.canonicalKey(source);
  const entry = {
    sourceKey,
    source,
    sourceHost: new URL(source).hostname,
    targets,
    targetHosts: [...new Set(targets.map((target) => new URL(target).hostname))],
    confirmedAt: Date.now()
  };
  store.learnedBundles = store.learnedBundles.filter((item) => item.sourceKey !== sourceKey);
  store.learnedBundles.unshift(entry);
  store.learnedBundles = store.learnedBundles.slice(0, MAX_LEARNED_BUNDLES);
  store.learnedLinks = store.learnedLinks.filter((item) => item.sourceKey !== sourceKey);
  await chrome.storage.local.set({ learnedBundles: store.learnedBundles, learnedLinks: store.learnedLinks });
  return entry;
}

function pageBlocksConfirmation(page) {
  return Boolean(
    page?.hardVerification ||
    page?.hasGateAction ||
    page?.hasAntiAdblock ||
    page?.gateError ||
    Number(page?.gateScore || 0) >= 35
  );
}

function confirmationFor(tabId, currentUrl, page = null) {
  const journey = updateJourney(tabId, currentUrl);
  if (!journey) return null;
  const current = new URL(journey.currentUrl);
  if (current.hostname === journey.startHost || Engine.canonicalKey(journey.currentUrl) === Engine.canonicalKey(journey.startUrl)) return null;
  if (pageBlocksConfirmation(page)) return null;
  return {
    from: journey.startUrl,
    to: journey.currentUrl,
    hops: journey.chain.length
  };
}

async function confirmJourney(tabId, destinationUrl) {
  const journey = journeys.get(tabId);
  const destination = Engine.normalizeUrl(destinationUrl);
  if (!journey || !destination || Engine.canonicalKey(destination) !== Engine.canonicalKey(journey.currentUrl)) {
    throw new Error("Doğrulanabilecek etkin bir geçiş bulunamadı.");
  }
  const page = tabStates.get(tabId) || null;
  if (page && Engine.canonicalKey(page.url) === Engine.canonicalKey(destination) && pageBlocksConfirmation(page)) {
    throw new Error("Geçiş adımları tamamlanmadan hedef öğrenilemez.");
  }

  const risk = Engine.assessRisk(destination);
  if (!risk.safe) throw new Error("Yüksek riskli hedef otomatik öğrenmeye alınmadı.");

  if (Engine.isContainerPage(journey.startUrl)) {
    const entry = await learnBundle(journey.startUrl, [destination]);
    const bundleStore = await getStore();
    bundleStore.stats.confirmedJourneys += 1;
    await chrome.storage.local.set({ stats: bundleStore.stats });
    journeys.delete(tabId);
    return entry;
  }

  const store = await getStore();
  const sourceKey = Engine.canonicalKey(journey.startUrl);
  const now = Date.now();
  const entry = {
    sourceKey,
    source: journey.startUrl,
    target: Engine.cleanTracking(destination),
    sourceHost: new URL(journey.startUrl).hostname,
    targetHost: new URL(destination).hostname,
    confirmedAt: now,
    confirmations: 1,
    hops: journey.chain.length
  };

  const existingIndex = store.learnedLinks.findIndex((item) => item.sourceKey === sourceKey);
  if (existingIndex >= 0) {
    entry.confirmations = (store.learnedLinks[existingIndex].confirmations || 0) + 1;
    store.learnedLinks.splice(existingIndex, 1);
  }
  store.learnedLinks.unshift(entry);
  store.learnedLinks = store.learnedLinks.slice(0, MAX_LEARNED_LINKS);

  const analyzed = Engine.analyzeUrl(journey.startUrl).candidates;
  const matchingCandidate = analyzed.find((candidate) => {
    try {
      return new URL(candidate.url).hostname === new URL(destination).hostname;
    } catch {
      return false;
    }
  });

  if (matchingCandidate?.parameter) {
    const profileKey = `${entry.sourceHost}:${matchingCandidate.parameter.toLowerCase()}`;
    const profileIndex = store.profiles.findIndex((profile) => profile.key === profileKey);
    const profile = profileIndex >= 0
      ? { ...store.profiles[profileIndex] }
      : { key: profileKey, host: entry.sourceHost, parameter: matchingCandidate.parameter, confirmations: 0, sources: [] };
    profile.sources = Array.isArray(profile.sources) ? profile.sources : [];
    if (!profile.sources.includes(sourceKey)) profile.sources.push(sourceKey);
    profile.confirmations = profile.sources.length;
    profile.updatedAt = now;
    if (profileIndex >= 0) store.profiles.splice(profileIndex, 1);
    store.profiles.unshift(profile);
  }

  store.stats.confirmedJourneys += 1;
  await chrome.storage.local.set({
    learnedLinks: store.learnedLinks,
    profiles: store.profiles,
    stats: store.stats
  });
  journeys.delete(tabId);
  return entry;
}

async function getPopupState(tabId, currentUrl) {
  const store = await getStore();
  const state = Number.isInteger(tabId) ? tabStates.get(tabId) || null : null;
  const journey = Number.isInteger(tabId) ? journeys.get(tabId) || null : null;
  return {
    ...store,
    currentUrl: Engine.normalizeUrl(currentUrl),
    currentPage: state,
    decision: currentUrl ? await getDecision(currentUrl, Boolean(state?.hardVerification)) : null,
    pendingConfirmation: journey && currentUrl ? confirmationFor(tabId, currentUrl, state) : null
  };
}

chrome.runtime.onInstalled.addListener(() => initialize().catch(console.error));
chrome.runtime.onStartup.addListener(() => initialize().catch(console.error));

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  cleanupJourneys();
  updateJourney(details.tabId, details.url);
  tabStates.delete(details.tabId);
});

chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  const sourceJourney = journeys.get(details.sourceTabId);
  if (!sourceJourney) return;
  journeys.set(details.tabId, {
    ...sourceJourney,
    tabId: details.tabId,
    currentUrl: Engine.normalizeUrl(details.url) || sourceJourney.currentUrl,
    chain: [...sourceJourney.chain],
    updatedAt: Date.now()
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
  journeys.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    cleanupJourneys();
    const senderTabId = sender.tab?.id;

    switch (message?.type) {
      case "PAGE_STATE": {
        if (!Number.isInteger(senderTabId)) throw new Error("Sekme bilgisi alınamadı.");
        const page = {
          url: Engine.normalizeUrl(message.page?.url),
          gateScore: Number(message.page?.gateScore) || 0,
          hasCaptcha: Boolean(message.page?.hasCaptcha),
          hardVerification: Boolean(message.page?.hardVerification),
          hasGateAction: Boolean(message.page?.hasGateAction),
          hasAntiAdblock: Boolean(message.page?.hasAntiAdblock),
          gateError: Boolean(message.page?.gateError),
          gateErrorMessage: String(message.page?.gateErrorMessage || "").slice(0, 300),
          candidates: Array.isArray(message.page?.candidates) ? message.page.candidates.slice(0, 8) : [],
          updatedAt: Date.now()
        };
        tabStates.set(senderTabId, page);
        if (!journeys.has(senderTabId) && page.url && page.gateScore >= 45) startJourney(senderTabId, page.url);
        const journey = journeys.get(senderTabId) || null;
        let recoveryUrl = null;
        if (page.gateError && journey) {
          journey.naturalTiming = true;
          if ((journey.recoveryAttempts || 0) < 1) {
            journey.recoveryAttempts = (journey.recoveryAttempts || 0) + 1;
            recoveryUrl = recoveryCheckpoint(journey, page.url);
          }
        }
        return {
          ok: true,
          decision: await getDecision(page.url, page.hardVerification),
          pendingConfirmation: confirmationFor(senderTabId, page.url, page),
          journeyActive: Boolean(journey),
          naturalTiming: Boolean(journey?.naturalTiming),
          recoveryUrl,
          settings: (await getStore()).settings
        };
      }
      case "START_JOURNEY": {
        const tabId = Number.isInteger(message.tabId) ? message.tabId : senderTabId;
        return { ok: Boolean(startJourney(tabId, message.targetUrl, message.sourceUrl)) };
      }
      case "CONFIRM_JOURNEY": {
        const tabId = Number.isInteger(message.tabId) ? message.tabId : senderTabId;
        return { ok: true, entry: await confirmJourney(tabId, message.destinationUrl) };
      }
      case "DISMISS_JOURNEY": {
        const tabId = Number.isInteger(message.tabId) ? message.tabId : senderTabId;
        journeys.delete(tabId);
        return { ok: true };
      }
      case "GET_DECISION":
        return { ok: true, decision: await getDecision(message.url, Boolean(message.hardVerification)) };
      case "AUTO_SKIP_USED": {
        const store = await getStore();
        store.stats.automaticSkips += 1;
        await chrome.storage.local.set({ stats: store.stats });
        return { ok: true };
      }
      case "LEARN_BUNDLE":
        return { ok: true, entry: await learnBundle(message.sourceUrl, message.targets) };
      case "GET_POPUP_STATE":
        return { ok: true, state: await getPopupState(message.tabId, message.currentUrl) };
      case "UPDATE_SETTINGS": {
        const store = await getStore();
        const settings = mergeSettings({ ...store.settings, ...(message.patch || {}) });
        await chrome.storage.local.set({ settings });
        return { ok: true, settings };
      }
      case "OPEN_URL": {
        const target = Engine.normalizeUrl(message.url);
        const risk = Engine.assessRisk(target);
        if (!target || !risk.safe) throw new Error("Hedef güvenli otomatik açma ölçütlerini karşılamıyor.");
        await chrome.tabs.update(message.tabId, { url: target });
        return { ok: true };
      }
      case "REMOVE_RULE": {
        const store = await getStore();
        const key = Engine.canonicalKey(message.source);
        const learnedLinks = store.learnedLinks.filter((item) => item.sourceKey !== key);
        const learnedBundles = store.learnedBundles.filter((item) => item.sourceKey !== key);
        const profiles = store.profiles
          .map((profile) => {
            const sources = Array.isArray(profile.sources)
              ? profile.sources.filter((sourceKey) => sourceKey !== key)
              : [];
            return { ...profile, sources, confirmations: sources.length };
          })
          .filter((profile) => profile.confirmations > 0);
        await chrome.storage.local.set({ learnedLinks, learnedBundles, profiles });
        return { ok: true };
      }
      case "CLEAR_RULES":
        await chrome.storage.local.set({ learnedLinks: [], learnedBundles: [], profiles: [] });
        return { ok: true };
      default:
        return { ok: false, error: "Bilinmeyen istek." };
    }
  })()
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
