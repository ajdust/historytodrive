/// <reference path="node_modules/@types/chrome/index.d.ts" />
/// <reference path="messages.d.ts" />

function sendToBackground(message: any) {
  chrome.runtime.sendMessage(message);
}

function listenToBackground<T extends (message: any, ...other: any[]) => void>(
  callback: T
) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    callback(message, sender, sendResponse);
  });
}

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

function initTags(tags: Shared.Tag[]) {
  const template = document.getElementById("tag-template")!.innerHTML;
  const tagsEl = document.getElementById("tags")!;
  let tagsElBuilder = "";
  for (let tag of tags) {
    let html = template.replace(/_TAG_TEXT_/g, tag.text);
    if (!tag.enabled) {
      html = html.replace(/checked/g, "");
    }
    tagsElBuilder += html;
  }

  tagsEl.innerHTML = tagsElBuilder;
  for (let cb of document.getElementsByClassName("tag-checkbox")!) {
    (<HTMLInputElement>cb).addEventListener("change", function () {
      checkTag({ enabled: this.checked, text: this.value });
    });
  }

  for (let rb of document.getElementsByClassName("remove-tag-button")!) {
    (<HTMLButtonElement>rb).addEventListener("click", function () {
      removeTag(this.value);
    });
  }

  (<any>window).tags = tags;
}

function storeTags() {
  sendToBackground(<MessageToBackground.SetTags>{
    action: "set_tags",
    tags: (<any>window).tags as Shared.Tag[],
  });
}

function addTag(tag: Shared.Tag) {
  const tags = (<any>window).tags as Shared.Tag[];
  tags.push(tag);
  initTags(tags);
  storeTags();
}

function removeTag(tagText: string) {
  const tags = (<any>window).tags as Shared.Tag[];
  const newTags = [];
  for (let tag of tags) {
    if (tag.text !== tagText) newTags.push(tag);
  }

  initTags(newTags);
  storeTags();
}

function checkTag(checkTag: Shared.Tag) {
  const tags = (<any>window).tags as Shared.Tag[];
  for (let tag of tags) {
    if (tag.text === checkTag.text) {
      tag.enabled = checkTag.enabled;
    }
  }

  initTags(tags);
  storeTags();
}

async function initPopup() {
  await waitForDocumentLoad();
  const enableButton = <HTMLButtonElement>(
      document.getElementById("enable-button")!
    ),
    disableButton = <HTMLButtonElement>(
      document.getElementById("disable-button")!
    ),
    addTagButton = <HTMLButtonElement>(
      document.getElementById("add-tag-button")!
    );

  enableButton.addEventListener("click", async () => {
    sendToBackground(<MessageToBackground.EnableTracking>{
      action: "enable_tracking",
    });
  });

  disableButton.addEventListener("click", async () => {
    sendToBackground(<MessageToBackground.DisableTracking>{
      action: "disable_tracking",
    });
  });

  addTagButton.addEventListener("click", async () => {
    const addTagInput = <HTMLInputElement>(
      document.getElementById("add-tag-input")!
    );
    if (!addTagInput.value.replace(/ /g, "")) {
      return;
    }

    addTag({ enabled: true, text: addTagInput.value });
  });

  listenToBackground(async (req: MessageToPopup.Any, _) => {
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
      initTags(req.tags);
    }
  });

  sendToBackground(<MessageToBackground.PopupNeedsInit>{
    action: "popup_needs_init",
  });
}

initPopup().then(() => console.log("Popup main finished"));
