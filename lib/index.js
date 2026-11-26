// src/host/index.ts
import z from "@deepseek-ai/schemastery";

// src/shared/contract.ts
var API_BASE = "/api/copilot-bridge";
var PI_AI_RECORD_SCOPE = "llm-pi-ai";
var PI_AI_PROVIDER = "github-copilot";
var PI_AI_RECORD_KEY = `${PI_AI_RECORD_SCOPE}/${PI_AI_PROVIDER}`;
var GITHUB_DOTCOM = "github.com";

// src/host/auth-controller.ts
import { credentialKey as credentialKey2 } from "@deepseek-ai/dsh-credentials";

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

// src/host/grant.ts
function piAiGrantRecord(token, enterpriseDomain) {
  const payload = {
    type: "oauth",
    refresh: token,
    access: "",
    expires: 0,
    ...enterpriseDomain === void 0 ? {} : { enterpriseUrl: enterpriseDomain }
  };
  return { kind: "grant", payload };
}
function payloadOf(record) {
  if (record?.kind !== "grant") return void 0;
  const { payload } = record;
  return typeof payload === "object" && payload !== null ? payload : void 0;
}
function grantToken(record) {
  const refresh = payloadOf(record)?.refresh;
  return typeof refresh === "string" && refresh.length > 0 ? refresh : void 0;
}
function grantEnterpriseDomain(record) {
  const value = payloadOf(record)?.enterpriseUrl;
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function grantModelIds(record) {
  const ids = payloadOf(record)?.availableModelIds;
  return Array.isArray(ids) && ids.every((id) => typeof id === "string") ? ids : void 0;
}

// src/host/hidden-models.ts
import { credentialKey } from "@deepseek-ai/dsh-credentials";
var InvalidHiddenModelsError = class extends Error {
};
function validateHiddenModels(input) {
  if (!isIds(input) || input.some((id) => id.trim().length === 0)) {
    throw new InvalidHiddenModelsError("hiddenModels must be an array of non-empty strings");
  }
  return [...new Set(input)];
}
var isIds = (value) => Array.isArray(value) && value.every((id) => typeof id === "string");
var sameIds = (a, b) => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((id) => right.has(id));
};
function fullModelIds(record) {
  const ids = grantModelIds(record);
  if (ids === void 0 || record?.kind !== "grant") return void 0;
  const bridge = record.payload.copilotBridge;
  if (typeof bridge === "object" && bridge !== null && "allModelIds" in bridge && "filteredModelIds" in bridge && isIds(bridge.allModelIds) && isIds(bridge.filteredModelIds) && sameIds(ids, bridge.filteredModelIds)) {
    return bridge.allModelIds;
  }
  return ids;
}
function createModelFilter(credentials, config, warn) {
  let inFlight;
  let rerun = false;
  let disposed = false;
  const reconcile = async () => {
    const store = credentials();
    if (store === void 0) return;
    await store.modifyRecord(credentialKey(PI_AI_RECORD_SCOPE, PI_AI_PROVIDER), async (record) => {
      if (disposed || grantToken(record) === void 0 || record?.kind !== "grant") return void 0;
      const full = fullModelIds(record);
      if (full === void 0) return void 0;
      const hidden = config.readHidden();
      const kept = [...new Set(hidden)].filter((id) => full.includes(id));
      if (config.writable() && (!sameIds(kept, hidden) || kept.length !== hidden.length)) {
        try {
          await config.writeHidden(kept.length === 0 ? void 0 : kept);
        } catch (error) {
          warn(`Could not prune hidden models: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const filtered = full.filter((id) => !kept.includes(id));
      const payload = record.payload;
      const bridge = payload.copilotBridge;
      if (sameIds(grantModelIds(record) ?? [], filtered) && bridge !== void 0 && bridge !== null && isIds(bridge.allModelIds) && sameIds(bridge.allModelIds, full) && isIds(bridge.filteredModelIds) && sameIds(bridge.filteredModelIds, filtered)) return void 0;
      return { ...record, payload: { ...payload, availableModelIds: filtered, copilotBridge: { allModelIds: full, filteredModelIds: filtered } } };
    });
  };
  return {
    synchronize() {
      if (disposed) return Promise.resolve();
      rerun = true;
      inFlight ??= Promise.resolve().then(async () => {
        while (rerun && !disposed) {
          rerun = false;
          await reconcile();
        }
      }).finally(() => {
        inFlight = void 0;
      });
      return inFlight;
    },
    dispose() {
      disposed = true;
    }
  };
}

// src/host/auth-controller.ts
var recordKey = () => credentialKey2(PI_AI_RECORD_SCOPE, PI_AI_PROVIDER);
function createAuthController(deps) {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => {
    clearTimeout(handle);
  });
  let flow = { state: "signed-out" };
  let generation = 0;
  let timer;
  const models = createModelFilter(deps.credentials, deps.config, (message) => deps.logger.warn(message));
  const configuredDomain = () => normalizeEnterpriseDomain(deps.config.read());
  const githubHost = () => configuredDomain() ?? GITHUB_DOTCOM;
  const stopPolling = () => {
    generation += 1;
    if (timer !== void 0) clearTimer(timer);
    timer = void 0;
  };
  const requireCredentials = (action) => {
    const credentials = deps.credentials();
    if (credentials === void 0) throw new Error(`${action} needs the credentials service; mount dsh-credentials-local`);
    return credentials;
  };
  const readGrant = async () => deps.credentials()?.readRecord(recordKey());
  const storeToken = async (token, enterpriseDomain) => {
    const credentials = requireCredentials("signing in");
    await credentials.modifyRecord(recordKey(), async () => piAiGrantRecord(token, enterpriseDomain));
    const written = await credentials.readRecord(recordKey());
    if (grantToken(written) !== token || grantEnterpriseDomain(written) !== enterpriseDomain) {
      throw new Error(`the credential record at ${PI_AI_RECORD_KEY} did not survive the write; the consuming plugin may have changed its grant format`);
    }
  };
  const resetHiddenModels = async () => {
    try {
      await models.synchronize();
      await deps.config.writeHidden(void 0);
    } catch (error) {
      deps.logger.warn(`Could not reset hidden models: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const status = async () => {
    await models.synchronize();
    const record = await readGrant();
    const base = {
      provider: PI_AI_PROVIDER,
      githubHost: githubHost(),
      enterpriseUrl: deps.config.read().trim(),
      configWritable: deps.config.writable()
    };
    if (grantToken(record) === void 0) {
      return { ...base, authenticated: false, ...flow.state === "authenticated" ? { state: "signed-out" } : flow };
    }
    const signedInHost = grantEnterpriseDomain(record) ?? GITHUB_DOTCOM;
    const modelIds = fullModelIds(record);
    return {
      ...base,
      authenticated: true,
      state: "authenticated",
      ...signedInHost === base.githubHost ? {} : { signedInHost },
      hiddenModels: [...new Set(deps.config.readHidden())].filter((id) => modelIds === void 0 || modelIds.includes(id)),
      ...modelIds === void 0 ? {} : { modelCount: modelIds.length, availableModels: [...modelIds].sort() }
    };
  };
  const schedulePoll = (device) => {
    stopPolling();
    const current = generation;
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
      const result = await deps.pollDeviceFlow(device);
      if (current !== generation) return;
      switch (result.state) {
        case "done":
          try {
            await storeToken(result.token, device.domain === GITHUB_DOTCOM ? void 0 : device.domain);
            await resetHiddenModels();
            finish("authenticated");
            deps.logger.info(`GitHub Copilot sign-in at ${device.domain} completed; the ${PI_AI_PROVIDER} route can now authenticate`);
          } catch (error) {
            finish("error", error instanceof Error ? error.message : String(error));
            deps.logger.error(error);
          }
          return;
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
    if (grantToken(await readGrant()) !== void 0) return status();
    if (flow.state === "pending" && now() < flow.expiresAt) return status();
    schedulePoll(await deps.startDeviceFlow(configuredDomain()));
    return status();
  };
  const logout = async () => {
    const credentials = requireCredentials("signing out");
    stopPolling();
    flow = { state: "signed-out" };
    await credentials.deleteRecord(recordKey());
    await resetHiddenModels();
    return status();
  };
  const setEnterpriseUrl = async (input) => {
    const host = normalizeEnterpriseDomain(input);
    if (!deps.config.writable()) throw new Error("saving the enterprise URL needs the settings service and a profile entry");
    await deps.config.write(host);
    if (flow.state === "pending") {
      stopPolling();
      flow = { state: "signed-out" };
    }
    deps.logger.info(`GitHub host set to ${host ?? GITHUB_DOTCOM}`);
    return status();
  };
  const setHiddenModels = async (input) => {
    const hidden = validateHiddenModels(input);
    if (!deps.config.writable()) throw new Error("saving hidden models needs the settings service and a profile entry");
    await models.synchronize();
    const full = fullModelIds(await readGrant());
    if (full !== void 0 && hidden.some((id) => !full.includes(id))) {
      throw new InvalidHiddenModelsError("hiddenModels contains an id not in the account model list");
    }
    await deps.config.writeHidden(hidden.length === 0 ? void 0 : hidden);
    return status();
  };
  return {
    status,
    login,
    logout,
    setEnterpriseUrl,
    setHiddenModels,
    syncModels: () => models.synchronize(),
    dispose() {
      stopPolling();
      models.dispose();
    }
  };
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
async function startDeviceFlow(enterpriseDomain) {
  const domain = enterpriseDomain ?? GITHUB_DOTCOM;
  const urls = deviceFlowUrls(domain);
  let response;
  try {
    response = await githubFetch(urls.deviceCodeUrl, {
      method: "POST",
      headers: FORM_HEADERS,
      body: new URLSearchParams({ client_id: OAUTH_CLIENT_ID, scope: OAUTH_SCOPE }).toString()
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
async function pollDeviceFlow(device) {
  let response;
  try {
    response = await githubFetch(deviceFlowUrls(device.domain).accessTokenUrl, {
      method: "POST",
      headers: FORM_HEADERS,
      body: new URLSearchParams({
        client_id: OAUTH_CLIENT_ID,
        device_code: device.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      }).toString()
    });
  } catch {
    return { state: "retry" };
  }
  if (!response.ok) return { state: "retry" };
  const data = await response.json();
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
import { credentialKey as credentialKey3 } from "@deepseek-ai/dsh-credentials";
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
  const key = credentialKey3(PI_AI_RECORD_SCOPE, PI_AI_PROVIDER);
  let pending;
  return async () => {
    try {
      const credentials = deps.credentials();
      const record = await credentials?.readRecord(key);
      const token = grantToken(record);
      if (!token) {
        pending = void 0;
        return { state: "signed-out" };
      }
      const domain = grantEnterpriseDomain(record) ?? "github.com";
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
          const current = await deps.credentials()?.readRecord(key);
          if (!grantToken(current)) return { state: "signed-out" };
          if (grantToken(current) !== token || (grantEnterpriseDomain(current) ?? "github.com") !== domain) return { state: "unavailable" };
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
import { credentialKey as credentialKey4 } from "@deepseek-ai/dsh-credentials";
var object2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
var number2 = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
var text = (value) => typeof value === "string" && value.trim().length > 0 ? value.slice(0, 2e3) : void 0;
function prices(value, batch) {
  const tier = object2(value);
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
  const warnings = object2(row.warning_text);
  const messages = [row.warning_messages, row.info_messages].flatMap((value) => Array.isArray(value) ? value : []);
  for (const code of ["model_pending_deprecation", "model_deprecated"]) {
    if (warnings && Object.hasOwn(warnings, code)) return text(warnings[code]) ?? "This model is retiring.";
    const message = messages.map(object2).find((item) => item?.code === code);
    if (message) return text(message.message) ?? "This model is retiring.";
  }
  return void 0;
}
function parseCatalog(raw, now) {
  const data = object2(raw)?.data;
  if (!Array.isArray(data)) return /* @__PURE__ */ new Map();
  const result = /* @__PURE__ */ new Map();
  for (const value of data) {
    const row = object2(value);
    if (typeof row?.id !== "string") continue;
    const billing = object2(row.billing);
    const tiers = object2(billing?.token_prices);
    const batch = number2(tiers?.batch_size);
    const pricing = batch ? prices(tiers?.default, batch) : void 0;
    const longContextPricing = batch ? prices(tiers?.long_context, batch) : void 0;
    const defaultTier = object2(tiers?.default);
    const defaultContextMax = number2(defaultTier?.max_prompt_tokens ?? defaultTier?.context_max);
    const promo = object2(billing?.promo);
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
  if (typeof enterprise === "string" && /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/.test(enterprise)) {
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
      const record = await deps.credentials()?.readRecord(credentialKey4(PI_AI_RECORD_SCOPE, PI_AI_PROVIDER));
      const grant = record?.kind === "grant" ? object2(record.payload) : void 0;
      const expires = number2(grant?.expires);
      if (grant?.type !== "oauth" || typeof grant.access !== "string" || !grant.access || expires === void 0 || expires <= now()) {
        cache2 = void 0;
        return /* @__PURE__ */ new Map();
      }
      const token = grant.access;
      const url = modelsUrl(token, grant.enterpriseUrl);
      if (cache2?.token === token && cache2.url === url && cache2.expiresAt > now()) return cache2.value;
      const entry = { token, url, expiresAt: Math.min(now() + 3e5, expires), value: Promise.resolve(/* @__PURE__ */ new Map()) };
      cache2 = entry;
      entry.value = (async () => {
        try {
          const response = await fetch2(url, {
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${token}`,
              "User-Agent": "GitHubCopilotChat/0.35.0",
              "Editor-Version": "vscode/1.107.0",
              "Editor-Plugin-Version": "copilot-chat/0.35.0",
              "Copilot-Integration-Id": "vscode-chat",
              "X-GitHub-Api-Version": "2026-06-01"
            },
            redirect: "error",
            signal: AbortSignal.timeout(5e3)
          });
          if (!response.ok) throw new Error("Copilot metadata unavailable");
          const result = parseCatalog(await response.json(), now());
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
async function modelCatalog(status, runtime, metadata) {
  const live = status.authenticated && status.availableModels?.length ? await metadata?.() : void 0;
  const models = await Promise.all((status.authenticated ? status.availableModels ?? [] : []).map(async (id) => {
    if (runtime !== void 0) {
      try {
        const info = await runtime.resolveModelInfo(PI_AI_PROVIDER, id);
        return {
          ...live?.get(id),
          id,
          name: info.name,
          ...info.context === void 0 ? {} : { contextWindow: info.context.contextWindow },
          ...info.inputModalities === void 0 ? {} : { inputModalities: info.inputModalities }
        };
      } catch {
      }
    }
    return { ...live?.get(id), id, name: id };
  }));
  return { status, models };
}

// src/host/routes.ts
var errorMessage = (error) => error instanceof Error ? error.message : String(error);
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
      return json(error instanceof InvalidHiddenModelsError ? 400 : 500, { ok: false, error: errorMessage(error) });
    }
  };
}
async function readEnterpriseUrlRequest(request) {
  const body = await request.json();
  const value = typeof body === "object" && body !== null ? body.enterpriseUrl : void 0;
  if (typeof value !== "string") throw new Error('request body must be {"enterpriseUrl": string}');
  return value;
}
function authRoutes(auth, runtime = () => void 0, metadata, usage = async () => ({ state: "unavailable" })) {
  return [
    { path: `${API_BASE}/usage`, methods: ["GET"], requestBody: "buffered", fetch: route(() => usage()) },
    { path: `${API_BASE}/status`, methods: ["GET"], requestBody: "buffered", fetch: route(() => auth.status()) },
    { path: `${API_BASE}/models`, methods: ["GET"], requestBody: "buffered", fetch: route(async () => modelCatalog(await auth.status(), runtime(), metadata)) },
    { path: `${API_BASE}/login`, methods: ["POST"], requestBody: "buffered", fetch: route(() => auth.login()) },
    { path: `${API_BASE}/logout`, methods: ["POST"], requestBody: "buffered", fetch: route(() => auth.logout()) },
    {
      path: `${API_BASE}/enterprise-url`,
      methods: ["POST"],
      requestBody: "buffered",
      fetch: route(async (request) => auth.setEnterpriseUrl(await readEnterpriseUrlRequest(request)))
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

// src/host/model-selection.ts
function filterModelSelection(runtime, hidden) {
  const descriptor = Object.getOwnPropertyDescriptor(runtime, "listModels");
  const original = runtime.listModels;
  let active = true;
  const filtered = async function(provider) {
    const models = await original.call(this, provider);
    if (!active || provider !== PI_AI_PROVIDER) return models;
    const excluded = new Set(hidden());
    return models.filter((model) => !excluded.has(model.id));
  };
  Object.defineProperty(runtime, "listModels", { configurable: true, writable: true, value: filtered });
  return () => {
    active = false;
    if (Object.getOwnPropertyDescriptor(runtime, "listModels")?.value !== filtered) return;
    if (descriptor === void 0) Reflect.deleteProperty(runtime, "listModels");
    else Object.defineProperty(runtime, "listModels", descriptor);
  };
}

// src/host/index.ts
var name = "copilot-bridge";
var inject = [];
var Config = z.object({
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
var errorMessage2 = (error) => error instanceof Error ? error.message : String(error);
function registerRoutes(ctx, auth) {
  const metadata = createCopilotMetadata({ credentials: () => ctx.get("credentials") });
  const usage = createCopilotUsage({ credentials: () => ctx.get("credentials") });
  ctx.inject(["connection"], (connectionCtx) => {
    connectionCtx.effect(() => {
      const { fetch: fetch2 } = connectionCtx.connection;
      const disposers = authRoutes(auth, () => ctx.get("llm"), metadata, usage).map((route2) => fetch2.register(route2));
      return async () => {
        for (const dispose of disposers.reverse()) await dispose();
      };
    }, `${name}: Web sign-in routes`);
  });
}
function apply(ctx, config) {
  const auth = createAuthController({
    credentials: () => ctx.get("credentials"),
    config: bridgeConfig(ctx, config),
    startDeviceFlow,
    pollDeviceFlow,
    logger: {
      info: (message) => ctx.logger.info(`${name}: ${message}`),
      warn: (message) => ctx.logger.warn(`${name}: ${message}`),
      error: (error) => ctx.logger.error(error)
    }
  });
  ctx.effect(() => () => auth.dispose(), `${name}: stop device-flow polling`);
  const syncModels = () => {
    void auth.syncModels().catch((error) => ctx.logger.warn(`${name}: model filtering failed: ${errorMessage2(error)}`));
  };
  ctx.on("credentials/record-updated", (key) => {
    if (key === PI_AI_RECORD_KEY) syncModels();
  });
  ctx.on("loader/volatile-update", (paths) => {
    if (paths.some((path) => path[0] === "hiddenModels")) syncModels();
  });
  ctx.inject(["credentials"], () => {
    syncModels();
  });
  ctx.inject(["llm"], (llmCtx) => {
    const notify = () => {
      void llmCtx.parallel("llm/models-updated", PI_AI_PROVIDER).catch((error) => ctx.logger.warn(`${name}: model selection refresh failed: ${errorMessage2(error)}`));
    };
    llmCtx.effect(() => {
      const dispose = filterModelSelection(llmCtx.llm, () => config.hiddenModels.get() ?? []);
      return () => {
        dispose();
        notify();
      };
    }, `${name}: model selection filter`);
    notify();
    llmCtx.effect(() => ctx.on("loader/volatile-update", (paths) => {
      if (paths.some((path) => path[0] === "hiddenModels")) notify();
    }), `${name}: model selection config updates`);
  });
  ctx.inject(["settings"], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber), `${name}: custom settings page`);
  });
  registerRoutes(ctx, auth);
}
export {
  Config,
  apply,
  inject,
  name
};
