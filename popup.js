const { DEFAULT_SETTINGS, normalizeSettings } = globalThis.FastReaderSettings;

const elements = {
  wpm: document.getElementById("wpm"),
  fontSize: document.getElementById("font-size"),
  fontSizeValue: document.getElementById("font-size-value"),
  jumpStep: document.getElementById("jump"),
  color: document.getElementById("color"),
  opacity: document.getElementById("opacity"),
  opacityValue: document.getElementById("opacity-value"),
  smartTiming: document.getElementById("smart-timing"),
  punctuationPauses: document.getElementById("punctuation-pauses"),
  contextPreview: document.getElementById("context-preview"),
  focusStyle: document.getElementById("focus-style"),
  fixationGuides: document.getElementById("fixation-guides"),
  backgroundMode: document.getElementById("background-mode"),
  startDelay: document.getElementById("start-delay"),
  autoHideControls: document.getElementById("auto-hide-controls"),
  calibration: document.getElementById("calibration"),
  skipCalibration: document.getElementById("skip-calibration"),
  reset: document.getElementById("reset"),
  toggle: document.getElementById("toggle-reader"),
  openShortcuts: document.getElementById("open-shortcuts"),
  toggleShortcut: document.getElementById("toggle-shortcut"),
  actionStatus: document.getElementById("action-status"),
  saveStatus: document.getElementById("save-status"),
};

let currentSettings = { ...DEFAULT_SETTINGS };
let activeTabId = null;
let saveStatusTimerId = null;

function renderSettings(settings) {
  currentSettings = normalizeSettings(settings);
  elements.wpm.value = String(currentSettings.wpm);
  elements.fontSize.value = String(currentSettings.fontSize);
  elements.fontSizeValue.textContent = `${currentSettings.fontSize}px`;
  elements.jumpStep.value = String(currentSettings.jumpStep);
  elements.color.value = currentSettings.color;
  elements.opacity.value = String(currentSettings.opacity);
  elements.opacityValue.textContent = `${Math.round(currentSettings.opacity * 100)}%`;
  elements.smartTiming.checked = currentSettings.smartTiming;
  elements.punctuationPauses.value = currentSettings.punctuationPauses;
  elements.contextPreview.value = currentSettings.contextPreview;
  elements.focusStyle.value = currentSettings.focusStyle;
  elements.fixationGuides.value = currentSettings.fixationGuides;
  elements.backgroundMode.value = currentSettings.backgroundMode;
  elements.startDelay.value = String(currentSettings.startDelay);
  elements.autoHideControls.checked = currentSettings.autoHideControls;
  elements.calibration.hidden = currentSettings.calibrationSeen;
}

function setActionStatus(message = "", tone = "neutral") {
  elements.actionStatus.textContent = message;
  elements.actionStatus.dataset.tone = tone;
}

function showSaveStatus(message, tone = "success") {
  clearTimeout(saveStatusTimerId);
  elements.saveStatus.textContent = message;
  elements.saveStatus.dataset.tone = tone;
  elements.saveStatus.classList.add("visible");
  saveStatusTimerId = setTimeout(() => elements.saveStatus.classList.remove("visible"), 1500);
}

function setReaderActive(isActive) {
  elements.toggle.dataset.active = String(isActive);
  elements.toggle.textContent = isActive ? "Stop reader" : "Read selected text";
}

function previewSettings(patch) {
  if (!activeTabId) return;
  chrome.tabs.sendMessage(activeTabId, { action: "update-settings", settings: patch }, () => {
    void chrome.runtime.lastError;
  });
}

function persistSettings(patch, successMessage = "Saved") {
  const normalized = normalizeSettings({ ...currentSettings, ...patch });
  const normalizedPatch = Object.fromEntries(
    Object.keys(patch).map((key) => [key, normalized[key]]),
  );
  renderSettings(normalized);
  previewSettings(normalizedPatch);

  chrome.storage.sync.set(normalizedPatch, () => {
    if (chrome.runtime.lastError) {
      showSaveStatus("Could not save", "error");
      return;
    }
    showSaveStatus(successMessage);
  });
}

function loadStoredSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    if (chrome.runtime.lastError) {
      renderSettings(DEFAULT_SETTINGS);
      showSaveStatus("Using defaults", "error");
      return;
    }
    renderSettings(settings);
  });
}

