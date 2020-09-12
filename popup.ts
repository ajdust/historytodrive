/// <reference path="webextension.d.ts" />
/// <reference path="messages.d.ts" />

function sendToBackground(message: any): Promise<any> {
  return browser.runtime.sendMessage(message);
}

function listenToBackground<T extends (message: any, ...other: any[]) => void>(
  callback: T
) {
  browser.runtime.onMessage.addListener(callback);
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
  const tagsEl = document.getElementById("tags")!;
  tagsEl.textContent = null;

  for (let tag of tags) {
    const checkboxEl = <HTMLInputElement>document.createElement("input");
    checkboxEl.classList.add("tag-checkbox");
    checkboxEl.id = `tag_checkbox_${tag.text.replace(/[^(\w\d)]/g, "")}`;
    if (tag.enabled) checkboxEl.checked = true;
    checkboxEl.value = tag.text;
    checkboxEl.type = "checkbox";

    const labelEl = <HTMLLabelElement>document.createElement("label");
    labelEl.htmlFor = checkboxEl.id;
    labelEl.classList.add("tag-label");
    labelEl.appendChild(document.createTextNode(tag.text));

    const buttonEl = <HTMLButtonElement>document.createElement("button");
    buttonEl.classList.add("remove-tag-button");
    buttonEl.value = tag.text;
    buttonEl.type = "button";
    buttonEl.appendChild(document.createTextNode("Remove"));

    const tagEl = <HTMLDivElement>document.createElement("div");
    tagEl.classList.add("tag");
    tagEl.append(checkboxEl, labelEl, buttonEl);
    tagsEl.append(tagEl);

    checkboxEl.addEventListener("change", async function () {
      await checkTag({ enabled: this.checked, text: this.value });
    });

    buttonEl.addEventListener("click", async function () {
      buttonEl.setAttribute("disabled", "");
      await removeTag(this.value);
    });
  }

  (<any>window).tags = tags;
}

async function storeTags() {
  await sendToBackground(<MessageToBackground.SetTags>{
    action: "set_tags",
    tags: (<any>window).tags as Shared.Tag[],
  });
}

async function addTag(tag: Shared.Tag) {
  const tags = (<any>window).tags as Shared.Tag[];
  if (tags.some((t) => t.text === tag.text)) return;

  tags.push(tag);
  initTags(tags);
  await storeTags();
}

async function removeTag(tagText: string) {
  const tags = (<any>window).tags as Shared.Tag[];
  const newTags = [];
  for (let tag of tags) {
    if (tag.text !== tagText) newTags.push(tag);
  }

  initTags(newTags);
  await storeTags();
}

async function checkTag(checkTag: Shared.Tag) {
  const tags = (<any>window).tags as Shared.Tag[];
  for (let tag of tags) {
    if (tag.text === checkTag.text) {
      tag.enabled = checkTag.enabled;
    }
  }

  initTags(tags);
  await storeTags();
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
    ),
    addTagInput = <HTMLInputElement>document.getElementById("add-tag-input");

  enableButton.addEventListener("click", async () => {
    enableButton.setAttribute("disabled", "");
    await sendToBackground(<MessageToBackground.EnableTracking>{
      action: "enable_tracking",
    });
  });

  disableButton.addEventListener("click", async () => {
    disableButton.setAttribute("disabled", "");
    await sendToBackground(<MessageToBackground.DisableTracking>{
      action: "disable_tracking",
    });
  });

  addTagInput.addEventListener("keyup", async (e) => {
    if (e.key === "Enter") {
      addTagButton.click();
    }
  });

  addTagButton.addEventListener("click", async () => {
    if (!addTagInput.value.replace(/ /g, "")) {
      return;
    }

    addTagButton.setAttribute("disabled", "");
    await addTag({ enabled: true, text: addTagInput.value.trim() });
    addTagButton.removeAttribute("disabled");
    addTagInput.value = "";
  });

  listenToBackground(async (req: MessageToPopup.Any, _) => {
    enableButton.removeAttribute("disabled");
    disableButton.removeAttribute("disabled");
    addTagButton.removeAttribute("disabled");
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

  await sendToBackground(<MessageToBackground.PopupNeedsInit>{
    action: "popup_needs_init",
  });
}

initPopup().then(() => console.log("Popup main finished"));
