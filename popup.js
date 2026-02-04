const defaultSettings = {
  wpm: 300,
  color: "#ff4444",
  opacity: 0.9,
  jumpStep: 10,
};

const wpmInput = document.getElementById("wpm");
const jumpInput = document.getElementById("jump");
const colorInput = document.getElementById("color");
const opacityInput = document.getElementById("opacity");
const opacityValue = document.getElementById("opacity-value");
const resetButton = document.getElementById("reset");
const toggleButton = document.getElementById("toggle-reader");
const openShortcutsButton = document.getElementById("open-shortcuts");

function renderSettings(settings) {
  wpmInput.value = settings.wpm;
  jumpInput.value = settings.jumpStep;
  colorInput.value = settings.color;
  opacityInput.value = settings.opacity;
  opacityValue.textContent = `${settings.opacity}`;
}

function persistSettings(patch) {
  chrome.storage.sync.set(patch, () => {
    sendSettingsToActiveTab(patch);
  });
}

function sendSettingsToActiveTab(settings) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        action: "update-settings",
        settings,
      });
    }
  });
}

function loadStoredSettings() {
  chrome.storage.sync.get(defaultSettings, (settings) => {
    renderSettings(settings);
  });
}

wpmInput.addEventListener("change", (event) => {
  persistSettings({ wpm: Number(event.target.value) || defaultSettings.wpm });
});

jumpInput.addEventListener("change", (event) => {
  persistSettings({ jumpStep: Number(event.target.value) || defaultSettings.jumpStep });
});

colorInput.addEventListener("input", (event) => {
  persistSettings({ color: event.target.value });
});

opacityInput.addEventListener("input", (event) => {
  const value = Number(event.target.value) || defaultSettings.opacity;
  opacityValue.textContent = `${value}`;
  persistSettings({ opacity: value });
});

resetButton.addEventListener("click", () => {
  chrome.storage.sync.set(defaultSettings, () => {
    renderSettings(defaultSettings);
    sendSettingsToActiveTab(defaultSettings);
  });
});

toggleButton.addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { action: "toggle" });
    }
  });
});

openShortcutsButton.addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

loadStoredSettings();