function isRestrictedPage(url = "") {
  return /^(chrome|edge|about|devtools|view-source):/i.test(url)
    || /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i.test(url);
}

function handleConnectionError(url = "") {
  elements.toggle.disabled = true;
  if (isRestrictedPage(url)) {
    setActionStatus("Chrome does not allow extensions on this page.", "error");
  } else {
    setActionStatus("Reload this page once, then try again.", "error");
  }
}

function inspectActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    activeTabId = tab?.id ?? null;

    if (!activeTabId || isRestrictedPage(tab?.url)) {
      handleConnectionError(tab?.url);
      return;
    }

    chrome.tabs.sendMessage(activeTabId, { action: "get-state" }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        handleConnectionError(tab.url);
        return;
      }
      elements.toggle.disabled = false;
      setReaderActive(Boolean(response.active));
    });
  });
}

function loadShortcut() {
  chrome.commands.getAll((commands) => {
    if (chrome.runtime.lastError) return;
    const command = commands.find((item) => item.name === "toggle-reader");
    elements.toggleShortcut.textContent = command?.shortcut || "Not set";
  });
}

function previewRangeSetting(key, value) {
  currentSettings = normalizeSettings({ ...currentSettings, [key]: value });
  renderSettings(currentSettings);
  previewSettings({ [key]: currentSettings[key] });
}

elements.wpm.addEventListener("change", (event) => persistSettings({ wpm: event.target.value }));
elements.jumpStep.addEventListener("change", (event) => persistSettings({ jumpStep: event.target.value }));

elements.fontSize.addEventListener("input", (event) => previewRangeSetting("fontSize", event.target.value));
elements.fontSize.addEventListener("change", () => persistSettings({ fontSize: currentSettings.fontSize }));

elements.color.addEventListener("input", (event) => previewRangeSetting("color", event.target.value));
elements.color.addEventListener("change", () => persistSettings({ color: currentSettings.color }));

elements.opacity.addEventListener("input", (event) => previewRangeSetting("opacity", event.target.value));
elements.opacity.addEventListener("change", () => persistSettings({ opacity: currentSettings.opacity }));

for (const [key, element] of [
  ["punctuationPauses", elements.punctuationPauses],
  ["contextPreview", elements.contextPreview],
  ["focusStyle", elements.focusStyle],
  ["fixationGuides", elements.fixationGuides],
  ["backgroundMode", elements.backgroundMode],
  ["startDelay", elements.startDelay],
]) {
  element.addEventListener("change", (event) => persistSettings({ [key]: event.target.value }));
}

for (const [key, element] of [
  ["smartTiming", elements.smartTiming],
  ["autoHideControls", elements.autoHideControls],
]) {
  element.addEventListener("change", (event) => persistSettings({ [key]: event.target.checked }));
}

elements.reset.addEventListener("click", () => {
  const resetSettings = { ...DEFAULT_SETTINGS, calibrationSeen: currentSettings.calibrationSeen };
  renderSettings(resetSettings);
  previewSettings(resetSettings);
  chrome.storage.sync.set(resetSettings, () => {
    if (chrome.runtime.lastError) {
      showSaveStatus("Could not reset", "error");
      return;
    }
    showSaveStatus("Defaults restored");
  });
});

document.querySelectorAll("[data-calibration-wpm]").forEach((button) => {
  button.addEventListener("click", () => {
    persistSettings({ wpm: button.dataset.calibrationWpm, calibrationSeen: true }, "Starting speed set");
  });
});

elements.skipCalibration.addEventListener("click", () => {
  persistSettings({ calibrationSeen: true }, "Skipped");
});

elements.toggle.addEventListener("click", () => {
  if (!activeTabId) return;
  elements.toggle.disabled = true;
  setActionStatus();

  chrome.tabs.sendMessage(activeTabId, { action: "toggle" }, (response) => {
    elements.toggle.disabled = false;
    if (chrome.runtime.lastError || !response) {
      setActionStatus("Reload this page once, then try again.", "error");
      return;
    }
    if (!response.ok) {
      setActionStatus(response.error || "Could not start the reader.", "error");
      return;
    }

    setReaderActive(Boolean(response.active));
    if (response.active) window.close();
    else setActionStatus("Reader closed.");
  });
});

elements.openShortcuts.addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

loadStoredSettings();
loadShortcut();
inspectActiveTab();
