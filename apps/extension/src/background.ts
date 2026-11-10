// Clicking the toolbar icon opens the Job Apply side panel.
const openOnClick = () => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
chrome.runtime.onInstalled.addListener(openOnClick);
chrome.runtime.onStartup.addListener(openOnClick);
