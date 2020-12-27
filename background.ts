/// <reference path="node_modules/dexie/dist/dexie.d.ts" />
/// <reference path="webextension.d.ts" />
/// <reference path="messages.d.ts" />

/* Browser extension wrappers */

function authenticate(details: {
  url: string;
  interactive: boolean;
}): Promise<string> {
  return browser.identity.launchWebAuthFlow(details);
}

function getRedirectURL(path: string): string {
  return browser.identity.getRedirectURL(path);
}

function getURL(path: string): string {
  return browser.runtime.getURL(path);
}

function getManifestName(): string {
  return browser.runtime.getManifest().name;
}

async function setIcon(file: string): Promise<void> {
  await browser.browserAction.setIcon({ path: file });
}

async function send(message: any): Promise<void> {
  try {
    await browser.runtime.sendMessage(message);
    return;
  } catch (exc) {
    console.warn(
      new Error(`could not send message: ${exc}; ${JSON.stringify(message)}`)
    );
    return;
  }
}

function listen<T extends (message: any, ...other: any[]) => void>(
  callback: T
) {
  browser.runtime.onMessage.addListener(callback);
}

/* Key value database */

class KeyValueDb extends Dexie.Dexie {
  private keyValue: Dexie.Table;

  constructor() {
    super("keyValue");
    this.version(1).stores({ keyValue: "key,value" });
    this.keyValue = this.table("keyValue");
  }

