/// <reference path="node_modules/@types/chrome/index.d.ts" />
// Run on each page load - send message to background
chrome.runtime.sendMessage({
  action: "track",
  data: {
    url: window.location.href,
    host: window.location.host,
    title: document.title,
  },
});
