// src/host/index.ts
import z from "@deepseek-ai/schemastery";

// src/shared/contract.ts
var API_BASE = "/api/copilot-bridge";
var BRIDGE_PROVIDER = "copilot-bridge";
var BRIDGE_RECORD_SCOPE = "copilot-bridge";
var BRIDGE_RECORD_ID = "github";
var BRIDGE_RECORD_KEY = `${BRIDGE_RECORD_SCOPE}/${BRIDGE_RECORD_ID}`;
var GITHUB_DOTCOM = "github.com";

// src/host/bridge-credentials.ts
import { credentialKey } from "@deepseek-ai/dsh-credentials";
var HOST = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/;
var bridgeRecordKey = () => credentialKey(BRIDGE_RECORD_SCOPE, BRIDGE_RECORD_ID);
function bridgeAccount(record) {
  if (record?.kind !== "grant" || typeof record.payload !== "object" || record.payload === null) return void 0;
  const { token, enterpriseHost } = record.payload;
  if (typeof token !== "string" || token.length === 0) return void 0;
  if (enterpriseHost === void 0) return { token };
  return typeof enterpriseHost === "string" && HOST.test(enterpriseHost) ? { token, enterpriseHost } : void 0;
}
async function readBridgeAccount(store) {
  return bridgeAccount(await store?.readRecord(bridgeRecordKey()));
}
async function writeBridgeAccount(store, account, signal) {
  const checkActive = () => {
    if (signal?.aborted) throw new Error("GitHub sign-in was cancelled");
  };
  checkActive();
  const payload = {
    type: "github-oauth",
    token: account.token,
    ...account.enterpriseHost === void 0 ? {} : { enterpriseHost: account.enterpriseHost }
  };
  const record = { kind: "grant", payload };
  await store.modifyRecord(bridgeRecordKey(), async () => {
    checkActive();
    return record;
  });
  checkActive();
  const written = await readBridgeAccount(store);
  checkActive();
  if (written?.token !== account.token || written.enterpriseHost !== account.enterpriseHost) {
    throw new Error(`the credential record at ${BRIDGE_RECORD_KEY} did not survive the write`);
  }
}
async function deleteBridgeAccount(store) {
  await store.deleteRecord(bridgeRecordKey());
}

// src/host/enterprise.ts
var InvalidEnterpriseUrlError = class extends Error {
  name = "InvalidEnterpriseUrlError";
  input;
  constructor(input) {
    super(`invalid GitHub Enterprise URL/domain "${input}"`);
    this.input = input;
  }
};
function normalizeEnterpriseDomain(input) {
  const trimmed = input?.trim() ?? "";
  if (trimmed.length === 0) return void 0;
  let url;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new InvalidEnterpriseUrlError(trimmed);
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname.length === 0 || url.protocol !== "https:" && url.protocol !== "http:") {
    throw new InvalidEnterpriseUrlError(trimmed);
  }
  return hostname === GITHUB_DOTCOM || hostname === `www.${GITHUB_DOTCOM}` ? void 0 : hostname;
}
function deviceFlowUrls(domain) {
  return {
    deviceCodeUrl: `https://${domain}/login/device/code`,
    accessTokenUrl: `https://${domain}/login/oauth/access_token`,
    verificationUri: `https://${domain}/login/device`
  };
}

// src/host/hidden-models.ts
var InvalidHiddenModelsError = class extends Error {
};
function validateHiddenModels(input) {
  if (!Array.isArray(input) || !input.every((id) => typeof id === "string") || input.some((id) => id.trim().length === 0)) {
    throw new InvalidHiddenModelsError("hiddenModels must be an array of non-empty strings");
  }
  return [...new Set(input)];
}

// src/host/pinned-models.ts
var InvalidPinnedModelsError = class extends Error {
};
function validatePinnedModels(input) {
  if (!Array.isArray(input) || !input.every((id) => typeof id === "string") || input.some((id) => id.trim().length === 0)) {
    throw new InvalidPinnedModelsError("pinnedModels must be an array of non-empty strings");
  }
  return [...new Set(input)];
}
function pinnedFirst(models, pinnedIds) {
  const pinned = new Set(pinnedIds);
  return [...models.filter((model) => pinned.has(model.id)), ...models.filter((model) => !pinned.has(model.id))];
}

// src/host/auth-controller.ts
var errorMessage = (error) => error instanceof Error ? error.message : String(error);
function createAuthController(deps) {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => {
    clearTimeout(handle);
  });
  let flow = { state: "signed-out" };
  let generation = 0;
  let disposed = false;
  let deviceRequest;
  let timer;
  const configuredDomain = () => normalizeEnterpriseDomain(deps.config.read());
  const githubHost = () => configuredDomain() ?? GITHUB_DOTCOM;
  const stopPolling = () => {
    generation += 1;
    deviceRequest?.abort();
    deviceRequest = void 0;
    if (timer !== void 0) clearTimer(timer);
    timer = void 0;
  };
  const cancelLogin = () => {
    stopPolling();
    flow = { state: "signed-out" };
  };
  const requireCredentials = (action) => {
    const credentials = deps.credentials();
    if (credentials === void 0) throw new Error(`${action} needs the credentials service; mount dsh-credentials-local`);
    return credentials;
  };
  const readAccount = () => readBridgeAccount(deps.credentials());
  const catalogIds = async () => {
    try {
      return await deps.catalogIds?.();
    } catch (error) {
      deps.logger.warn(`Could not read the model catalog: ${errorMessage(error)}`);
      return void 0;
    }
  };
  const bestEffort = async (label, action) => {
    try {
      await action();
    } catch (error) {
      deps.logger.warn(`${label}: ${errorMessage(error)}`);
    }
  };
  const resetHiddenModels = () => bestEffort("Could not reset hidden models", () => deps.config.writeHidden(void 0));
  const resetPinnedModels = () => bestEffort("Could not reset pinned models", () => deps.config.writePinned(void 0));
  const status = async () => {
    const account = await readAccount();
    const base = {
      provider: BRIDGE_PROVIDER,
      githubHost: githubHost(),
      enterpriseUrl: deps.config.read().trim(),
      configWritable: deps.config.writable()
    };
    if (account === void 0) {
      return { ...base, authenticated: false, ...flow.state === "authenticated" ? { state: "signed-out" } : flow };
    }
    const signedInHost = account.enterpriseHost ?? GITHUB_DOTCOM;
    const ids = await catalogIds();
    const modelIds = ids === void 0 ? void 0 : [...new Set(ids)].sort();
    return {
      ...base,
      authenticated: true,
      state: "authenticated",
      ...signedInHost === base.githubHost ? {} : { signedInHost },
      hiddenModels: [...new Set(deps.config.readHidden())].filter((id) => modelIds === void 0 || modelIds.includes(id)),
      pinnedModels: [...new Set(deps.config.readPinned())],
      ...modelIds === void 0 ? {} : { modelCount: modelIds.length, availableModels: modelIds }
    };
  };
  const schedulePoll = (device, abort) => {
    const current = generation;
    const active = () => current === generation && !disposed && !abort.signal.aborted;
    const deadline = now() + device.expiresIn * 1e3;
    let interval = device.interval;
    flow = { state: "pending", verificationUri: device.verificationUri, userCode: device.userCode, expiresAt: deadline };
    const finish = (state, message) => {
      if (current !== generation) return;
      timer = void 0;
      flow = message === void 0 ? { state } : { state, message };
    };
    const tick = async () => {
      if (current !== generation) return;
      if (now() > deadline) {
        finish("expired", "The device code expired. Start sign-in again.");
        return;
      }
      const result = await deps.pollDeviceFlow(device, abort.signal);
      if (current !== generation) return;
      switch (result.state) {
        case "done": {
          const account = device.domain === GITHUB_DOTCOM ? { token: result.token } : { token: result.token, enterpriseHost: device.domain };
          try {
            await writeBridgeAccount(requireCredentials("signing in"), account, abort.signal);
          } catch (error) {
            if (!active()) return;
            finish("error", errorMessage(error));
            deps.logger.error(error);
            return;
          }
          if (!active()) return;
          await resetHiddenModels();
          if (!active()) return;
          await resetPinnedModels();
          if (!active()) return;
          finish("authenticated");
          deps.logger.info(`GitHub Copilot sign-in at ${device.domain} completed`);
          await bestEffort("Sign-in follow-up failed", () => deps.onSignedIn?.(account));
          return;
        }
        case "expired":
          finish("expired", "The device code expired. Start sign-in again.");
          return;
        case "denied":
          finish("denied", "GitHub authorization was denied.");
          return;
        case "error":
          finish("error", result.message);
          return;
        case "slow-down":
          interval += 5;
          break;
        case "retry":
          break;
      }
      timer = setTimer(() => {
        void tick();
      }, interval * 1e3);
    };
    timer = setTimer(() => {
      void tick();
    }, interval * 1e3);
  };
  const login = async () => {
    if (disposed) throw new Error("GitHub sign-in is disposed");
    const current = generation;
    const host = configuredDomain();
    const account = await readAccount();
    if (current !== generation || disposed || host !== configuredDomain()) throw new Error("GitHub sign-in was cancelled");
    if (account !== void 0) return status();
    if (flow.state === "pending" && now() < flow.expiresAt) return status();
    stopPolling();
    const started = generation;
    const abort = deviceRequest = new AbortController();
    const device = await deps.startDeviceFlow(host, abort.signal);
    if (started !== generation || disposed || host !== configuredDomain()) throw new Error("GitHub sign-in was cancelled");
    schedulePoll(device, abort);
    return status();
  };
  const logout = async () => {
    const credentials = requireCredentials("signing out");
    cancelLogin();
    await deleteBridgeAccount(credentials);
    await resetHiddenModels();
    await resetPinnedModels();
    await bestEffort("Sign-out follow-up failed", () => deps.onSignedOut?.());
    return status();
  };
  const setEnterpriseUrl = async (input) => {
    const host = normalizeEnterpriseDomain(input);
    if (!deps.config.writable()) throw new Error("saving the enterprise URL needs the settings service and a profile entry");
    cancelLogin();
    await deps.config.write(host);
    deps.logger.info(`GitHub host set to ${host ?? GITHUB_DOTCOM}`);
    return status();
  };
  const setHiddenModels = async (input) => {
    const hidden = validateHiddenModels(input);
    if (!deps.config.writable()) throw new Error("saving hidden models needs the settings service and a profile entry");
    const known = await catalogIds();
    if (known !== void 0 && hidden.some((id) => !known.includes(id))) {
      throw new InvalidHiddenModelsError("hiddenModels contains an id not in the account model list");
    }
    await deps.config.writeHidden(hidden.length === 0 ? void 0 : hidden);
    return status();
  };
  const setPinnedModels = async (input) => {
    const pinned = validatePinnedModels(input);
    if (!deps.config.writable()) throw new Error("saving pinned models needs the settings service and a profile entry");
    const known = await catalogIds();
    const saved = new Set(deps.config.readPinned());
    if (pinned.some((id) => !saved.has(id) && !known?.includes(id))) {
      throw new InvalidPinnedModelsError("pinnedModels contains an id not in the supported account model list");
    }
    await deps.config.writePinned(pinned.length === 0 ? void 0 : pinned);
    return status();
  };
  return { status, login, logout, setEnterpriseUrl, setHiddenModels, setPinnedModels, cancelLogin, dispose() {
    disposed = true;
    cancelLogin();
  } };
}

