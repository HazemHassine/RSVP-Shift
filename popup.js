const { DEFAULT_SETTINGS, normalizeSettings } = globalThis.FastReaderSettings;

const wpmInput = document.getElementById("wpm");
const jumpInput = document.getElementById("jump");
const colorInput = document.getElementById("color");
const opacityInput = document.getElementById("opacity");
const opacityValue = document.getElementById("opacity-value");
const resetButton = document.getElementById("reset");
const toggleButton = document.getElementById("toggle-reader");
const openShortcutsButton = document.getElementById("open-shortcuts");
const toggleShortcut = document.getElementById("toggle-shortcut");
const actionStatus = document.getElementById("action-status");
const saveStatus = document.getElementById("save-status");

let currentSettings = { ...DEFAULT_SETTINGS };
let activeTabId = null;
let saveStatusTimerId = null;

function renderSettings(settings) {
  currentSettings = normalizeSettings(settings);
  wpmInput.value = String(currentSettings.wpm);
  jumpInput.value = String(currentSettings.jumpStep);
  colorInput.value = currentSettings.color;
  opacityInput.value = String(currentSettings.opacity);
  opacityValue.textContent = `${Math.round(currentSettings.opacity * 100)}%`;
}

function setActionStatus(message = "", tone = "neutral") {
  actionStatus.textContent = message;
  actionStatus.dataset.tone = tone;
}

function showSaveStatus(message, tone = "success") {
  clearTimeout(saveStatusTimerId);
  saveStatus.textContent = message;
  saveStatus.dataset.tone = tone;
  saveStatus.classList.add("visible");
  saveStatusTimerId = setTimeout(() => saveStatus.classList.remove("visible"), 1800);
}

function setReaderActive(isActive) {
  toggleButton.dataset.active = String(isActive);
  toggleButton.textContent = isActive ? "Stop reader" : "Read selected text";
}

function persistSettings(patch, successMessage = "Saved") {
  const normalized = normalizeSettings({ ...currentSettings, ...patch });
  const normalizedPatch = Object.fromEntries(
    Object.keys(patch).map((key) => [key, normalized[key]]),
  );
  renderSettings(normalized);

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
  toggleButton.disabled = true;
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

    if (!activeTabId) {
      handleConnectionError(tab?.url);
      return;
    }

    if (isRestrictedPage(tab.url)) {
      handleConnectionError(tab.url);
      return;
    }

    chrome.tabs.sendMessage(activeTabId, { action: "get-state" }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        handleConnectionError(tab.url);
        return;
      }
      toggleButton.disabled = false;
      setReaderActive(Boolean(response.active));
    });
  });
}

function loadShortcut() {
  chrome.commands.getAll((commands) => {
    if (chrome.runtime.lastError) return;
    const command = commands.find((item) => item.name === "toggle-reader");
    toggleShortcut.textContent = command?.shortcut || "Not set";
  });
}

wpmInput.addEventListener("change", (event) => {
  persistSettings({ wpm: event.target.value });
});

jumpInput.addEventListener("change", (event) => {
  persistSettings({ jumpStep: event.target.value });
});

colorInput.addEventListener("input", (event) => {
  currentSettings = normalizeSettings({ ...currentSettings, color: event.target.value });
});

colorInput.addEventListener("change", () => {
  persistSettings({ color: currentSettings.color });
});

opacityInput.addEventListener("input", (event) => {
  currentSettings = normalizeSettings({ ...currentSettings, opacity: event.target.value });
  opacityValue.textContent = `${Math.round(currentSettings.opacity * 100)}%`;
});

opacityInput.addEventListener("change", () => {
  persistSettings({ opacity: currentSettings.opacity });
});

resetButton.addEventListener("click", () => {
  renderSettings(DEFAULT_SETTINGS);
  chrome.storage.sync.set(DEFAULT_SETTINGS, () => {
    if (chrome.runtime.lastError) {
      showSaveStatus("Could not reset", "error");
      return;
    }
    showSaveStatus("Defaults restored");
  });
});

toggleButton.addEventListener("click", () => {
  if (!activeTabId) return;
  toggleButton.disabled = true;
  setActionStatus();

  chrome.tabs.sendMessage(activeTabId, { action: "toggle" }, (response) => {
    toggleButton.disabled = false;
    if (chrome.runtime.lastError || !response) {
      setActionStatus("Reload this page once, then try again.", "error");
      return;
    }
    if (!response.ok) {
      setActionStatus(response.error || "Could not start the reader.", "error");
      return;
    }

    setReaderActive(Boolean(response.active));
    if (response.active) {
      window.close();
    } else {
      setActionStatus("Reader closed.");
    }
  });
});

openShortcutsButton.addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

loadStoredSettings();
loadShortcut();
inspectActiveTab();
