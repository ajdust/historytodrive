/// <reference path="node_modules/@types/chrome/index.d.ts" />
/// <reference path="node_modules/dexie/dist/dexie.d.ts" />
/// <reference path="node_modules/xlsx/types/index.d.ts" />
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

function getRedirectURL(path: string): string {
  return chrome.identity.getRedirectURL(path);
}

function getURL(path: string): string {
  return chrome.runtime.getURL(path);
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

async function authenticateForPKCECode(oauth: {
  interactive: boolean;
  oauthAuthorizeUri: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
}): Promise<{ verifier: string; code: string }> {
  // See https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-auth-code-flow#request-an-authorization-code
  // and https://docs.microsoft.com/en-us/onedrive/developer/rest-api/getting-started/graph-oauth?view=odsp-graph-online#authentication-scopes
  // TODO: replace randomString with randomCryptoString method
  const [authState, codeVerifier] = [randomString(50), randomString(50)];
  const authUrl =
    `${oauth.oauthAuthorizeUri}?` +
    [
      `client_id=${oauth.clientId}`,
      `redirect_uri=${encodeURIComponent(oauth.redirectUri)}`,
      `scope=${encodeURIComponent(oauth.scopes.join(" "))}`,
      `state=${authState}`,
      "response_type=code",
      "code_challenge_method=S256",
      `code_challenge=${await sha256(codeVerifier)}`,
    ].join("&");

  const redirectedUrl = await authenticate({
    url: authUrl,
    interactive: oauth.interactive,
  });

  const params = getUrlParameters(redirectedUrl);
  if (params.get("state") !== authState)
    throw "Redirected URI does not contain expected 'state=' in query parameters";
  if (!params.has("code"))
    throw "Redirected URI does not contain expected 'code=' in query parameters";

  return { verifier: codeVerifier, code: params.get("code")! };
}

async function getPKCEAccessToken(oauth: {
  clientId: string;
  oauthTokenUri: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<{
  uid: string;
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  account_id: string;
}> {
  // See https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-auth-code-flow#request-an-access-token
  const response = await fetch(oauth.oauthTokenUri, {
    body: [
      `client_id=${encodeURIComponent(oauth.clientId)}`,
      `grant_type=authorization_code`,
      `redirect_uri=${encodeURIComponent(oauth.redirectUri)}`,
      `code=${encodeURIComponent(oauth.code)}`,
      `code_verifier=${encodeURIComponent(oauth.codeVerifier)}`,
    ].join("&"),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });

  if (response.status === 200) return await response.json();

  throw (
    `Error: ${response.status} from ${oauth.oauthTokenUri}: ` +
    (await response.text())
  );
}

async function refreshAccessToken(oauth: {
  clientId: string;
  oauthRefreshUri: string;
  redirectUri: string;
  refreshToken: string;
}): Promise<{
  uid: string;
  access_token: string;
  expires_in: number;
  token_type: string;
  id_token: string;
  scopes: string;
}> {
  const response = await fetch(oauth.oauthRefreshUri, {
    method: "POST",
    body: [
      `client_id=${encodeURIComponent(oauth.clientId)}`,
      `grant_type=refresh_token`,
      `refresh_token=${encodeURIComponent(oauth.refreshToken)}`,
    ].join("&"),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  if (response.status === 200) return await response.json();

  throw (
    `Error: ${response.status} from ${oauth.oauthRefreshUri}: ` +
    (await response.text())
  );
}

/* Graph API calls */

const driveUri = "https://graph.microsoft.com/v1.0/me/drive";

// Get headers for requests to drive API
function GetDriveHeaders(accessToken: string): Headers {
  return new Headers({
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  });
}

// List items in a folder
async function ListChildren(
  headers: Headers,
  folderPath: string
): Promise<{ status: number; content: any }> {
  const response = await fetch(`${driveUri}/${folderPath}/children`, {
    headers: headers,
  });

  const content = await response.json();
  return { status: response.status, content: content };
}

// Request to create a folder
async function CreateFolder(
  headers: Headers,
  folderPath: string,
  folderName: string
): Promise<{ status: number; content: any }> {
  const response = await fetch(`${driveUri}/${folderPath}/children`, {
    method: "POST",
    headers: headers,
    body: JSON.stringify({
      name: folderName,
      folder: {},
      "@microsoft.graph.conflictBehavior": "rename",
    }),
  });
  return { status: response.status, content: await response.json() };
}

// Upload an Excel file with an empty table
async function UploadEmptyExcelFile(
  headers: Headers,
  folderPath: string,
  folderName: string,
  filename: string
): Promise<{ status: number; content: any }> {
  const hs = new Headers();
  headers.forEach((value, key) => hs.set(key, value));
  const empty = await fetch(getURL("empty_table.xlsx"));
  if (empty.status !== 200) {
    throw `could not get empty excel file, got ${
      empty.status
    }: ${await empty.text()}`;
  }

  const emptyBlob = await empty.blob();
  hs.set("Content-Type", emptyBlob.type);

  const response = await fetch(
    `${driveUri}/${folderPath}:/${folderName}/${filename}:/content`,
    {
      method: "PUT",
      body: emptyBlob,
      headers: hs,
    }
  );

  return { status: response.status, content: await response.json() };
}

// Request to get a folder, creating it if it does not exist
async function GetOrCreateFolder(
  headers: Headers,
  folderPath: string,
  folderName: string
): Promise<any> {
  const list = await ListChildren(headers, folderPath);
  if (list.status !== 200 && list.status !== 201) {
    throw `${list.status} while listing ${folderPath}: ${list.content}`;
  }

  const matches = list.content.value.filter(
    (v: any) => v.folder && v.name === folderName
  );

  if (matches.length > 0) {
    return matches[0];
  }

  const create = await CreateFolder(headers, folderPath, folderName);
  if (create.status !== 200 && create.status !== 201) {
    throw `${create.status} while creating a folder: ${create.content}`;
  }

  return create.content;
}

// Request to get an excel file, creating it if it does not exist
async function GetOrCreateExcelFile(
  headers: Headers,
  folderPath: string,
  folderName: string,
  filename: string
): Promise<any> {
  const folder = await GetOrCreateFolder(headers, folderPath, folderName);
  const list = await ListChildren(headers, `items/${folder.id}`);
  if (list.status !== 200 && list.status !== 201) {
    throw `${list.status} while listing items/${folder.id}: ${list.content}`;
  }

  const matched = list.content.value.filter((v: any) => v.name === filename);
  if (matched.length > 0) {
    return matched[0];
  }

  const create = await UploadEmptyExcelFile(
    headers,
    folderPath,
    folderName,
    filename
  );
  if (create.status !== 200 && create.status !== 201) {
    throw `${create.status} while uploading file: ${create.content}`;
  }

  return create.content;
}

// Append lines to an existing excel file
async function AppendToExcelFile(
  headers: Headers,
  folderPath: string,
  folderName: string,
  filename: string,
  values: string[][]
): Promise<{ status: number; content: any }> {
  const baseUri = "https://graph.microsoft.com/v1.0/me/drive";
  const uri = `${baseUri}/${folderPath}/${folderName}/${filename}:/workbook/tables/History/rows/add`;
  const response = await fetch(uri, {
    method: "POST",
    body: JSON.stringify({ index: null, values: values }),
    headers: headers,
  });

  return { status: response.status, content: await response.json() };
}

/* Message handling */

class MessageHandler {
  private readonly clientId: string;
  private kvDb: KeyValueDb;

  constructor() {
    this.clientId = getClientId();
    this.kvDb = new KeyValueDb();
  }

  async enableTracking(): Promise<void> {
    const codes = await authenticateForPKCECode({
      interactive: true,
      oauthAuthorizeUri:
        "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
      clientId: this.clientId,
      redirectUri: getRedirectURL("microsoft"),
      scopes: ["openid", "files.readwrite"],
    });

    const tokenResponse = await getPKCEAccessToken({
      oauthTokenUri:
        "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
      clientId: this.clientId,
      redirectUri: getRedirectURL("microsoft"),
      codeVerifier: codes.verifier,
      code: codes.code,
    });

    await this.kvDb.put("auth", tokenResponse);
    // TODO: check MS oauth success

    send(<MessageToPopup.EnabledTracking>{
      action: "tracking_is_enabled",
    });
  }

  async disableTracking() {
    await this.kvDb.put("auth", {});
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
