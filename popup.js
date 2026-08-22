const elements = {
  version: document.querySelector("#version"),
  enabled: document.querySelector("#enabled"),
  status: document.querySelector("#status"),
  statusTitle: document.querySelector("#statusTitle"),
  statusText: document.querySelector("#statusText"),
  currentHost: document.querySelector("#currentHost"),
  currentDetail: document.querySelector("#currentDetail"),
  candidate: document.querySelector("#candidate"),
  openTarget: document.querySelector("#openTarget"),
  watchJourney: document.querySelector("#watchJourney"),
  confirmJourney: document.querySelector("#confirmJourney"),
  showAssistant: document.querySelector("#showAssistant"),
  aggressiveFastPass: document.querySelector("#aggressiveFastPass"),
  autoSubmitSteps: document.querySelector("#autoSubmitSteps"),
  hideGateAds: document.querySelector("#hideGateAds"),
  dismissAntiAdblock: document.querySelector("#dismissAntiAdblock"),
  autoOpenLearned: document.querySelector("#autoOpenLearned"),
  autoOpenPatterns: document.querySelector("#autoOpenPatterns"),
  blockPopups: document.querySelector("#blockPopups"),
  ruleCount: document.querySelector("#ruleCount"),
  rules: document.querySelector("#rules"),
  clearRules: document.querySelector("#clearRules"),
  notice: document.querySelector("#notice")
};

let activeTab = null;
let state = null;

elements.version.textContent = `v${chrome.runtime.getManifest().version}`;

function showNotice(message, error = false) {
  elements.notice.textContent = message;
  elements.notice.classList.toggle("error", error);
  elements.notice.hidden = !message;
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "İşlem tamamlanamadı.");
  return response;
}

function hostOf(value) {
  try { return new URL(value).hostname; } catch { return "—"; }
}

function renderRules(links) {
  elements.rules.replaceChildren();
  elements.ruleCount.textContent = String(links.length);
  elements.clearRules.disabled = links.length === 0;
  if (!links.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Henüz doğrulanmış bir geçiş yok.";
    elements.rules.append(empty);
    return;
  }

  for (const link of links.slice(0, 8)) {
    const row = document.createElement("div");
    row.className = "rule";
    const description = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = link.bundle
      ? `${link.sourceHost} → ${link.targetCount} hedef`
      : `${link.sourceHost} → ${link.targetHost}`;
    const detail = document.createElement("small");
    detail.textContent = link.source;
    detail.title = link.source;
    description.append(title, detail);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Sil";
    remove.addEventListener("click", async () => {
      try {
        await send({ type: "REMOVE_RULE", source: link.source });
        await load();
      } catch (error) { showNotice(error.message, true); }
    });
    row.append(description, remove);
    elements.rules.append(row);
  }
}

function render(nextState) {
  state = nextState;
  const settings = nextState.settings;
  elements.enabled.checked = settings.enabled;
  elements.showAssistant.checked = settings.showAssistant;
  elements.aggressiveFastPass.checked = settings.aggressiveFastPass;
  elements.autoSubmitSteps.checked = settings.autoSubmitSteps;
  elements.hideGateAds.checked = settings.hideGateAds;
  elements.dismissAntiAdblock.checked = settings.dismissAntiAdblockOverlays;
  elements.autoOpenLearned.checked = settings.autoOpenLearned;
  elements.autoOpenPatterns.checked = settings.autoOpenLearnedPatterns;
  elements.blockPopups.checked = settings.blockPopupsOnGatePages;
  elements.currentHost.textContent = hostOf(nextState.currentUrl);

  const decision = nextState.decision;
  const pending = nextState.pendingConfirmation;
  const page = nextState.currentPage;
  const hasTarget = Boolean(decision?.target);
  elements.candidate.hidden = !hasTarget;
  elements.openTarget.hidden = !hasTarget;
  elements.confirmJourney.hidden = !pending;
  elements.watchJourney.disabled = !activeTab?.id || !nextState.currentUrl;

  if (hasTarget) {
    elements.candidate.textContent = decision.target;
    elements.candidate.title = decision.target;
  }

  elements.status.className = `status ${settings.enabled ? "is-on" : ""}`;
  elements.statusTitle.textContent = settings.enabled ? "Yerel öğrenme etkin" : "Eklenti kapalı";
  elements.statusText.textContent = settings.enabled
    ? `${nextState.learnedLinks.length} tam bağlantı, ${(nextState.learnedBundles || []).length} container paketi ve ${nextState.profiles.filter((item) => item.confirmations >= 2).length} doğrulanmış kalıp hazır.`
    : "Bağlantılar normal biçimde açılır; izleme ve öğrenme yapılmaz.";

  if (pending) {
    elements.status.className = "status is-warning";
    elements.currentDetail.textContent = "Bir yönlendirme zincirinin dış hedefine ulaşıldı. Doğruysa öğrenebilirsiniz.";
  } else if (hasTarget) {
    elements.currentDetail.textContent = decision.reason;
  } else if (page?.hasCaptcha) {
    elements.currentDetail.textContent = "Doğrulama algılandı. CAPTCHA/parola tamamlandıktan sonra hedef öğrenilebilir.";
  } else if ((page?.gateScore || 0) >= 45) {
    elements.currentDetail.textContent = `Geçiş sayfası olasılığı: %${page.gateScore}. Yönlendirme izleniyor.`;
  } else {
    elements.currentDetail.textContent = "Bu sekmede açık veya öğrenilmiş bir hedef bulunmadı.";
  }

  const bundleRows = (nextState.learnedBundles || []).map((bundle) => ({
    ...bundle,
    bundle: true,
    targetCount: bundle.targets?.length || 0
  }));
  renderRules([...bundleRows, ...nextState.learnedLinks]);
}