// src/host/transport.ts
import { ProxyAgent } from "undici";
var cache;
function resolveHttpProxy() {
  for (const key of ["https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY"]) {
    const value = process.env[key];
    if (value === void 0 || value.length === 0) continue;
    try {
      const { protocol } = new URL(value);
      if (protocol === "http:" || protocol === "https:") return value;
    } catch {
    }
  }
  return void 0;
}
function isProxyBypassed(hostname) {
  const raw = process.env.no_proxy ?? process.env.NO_PROXY;
  if (raw === void 0 || raw.length === 0) return false;
  const host = hostname.toLowerCase();
  return raw.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean).some((pattern) => {
    if (pattern === "*") return true;
    if (pattern.includes("/")) return false;
    const base = pattern.startsWith(".") ? pattern.slice(1) : pattern;
    return host === base || host.endsWith(`.${base}`);
  });
}
function proxyDispatcher() {
  const url = resolveHttpProxy();
  if (url === void 0) return void 0;
  if (cache?.url !== url) cache = { url, agent: new ProxyAgent(url) };
  return cache.agent;
}
async function githubFetch(url, init = {}) {
  const target = new URL(url);
  const dispatcher = target.protocol === "https:" && !isProxyBypassed(target.hostname) ? proxyDispatcher() : void 0;
  if (dispatcher === void 0) return fetch(url, init);
  return fetch(url, { ...init, dispatcher });
}

// src/host/device-flow.ts
var OAUTH_CLIENT_ID = "Iv1.b507a08c87ecfe98";
var OAUTH_SCOPE = "read:user";
var USER_AGENT = "GitHubCopilotChat/0.35.0";
var CopilotAuthError = class extends Error {
  name = "CopilotAuthError";
  code;
  status;
  constructor(message, code, options) {
    super(message, options?.cause === void 0 ? void 0 : { cause: options.cause });
    this.code = code;
    if (options?.status !== void 0) this.status = options.status;
  }
};
var FORM_HEADERS = {
  accept: "application/json",
  "content-type": "application/x-www-form-urlencoded",
  "user-agent": USER_AGENT
};
async function startDeviceFlow(enterpriseDomain, signal) {
  const domain = enterpriseDomain ?? GITHUB_DOTCOM;
  const urls = deviceFlowUrls(domain);
  let response;
  try {
    response = await githubFetch(urls.deviceCodeUrl, {
      method: "POST",
      headers: FORM_HEADERS,
      body: new URLSearchParams({ client_id: OAUTH_CLIENT_ID, scope: OAUTH_SCOPE }).toString(),
      signal: signal ?? null
    });
  } catch (cause) {
    throw new CopilotAuthError(`failed to start GitHub device authorization at ${domain}`, "TRANSPORT", { cause });
  }
  if (!response.ok) {
    throw new CopilotAuthError(
      `GitHub device authorization at ${domain} failed (HTTP ${response.status})`,
      response.status >= 500 ? "SERVER" : "TRANSPORT",
      { status: response.status }
    );
  }
  const data = await response.json();
  const { device_code: deviceCode, user_code: userCode } = data;
  if (typeof deviceCode !== "string" || deviceCode.length === 0 || typeof userCode !== "string" || userCode.length === 0) {
    throw new CopilotAuthError(`GitHub at ${domain} did not return a device code`, "TRANSPORT");
  }
  return {
    domain,
    deviceCode,
    userCode,
    verificationUri: typeof data.verification_uri === "string" && data.verification_uri.length > 0 ? data.verification_uri : urls.verificationUri,
    interval: Math.max(Number(data.interval) || 5, 1),
    expiresIn: Number(data.expires_in) || 900
  };
}
async function pollDeviceFlow(device, signal) {
  let data;
  try {
    const response = await githubFetch(deviceFlowUrls(device.domain).accessTokenUrl, {
      method: "POST",
      headers: FORM_HEADERS,
      body: new URLSearchParams({
        client_id: OAUTH_CLIENT_ID,
        device_code: device.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      }).toString(),
      signal: signal ?? null
    });
    if (!response.ok) return { state: "retry" };
    data = await response.json();
  } catch {
    return { state: "retry" };
  }
  if (typeof data.access_token === "string" && data.access_token.length > 0) return { state: "done", token: data.access_token };
  switch (data.error) {
    case "authorization_pending":
      return { state: "retry" };
    case "slow_down":
      return { state: "slow-down" };
    case "expired_token":
      return { state: "expired" };
    case "access_denied":
      return { state: "denied" };
    default:
      return { state: "error", message: typeof data.error === "string" ? data.error : "unknown" };
  }
}