  async get<T>(key: string, defaultValue: T): Promise<T> {
    const kv = await this.keyValue.get(key);
    return kv ? (kv.value as T) : defaultValue;
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

async function randomString(): Promise<string> {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const jwk = await crypto.subtle.exportKey("jwk", key);
  return jwk.k!;
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

interface RequestError {
  status: number;
  context: string;
  response: string;
}

type Either<TSuccess, TError> =
  | { success: true; value: TSuccess }
  | { success: false; error: TError };

/* Authentication */

async function pkceAuthenticate(oauth: {
  interactive: boolean;
  oauthAuthorizeUri: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
}): Promise<{ verifier: string; code: string }> {
  // See https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-auth-code-flow#request-an-authorization-code
  // and https://docs.microsoft.com/en-us/onedrive/developer/rest-api/getting-started/graph-oauth?view=odsp-graph-online#authentication-scopes
  const [authState, codeVerifier] = [
    await randomString(),
    await randomString(),
  ];
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
    throw new Error(
      "Redirected URI does not contain expected 'state=' in query parameters"
    );
  if (!params.has("code"))
    throw new Error(
      "Redirected URI does not contain expected 'code=' in query parameters"
    );

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

async function pkceGetAccessToken(oauth: {
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

  throw new Error(
    `${response.status} from ${oauth.oauthTokenUri}: ` + (await response.text())
  );
}

async function pkceRefreshAccessToken(oauth: {
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

  throw new Error(
    `${response.status} from ${oauth.oauthRefreshUri}: ` +
      (await response.text())
  );
}

/* Microsoft graph API calls */

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

const driveUri = "https://graph.microsoft.com/v1.0/me/drive";

function driveGetHeaders(
  accessToken: string,
  contentType: string = "application/json"
): Headers {
  return new Headers({
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": contentType,
  });
}

async function driveListChildren(
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

async function driveCreateFolder(
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

async function driveUploadEmptyExcelFile(
  headers: Headers,
  filename: string,
  folderId: string | undefined = undefined
): Promise<Either<FileItem, RequestError>> {
  const empty = await fetch(getURL("empty_table.xlsx"));
  if (empty.status !== 200) {
    throw new Error(
      `${empty.status} while fetching empty_table.xlsx: ${await empty.text()}`
    );
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

async function driveGetOrCreateFolder(
  headers: Headers,
  name: string,
  folderId: string | undefined = undefined
): Promise<Either<FolderItem, RequestError>> {
  const list = await driveListChildren(headers, folderId);
  if (!list.success) return list;

  const matches = list.value.filter(
    (v) => (v as FolderItem).folder && v.name === name
  );

  if (matches.length > 0) {
    return { success: true, value: matches[0] as FolderItem };
  }

  return await driveCreateFolder(headers, name, folderId);
}

async function driveGetOrCreateExcelFile(
  headers: Headers,
  filename: string,
  folderId: string | undefined
): Promise<Either<FileItem, RequestError>> {
  const list = await driveListChildren(headers, folderId);
  if (!list.success) return list;

  const matched = list.value.filter(
    (v) =>
      (v as FileItem).file && v.name.toLowerCase() === filename.toLowerCase()
  );

  if (matched.length > 0) {
    return { success: true, value: matched[0] as FileItem };
  }

  return await driveUploadEmptyExcelFile(headers, filename, folderId);
}

async function driveAppendRowToExcelFile(
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
  private readonly kvDb: KeyValueDb;
  private readonly name: string;
  private readonly baseFilename: string;
  private lastStatus: boolean | undefined;

  constructor() {
    this.kvDb = new KeyValueDb();
    this.name = getManifestName();
    this.baseFilename = this.name.replace(/ /g, "");
  }

  async enableTracking(interactive: boolean = true): Promise<void> {
    const codes = await pkceAuthenticate({
      interactive: interactive,
      oauthAuthorizeUri:
        "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
      clientId: (<any>window).CLIENT_ID,
      redirectUri: getRedirectURL("microsoft"),
      scopes: ["openid", "files.readwrite"],
    });

    const tokenResponse = await pkceGetAccessToken({
      oauthTokenUri:
        "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
      clientId: (<any>window).CLIENT_ID,
      redirectUri: getRedirectURL("microsoft"),
      codeVerifier: codes.verifier,
      code: codes.code,
    });

    await this.setAuth(tokenResponse);
    const setup = await this.setupFile();
    if (!setup.success) {
      const err = setup.error;
      console.warn(
        new Error(`${err.status} while ${err.context}: ${err.response}`)
      );
      return;
    }

    await this.notifyTrackingStatus();
  }

  async refreshToken() {
    await this.clearFileData();
    try {
      const currentResponse = await this.getAuth();
      if (currentResponse) {
        const tokenResponse = await pkceRefreshAccessToken({
          oauthRefreshUri:
            "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
          clientId: (<any>window).CLIENT_ID,
          refreshToken: currentResponse.refresh_token,
        });

        await this.setAuth(tokenResponse);
        console.log("Token was refreshed.");
        return;
      }
    } catch (exc) {
      console.warn(exc);
    }

    try {
      await this.enableTracking(false);
      console.log("Non-interactive sign in was successful.");
    } catch (exc) {
      console.warn(exc);
      // Disable if 'Requires user interaction'
      const msg: string = exc.message ?? exc.toString();
      if (msg.toLowerCase().indexOf("interact") >= 0) {
        await this.disableTracking(msg);
      }
    }
  }

  async disableTracking(error: RequestError | string | undefined = undefined) {
    await this.clearAuth();
    await this.clearFileData();
    if (typeof error === "string") await this.notifyTrackingStatus(error);
    else if (typeof error === "object") {
      const msg = `${error.status} while ${error.context}: ${error.response}`;
      await this.notifyTrackingStatus(msg);
    } else {
      await this.notifyTrackingStatus();
    }
  }

  async isTracking(): Promise<boolean> {
    const auth = await this.getAuth();
    const tracking = !!auth?.access_token;
    if (this.lastStatus !== tracking) {
      if (tracking) await setIcon("logo_48px.png");
      else await setIcon("logo_48px_disabled.png");
      this.lastStatus = tracking;
    }
    return tracking;
  }

  async notifyTrackingStatus(error: string | undefined = undefined) {
    if (await this.isTracking()) {
      const { folderUrl } = (await this.getFileData())!;
      const tags = await this.getTags();
      const rules = await this.getRedactionRules();
      await send(<MessageToPopup.EnabledTracking>{
        action: "tracking_is_enabled",
        url: folderUrl,
        tags: tags,
        redaction_rules: rules,
      });
    } else {
      await send(<MessageToPopup.DisabledTracking>{
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
    if (auth === null) throw new Error("Expected not null from getAuth");

    const hs = driveGetHeaders(auth.access_token);
    let fileData = await this.getFileData();
    let { fileId, folderUrl, fileYearMonth } = fileData ?? {};
    if (fileId && ym === fileYearMonth)
      return { success: true, value: { headers: hs, file: fileData! } };

    const folder = await driveGetOrCreateFolder(hs, this.name);
    if (!folder.success) return folder;

    folderUrl = folder.value.webUrl;
    const file = await driveGetOrCreateExcelFile(
      hs,
      `${this.baseFilename}-${ym}.xlsx`,
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

  async track(data: Shared.TrackData, tryCount: number = 0) {
    if (!(await this.isTracking())) return;

    let setup = await this.setupFile();
    if (!setup.success) {
      console.warn(setup.error);
      if (tryCount > 50) {
        await this.disableTracking(setup.error);
        return;
      }

      await new Promise((r) => setTimeout(r, 2000));
      if (setup.error.status === 401) {
        await this.refreshToken();
      }

      await this.clearFileData();
      await this.track(data, tryCount + 1);
      return;
    }

    const tag = await this.getJoinedTag();
    const url = await this.getRedactedUrl(data.url);
    const append = await driveAppendRowToExcelFile(
      setup.value.headers,
      setup.value.file.fileId,
      [
        [
          data.timestamp,
          tag,
          data.title,
          data.host,
          url,
          data.userAgent,
          "",
          "",
          "",
          "",
        ],
      ]
    );

    if (!append.success) {
      console.warn(append.error);
      if (tryCount > 50) {
        await this.disableTracking(append.error);
        return;
      }

      await new Promise((r) => setTimeout(r, 2000));
      if (append.error.status === 401) {
        await this.refreshToken();
      }

      await this.clearFileData();
      await this.track(data, tryCount + 1);
      return;
    }
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

  async clearFileData() {
    await this.kvDb.put("file", {});
  }

  async getFileData(): Promise<FileData | null> {
    return await this.kvDb.get<FileData | null>("file", null);
  }

  async getJoinedTag(): Promise<string> {
    const tags = await this.getTags();
    return tags
      .filter((t) => t.enabled)
      .map((t) => t.text)
      .join("; ");
  }

  async getTags(): Promise<Shared.Tag[]> {
    const tags = await this.kvDb.get<Shared.Tag[]>("tags", []);
    if (tags.length === 0) {
      const defaultTags = [
        { enabled: false, text: "Personal" },
        { enabled: false, text: "Project" },
        { enabled: false, text: "Work" },
        { enabled: false, text: "Other" },
      ];
      await this.setTags(defaultTags);
      return defaultTags;
    }

    return tags;
  }

  async getRedactedUrl(url: string): Promise<string> {
    try {
      const rules = await this.getRedactionRules();
      for (const rule of rules) {
        if (rule.enabled)
          url = url.replace(new RegExp(rule.replace, "gi"), rule.with);
      }

      return url;
    } catch (e) {
      return e.toString();
    }
  }

  async getRedactionRules(): Promise<Shared.RedactionRule[]> {
    const redacting = await this.kvDb.get<Shared.RedactionRule[]>(
      "redaction_rules",
      []
    );
    if (redacting.length === 0) {
      const defaultRedaction = [
        {
          enabled: true,
          replace: "(code|access_token|redirect_uri|state|nonce)=[^&]*",
          with: "$1=redacted",
          description: "OAuth parameters",
        },
      ];
      await this.setRedactionRules(defaultRedaction);
      return defaultRedaction;
    }

    return redacting;
  }

  async setTags(tags: Shared.Tag[]) {
    await this.kvDb.put("tags", tags ?? []);
  }

  async setRedactionRules(regexReplaces: Shared.RedactionRule[]) {
    await this.kvDb.put("redaction_rules", regexReplaces);
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
  } else if (req.action === "set_redaction_rules") {
    await mh.setRedactionRules(req.redaction_rules);
  }
});
