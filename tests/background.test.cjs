const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const listeners = {};
const storage = {};
const tabUpdates = [];
const tabCreates = [];
const tabRemovals = [];

const chrome = {
  storage: {
    local: {
      async get(defaults) { return { ...defaults, ...storage }; },
      async set(values) { Object.assign(storage, values); }
    }
  },
  runtime: {
    onInstalled: { addListener(listener) { listeners.installed = listener; } },
    onStartup: { addListener(listener) { listeners.startup = listener; } },
    onMessage: { addListener(listener) { listeners.message = listener; } }
  },
  webNavigation: {
    onCommitted: { addListener(listener) { listeners.committed = listener; } },
    onCreatedNavigationTarget: { addListener(listener) { listeners.createdTarget = listener; } }
  },
  tabs: {
    onRemoved: { addListener(listener) { listeners.tabRemoved = listener; } },
    async update(tabId, patch) { tabUpdates.push({ tabId, patch }); },
    async create(patch) { tabCreates.push(patch); return { id: 100 + tabCreates.length, ...patch }; },
    async remove(tabId) { tabRemovals.push(tabId); }
  }
};

const context = {
  chrome,
  console,
  URL,
  URLSearchParams,
  atob,
  decodeURIComponent,
  Date,
  Map,
  Set,
  Promise,
  globalThis: null,
  importScripts() {}
};
context.globalThis = context;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "engine.js"), "utf8"), context);
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8"), context);

function send(message, tabId = 8, tabUrl = "https://source.example/") {
  return new Promise((resolve) => {
    const keepOpen = listeners.message(message, { tab: { id: tabId, url: tabUrl } }, resolve);
    assert.equal(keepOpen, true);
  });
}

