// Avoid leaving saved UI fields behind after a tab is closed.
chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.session.remove(`tab-${tabId}`).catch(() => {});
});
