/// <reference path="node_modules/@types/chrome/index.d.ts" />
/// <reference path="messages.d.ts" />

function waitForDocumentLoad() {
  return document.readyState === "loading"
    ? new Promise((r) => document.addEventListener("DOMContentLoaded", r))
    : Promise.resolve();
}

function setMode(mode: "enabled" | "disabled") {
  const content = document.getElementById("content")!;
  content.classList.remove("has-disabled", "has-enabled");
  content.classList.add("has-" + mode);
}

async function initPopup() {
  await waitForDocumentLoad();
  const enableButton = document.getElementById("enable-button")!,
    disableButton = document.getElementById("disable-button")!;

  enableButton.addEventListener("click", async () => {
    chrome.runtime.sendMessage(<MessageToBackground.EnableTracking>{
      action: "enable_tracking",
    });
  });

  disableButton.addEventListener("click", async () => {
    chrome.runtime.sendMessage(<MessageToBackground.DisableTracking>{
      action: "disable_tracking",
    });
  });

  chrome.runtime.onMessage.addListener(async (req: MessageToPopup.Any, _) => {
    if (req.action === "tracking_is_disabled") {
      setMode("disabled");
      [...document.getElementsByClassName("file-url")].forEach((e) => {
        e.setAttribute("href", "#");
      });
    } else if (req.action === "tracking_is_enabled") {
      setMode("enabled");
      [...document.getElementsByClassName("folder-url")].forEach((e) => {
        e.setAttribute("href", req.url);
      });
    }
  });

  await chrome.runtime.sendMessage(<MessageToBackground.PopupNeedsInit>{
    action: "popup_needs_init",
  });
}

initPopup().then(() => console.log("Popup main finished"));
