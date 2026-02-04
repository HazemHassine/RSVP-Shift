chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-reader") return;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    if (activeTab?.id) {
      chrome.tabs.sendMessage(activeTab.id, { action: "toggle" });
    }
  });
});