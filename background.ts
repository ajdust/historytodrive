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
        reject(chrome.runtime.lastError);
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

  async get<T>(key: string, defaultValue: T): Promise<T> {
    const kv = await this.keyValue.get(key);
    return kv ? (kv as T) : defaultValue;
  }

  put<T>(key: string, value: T) {
    return this.keyValue.put({ key: key, value: value });
  }
}

/* Utilities */

function yearMonth(): string {
  const dt = new Date();
  return `${dt.getFullYear()}-${dt.getMonth() + 1}`;
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

interface PKCEResponse {
  uid: string;
  access_token: string;
  expires_in: number;
  token_type: string;
  id_token: string;
  scopes: string;
  refresh_token: string;
}

async function getPKCEAccessToken(oauth: {
  clientId: string;
  oauthTokenUri: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<PKCEResponse> {
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
  refreshToken: string;
}): Promise<PKCEResponse> {
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

interface DriveItem {
  id: string;
  fileSystemInfo: { createdDateTime: string; lastModifiedDateTime: string };
  name: string;
  size: number;
  webUrl: string;
}

interface FolderItem extends DriveItem {
  folder: { childCount: number };
}

interface FileItem extends DriveItem {
  file: { mimeType: string };
}

interface RequestError {
  status: number;
  context: string;
  response: string;
}

type Either<TSuccess, TError> =
  | { success: true; value: TSuccess }
  | { success: false; error: TError };

const driveUri = "https://graph.microsoft.com/v1.0/me/drive";

// Get headers for requests to drive API
function GetDriveHeaders(
  accessToken: string,
  contentType: string = "application/json"
): Headers {
  return new Headers({
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": contentType,
  });
}

async function DriveListChildren(
  headers: Headers,
  folderId: string | undefined = undefined
): Promise<Either<DriveItem[], RequestError>> {
  const id = folderId ? `items/${folderId}` : "root";
  const response = await fetch(`${driveUri}/${id}/children`, {
    headers: headers,
  });

  if (response.status !== 200 && response.status !== 201) {
    const err = {
      status: response.status,
      context: `listing children for ${id}`,
      response: await response.text(),
    };

    return { success: false, error: err };
  }

  return { success: true, value: (await response.json()).value };
}

async function DriveCreateFolder(
  headers: Headers,
  name: string,
  folderId: string | undefined = undefined
): Promise<Either<FolderItem, RequestError>> {
  const id = folderId ? `items/${folderId}` : "root";
  const response = await fetch(`${driveUri}/${id}/children`, {
    method: "POST",
    headers: headers,
    body: JSON.stringify({
      name: name,
      folder: {},
      "@microsoft.graph.conflictBehavior": "rename",
    }),
  });

  if (response.status !== 200 && response.status !== 201) {
    const err = {
      status: response.status,
      context: `creating folder ${name} in ${id}`,
      response: await response.text(),
    };

    return { success: false, error: err };
  }

  return { success: true, value: await response.json() };
}

async function DriveUploadEmptyExcelFile(
  headers: Headers,
  filename: string,
  folderId: string | undefined = undefined
): Promise<Either<FileItem, RequestError>> {
  const empty = await fetch(getURL("empty_table.xlsx"));
  if (empty.status !== 200) {
    throw `${
      empty.status
    } while fetching empty_table.xlsx: ${await empty.text()}`;
  }

  const hs = new Headers();
  headers.forEach((value, key) => hs.set(key, value));
  const emptyBlob = await empty.blob();
  hs.set("Content-Type", emptyBlob.type);

  const id = folderId ? `items/${folderId}` : "root";
  const response = await fetch(`${driveUri}/${id}:/${filename}:/content`, {
    method: "PUT",
    body: emptyBlob,
    headers: hs,
  });

  if (response.status !== 200 && response.status !== 201) {
    const err = {
      status: response.status,
      context: `uploading empty excel file ${filename} in ${id}`,
      response: await response.text(),
    };

    return { success: false, error: err };
  }

  return { success: true, value: await response.json() };
}

async function GetOrCreateFolder(
  headers: Headers,
  name: string,
  folderId: string | undefined = undefined
): Promise<Either<FolderItem, RequestError>> {
  const list = await DriveListChildren(headers, folderId);
  if (!list.success) return list;

  const matches = list.value.filter(
    (v) => (v as FolderItem).folder && v.name === name
  );

  if (matches.length > 0) {
    return { success: true, value: matches[0] as FolderItem };
  }

  const create = await DriveCreateFolder(headers, name, folderId);
  return create;
}

async function GetOrCreateExcelFile(
  headers: Headers,
  filename: string,
  folderId: string | undefined
): Promise<Either<FileItem, RequestError>> {
  const list = await DriveListChildren(headers, folderId);
  if (!list.success) return list;

  const matched = list.value.filter(
    (v) => (v as FileItem).file && v.name === filename
  );

  if (matched.length > 0) {
    return { success: true, value: matched[0] as FileItem };
  }

  const upload = await DriveUploadEmptyExcelFile(headers, filename, folderId);
  return upload;
}

async function AppendRowToExcelFile(
  headers: Headers,
  fileId: string,
  values: string[][]
): Promise<Either<true, RequestError>> {
  const baseUri = "https://graph.microsoft.com/v1.0/me/drive";
  const uri = `${baseUri}/items/${fileId}/workbook/tables/History/rows/add`;
  const response = await fetch(uri, {
    method: "POST",
    body: JSON.stringify({ index: null, values: values }),
    headers: headers,
  });

  if (response.status !== 200 && response.status !== 201) {
    const err = {
      status: response.status,
      context: `appending row to ${fileId}`,
      response: await response.text(),
    };

    return { success: false, error: err };
  }

  return { success: true, value: true };
}

/* Message handling */
type FileData = {
  fileId: string;
  folderUrl: string;
  fileYearMonth: string;
};

class MessageHandler {
  private readonly clientId: string;
  private kvDb: KeyValueDb;

  constructor() {
    this.clientId = getClientId();
    this.kvDb = new KeyValueDb();
  }

  async enableTracking(interactive: boolean = true): Promise<void> {
    const codes = await authenticateForPKCECode({
      interactive: interactive,
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

    await this.setAuth(tokenResponse);
    const setup = await this.setupFile();
    if (!setup.success) {
      const err = setup.error;
      console.warn(`${err.status} while ${err.context}: ${err.response}`);
      return;
    }

    await this.notifyTrackingStatus();
  }

  async disableTracking(error: string | undefined = undefined) {
    await this.clearAuth();
    await this.notifyTrackingStatus(error);
  }

  async isTracking(): Promise<boolean> {
    const auth = await this.getAuth();
    return auth?.access_token ? true : false;
  }

  async notifyTrackingStatus(error: string | undefined = undefined) {
    if (await this.isTracking()) {
      const { folderUrl } = (await this.getFileData())!;
      send(<MessageToPopup.EnabledTracking>{
        action: "tracking_is_enabled",
        url: folderUrl,
      });
    } else {
      send(<MessageToPopup.DisabledTracking>{
        action: "tracking_is_disabled",
        error: error,
      });
    }
  }

  async setupFile(): Promise<
    Either<{ headers: Headers; file: FileData }, RequestError>
  > {
    const ym = yearMonth();
    const auth = await this.getAuth();
    if (auth === null) throw "Expected not null from getAuth";

    const hs = GetDriveHeaders(auth.access_token);
    let fileData = await this.getFileData();
    let { fileId, folderUrl, fileYearMonth } = fileData ?? {};
    if (fileId && ym === fileYearMonth)
      return { success: true, value: { headers: hs, file: fileData! } };

    const folder = await GetOrCreateFolder(hs, "History");
    if (!folder.success) return folder;

    folderUrl = folder.value.webUrl;
    const file = await GetOrCreateExcelFile(
      hs,
      `History-${ym}.xlsx`,
      folder.value.id
    );
    if (!file.success) return file;

    fileData = {
      fileId: file.value.id,
      folderUrl: folderUrl,
      fileYearMonth: ym,
    };
    await this.setFileData(fileData);

    return { success: true, value: { headers: hs, file: fileData } };
  }

  async refreshToken() {
    try {
      console.log("Trying refresh token");
      const currentResponse = await this.getAuth();
      if (currentResponse === null) {
        throw "Expected not null from getAuth";
      }

      const tokenResponse = await refreshAccessToken({
        clientId: this.clientId,
        oauthRefreshUri:
          "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
        refreshToken: currentResponse.refresh_token,
      });

      await this.setAuth(tokenResponse);
      return;
    } catch (exc) {
      console.warn(exc);
    }

    try {
      console.log("Trying non-interactive sign in");
      await this.enableTracking(false);
    } catch (exc) {
      console.warn(exc);
      await this.disableTracking(exc.toString());
    }
  }

  async track(data: MessageToBackground.TrackData) {
    console.log(data);
    if (!(await this.isTracking())) return;

    async function append(
      hs: Headers,
      fileId: string | undefined,
      data: MessageToBackground.TrackData,
      tags: string
    ) {
      if (!fileId) throw "Expected fileId";
      const append = await AppendRowToExcelFile(hs, fileId, [
        [data.timestamp, tags, data.title, data.host, data.url, data.userAgent],
      ]);
      if (!append.success) {
        const err = append.error;
        console.warn(`${err.status} while ${err.context}: ${err.response}`);
      }
    }

    const tags = await this.getTags();
    let setup = await this.setupFile();

    if (setup.success) {
      await append(setup.value.headers, setup.value.file.fileId, data, tags);
    } else if (!setup.success && setup.error.status === 401) {
      await this.refreshToken();
      setup = await this.setupFile();
      if (setup.success) {
        await append(setup.value.headers, setup.value.file.fileId, data, tags);
      }
    }

    if (!setup.success) {
      const err = `${setup.error.status} while ${setup.error.context}: ${setup.error.response}`;
      await this.disableTracking(err);
      throw err;
    }
  }

  async setTags(tags: string) {
    await this.kvDb.put("tags", tags);
  }

  async getTags(): Promise<string> {
    return await this.kvDb.get("tags", "");
  }

  async setAuth(auth: PKCEResponse) {
    await this.kvDb.put("auth", auth);
  }

  async clearAuth() {
    await this.kvDb.put("auth", null);
  }

  async getAuth(): Promise<PKCEResponse | null> {
    return await this.kvDb.get<PKCEResponse | null>("auth", null);
  }

  async setFileData(data: FileData) {
    await this.kvDb.put("file", data);
  }

  async getFileData(): Promise<FileData | null> {
    return await this.kvDb.get<FileData | null>("file", null);
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
  } else if (req.action === "set_tags") {
    await mh.setTags(req.tags);
  }
});