// src/host/copilot-usage.ts
var object = (value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
var number = (value) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : void 0;
};
function parseUsage(raw) {
  const data = object(raw);
  const snapshots = object(data?.quota_snapshots);
  const premium = object(snapshots?.premium_interactions);
  const snapshot = premium && (premium.unlimited === true || (number(premium.entitlement) ?? 0) > 0) ? premium : object(snapshots?.chat);
  if (!snapshot) return { state: "unavailable" };
  const unlimited = snapshot.unlimited === true;
  const total = unlimited ? void 0 : number(snapshot.entitlement) || void 0;
  const remaining = number(snapshot.quota_remaining);
  const percentRemaining = number(snapshot.percent_remaining);
  const percentUsed = unlimited ? void 0 : percentRemaining !== void 0 && percentRemaining <= 100 ? 100 - percentRemaining : total !== void 0 && remaining !== void 0 ? Math.max(0, 100 * (1 - remaining / total)) : void 0;
  const used = unlimited ? number(snapshot.credits_used) : total === void 0 ? void 0 : remaining !== void 0 ? Math.max(0, total - remaining) : void 0;
  if (!unlimited && total === void 0 && percentUsed === void 0) return { state: "unavailable" };
  const resetSeconds = number(snapshot.quota_reset_at);
  const resetSource = resetSeconds ? resetSeconds * 1e3 : data?.quota_reset_date_utc ?? data?.quota_reset_date;
  const date = typeof resetSource === "number" || typeof resetSource === "string" ? new Date(resetSource) : void 0;
  const reset = date && Number.isFinite(date.getTime()) ? { at: date.toISOString(), hasTime: !!resetSeconds || typeof data?.quota_reset_date_utc === "string" } : void 0;
  return {
    state: "available",
    unit: data?.token_based_billing === true ? "credits" : "requests",
    unlimited,
    ...total === void 0 ? {} : { total },
    ...used === void 0 ? {} : { used },
    ...percentUsed === void 0 ? {} : { percentUsed },
    ...reset === void 0 ? {} : { reset }
  };
}
function createCopilotUsage(deps) {
  const fetch2 = deps.fetch ?? githubFetch;
  let pending;
  return async () => {
    try {
      const account = await readBridgeAccount(deps.credentials());
      if (!account) {
        pending = void 0;
        return { state: "signed-out" };
      }
      const { token } = account;
      const domain = account.enterpriseHost ?? "github.com";
      if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/.test(domain)) return { state: "unavailable" };
      if (pending?.token === token && pending.domain === domain) return pending.value;
      const entry = { token, domain, value: Promise.resolve({ state: "unavailable" }) };
      pending = entry;
      entry.value = (async () => {
        try {
          const response = await fetch2(`https://api.${domain}/copilot_internal/user`, {
            headers: {
              Accept: "application/json",
              Authorization: `token ${token}`,
              "X-GitHub-Api-Version": "2025-04-01",
              "User-Agent": "GitHubCopilotChat/0.35.0",
              "Editor-Version": "vscode/1.107.0",
              "Editor-Plugin-Version": "copilot-chat/0.35.0"
            },
            redirect: "error",
            signal: AbortSignal.timeout(5e3)
          });
          if (!response.ok) return { state: "unavailable" };
          const result = parseUsage(await response.json());
          const current = await readBridgeAccount(deps.credentials());
          if (!current) return { state: "signed-out" };
          if (current.token !== token || (current.enterpriseHost ?? "github.com") !== domain) return { state: "unavailable" };
          return result;
        } catch {
          return { state: "unavailable" };
        } finally {
          if (pending === entry) pending = void 0;
        }
      })();
      return entry.value;
    } catch {
      return { state: "unavailable" };
    }
  };
}

// src/host/copilot-metadata.ts
import { attributionHeaders as attributionHeaders2 } from "@deepseek-ai/dsh-llm";

// src/host/access-token.ts
import { attributionHeaders } from "@deepseek-ai/dsh-llm";

// src/host/copilot-headers.ts
var COPILOT_EDITOR_HEADERS = {
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Copilot-Integration-Id": "vscode-chat"
};
var COPILOT_USER_AGENT = "GitHubCopilotChat/0.35.0";

