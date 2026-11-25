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
function authRoutes(auth) {
  return [
    { path: `${API_BASE}/status`, methods: ["GET"], requestBody: "buffered", fetch: route(() => auth.status()) },
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
  ctx.inject(["connection"], (connectionCtx) => {
    connectionCtx.effect(() => {
      const { fetch: fetch2 } = connectionCtx.connection;
      const disposers = authRoutes(auth).map((route2) => fetch2.register(route2));
      return async () => {
        for (const dispose of disposers.reverse()) await dispose();
      };
    }, `${name}: Web sign-in routes`);
  });
}
function loginText(status) {
  if (status.authenticated) return "GitHub Copilot is already authenticated. Run /copilot-status for details.";
  return [
    `GitHub Copilot sign-in (${status.githubHost})`,
    `1. Open this URL in your browser: ${status.verificationUri ?? ""}`,
    `2. Enter this code: ${status.userCode ?? ""}`,
    "3. Authorize the GitHub App (VS Code) and complete sign-in.",
    "",
    "Polling continues in the background; the credential is stored once you authorize.",
    `Then select a model under the "${PI_AI_PROVIDER}" provider in Settings \u2192 Models.`
  ].join("\n");
}
function statusText(status) {
  if (!status.authenticated) {
    return `GitHub Copilot is NOT signed in (host: ${status.githubHost}). Run /copilot-login to sign in.`;
  }
  return [
    `GitHub Copilot: authenticated at ${status.signedInHost ?? status.githubHost}.`,
    ...status.signedInHost === void 0 ? [] : [
      `The configured host is now ${status.githubHost}; run /copilot-logout and /copilot-login to switch.`
    ],
    `Credential published to the "${status.provider}" provider.`,
    status.modelCount === void 0 ? "The model list is populated by that provider on its first request." : `Models available to this account: ${status.modelCount}`,
    ...status.hiddenModels?.length ? [`Hidden from model selection: ${status.hiddenModels.length}`] : []
  ].join("\n");
}
function registerCommands(ctx, auth) {
  const run = (render) => async () => {
    try {
      return { kind: "success", text: await render() };
    } catch (error) {
      return { kind: "error", text: errorMessage2(error) };
    }
  };
  ctx.inject(["commands"], (commandsCtx) => {
    commandsCtx.effect(() => {
      const disposers = [
        commandsCtx.commands.register({
          name: "copilot-login",
          description: "Sign in to GitHub Copilot via the device flow",
          handler: run(async () => loginText(await auth.login()))
        }),
        commandsCtx.commands.register({
          name: "copilot-status",
          description: "Show GitHub Copilot authentication status",
          handler: run(async () => statusText(await auth.status()))
        }),
        commandsCtx.commands.register({
          name: "copilot-logout",
          description: "Sign out of GitHub Copilot and remove the stored credential",
          handler: run(async () => {
            const wasSignedIn = (await auth.status()).authenticated;
            await auth.logout();
            return wasSignedIn ? `GitHub Copilot signed out; the "${PI_AI_PROVIDER}" credential has been removed.` : "GitHub Copilot is not signed in. Nothing to do.";
          })
        })
      ];
      return () => {
        for (const dispose of disposers.reverse()) dispose();
      };
    }, `${name}: slash commands`);
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
  ctx.inject(["settings"], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber), `${name}: custom settings page`);
  });
  registerRoutes(ctx, auth);
  registerCommands(ctx, auth);
}
export {
  Config,
  apply,
  inject,
  name
};
