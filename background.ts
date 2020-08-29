/// <reference path="node_modules/Dropbox/dist/Dropbox-sdk.min.d.ts" />
/// <reference path="node_modules/@types/chrome/index.d.ts" />
/// <reference path="node_modules/dexie/dist/dexie.d.ts" />

import {
  SentToBackgroundMessage,
  TrackingIsDisabledMessage,
  TrackingIsEnabledMessage,
} from "./messages";

function startAuthFlow(details: {
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

// @ts-ignore
class KeyValueDb extends Dexie.Dexie {
  private keyValue: Dexie.Table<any, Dexie.IndexableType>;

  constructor() {
    super("keyValue");
    this.version(1).stores({ keyValue: "key,value" });
    this.keyValue = this.table("keyValue");
  }

  async get(key: string): Promise<Object | null> {
    const kv = await this.keyValue.get(key);
    return kv ? kv.value : null;
  }

  put(key: string, value: Object) {
    return this.keyValue.put({ key: key, value: value });
  }
}

// See https://www.dropbox.com/developers/documentation/http/documentation#oauth2-token
async function getPkceAccessToken(
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
  const response = await fetch("https://api.dropbox.com/oauth2/token", {
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
    `Error: ${response.status} from api.dropbox.com: ` + (await response.text())
  );
}

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
async function main() {
  const cid = chrome.runtime.getManifest().oauth2!.client_id;
  chrome.runtime.onMessage.addListener(
    async (req: SentToBackgroundMessage, _) => {
      if (req.action === "track") {
        console.log(req.data);
      } else if (req.action === "log") {
        console.warn(req.data);
      } else if (req.action === "popup_needs_init") {
        chrome.runtime.sendMessage(<TrackingIsDisabledMessage>{
          action: "tracking_is_disabled",
        });
      } else if (req.action === "enable_tracking") {
        // @ts-ignore
        const dbx = new Dropbox.Dropbox({ clientId: cid, fetch: window.fetch });
        const authState = randomString(50);
        const codeVerifier = randomString(50);
        const redirectUrl = chrome.identity.getRedirectURL("dropbox");
        const authUrl =
          dbx.getAuthenticationUrl(redirectUrl, authState, "code") +
          "&code_challenge_method=S256" +
          "&code_challenge=" +
          (await sha256(codeVerifier));

        const redirectedUrl = await startAuthFlow({
          url: authUrl,
          interactive: true,
        });
        const redirectedParams = getUrlParameters(redirectedUrl);
        if (redirectedParams.get("state") !== authState)
          throw "Redirected URI does not contain expected 'state=' in query parameters";
        if (!redirectedParams.has("code"))
          throw "Redirected URI does not contain expected 'code=' in query parameters";

        const tokenResponse = await getPkceAccessToken(
          redirectedParams.get("code")!,
          redirectedUrl,
          codeVerifier,
          cid
        );

        // TODO: do something with the token response!

        chrome.runtime.sendMessage(<TrackingIsEnabledMessage>{
          action: "tracking_is_enabled",
        });
      } else if (req.action === "disable_tracking") {
        chrome.runtime.sendMessage(<TrackingIsDisabledMessage>{
          action: "tracking_is_disabled",
        });
      }
    }
  );
}

main().then(() => console.log("Main finished running."));