// src/host/access-token.ts
var AccessTokenError = class extends Error {
  name = "AccessTokenError";
  reason;
  status;
  constructor(reason, message, status) {
    super(message);
    this.reason = reason;
    this.status = status;
  }
};
var COPILOT_HEADERS = {
  Accept: "application/json",
  "user-agent": COPILOT_USER_AGENT,
  ...COPILOT_EDITOR_HEADERS
};
var DEFAULT_REFRESH_MS = 30 * 6e4;
var EXPIRY_MARGIN_MS = 6e4;
var RETRY_MS = 6e4;
var MIN_DELAY_MS = 1e3;
var HOST_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/;
function allowedBaseUrl(raw, enterpriseHost) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return void 0;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return void 0;
  if (url.pathname !== "/" && url.pathname !== "") return void 0;
  const host = url.hostname;
  const allowed = host === "api.githubcopilot.com" || /^api\.[a-z0-9-]+\.githubcopilot\.com$/.test(host) || enterpriseHost !== void 0 && host === `copilot-api.${enterpriseHost}`;
  return allowed ? `https://${host}` : void 0;
}
var object2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
var positive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : void 0;
function createAccessTokens(deps) {
  const fetch2 = deps.fetch ?? githubFetch;
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimeout ?? ((callback, ms) => {
    const handle = setTimeout(callback, ms);
    handle.unref();
    return handle;
  });
  const clearTimer = deps.clearTimeout ?? ((handle) => clearTimeout(handle));
  const timeoutMs = deps.timeoutMs ?? 1e4;
  const listeners = /* @__PURE__ */ new Set();
  let cached;
  let inflight;
  let timer;
  let epoch = 0;
  let generation = 0;
  let accountGeneration = 0;
  let accountKey;
  let accountAbort = new AbortController();
  let exchanged = false;
  let disposed = false;
  const keyOf = (account) => `${account.enterpriseHost ?? ""}
${account.token}`;
  function cancelTimer() {
    if (timer !== void 0) clearTimer(timer);
    timer = void 0;
  }
  function schedule(ms) {
    cancelTimer();
    timer = setTimer(() => {
      timer = void 0;
      void refresh();
    }, Math.max(MIN_DELAY_MS, ms));
  }
  async function request(account, signal) {
    const host = account.enterpriseHost?.toLowerCase();
    if (host !== void 0 && !HOST_PATTERN.test(host)) throw new AccessTokenError("invalid-host", "Invalid GitHub Enterprise host");
    let response;
    try {
      response = await fetch2(`https://api.${host ?? "github.com"}/copilot_internal/v2/token`, {
        headers: { ...COPILOT_HEADERS, Authorization: `Bearer ${account.token}`, ...attributionHeaders() },
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      });
    } catch {
      if (signal.aborted) throw new AccessTokenError("reset", "Copilot token exchange was discarded");
      throw new AccessTokenError("exchange-failed", "Copilot token exchange failed");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AccessTokenError("exchange-failed", `Copilot token exchange failed with HTTP ${response.status}`, response.status);
    }
    let raw;
    try {
      raw = object2(await response.json());
    } catch {
      raw = void 0;
    }
    const token = raw?.token;
    const expiresAt = positive(raw?.expires_at);
    if (typeof token !== "string" || token.length === 0 || expiresAt === void 0) {
      throw new AccessTokenError("invalid-response", "Invalid Copilot token exchange response");
    }
    const api = object2(raw?.endpoints)?.api;
    const candidate = typeof api === "string" ? api : host === void 0 ? "https://api.individual.githubcopilot.com" : `https://copilot-api.${host}`;
    const baseUrl = allowedBaseUrl(candidate, host);
    if (baseUrl === void 0) throw new AccessTokenError("disallowed-endpoint", "Copilot API endpoint is not allowed");
    const refreshIn = positive(raw?.refresh_in);
    return { token, baseUrl, expiresAt: expiresAt * 1e3, refreshMs: refreshIn === void 0 ? DEFAULT_REFRESH_MS : refreshIn * 1e3 };
  }
  function exchange(account, key) {
    if (inflight?.key === key) return inflight.promise;
    inflight?.controller.abort();
    const entry = { key, controller: new AbortController(), promise: Promise.resolve() };
    inflight = entry;
    entry.promise = (async () => {
      try {
        const result = await request(account, entry.controller.signal);
        if (inflight !== entry) throw new AccessTokenError("reset", "Copilot token exchange was discarded");
        const value = {
          token: result.token,
          baseUrl: result.baseUrl,
          expiresAt: result.expiresAt,
          generation: ++generation,
          accountGeneration,
          signal: accountAbort.signal
        };
        cached = { key, value };
        schedule(Math.min(result.refreshMs, result.expiresAt - now() - EXPIRY_MARGIN_MS));
        const replacement = exchanged;
        exchanged = true;
        if (replacement) {
          for (const listener of [...listeners]) {
            try {
              listener(value);
            } catch (error) {
              deps.logger?.warn(`Copilot access-token refresh listener failed: ${error instanceof Error ? error.name : "error"}`);
            }
          }
        }
        return value;
      } finally {
        if (inflight === entry) inflight = void 0;
      }
    })();
    return entry.promise;
  }
  async function refresh() {
    const started = epoch;
    try {
      const account = await deps.readAccount();
      if (started !== epoch || !account?.token || cached?.key !== keyOf(account)) return;
      await exchange(account, keyOf(account));
    } catch (error) {
      if (started !== epoch || error instanceof AccessTokenError && error.reason === "reset") return;
      deps.logger?.warn(`Copilot access-token refresh failed: ${error instanceof AccessTokenError ? error.message : "unexpected error"}`);
      if (timer === void 0) schedule(RETRY_MS);
    }
  }
  function abortable(promise, signal) {
    if (signal === void 0) return promise;
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
  }
  function reset() {
    epoch++;
    accountAbort.abort(new Error("Copilot account changed"));
    accountAbort = new AbortController();
    accountKey = void 0;
    inflight?.controller.abort();
    inflight = void 0;
    cached = void 0;
    exchanged = false;
    cancelTimer();
  }
  return {
    async current(signal) {
      if (disposed) throw new AccessTokenError("disposed", "Copilot access tokens are disposed");
      signal?.throwIfAborted();
      const started = epoch;
      const account = await abortable(deps.readAccount(), signal);
      if (started !== epoch) throw new AccessTokenError("reset", "Copilot account changed");
      if (!account?.token) {
        reset();
        throw new AccessTokenError("signed-out", "Not signed in to GitHub Copilot");
      }
      const key = keyOf(account);
      if (accountKey !== key) {
        accountAbort.abort(new Error("Copilot account changed"));
        accountAbort = new AbortController();
        accountKey = key;
        accountGeneration++;
      }
      if (cached?.key === key && cached.value.expiresAt - now() > EXPIRY_MARGIN_MS) return cached.value;
      if (cached?.key !== key) {
        cached = void 0;
        cancelTimer();
      }
      return abortable(exchange(account, key), signal);
    },
    invalidate(token) {
      if (cached?.value.generation !== token.generation) return;
      cached = void 0;
      cancelTimer();
    },
    onRefresh(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset,
    dispose() {
      disposed = true;
      reset();
      listeners.clear();
    }
  };
}

// src/host/copilot-metadata.ts
var object3 = (value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
var number2 = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
var text = (value) => typeof value === "string" && value.trim().length > 0 ? value.slice(0, 2e3) : void 0;
function prices(value, batch) {
  const tier = object3(value);
  const result = {};
  for (const [field, raw] of [
    ["input", tier?.input_price],
    ["output", tier?.output_price],
    ["cacheRead", tier?.cache_read_price ?? tier?.cache_price],
    ["cacheWrite", tier?.cache_write_price]
  ]) {
    const amount = number2(raw);
    const perMillion = amount === void 0 ? void 0 : amount * (1e6 / batch);
    if (perMillion !== void 0 && Number.isFinite(perMillion)) result[field] = perMillion;
  }
  return Object.keys(result).length > 0 ? result : void 0;
}
function retirement(row) {
  const warnings = object3(row.warning_text);
  const messages = [row.warning_messages, row.info_messages].flatMap((value) => Array.isArray(value) ? value : []);
  for (const code of ["model_pending_deprecation", "model_deprecated"]) {
    if (warnings && Object.hasOwn(warnings, code)) return text(warnings[code]) ?? "This model is retiring.";
    const message = messages.map(object3).find((item) => item?.code === code);
    if (message) return text(message.message) ?? "This model is retiring.";
  }
  return void 0;
}
function parseCatalog(raw, now) {
  const data = object3(raw)?.data;
  if (!Array.isArray(data)) return /* @__PURE__ */ new Map();
  const result = /* @__PURE__ */ new Map();
  for (const value of data) {
    const row = object3(value);
    if (typeof row?.id !== "string") continue;
    const billing = object3(row.billing);
    const tiers = object3(billing?.token_prices);
    const batch = number2(tiers?.batch_size);
    const pricing = batch ? prices(tiers?.default, batch) : void 0;
    const longContextPricing = batch ? prices(tiers?.long_context, batch) : void 0;
    const defaultTier = object3(tiers?.default);
    const defaultContextMax = number2(defaultTier?.max_prompt_tokens ?? defaultTier?.context_max);
    const promo = object3(billing?.promo);
    const discount = number2(promo?.discount_percent);
    const endsAt = text(promo?.ends_at);
    const validExpiry = promo?.ends_at === void 0 || endsAt !== void 0 && Date.parse(endsAt) > now;
    const message = text(promo?.message);
    const retiring = retirement(row);
    result.set(row.id, {
      ...retiring === void 0 ? {} : { retiring },
      ...pricing === void 0 ? {} : { pricing },
      ...longContextPricing === void 0 ? {} : { longContextPricing },
      ...defaultContextMax === void 0 ? {} : { defaultContextMax },
      ...discount === void 0 || discount <= 0 || discount > 100 || !validExpiry ? {} : {
        promotion: { discountPercent: discount, ...message === void 0 ? {} : { message }, ...endsAt === void 0 ? {} : { endsAt } }
      }
    });
  }
  return result;
}
function modelsUrl(token, enterprise) {
  const proxy = token.match(/(?:^|;)proxy-ep=([^;]+)/)?.[1]?.replace(/^proxy\./, "api.");
  if (proxy && /^api(?:\.[a-z0-9-]+)?\.githubcopilot\.com$/.test(proxy)) return `https://${proxy}/models`;
  if (enterprise !== void 0 && /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/.test(enterprise)) {
    return `https://copilot-api.${enterprise}/models`;
  }
  return "https://api.individual.githubcopilot.com/models";
}
function createCopilotMetadata(deps) {
  const now = deps.now ?? Date.now;
  const fetch2 = deps.fetch ?? githubFetch;
  let cache2;
  return async () => {
    try {
      const account = await readBridgeAccount(deps.credentials());
      const access = account === void 0 ? void 0 : await deps.accessToken?.();
      const expires = number2(access?.expiresAt);
      if (account === void 0 || typeof access?.token !== "string" || !access.token || access.signal?.aborted || expires === void 0 || expires <= now()) {
        cache2 = void 0;
        return /* @__PURE__ */ new Map();
      }
      const { token } = access;
      const baseUrl = access.baseUrl === void 0 ? void 0 : allowedBaseUrl(access.baseUrl, account.enterpriseHost);
      if (access.baseUrl !== void 0 && baseUrl === void 0) return /* @__PURE__ */ new Map();
      const url = baseUrl === void 0 ? modelsUrl(token, account.enterpriseHost) : `${baseUrl}/models`;
      if (cache2?.token === token && cache2.url === url && cache2.signal === access.signal && cache2.expiresAt > now()) return cache2.value;
      const entry = { token, url, signal: access.signal, expiresAt: Math.min(now() + 3e5, expires), value: Promise.resolve(/* @__PURE__ */ new Map()) };
      cache2 = entry;
      entry.value = (async () => {
        try {
          const response = await fetch2(url, {
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${token}`,
              ...COPILOT_EDITOR_HEADERS,
              "X-GitHub-Api-Version": "2026-06-01",
              ...attributionHeaders2()
            },
            redirect: "error",
            signal: access.signal ? AbortSignal.any([access.signal, AbortSignal.timeout(5e3)]) : AbortSignal.timeout(5e3)
          });
          if (!response.ok) throw new Error("Copilot metadata unavailable");
          const result = parseCatalog(await response.json(), now());
          if (access.signal?.aborted) return /* @__PURE__ */ new Map();
          for (const model of result.values()) {
            if (model.promotion?.endsAt) entry.expiresAt = Math.min(entry.expiresAt, Date.parse(model.promotion.endsAt));
          }
          return result;
        } catch {
          entry.expiresAt = Math.min(entry.expiresAt, now() + 3e4);
          return /* @__PURE__ */ new Map();
        }
      })();
      return entry.value;
    } catch {
      cache2 = void 0;
      return /* @__PURE__ */ new Map();
    }
  };
}

// src/host/model-catalog.ts
async function modelCatalog(status, catalog, metadata, vision = true) {
  const snapshot = catalog?.snapshot();
  const display = status.authenticated && snapshot?.models.length ? await metadata?.() : void 0;
  const models = status.authenticated && snapshot === catalog?.snapshot() ? (snapshot?.models ?? []).map((model) => ({
    ...display?.get(model.id),
    id: model.id,
    name: model.name,
    ...model.protocol === void 0 ? {} : { protocol: model.protocol },
    ...model.disabledReason === void 0 ? {} : { disabledReason: model.disabledReason },
    ...model.contextWindow === void 0 ? {} : { contextWindow: model.contextWindow },
    inputModalities: model.input.filter((input) => input !== "image" || vision)
  })) : [];
  const state = status.authenticated ? catalog?.state() ?? { status: "loading" } : { status: "ready" };
  return { status, models: pinnedFirst(models, status.pinnedModels ?? []), state: state.status, ...state.status === "error" ? { error: state.error } : {} };
}

// src/host/routes.ts
var errorMessage2 = (error) => error instanceof Error ? error.message : String(error);
function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
function route(action) {
  return async (request) => {
    try {
      return json(200, { ok: true, value: await action(request) });
    } catch (error) {
      return json(error instanceof InvalidHiddenModelsError || error instanceof InvalidPinnedModelsError ? 400 : 500, { ok: false, error: errorMessage2(error) });
    }
  };
}
async function readEnterpriseUrlRequest(request) {
  const body = await request.json();
  const value = typeof body === "object" && body !== null ? body.enterpriseUrl : void 0;
  if (typeof value !== "string") throw new Error('request body must be {"enterpriseUrl": string}');
  return value;
}
function authRoutes(auth, catalog, metadata, usage = async () => ({ state: "unavailable" }), vision = () => true) {
  return [
    { path: `${API_BASE}/usage`, methods: ["GET"], requestBody: "buffered", fetch: route(() => usage()) },
    { path: `${API_BASE}/status`, methods: ["GET"], requestBody: "buffered", fetch: route(() => auth.status()) },
    { path: `${API_BASE}/models`, methods: ["GET"], requestBody: "buffered", fetch: route(async () => modelCatalog(await auth.status(), catalog, metadata, vision())) },
    { path: `${API_BASE}/models/refresh`, methods: ["POST"], requestBody: "buffered", fetch: route(async () => {
      if ((await auth.status()).authenticated) await catalog?.refresh().catch(() => {
      });
      return modelCatalog(await auth.status(), catalog, metadata, vision());
    }) },
    { path: `${API_BASE}/login`, methods: ["POST"], requestBody: "buffered", fetch: route(() => auth.login()) },
    { path: `${API_BASE}/logout`, methods: ["POST"], requestBody: "buffered", fetch: route(() => auth.logout()) },
    {
      path: `${API_BASE}/enterprise-url`,
      methods: ["POST"],
      requestBody: "buffered",
      fetch: route(async (request) => auth.setEnterpriseUrl(await readEnterpriseUrlRequest(request)))
    },
    {
      path: `${API_BASE}/pinned-models`,
      methods: ["POST"],
      requestBody: "buffered",
      fetch: route(async (request) => {
        let body;
        try {
          body = await request.json();
        } catch {
          throw new InvalidPinnedModelsError('request body must be {"pinnedModels": string[]}');
        }
        return auth.setPinnedModels(typeof body === "object" && body !== null && "pinnedModels" in body ? body.pinnedModels : void 0);
      })
    },
    {
      path: `${API_BASE}/hidden-models`,
      methods: ["POST"],
      requestBody: "buffered",
      fetch: route(async (request) => {
        let body;
        try {
          body = await request.json();
        } catch {
          throw new InvalidHiddenModelsError('request body must be {"hiddenModels": string[]}');
        }
        return auth.setHiddenModels(typeof body === "object" && body !== null && "hiddenModels" in body ? body.hiddenModels : void 0);
      })
    }
  ];
}

// src/host/live-catalog.ts
import { attributionHeaders as attributionHeaders3 } from "@deepseek-ai/dsh-llm";
var PROTOCOLS = [
  ["/v1/messages", "anthropic-messages"],
  ["/responses", "openai-responses"],
  ["/chat/completions", "openai-completions"]
];
var object4 = (value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
var text2 = (value) => typeof value === "string" && value.trim().length > 0 ? value : void 0;
var count = (value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : void 0;
var strings = (value) => Array.isArray(value) ? [...new Set(value.filter((item) => text2(item) !== void 0))] : [];
function projectModel(value) {
  const row = object4(value);
  const id = text2(row?.id);
  const capabilities = object4(row?.capabilities);
  const endpoints = strings(row?.supported_endpoints);
  if (row === void 0 || id === void 0 || capabilities?.type !== "chat" || endpoints.length === 0) return void 0;
  const supports = object4(capabilities.supports);
  const limits = object4(capabilities.limits);
  const contextWindow = count(limits?.max_context_window_tokens) ?? count(limits?.max_prompt_tokens);
  const maxOutputTokens = count(limits?.max_output_tokens);
  const base = {
    id,
    name: text2(row.name) ?? id,
    input: supports?.vision === true ? ["text", "image"] : ["text"],
    ...contextWindow === void 0 ? {} : { contextWindow },
    ...maxOutputTokens === void 0 ? {} : { maxOutputTokens },
    reasoningEfforts: strings(supports?.reasoning_effort)
  };
  const protocol = PROTOCOLS.find(([endpoint]) => endpoints.includes(endpoint))?.[1];
  if (protocol === void 0) return { ...base, supported: false, disabledReason: "unsupported-protocol" };
  if (row.model_picker_enabled === false) return { ...base, supported: false, disabledReason: "not-offered", protocol };
  return { ...base, supported: true, protocol };
}
var CatalogError = class extends Error {
};
function projectCatalog(payload) {
  const data = object4(payload)?.data;
  if (!Array.isArray(data)) throw new CatalogError("Copilot model catalog response is invalid");
  return data.flatMap((value) => projectModel(value) ?? []);
}
var COPILOT_HEADERS2 = {
  Accept: "application/json",
  "user-agent": COPILOT_USER_AGENT,
  ...COPILOT_EDITOR_HEADERS,
  "X-GitHub-Api-Version": "2026-06-01"
};
var cancelled = () => new CatalogError("Copilot model discovery was cancelled");
function modelsUrl2(baseUrl) {
  let url;
  try {
    url = new URL(`${baseUrl.replace(/\/+$/, "")}/models`);
  } catch {
    throw new CatalogError("Copilot API base URL is invalid");
  }
  if (url.protocol !== "https:") throw new CatalogError("Copilot API base URL must use HTTPS");
  return url.href;
}
function createLiveCatalog(deps) {
  const fetch2 = deps.fetch ?? githubFetch;
  const timeoutMs = deps.timeoutMs ?? 15e3;
  const listeners = /* @__PURE__ */ new Set();
  let current;
  let status = { status: "loading" };
  let inFlight;
  let epoch = 0;
  let disposed = false;
  const emit = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        deps.logger.warn("Copilot catalog listener failed");
      }
    }
  };
  async function discover(abort, started) {
    const live = () => {
      if (started !== epoch) throw cancelled();
    };
    try {
      let access = await deps.token();
      for (; ; ) {
        live();
        const url = modelsUrl2(access.baseUrl);
        const response = await fetch2(url, {
          headers: { ...COPILOT_HEADERS2, Authorization: `Bearer ${access.token}`, ...attributionHeaders3() },
          redirect: "error",
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(timeoutMs)])
        });
        live();
        if (!response.ok) throw new CatalogError(`Copilot model discovery failed (HTTP ${response.status})`);
        const payload = await response.json().catch(() => void 0);
        live();
        const models = projectCatalog(payload);
        const latest = await deps.token();
        live();
        if (latest.generation !== access.generation) {
          access = latest;
          continue;
        }
        const snapshot = { generation: access.generation, models };
        current = snapshot;
        status = { status: "ready" };
        emit();
        return snapshot;
      }
    } catch (error) {
      if (started !== epoch) throw cancelled();
      const message = error instanceof CatalogError ? error.message : "Copilot model discovery failed";
      deps.logger.warn(message);
      status = { status: "error", error: message };
      emit();
      throw new Error(message);
    } finally {
      if (inFlight?.abort === abort) inFlight = void 0;
    }
  }
  function refresh() {
    if (disposed) return Promise.reject(new Error("Copilot model catalog is disposed"));
    if (inFlight) return inFlight.promise;
    const abort = new AbortController();
    const previous = status;
    status = { status: "loading" };
    const promise = discover(abort, epoch);
    inFlight = { promise, abort };
    if (previous.status !== "loading") emit();
    return promise;
  }
  function reset() {
    epoch++;
    inFlight?.abort.abort(cancelled());
    inFlight = void 0;
    const changed = current !== void 0 || status.status !== "loading";
    current = void 0;
    status = { status: "loading" };
    if (changed) emit();
  }
  return {
    refresh,
    async ready() {
      const started = epoch;
      if (!inFlight && current) return current;
      try {
        const snapshot = await refresh();
        if (started !== epoch) throw cancelled();
        return snapshot;
      } catch (error) {
        if (started !== epoch) throw cancelled();
        if (current) return current;
        throw error;
      }
    },
    snapshot: () => current,
    state: () => status,
    reset,
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      listeners.clear();
      reset();
      disposed = true;
    }
  };
}

// src/host/bridge-adapter.ts
import {
  attributionHeaders as attributionHeaders4,
  fileHandleText,
  LlmAdapter,
  LlmError,
  offloadedImageText,
  ReasoningEffortId,
  textOnlyImageText,
  ToolCallId
} from "@deepseek-ai/dsh-llm";
import { stream as anthropicMessages, streamSimple as anthropicMessagesSimple } from "@earendil-works/pi-ai/api/anthropic-messages";
import { streamSimple as openaiCompletions } from "@earendil-works/pi-ai/api/openai-completions";
import { streamSimple as openaiResponses } from "@earendil-works/pi-ai/api/openai-responses";
var BRIDGE_PROVIDER2 = "copilot-bridge";
var BRIDGE_PROVIDER_NAME = "GitHub Copilot Bridge";
var DEFAULT_TRANSPORTS = {
  "anthropic-messages": (model, context, options) => {
    const anthropicModel = model;
    return options.reasoning === void 0 && ANTHROPIC_THINKING_POLICY[model.id] === "always-adaptive" ? anthropicMessages(anthropicModel, context, { ...options, thinkingEnabled: true }) : anthropicMessagesSimple(anthropicModel, context, options);
  },
  "openai-responses": openaiResponses,
  "openai-completions": openaiCompletions
};
var COPILOT_HEADERS3 = {
  "User-Agent": COPILOT_USER_AGENT,
  ...COPILOT_EDITOR_HEADERS
};
var THINKING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"];
var ANTHROPIC_ADAPTIVE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
var FALLBACK_MAX_TOKENS = 16384;
var ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
var ANTHROPIC_THINKING_POLICY = {
  "claude-fable-5": "always-adaptive",
  "claude-fable-5.1": "always-adaptive",
  "claude-haiku-5.5": "adaptive",
  "claude-opus-4.7": "adaptive",
  "claude-opus-4.8": "adaptive",
  "claude-opus-5": "adaptive",
  "claude-opus-5.5": "always-adaptive",
  "claude-sonnet-4.6": "adaptive",
  "claude-sonnet-5": "adaptive",
  "claude-sonnet-5.5": "always-adaptive"
};
var capitalize = (value) => value.charAt(0).toUpperCase() + value.slice(1);
var aborted = () => new LlmError("Copilot request aborted by caller", "ABORTED");
function waitFor(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(aborted());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then((value) => {
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    }, (error) => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
  });
}
function supportedEfforts(model) {
  const levels = model.protocol === "anthropic-messages" && Object.hasOwn(ANTHROPIC_THINKING_POLICY, model.id) ? ANTHROPIC_ADAPTIVE_EFFORTS : THINKING_LEVELS;
  return levels.filter((level) => model.reasoningEfforts.includes(level));
}
function modelInfo(model, vision) {
  return { provider: BRIDGE_PROVIDER2, id: model.id, name: model.name, inputModalities: model.input.filter((input) => input !== "image" || vision) };
}
function resolvedInfo(model, vision) {
  const efforts = supportedEfforts(model);
  return {
    ...modelInfo(model, vision),
    ...model.contextWindow === void 0 ? {} : { context: { contextWindow: model.contextWindow } },
    ...efforts.length === 0 ? {} : {
      reasoning: { efforts: efforts.map((level) => ({ id: ReasoningEffortId(level), name: capitalize(level) })) }
    }
  };
}
function piModel(model, baseUrl) {
  const efforts = supportedEfforts(model);
  const thinking = model.protocol === "anthropic-messages" && Object.hasOwn(ANTHROPIC_THINKING_POLICY, model.id) ? ANTHROPIC_THINKING_POLICY[model.id] : void 0;
  return {
    id: model.id,
    name: model.name,
    api: model.protocol,
    provider: "github-copilot",
    baseUrl,
    input: [...model.input],
    cost: ZERO_COST,
    headers: { ...COPILOT_HEADERS3 },
    reasoning: efforts.length > 0 || thinking === "always-adaptive",
    ...thinking === void 0 ? {} : { compat: { forceAdaptiveThinking: true } },
    // Unadvertised levels map to `null` so pi-ai never clamps onto an invented level.
    thinkingLevelMap: Object.fromEntries(THINKING_LEVELS.map((level) => [level, efforts.includes(level) ? level : null])),
    contextWindow: model.contextWindow ?? 0,
    maxTokens: model.maxOutputTokens ?? FALLBACK_MAX_TOKENS
  };
}
function tokenError(error) {
  if (error instanceof AccessTokenError) {
    return error.reason === "signed-out" ? new LlmError("Sign in to GitHub Copilot to use this model", "MISSING_CREDENTIAL") : new LlmError(error.message, "AUTH", { cause: error });
  }
  return new LlmError("Copilot access token is unavailable", "AUTH");
}
var emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { ...ZERO_COST, total: 0 } });
function mapUsage(usage) {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.totalTokens,
    ...usage.cacheRead > 0 ? { cacheReadTokens: usage.cacheRead } : {},
    ...usage.cacheWrite > 0 ? { cacheWriteTokens: usage.cacheWrite } : {}
  };
}
function failureOf(message, status, aborted2) {
  const code = aborted2 ? "ABORTED" : classify(message, status);
  const leading = /^\D{0,40}?\b([45]\d\d)\b/.exec(message);
  const httpStatus = status !== void 0 && status >= 400 ? status : leading ? Number(leading[1]) : void 0;
  const diagnostics = {
    ABORTED: "Copilot request aborted",
    AUTH: "Copilot authentication failed; sign in again",
    CONTEXT_WINDOW_EXCEEDED: "Copilot model context window exceeded",
    QUOTA: "Copilot quota exceeded",
    RATE_LIMIT: "Copilot rate limit exceeded; retry later",
    INVALID_REQUEST: "Copilot rejected the request",
    SERVER: "Copilot service failed; retry later",
    TIMEOUT: "Copilot request timed out",
    TRANSPORT: "Copilot connection failed"
  };
  return { message: diagnostics[code] ?? "Copilot request failed", code, ...httpStatus === void 0 ? {} : { status: httpStatus } };
}
function classify(message, status) {
  const text3 = message.toLowerCase();
  const code = status !== void 0 && status >= 400 ? status : Number(/^\D{0,40}?\b([45]\d\d)\b/.exec(message)?.[1] ?? 0);
  if (/context[\s_-](length|window)|too (long|large) for/.test(text3)) return "CONTEXT_WINDOW_EXCEEDED";
  if (code === 401 || code === 403) return "AUTH";
  if (/insufficient[\s_-]+quota|quota[\s_-]+exceeded/.test(text3)) return "QUOTA";
  if (code === 429 || text3.includes("rate limit")) return "RATE_LIMIT";
  if (code === 400 || code === 413 || code === 422) return "INVALID_REQUEST";
  if (code >= 500) return "SERVER";
  if (text3.includes("timeout") || text3.includes("timed out")) return "TIMEOUT";
  if (/stream ended|network|socket|terminated|econnreset|fetch failed/.test(text3)) return "TRANSPORT";
  return "PI_AI_ERROR";
}
function isUnauthorized(status, message) {
  return status === 401 || status === void 0 && /^\D{0,40}?\b401\b/.test(message ?? "");
}
function parseArguments(raw) {
  try {
    const value = JSON.parse(raw);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
function replayed(source, model) {
  const replay = source?.replayState?.response;
  if (typeof replay !== "object" || replay === null) return void 0;
  const message = replay;
  return message.role === "assistant" && message.provider === "github-copilot" && message.api === model.protocol && message.model === model.id && Array.isArray(message.content) ? message : void 0;
}
var textOf = (content) => content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
function toTool(tool) {
  return { name: tool.name, description: tool.description, parameters: tool.parameters };
}
async function toContext(options, model, deps) {
  const vision = model.input.includes("image");
  const toolNames = /* @__PURE__ */ new Map();
  const system = options.system ? [options.system] : [];
  const messages = [];
  let leading = true;
  async function parts(content) {
    const result = [];
    for (const block of content) {
      if (block.type === "text") result.push({ type: "text", text: block.text });
      else if (block.type === "file") result.push({ type: "text", text: fileHandleText(block.attachment, void 0) });
      else if (block.type === "image") {
        if (block.offloaded) result.push({ type: "text", text: offloadedImageText(block.attachment) });
        else if (!vision) result.push({ type: "text", text: textOnlyImageText(block.attachment) });
        else {
          const loadImage = deps.loadImage;
          if (!loadImage) throw new LlmError("Image input is not available for this route", "UNSUPPORTED_CONTENT");
          const image = await loadImage(block.attachment, options.signal);
          result.push({ type: "image", data: image.data, mimeType: image.mimeType });
        }
      }
    }
    return result;
  }
  for (const message of options.messages) {
    const timestamp = Date.now();
    if (message.role === "system" || message.role === "developer") {
      const text3 = textOf(message.content);
      if (leading && message.role === "system") {
        if (text3) system.push(text3);
      } else if (text3) messages.push({ role: "system", content: text3, timestamp });
      continue;
    }
    leading = false;
    if (message.role === "user") {
      messages.push({ role: "user", content: await parts(message.content), timestamp });
    } else if (message.role === "assistant") {
      for (const block of message.content) if (block.type === "tool-call") toolNames.set(block.id, block.name);
      const replay = replayed(message.source, model);
      if (replay) {
        messages.push(replay);
        continue;
      }
      const content = message.content.flatMap((block) => block.type === "text" ? [{ type: "text", text: block.text }] : block.type === "tool-call" ? [{ type: "toolCall", id: block.id, name: block.name, arguments: parseArguments(block.arguments) }] : []);
      messages.push({
        role: "assistant",
        content,
        api: model.protocol,
        provider: "github-copilot",
        model: model.id,
        usage: emptyUsage(),
        stopReason: content.some((block) => block.type === "toolCall") ? "toolUse" : "stop",
        timestamp
      });
    } else if (message.role === "tool") {
      messages.push({
        role: "toolResult",
        toolCallId: message.toolCallId,
        toolName: toolNames.get(message.toolCallId) ?? "",
        content: await parts(message.content),
        isError: message.isError === true,
        timestamp
      });
    }
  }
  const tools = (options.tools ?? []).map(toTool);
  const prompt = system.join("\n\n");
  const head = prompt || tools.length > 0 ? [{ role: "system", content: prompt, ...tools.length > 0 ? { toolsAdded: tools } : {}, timestamp: 0 }] : [];
  return { messages: [...head, ...messages] };
}
var ChunkMapper = class {
  toolIds = /* @__PURE__ */ new Map();
  blocks = 0;
  malformedTool = false;
  map(event, aborted2, status) {
    switch (event.type) {
      case "text_start":
        return [{ type: "block-start", index: event.contentIndex, blockType: "text" }];
      case "text_delta":
        return [{ type: "text-delta", index: event.contentIndex, text: event.delta }];
      case "text_end":
        this.blocks++;
        return [{ type: "block-end", index: event.contentIndex, block: { type: "text", text: event.content } }];
      case "thinking_start":
        return [{ type: "block-start", index: event.contentIndex, blockType: "reasoning" }];
      case "thinking_delta":
        return [{ type: "reasoning-delta", index: event.contentIndex, text: event.delta }];
      case "thinking_end":
        this.blocks++;
        return [{ type: "block-end", index: event.contentIndex, block: { type: "reasoning", text: event.content } }];
      case "toolcall_start": {
        const call = event.partial.content[event.contentIndex];
        const id = ToolCallId(call?.type === "toolCall" ? call.id : `call_${event.contentIndex}`);
        this.toolIds.set(event.contentIndex, id);
        return [{ type: "block-start", index: event.contentIndex, blockType: "tool-call" }];
      }
      case "toolcall_delta": {
        const call = event.partial.content[event.contentIndex];
        const id = this.toolIds.get(event.contentIndex) ?? ToolCallId(call?.type === "toolCall" ? call.id : `call_${event.contentIndex}`);
        return [{
          type: "tool-call-delta",
          index: event.contentIndex,
          id,
          ...call?.type === "toolCall" && call.name ? { name: call.name } : {},
          argumentsDelta: event.delta
        }];
      }
      case "toolcall_end":
        if (event.toolCall.argumentsError) {
          this.malformedTool = true;
          return [];
        }
        this.blocks++;
        return [{
          type: "block-end",
          index: event.contentIndex,
          block: { type: "tool-call", id: ToolCallId(event.toolCall.id), name: event.toolCall.name, arguments: JSON.stringify(event.toolCall.arguments) }
        }];
      case "done":
        return [{ type: "usage", usage: mapUsage(event.message.usage) }, { type: "finish", ...this.finish(event.message) }];
      case "error": {
        const failure = failureOf(event.error.errorMessage ?? "", status(), event.reason === "aborted" || aborted2());
        const reason = failure.code === "ABORTED" ? { kind: "aborted", failure } : { kind: "error", failure };
        return [{ type: "usage", usage: mapUsage(event.error.usage ?? emptyUsage()) }, { type: "finish", reason }];
      }
      default:
        return [];
    }
  }
  finish(message) {
    if (message.stopReason === "length") return { reason: { kind: "max-tokens" }, replayState: { response: message } };
    if (this.malformedTool) {
      return { reason: { kind: "error", failure: { message: "Copilot returned malformed tool arguments", code: "MALFORMED_RESPONSE" } } };
    }
    if (message.stopReason === "toolUse") return { reason: { kind: "tool-calls" }, replayState: { response: message } };
    if (this.blocks === 0) {
      return { reason: { kind: "error", failure: { message: "Copilot returned an empty response", code: "EMPTY_RESPONSE" } } };
    }
    return { reason: { kind: "stop" }, replayState: { response: message } };
  }
};
var BridgeAdapter = class extends LlmAdapter {
  deps;
  transports;
  constructor(deps) {
    super();
    this.deps = deps;
    this.transports = { ...DEFAULT_TRANSPORTS, ...deps.transports };
  }
  providerInfo(provider) {
    return { id: provider, name: BRIDGE_PROVIDER_NAME };
  }
  /** Visible models: supported − hidden; disabled models never appear. Empty while signed out or undiscovered. */
  async listModels(_provider) {
    let snapshot;
    try {
      snapshot = await this.deps.catalog.ready();
    } catch {
      return [];
    }
    const hidden = new Set(this.deps.hidden());
    return pinnedFirst(snapshot.models, this.deps.pinned?.() ?? []).flatMap((model) => model.supported && !hidden.has(model.id) ? [modelInfo(model, this.deps.loadImage !== void 0)] : []);
  }
  async resolveModel(_provider, model, signal) {
    return resolvedInfo((await this.supported(model, signal)).model, this.deps.loadImage !== void 0);
  }
  async prepareCall(_provider, model, signal) {
    const selected = await this.supported(model, signal);
    const definition = selected.model;
    if (signal?.aborted) throw aborted();
    let token;
    try {
      token = await this.deps.tokens.current(signal);
    } catch (error) {
      if (signal?.aborted) throw new LlmError("Copilot request aborted by caller", "ABORTED");
      throw tokenError(error);
    }
    if (selected.generation !== token.generation) {
      throw new LlmError("Copilot model catalog changed during preparation; retry the request", "DISCOVERY_FAILED");
    }
    const bound = { model: definition, token, transport: this.transports[definition.protocol] };
    return { model: resolvedInfo(definition, this.deps.loadImage !== void 0), stream: (options) => this.run(options, bound) };
  }
  async *stream(options) {
    const prepared = await this.prepareCall(options.provider, options.model, options.signal);
    yield* prepared.stream(options);
  }
  async supported(id, signal) {
    if (signal?.aborted) throw aborted();
    let snapshot;
    try {
      snapshot = await waitFor(this.deps.catalog.ready(), signal);
    } catch (error) {
      if (signal?.aborted) throw aborted();
      throw new LlmError("Copilot model catalog is unavailable", "DISCOVERY_FAILED", { cause: error });
    }
    const model = snapshot.models.find((entry) => entry.id === id);
    if (!model?.supported) throw new LlmError(`GitHub Copilot Bridge has no model "${id}"`, "UNKNOWN_MODEL");
    return { model, generation: snapshot.generation };
  }
  reasoning(options, model) {
    if (options.reasoningEffort === void 0) return void 0;
    const level = supportedEfforts(model).find((entry) => entry === String(options.reasoningEffort));
    if (level === void 0) {
      throw new LlmError(`Model "${model.id}" does not support reasoning effort "${options.reasoningEffort}"`, "UNSUPPORTED_REASONING_EFFORT");
    }
    return level;
  }
  async *run(options, bound) {
    options = { ...options, signal: options.signal ? AbortSignal.any([options.signal, bound.token.signal]) : bound.token.signal };
    if (options.signal?.aborted) throw aborted();
    if (options.stop?.length) throw new LlmError("GitHub Copilot Bridge does not support GenerateOptions.stop", "UNSUPPORTED_OPTION");
    const reasoning = this.reasoning(options, bound.model);
    const context = await waitFor(toContext(options, bound.model, this.deps), options.signal);
    const baseFetch = this.deps.fetch ?? globalThis.fetch;
    let token = bound.token;
    for (let attempt = 0; ; attempt++) {
      let status;
      const fetch2 = async (input, init) => {
        const response = await baseFetch(input, { ...init, redirect: "error" });
        status = response.status;
        return response;
      };
      const consumer = new AbortController();
      const signal = options.signal ? AbortSignal.any([options.signal, consumer.signal]) : consumer.signal;
      const mapper = new ChunkMapper();
      let emitted = false;
      let retry = false;
      try {
        const events = bound.transport(piModel(bound.model, token.baseUrl), context, {
          apiKey: token.token,
          signal,
          fetch: fetch2,
          maxRetries: 0,
          // Attribution goes last so no transport default can override it.
          headers: { ...attributionHeaders4() },
          ...reasoning === void 0 ? {} : { reasoning },
          ...options.maxTokens === void 0 ? {} : { maxTokens: options.maxTokens },
          ...options.temperature === void 0 ? {} : { temperature: options.temperature },
          ...options.sessionId === void 0 ? {} : { sessionId: options.sessionId }
        });
        for await (const event of events) {
          if (event.type === "error" && !emitted && attempt === 0 && !options.signal?.aborted && isUnauthorized(status, event.error.errorMessage)) {
            retry = true;
            break;
          }
          for (const chunk of mapper.map(event, () => options.signal?.aborted === true, () => status)) {
            emitted = true;
            yield chunk;
          }
          if (event.type === "done" || event.type === "error") return;
        }
      } catch (error) {
        const failure = failureOf(error instanceof Error ? error.message : "", status, options.signal?.aborted === true);
        throw LlmError.fromFailure(failure);
      } finally {
        consumer.abort();
      }
      if (!retry) throw new LlmError("Copilot event stream ended without done/error", "STREAM_CLOSED");
      this.deps.tokens.invalidate(token);
      try {
        token = await this.deps.tokens.current(options.signal);
        if (token.accountGeneration !== bound.token.accountGeneration) {
          throw new LlmError("Copilot account changed; retry the request", "AUTH");
        }
      } catch (error) {
        throw tokenError(error);
      }
    }
  }
};

// src/host/index.ts
var name = "copilot-bridge";
var inject = [];
var Config = z.object({
  pinnedModels: z.array(z.string()).description("GitHub Copilot model ids pinned to the top of bridge model selection. Cleared on sign-out and sign-in.").default([]).volatile(),
  hiddenModels: z.array(z.string()).description("GitHub Copilot model ids hidden from model selection. Cleared on sign-out and sign-in.").default([]).volatile(),
  enterpriseUrl: z.string().description("GitHub Enterprise URL or host, e.g. https://octocorp.ghe.com/. Leave blank for github.com.").default("").volatile()
});
var ENTERPRISE_URL_FIELD = "enterpriseUrl";
function bridgeConfig(ctx, config) {
  const entryId = ctx.fiber.entry?.options.id;
  return {
    read: () => config.enterpriseUrl.get() ?? "",
    writable: () => entryId !== void 0 && ctx.get("settings") !== void 0,
    readHidden: () => config.hiddenModels.get() ?? [],
    async writeHidden(ids) {
      const settings = ctx.get("settings");
      if (settings === void 0 || entryId === void 0) {
        throw new Error("saving hidden models needs the settings service and a profile entry");
      }
      if (ids === void 0) await settings.mutate(entryId, [{ op: "unset", path: ["hiddenModels"] }]);
      else await settings.update(entryId, { hiddenModels: [...ids] });
    },
    readPinned: () => config.pinnedModels.get() ?? [],
    async writePinned(ids) {
      const settings = ctx.get("settings");
      if (settings === void 0 || entryId === void 0) {
        throw new Error("saving pinned models needs the settings service and a profile entry");
      }
      if (ids === void 0) await settings.mutate(entryId, [{ op: "unset", path: ["pinnedModels"] }]);
      else await settings.update(entryId, { pinnedModels: [...ids] });
    },
    async write(host) {
      const settings = ctx.get("settings");
      if (settings === void 0 || entryId === void 0) {
        throw new Error("saving the enterprise URL needs the settings service and a profile entry");
      }
      if (host === void 0) await settings.mutate(entryId, [{ op: "unset", path: [ENTERPRISE_URL_FIELD] }]);
      else await settings.update(entryId, { [ENTERPRISE_URL_FIELD]: `https://${host}/` });
    }
  };
}
var errorMessage3 = (error) => error instanceof Error ? error.message : String(error);
function registerRoutes(ctx, auth, catalog, accessToken) {
  const metadata = createCopilotMetadata({ credentials: () => ctx.get("credentials"), accessToken });
  const usage = createCopilotUsage({ credentials: () => ctx.get("credentials") });
  ctx.inject(["connection"], (connectionCtx) => {
    connectionCtx.effect(() => {
      const { fetch: fetch2 } = connectionCtx.connection;
      const disposers = authRoutes(auth, catalog, metadata, usage, () => ctx.get("attachments") !== void 0).map((route2) => fetch2.register(route2));
      return async () => {
        for (const dispose of disposers.reverse()) await dispose();
      };
    }, `${name}: Web sign-in routes`);
  });
}
function apply(ctx, config) {
  const configStore = bridgeConfig(ctx, config);
  const notify = () => ctx.emit("llm/models-updated", BRIDGE_PROVIDER);
  const readAccount = async () => {
    const account = await readBridgeAccount(ctx.get("credentials"));
    return account?.enterpriseHost === normalizeEnterpriseDomain(configStore.read()) ? account : void 0;
  };
  const tokens = createAccessTokens({ readAccount, logger: ctx.logger });
  const catalog = createLiveCatalog({ token: () => tokens.current(), logger: ctx.logger });
  let disposed = false;
  let epoch = 0;
  const reset = () => {
    epoch++;
    tokens.reset();
    catalog.reset();
    notify();
  };
  const discover = async () => {
    const started = epoch;
    if (!disposed && await readAccount() && started === epoch) await catalog.refresh().catch(() => {
    });
  };
  const auth = createAuthController({
    credentials: () => ctx.get("credentials"),
    config: configStore,
    catalogIds: async () => catalog.snapshot()?.models.flatMap((model) => model.supported ? [model.id] : []),
    onSignedIn: discover,
    onSignedOut: reset,
    startDeviceFlow,
    pollDeviceFlow,
    logger: {
      info: (message) => ctx.logger.info(`${name}: ${message}`),
      warn: (message) => ctx.logger.warn(`${name}: ${message}`),
      error: (error) => ctx.logger.error(error)
    }
  });
  ctx.effect(() => () => auth.dispose(), `${name}: stop device-flow polling`);
  ctx.effect(() => catalog.onChange(notify), `${name}: catalog updates`);
  ctx.effect(() => tokens.onRefresh(() => {
    void discover();
  }), `${name}: token refresh discovery`);
  ctx.effect(() => () => {
    disposed = true;
    epoch++;
    tokens.dispose();
    catalog.dispose();
  }, `${name}: dispose live catalog and access tokens`);
  ctx.on("credentials/record-updated", (key) => {
    if (key !== BRIDGE_RECORD_KEY) return;
    reset();
    void discover();
  });
  ctx.on("loader/volatile-update", (paths) => {
    if (paths.some((path) => path[0] === "enterpriseUrl")) {
      auth.cancelLogin();
      reset();
      void configStore.writeHidden(void 0).catch((error) => ctx.logger.warn(`${name}: could not reset hidden models: ${errorMessage3(error)}`));
      void configStore.writePinned(void 0).catch((error) => ctx.logger.warn(`${name}: could not reset pinned models: ${errorMessage3(error)}`));
      void discover();
    } else if (paths.some((path) => path[0] === "hiddenModels" || path[0] === "pinnedModels")) notify();
  });
  ctx.inject(["credentials"], (credentialsCtx) => {
    void discover();
    credentialsCtx.effect(() => () => reset(), `${name}: credentials lifetime`);
  });
  ctx.inject(["llm"], (llmCtx) => {
    const adapter = new BridgeAdapter({
      catalog: { async ready() {
        const started = epoch;
        const account = await readAccount();
        if (started !== epoch || disposed) throw new Error("Copilot account changed");
        if (account === void 0) return { generation: -1, models: [] };
        const state = catalog.state();
        if (state.status === "error" && catalog.snapshot() === void 0) throw new Error(state.error);
        const snapshot = await catalog.ready();
        if (started !== epoch || disposed) throw new Error("Copilot account changed");
        return snapshot;
      } },
      tokens,
      hidden: () => configStore.readHidden(),
      pinned: () => configStore.readPinned(),
      get loadImage() {
        const attachments = llmCtx.get("attachments");
        if (attachments === void 0) return void 0;
        return async (ref, signal) => {
          const image = await attachments.readImage(ref, signal);
          return { data: Buffer.from(image.data).toString("base64"), mimeType: image.ref.mediaType };
        };
      }
    });
    llmCtx.llm.registerAdapter([BRIDGE_PROVIDER], adapter);
    llmCtx.inject(["attachments"], (attachmentsCtx) => {
      notify();
      attachmentsCtx.effect(() => () => notify(), `${name}: attachment capabilities lifetime`);
    });
  });
  ctx.inject(["settings"], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber), `${name}: custom settings page`);
  });
  registerRoutes(ctx, auth, catalog, (signal) => tokens.current(signal));
}
export {
  Config,
  apply,
  inject,
  name
};
