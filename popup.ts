/// <reference path="webextension.d.ts" />
/// <reference path="messages.d.ts" />
const TRASH_ICON =
  "data:image/gif;base64,R0lGODlhEAAQAPMAANXV1e3t7d/f39HR0dvb2/Hx8dTU1OLi4urq6mZmZpmZmf///wAAAAAAAAAAAAAAACH5BAEAAAwALAAAAAAQABAAAARBkMlJq71Yrp3ZXkr4WWCYnOZSgQVyEMYwJCq1nHhe20qgCAoA7QLyAYU7njE4JPV+zOSkCEUSFbmTVPPpbjvgTAQAOw==";

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
    buttonEl.classList.add("remove-button");
    buttonEl.value = tag.text;
    buttonEl.type = "button";

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

  setLocalTags(tags);
}

function initRedactionRules(redactionRules: Shared.RedactionRule[]) {
  const redactionRulesEl = document.getElementById("redaction-rules")!;
  redactionRulesEl.textContent = null;

  for (let i = 0; i < redactionRules.length; i++) {
    const rule = redactionRules[i];
    const checkboxEl = <HTMLInputElement>document.createElement("input");
    checkboxEl.classList.add("redaction-rule-checkbox");
    checkboxEl.id = `redaction-rule_checkbox_${i}`;
    if (rule.enabled) checkboxEl.checked = true;
    checkboxEl.value = rule.description;
    checkboxEl.type = "checkbox";

    const labelEl = <HTMLLabelElement>document.createElement("label");
    labelEl.htmlFor = checkboxEl.id;
    labelEl.classList.add("redaction-rule-label");
    labelEl.title = `"${rule.replace}" -> "${rule.with}"`;
    labelEl.appendChild(document.createTextNode(rule.description));

    const buttonEl = <HTMLButtonElement>document.createElement("button");
    buttonEl.classList.add("remove-button");
    buttonEl.value = i.toString();
    buttonEl.type = "button";

    const el = <HTMLDivElement>document.createElement("div");
    el.classList.add("redaction-rule");
    el.append(checkboxEl, labelEl, buttonEl);
    redactionRulesEl.append(el);

    checkboxEl.addEventListener("change", async function () {
      await checkRedactionRule({
        enabled: this.checked,
        description: this.value,
      });
    });

    buttonEl.addEventListener("click", async function () {
      buttonEl.setAttribute("disabled", "");
      await removeRedactionRule(parseInt(this.value));
    });
  }

  setLocalRedactionRules(redactionRules);
}

function getLocalTags(): Shared.Tag[] {
  return (<any>window).tags as Shared.Tag[];
}

function setLocalTags(tags: Shared.Tag[]) {
  (<any>window).tags = tags;
}

async function storeTags() {
  await sendToBackground(<MessageToBackground.SetTags>{
    action: "set_tags",
    tags: getLocalTags(),
  });
}

async function addTag(tag: Shared.Tag) {
  const tags = getLocalTags();
  if (tags.some((t) => t.text === tag.text)) return;

  tags.push(tag);
  initTags(tags);
  await storeTags();
}

async function removeTag(tagText: string) {
  const tags = getLocalTags();
  const newTags = [];
  for (let tag of tags) {
    if (tag.text !== tagText) newTags.push(tag);
  }

  initTags(newTags);
  await storeTags();
}

async function checkTag(checkTag: Shared.Tag) {
  const tags = getLocalTags();
  for (let tag of tags) {
    if (tag.text === checkTag.text) {
      tag.enabled = checkTag.enabled;
    }
  }

  initTags(tags);
  await storeTags();
}

function getLocalRedactionRules(): Shared.RedactionRule[] {
  return (<any>window).redactionRules as Shared.RedactionRule[];
}

function setLocalRedactionRules(rules: Shared.RedactionRule[]) {
  (<any>window).redactionRules = rules;
}

async function storeRedactionRule() {
  await sendToBackground(<MessageToBackground.SetRedactionRules>{
    action: "set_redaction_rules",
    redaction_rules: getLocalRedactionRules(),
  });
}

async function addRedactionRule(rule: Shared.RedactionRule) {
  const rules = getLocalRedactionRules();
  if (
    rules.some((t) => t.description === rule.description) ||
    rules.some((t) => t.replace === rule.replace && t.with == rule.with)
  ) {
    return;
  }

  rules.push(rule);
  initRedactionRules(rules);
  await storeRedactionRule();
}

async function removeRedactionRule(ruleIndex: number) {
  const rules = getLocalRedactionRules();
  const newRules = [];
  for (let i = 0; i < rules.length; i++) {
    if (i != ruleIndex) newRules.push(rules[i]);
  }

  initRedactionRules(newRules);
  await storeRedactionRule();
}

async function checkRedactionRule(checkRedactionRule: {
  enabled: boolean;
  description: string;
}) {
  const rules = getLocalRedactionRules();
  for (let rule of rules) {
    if (rule.description === checkRedactionRule.description) {
      rule.enabled = checkRedactionRule.enabled;
    }
  }

  initRedactionRules(rules);
  await storeRedactionRule();
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
    addTagInput = <HTMLInputElement>document.getElementById("add-tag-input"),
    addRedactionRuleButton = <HTMLButtonElement>(
      document.getElementById("add-redaction-rule-button")!
    ),
    addRedactionRuleInputDescription = <HTMLInputElement>(
      document.getElementById("add-redaction-rule-input-description")
    ),
    addRedactionRuleInputReplace = <HTMLInputElement>(
      document.getElementById("add-redaction-rule-input-replace")
    ),
    addRedactionRuleInputWith = <HTMLInputElement>(
      document.getElementById("add-redaction-rule-input-with")
    ),
    toggleMoreLink = <HTMLLinkElement>(
      document.getElementById("toggle-more-link")
    ),
    moreArea = <HTMLDivElement>document.getElementById("more-area");

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

  toggleMoreLink.addEventListener("click", () => {
    moreArea.style.display = moreArea.style.display === "none" ? "" : "none";
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

  addRedactionRuleInputWith.addEventListener("keyup", async (e) => {
    if (e.key == "Enter") {
      addRedactionRuleButton.click();
    }
  });

  addRedactionRuleButton.addEventListener("click", async () => {
    if (
      !addRedactionRuleInputDescription.value.replace(/ /g, "") ||
      !addRedactionRuleInputReplace.value.replace(/ /g, "")
    ) {
      return;
    }

    let reg = new RegExp(addRedactionRuleInputReplace.value);
    addRedactionRuleButton.setAttribute("disabled", "");
    await addRedactionRule({
      enabled: true,
      description: addRedactionRuleInputDescription.value.trim(),
      replace: reg.source,
      with: addRedactionRuleInputWith.value.trim(),
    });
    addRedactionRuleButton.removeAttribute("disabled");
    addRedactionRuleInputDescription.value = "";
    addRedactionRuleInputReplace.value = "";
    addRedactionRuleInputWith.value = "";
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
      initRedactionRules(req.redaction_rules);
    }
  });

  await sendToBackground(<MessageToBackground.PopupNeedsInit>{
    action: "popup_needs_init",
  });
}

initPopup().then(() => console.log("Popup main finished"));
