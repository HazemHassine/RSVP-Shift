function showUnavailableBadge(tabId) {
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#d94b59" });
  chrome.action.setBadgeText({ tabId, text: "!" });
  chrome.action.setTitle({ tabId, title: "Fast Reader is unavailable on this page" });

  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: "" });
    chrome.action.setTitle({ tabId, title: "Fast Reader" });
  }, 2500);
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-reader") return;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    if (!activeTab?.id) return;

    chrome.tabs.sendMessage(activeTab.id, { action: "toggle" }, () => {
      if (chrome.runtime.lastError) showUnavailableBadge(activeTab.id);
    });
  });
});
