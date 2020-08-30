/// <reference path="node_modules/Dropbox/dist/Dropbox-sdk.min.d.ts" />
/// <reference path="node_modules/@types/chrome/index.d.ts" />
/// <reference path="node_modules/dexie/dist/dexie.d.ts" />
/// <reference path="messages.d.ts" />

/* Browser extension wrappers */

function authenticate(details: {
  url: string;
  interactive: boolean;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(details, function (redirectedTo) {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError.message);
      } else {
        resolve(redirectedTo);
      }
    });
  });
}

function getRedirectURL(): string {
  return chrome.identity.getRedirectURL("dropbox");
}

function getClientId(): string {
  return chrome.runtime.getManifest().oauth2!.client_id;
}

function send(message: any) {
  chrome.runtime.sendMessage(message);
}

function listen<T extends (message: any, ...other: any[]) => void>(
  callback: T
) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    callback(message, sender, sendResponse);
  });
}

/* Key value database */

class KeyValueDb extends Dexie.Dexie {
  private keyValue: Dexie.Table<any, Dexie.IndexableType>;

  constructor() {
    super("keyValue");
    this.version(1).stores({ keyValue: "key,value" });
    this.keyValue = this.table("keyValue");
  }

  async get(key: string): Promise<any> {
    const kv = await this.keyValue.get(key);
    return kv ? kv.value : null;
  }

  put(key: string, value: Object) {
    return this.keyValue.put({ key: key, value: value });
  }
}

/* Utilities */

function randomString(length: number) {
  let text = "";
  for (let i = 0; i < length; ++i) {
    const index = Math.floor(Math.random() * 62);
    if (index < 10) text += String.fromCharCode(index + 48);
    else if (index < 36) text += String.fromCharCode(index + 55);
    else text += String.fromCharCode(index + 61);
  }

  return text;
}

function arrayToBase64(array: Uint8Array): string {
  return btoa(String.fromCharCode(...array));
}

function bufferToBase64(array: ArrayBuffer): string {
  return arrayToBase64(new Uint8Array(array));
}

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer: ArrayBuffer = await crypto.subtle.digest(
    "SHA-256",
    msgBuffer
  );

  return bufferToBase64(hashBuffer)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function getUrlParameters(url: string): Map<string, string> {
  const params = new Map<string, string>();
  const parser = document.createElement("a");
  parser.href = url;
  const query = parser.search.substring(1);
  const vars = query.split("&");

  for (let i = 0; i < vars.length; ++i) {
    const [key, value] = vars[i].split("=");
    params.set(key, decodeURIComponent(value));
  }

  return params;
}

async function getPKCEAccessToken(
  oauth2TokenUrl: string,
  codeFromQueryParameter: string,
  permittedRedirectUri: string,
  codeVerifier: string,
  clientId: string
): Promise<{
  uid: string;
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  account_id: string;
}> {
  const response = await fetch(oauth2TokenUrl, {
    body:
      `code=${encodeURIComponent(codeFromQueryParameter)}` +
      `&grant_type=authorization_code` +
      `&redirect_uri=${encodeURIComponent(permittedRedirectUri)}` +
      `&code_verifier=${encodeURIComponent(codeVerifier)}` +
      `&client_id=${encodeURIComponent(clientId)}`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });

  if (response.status === 200) return await response.json();

  throw (
    `Error: ${response.status} from ${oauth2TokenUrl}: ` +
    (await response.text())
  );
}

/* Message handling */

class MessageHandler {
  private clientId: string;
  private kvDb: KeyValueDb;
  private dbx: DropboxTypes.Dropbox;

  constructor() {
    this.clientId = getClientId();
    this.kvDb = new KeyValueDb();
    this.dbx = new Dropbox.Dropbox({
      clientId: this.clientId,
      fetch: window.fetch,
    });
  }

  async enableTracking(): Promise<void> {
    const [authState, codeVerifier] = [randomString(50), randomString(50)];
    const redirectUrl = getRedirectURL();
    const authUrl =
      this.dbx.getAuthenticationUrl(redirectUrl, authState, "code") +
      "&code_challenge_method=S256" +
      `&code_challenge=${await sha256(codeVerifier)}`;

    const redirectedUrl = await authenticate({
      url: authUrl,
      interactive: true,
    });

    const params = getUrlParameters(redirectedUrl);
    if (params.get("state") !== authState)
      throw "Redirected URI does not contain expected 'state=' in query parameters";
    if (!params.has("code"))
      throw "Redirected URI does not contain expected 'code=' in query parameters";

    // See https://www.dropbox.com/developers/documentation/http/documentation#oauth2-token
    const tokenResponse = await getPKCEAccessToken(
      "https://api.dropbox.com/oauth2/token",
      params.get("code")!,
      redirectUrl,
      codeVerifier,
      this.clientId
    );

    await this.kvDb.put("auth", tokenResponse);
    this.dbx.setAccessToken(tokenResponse.access_token);
    const echo = await this.dbx.checkUser({ query: "check" });
    if (echo.result !== "check") throw `Expected check but got ${echo.result}`;

    send(<MessageToPopup.EnabledTracking>{
      action: "tracking_is_enabled",
    });
  }

  async disableTracking() {
    await this.kvDb.put("auth", {});
    this.dbx = new DropboxTypes.Dropbox({
      clientId: this.clientId,
      fetch: window.fetch,
    });
    send(<MessageToPopup.DisabledTracking>{
      action: "tracking_is_disabled",
    });
  }

  async isTracking(): Promise<boolean> {
    const auth = await this.kvDb.get("auth");
    return auth?.access_token ? true : false;
  }

  async notifyTrackingStatus() {
    if (await this.isTracking()) {
      send(<MessageToPopup.EnabledTracking>{
        action: "tracking_is_enabled",
      });
    } else {
      send(<MessageToPopup.DisabledTracking>{
        action: "tracking_is_disabled",
      });
    }
  }

  async track(data: MessageToBackground.TrackData) {
    console.log(data);
    if (!(await this.isTracking())) return;
  }

  async log(message: string) {
    console.warn(message);
  }
}

const mh = new MessageHandler();

listen(async (req: MessageToBackground.Any) => {
  if (req.action === "track") {
    await mh.track(req.data);
  } else if (req.action === "log") {
    await mh.log(req.data);
  } else if (req.action === "popup_needs_init") {
    await mh.notifyTrackingStatus();
  } else if (req.action === "enable_tracking") {
    await mh.enableTracking();
  } else if (req.action === "disable_tracking") {
    await mh.disableTracking();
  }
});