async function load() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab || null;
  const response = await send({
    type: "GET_POPUP_STATE",
    tabId: tab?.id,
    currentUrl: tab?.url
  });
  render(response.state);
}

async function updateSettings(patch) {
  try {
    await send({ type: "UPDATE_SETTINGS", patch });
    await load();
  } catch (error) { showNotice(error.message, true); }
}

elements.enabled.addEventListener("change", () => updateSettings({ enabled: elements.enabled.checked }));
elements.showAssistant.addEventListener("change", () => updateSettings({ showAssistant: elements.showAssistant.checked }));
elements.aggressiveFastPass.addEventListener("change", () => updateSettings({ aggressiveFastPass: elements.aggressiveFastPass.checked }));
elements.autoSubmitSteps.addEventListener("change", () => updateSettings({ autoSubmitSteps: elements.autoSubmitSteps.checked }));
elements.hideGateAds.addEventListener("change", () => updateSettings({ hideGateAds: elements.hideGateAds.checked }));
elements.dismissAntiAdblock.addEventListener("change", () => updateSettings({ dismissAntiAdblockOverlays: elements.dismissAntiAdblock.checked }));
elements.autoOpenLearned.addEventListener("change", () => updateSettings({ autoOpenLearned: elements.autoOpenLearned.checked }));
elements.autoOpenPatterns.addEventListener("change", () => updateSettings({ autoOpenLearnedPatterns: elements.autoOpenPatterns.checked }));
elements.blockPopups.addEventListener("change", () => updateSettings({ blockPopupsOnGatePages: elements.blockPopups.checked }));

elements.openTarget.addEventListener("click", async () => {
  try {
    await send({ type: "OPEN_URL", tabId: activeTab.id, url: state.decision.target });
    window.close();
  } catch (error) { showNotice(error.message, true); }
});

elements.watchJourney.addEventListener("click", async () => {
  try {
    await send({ type: "START_JOURNEY", tabId: activeTab.id, targetUrl: state.currentUrl });
    showNotice("Bu sekmedeki yönlendirme zinciri izleniyor. Hedefe ulaşınca doğrulama sorulacak.");
  } catch (error) { showNotice(error.message, true); }
});

elements.confirmJourney.addEventListener("click", async () => {
  try {
    await send({ type: "CONFIRM_JOURNEY", tabId: activeTab.id, destinationUrl: state.currentUrl });
    showNotice("Geçiş yerel olarak öğrenildi.");
    await load();
  } catch (error) { showNotice(error.message, true); }
});

elements.clearRules.addEventListener("click", async () => {
  if (!confirm("Tüm öğrenilmiş bağlantı ve kalıplar silinsin mi?")) return;
  try {
    await send({ type: "CLEAR_RULES" });
    showNotice("Yerel öğrenme hafızası temizlendi.");
    await load();
  } catch (error) { showNotice(error.message, true); }
});

load().catch((error) => showNotice(error.message, true));