(async () => {
  await listeners.installed();
  assert.equal(storage.schemaVersion, 4);
  assert.equal(storage.settings.enabled, false);
  assert.equal(storage.settings.blockPopupsOnGatePages, true);
  assert.equal(storage.settings.aggressiveFastPass, true);
  assert.equal(storage.settings.autoSubmitSteps, true);
  assert.equal(storage.settings.dismissAntiAdblockOverlays, true);
  await send({ type: "UPDATE_SETTINGS", patch: { enabled: true } });

  const signedGateway = `https://jump.example/goto/${"A".repeat(40)}/token`;
  const timedIntermediate = "https://intermediate.example/wait";
  const rejectedStep = "https://intermediate.example/links/go";
  assert.equal((await send({ type: "START_JOURNEY", targetUrl: signedGateway })).ok, true);
  assert.equal((await send({ type: "GET_GUARD_STATE" })).active, true);
  listeners.createdTarget({ sourceTabId: 8, tabId: 81, url: "https://popup.example/ad" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(tabRemovals, [81]);
  listeners.committed({ tabId: 8, frameId: 0, url: timedIntermediate });
  assert.equal((await send({
    type: "START_JOURNEY",
    targetUrl: timedIntermediate,
    sourceUrl: timedIntermediate
  }, 8, timedIntermediate)).ok, true);
  listeners.committed({ tabId: 8, frameId: 0, url: rejectedStep });
  const rejected = await send({
    type: "PAGE_STATE",
    page: {
      url: rejectedStep,
      gateScore: 0,
      gateError: true,
      gateErrorMessage: "Bad Request.",
      candidates: []
    }
  }, 8, rejectedStep);
  assert.equal(rejected.pendingConfirmation, null);
  assert.equal(rejected.naturalTiming, true);
  assert.equal(rejected.recoveryUrl, timedIntermediate);
  const repeatedRejection = await send({
    type: "PAGE_STATE",
    page: { url: rejectedStep, gateScore: 0, gateError: true, candidates: [] }
  }, 8, rejectedStep);
  assert.equal(repeatedRejection.recoveryUrl, null);
  const rejectedConfirmation = await send({ type: "CONFIRM_JOURNEY", destinationUrl: rejectedStep }, 8, rejectedStep);
  assert.equal(rejectedConfirmation.ok, false);

  listeners.committed({ tabId: 8, frameId: 0, url: timedIntermediate });
  listeners.committed({ tabId: 8, frameId: 0, url: rejectedStep });
  listeners.committed({ tabId: 8, frameId: 0, url: timedIntermediate });
  const loopState = await send({
    type: "PAGE_STATE",
    page: { url: timedIntermediate, gateScore: 20, candidates: [] }
  }, 8, timedIntermediate);
  assert.equal(loopState.loopDetected, true);
  assert.equal((await send({ type: "RESET_LOOP" }, 8, timedIntermediate)).ok, true);

  const automaticGateway = "https://short.example/automatic";
  const automaticDestination = "https://ordinary.example/article";
  await send({ type: "START_JOURNEY", targetUrl: automaticGateway }, 9, automaticGateway);
  listeners.committed({
    tabId: 9,
    frameId: 0,
    url: automaticDestination,
    transitionType: "link",
    transitionQualifiers: ["server_redirect"]
  });
  const automaticArrival = await send({
    type: "PAGE_STATE",
    page: { url: automaticDestination, gateScore: 0, candidates: [] }
  }, 9, automaticDestination);
  assert.equal(automaticArrival.journeyActive, false);
  assert.equal(automaticArrival.pendingConfirmation, null);

  const unrelatedPage = "https://ordinary.example/another-page";
  listeners.committed({
    tabId: 9,
    frameId: 0,
    url: unrelatedPage,
    transitionType: "link",
    transitionQualifiers: []
  });
  const unrelatedState = await send({
    type: "PAGE_STATE",
    page: { url: unrelatedPage, gateScore: 0, candidates: [] }
  }, 9, unrelatedPage);
  assert.equal(unrelatedState.journeyActive, false);
  assert.equal(unrelatedState.pendingConfirmation, null);
  assert.equal((await send({ type: "GET_GUARD_STATE" }, 9, unrelatedPage)).active, false);

  const gateway = "https://tpi.li/AbCdEf123";
  const antiAdblockIntermediate = "https://intermediate.example/article";
  const continueIntermediate = "https://second-step.example/continue";
  const destination = "https://files.example/download?id=1";
  assert.equal((await send({
    type: "START_JOURNEY",
    targetUrl: gateway,
    manualConfirmation: true
  })).ok, true);
  listeners.committed({ tabId: 8, frameId: 0, url: antiAdblockIntermediate });

  const blockedByOverlay = await send({
    type: "PAGE_STATE",
    page: {
      url: antiAdblockIntermediate,
      gateScore: 8,
      hasGateAction: false,
      hasAntiAdblock: true,
      hardVerification: false,
      candidates: []
    }
  }, 8, antiAdblockIntermediate);
  assert.equal(blockedByOverlay.pendingConfirmation, null);
  assert.equal(blockedByOverlay.journeyActive, true);

  listeners.committed({ tabId: 8, frameId: 0, url: continueIntermediate });
  const blockedByContinue = await send({
    type: "PAGE_STATE",
    page: {
      url: continueIntermediate,
      gateScore: 18,
      hasGateAction: true,
      hasAntiAdblock: false,
      hardVerification: false,
      candidates: []
    }
  }, 8, continueIntermediate);
  assert.equal(blockedByContinue.pendingConfirmation, null);
  const prematureConfirmation = await send({ type: "CONFIRM_JOURNEY", destinationUrl: continueIntermediate }, 8, continueIntermediate);
  assert.equal(prematureConfirmation.ok, false);

  listeners.committed({ tabId: 8, frameId: 0, url: destination });

  const arrived = await send({
    type: "PAGE_STATE",
    page: { url: destination, gateScore: 0, hasCaptcha: false, candidates: [] }
  }, 8, destination);
  assert.equal(arrived.ok, true);
  assert.equal(arrived.pendingConfirmation.from, gateway);
  assert.equal(arrived.pendingConfirmation.to, destination);

  const confirmed = await send({ type: "CONFIRM_JOURNEY", destinationUrl: destination }, 8, destination);
  assert.equal(confirmed.ok, true);
  assert.equal(storage.learnedLinks.length, 1);

  const learned = await send({ type: "GET_DECISION", url: gateway });
  assert.equal(learned.decision.learned, true);
  assert.equal(learned.decision.auto, true);
  assert.equal(learned.decision.target, destination);

  const patternSources = [];
  for (let index = 2; index <= 3; index += 1) {
    const parameterGateway = `https://jump.example/go?url=${encodeURIComponent(`https://target.example/file/${index}`)}`;
    patternSources.push(parameterGateway);
    const parameterTarget = `https://target.example/file/${index}`;
    await send({ type: "START_JOURNEY", targetUrl: parameterGateway, manualConfirmation: true });
    listeners.committed({ tabId: 8, frameId: 0, url: parameterTarget });
    await send({ type: "PAGE_STATE", page: { url: parameterTarget, gateScore: 0 } }, 8, parameterTarget);
    const result = await send({ type: "CONFIRM_JOURNEY", destinationUrl: parameterTarget }, 8, parameterTarget);
    assert.equal(result.ok, true);
  }

  const patternDecision = await send({
    type: "GET_DECISION",
    url: `https://jump.example/go?url=${encodeURIComponent("https://target.example/file/new")}`
  });
  assert.equal(patternDecision.decision.learned, true);
  assert.equal(patternDecision.decision.auto, true);
  assert.equal(patternDecision.decision.target, "https://target.example/file/new");

  await send({ type: "REMOVE_RULE", source: patternSources[0] });
  const reducedPattern = await send({
    type: "GET_DECISION",
    url: `https://jump.example/go?url=${encodeURIComponent("https://target.example/file/another")}`
  });
  assert.equal(reducedPattern.decision.learned, false);
  assert.equal(reducedPattern.decision.auto, false);

  const container = "https://www.keeplinks.org/p16/container-token";
  const bundleTargets = ["https://host-a.example/file/1", "https://host-b.example/file/2"];
  const bundleLearned = await send({ type: "LEARN_BUNDLE", sourceUrl: container, targets: bundleTargets });
  assert.equal(bundleLearned.ok, true);
  assert.equal(storage.learnedBundles.length, 1);
  const bundleDecision = await send({ type: "GET_DECISION", url: container });
  assert.equal(bundleDecision.decision.auto, false);
  assert.deepEqual([...bundleDecision.decision.targets], bundleTargets);

  const openGroupAttempt = await send({ type: "OPEN_URLS", urls: bundleTargets, learnSource: container });
  assert.equal(openGroupAttempt.ok, false);
  assert.equal(tabCreates.length, 0);

  const filecryptContainer = "https://filecrypt.cc/Container/ABC123.html";
  const filecryptDestination = "https://files.example/final-package";
  await send({ type: "START_JOURNEY", targetUrl: filecryptContainer, manualConfirmation: true });
  listeners.committed({ tabId: 8, frameId: 0, url: filecryptDestination });
  await send({ type: "PAGE_STATE", page: { url: filecryptDestination, gateScore: 0 } }, 8, filecryptDestination);
  const containerConfirmed = await send({ type: "CONFIRM_JOURNEY", destinationUrl: filecryptDestination }, 8, filecryptDestination);
  assert.equal(containerConfirmed.ok, true);
  const filecryptDecision = await send({ type: "GET_DECISION", url: filecryptContainer });
  assert.deepEqual([...filecryptDecision.decision.targets], [filecryptDestination]);
  assert.equal(filecryptDecision.decision.auto, true);

  const dangerous = await send({
    type: "OPEN_URL",
    tabId: 8,
    url: "https://download.example/payload.exe"
  });
  assert.equal(dangerous.ok, false);
  assert.equal(tabUpdates.length, 0);

  storage.schemaVersion = 1;
  storage.learnedLinks.push({
    sourceKey: context.LinkGuideEngine.canonicalKey("https://www.keeplinks.org/p16/old-bad-rule"),
    source: "https://www.keeplinks.org/p16/old-bad-rule",
    target: "https://wrong.example/first-only"
  });
  await listeners.startup();
  assert.equal(storage.schemaVersion, 4);
  assert.equal(storage.settings.dismissAntiAdblockOverlays, true);
  assert.equal(storage.learnedLinks.some((item) => /old-bad-rule/.test(item.source)), false);
  assert.equal(storage.learnedBundles.length, 0);

  process.stdout.write("background tests passed\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
