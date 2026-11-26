window.__ModuleLoader__.load({
  id: "dsh-copilot-bridge",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/shared/contract.ts
var API_BASE = "/api/copilot-bridge";
var PI_AI_RECORD_SCOPE = "llm-pi-ai";
var PI_AI_PROVIDER = "github-copilot";
var PI_AI_RECORD_KEY = `${PI_AI_RECORD_SCOPE}/${PI_AI_PROVIDER}`;

// src/client/components.tsx
var import_react2 = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/i18n.ts
var import_react = require("react");
var LOCALE_NS = "copilot-bridge";
var EN = {
  nav: "GitHub Copilot",
  title: "GitHub Copilot",
  intro: "Sign in with the GitHub OAuth device flow, on github.com or your GitHub Enterprise host. The plugin stores the long-lived OAuth credential; the Harness route refreshes short-lived Copilot tokens and discovers the models available to your account.",
  signedIn: "Signed in",
  pending: "Waiting for GitHub authorization",
  signedOut: "Signed out",
  signIn: "Sign in to GitHub Copilot",
  requesting: "Requesting\u2026",
  waiting: "Waiting for authorization\u2026",
  signOut: "Sign out",
  processing: "Processing\u2026",
  refresh: "Refresh status",
  pendingIntro: "Open the GitHub device page and enter this code:",
  deviceCode: "Device code",
  copyCode: "Copy code",
  copied: "Copied",
  pendingHint: "This page updates automatically after authorization. You never need to paste a token here.",
  signedInAt: "Signed in at {host}.",
  hiddenModelsTitle: "Model visibility",
  modelsSummary: "Manage your GitHub Copilot account and choose which models appear in model selection.",
  accountTab: "Account",
  modelsTab: "Models",
  loadingAccount: "Loading account\u2026",
  searchModels: "Search models\u2026",
  loadingModels: "Loading models\u2026",
  modelsSignIn: "Sign in under Plugins \u2192 GitHub Copilot \u2192 Account to manage model visibility.",
  noAvailableModels: "No models are available to this account.",
  visibility: "Visible",
  modelName: "Name",
  contextSize: "Context size",
  capabilities: "Capabilities",
  modelCost: "Cost (Credits per 1M tokens)",
  modelMetadataNote: "\u2014 means unavailable metadata, not zero cost. Live prices require a valid Copilot access token; make a Copilot request if needed.",
  priceInput: "In: {amount}",
  priceOutput: "Out: {amount}",
  priceCacheRead: "Cache Read: {amount}",
  priceCacheWrite: "Cache Write: {amount}",
  defaultPricing: "Provider-reported default-context prices. No additional promotion discount is applied here.",
  longContextPricing: "Long-context prices",
  aboveContextPricing: "Prices above {context} tokens",
  retiring: "Retiring",
  modelDiscount: "{percent}% off",
  promotionEnds: "Offer ends: {date}",
  textInput: "Text",
  vision: "Vision",
  audioInput: "Audio",
  videoInput: "Video",
  showModel: "Show {id}",
  retry: "Retry",
  modelListPending: "The model list appears after the first request to the github-copilot provider.",
  modelCounts: "{available} available, {hidden} hidden",
  modelsShowing: ", showing {shown}",
  filterModels: "Filter models",
  clearModelFilter: "Clear model filter",
  hideModel: "Hide {id}",
  noMatchingModels: "No matching models",
  hiddenModelsReadOnly: "This profile cannot save settings from here (no settings service or profile entry). Set hiddenModels in the profile's cordis.patch.yml instead.",
  hiddenModelsWarning: "Hiding a model in use makes its session's next request fail with UNKNOWN_MODEL; its picker will show \u201CSelect model\u201D.",
  whereToSelect: 'Signing in publishes the credential to the "{provider}" provider. Pick a model there under Settings \u2192 Models.',
  commandHint: "The /copilot-login, /copilot-status, and /copilot-logout commands remain available on chat surfaces.",
  pluginVersion: "Plugin version:",
  hostTitle: "GitHub host",
  hostIntro: "Sign-in targets {host}. Enter your GitHub Enterprise URL (for example https://<company>.ghe.com/) to sign in there instead. The value is saved in this profile's configuration file.",
  hostLabel: "GitHub Enterprise URL",
  hostPlaceholder: "https://<company>.ghe.com/",
  saveHost: "Save",
  saving: "Saving\u2026",
  resetHost: "Use github.com",
  hostSaved: "Saved. Sign-in now targets {host}.",
  hostMismatch: "The stored credential was issued by {signedIn}, but the configured host is {host}. Sign out and sign in again to switch.",
  hostReadOnly: "This profile cannot save settings from here (no settings service or profile entry). Set enterpriseUrl in the profile's cordis.patch.yml instead.",
  loginDialogTitle: "Sign in to GitHub Copilot",
  loginDialogDescription: "Open the GitHub device page, then enter the device code below.",
  openGitHub: "Open GitHub",
  close: "Close",
  logoutOption: "Sign out of GitHub Copilot",
  logoutOptionDetail: "Remove the GitHub OAuth credential stored on this device",
  logoutConfirmTitle: "Sign out of GitHub Copilot?",
  logoutConfirmDescription: "This removes the OAuth credential stored on this device. Provider configuration is kept. You can sign in again later.",
  logoutAcknowledge: "I understand and want to sign out of GitHub Copilot",
  cancel: "Cancel",
  logoutConfirm: "Sign out",
  sessionUnavailable: "The current session is not ready.",
  logoutFailed: "GitHub Copilot sign-out failed: {message}",
  commandUnavailable: "The Host does not provide /copilot-logout.",
  cardSignedIn: "Signed in to GitHub Copilot at {host} via dsh-copilot-bridge. No API key needed; the stored sign-in is used.",
  cardApply: "Leave the API key field empty and click {apply}.",
  cardSignedOut: "No API key needed: sign in under Plugins \u2192 GitHub Copilot \u2192 Account, then leave the API key field empty.",
  modelsApply: "Apply"
};
var ZH = {
  nav: "GitHub Copilot",
  title: "GitHub Copilot",
  intro: "\u901A\u8FC7 GitHub OAuth \u8BBE\u5907\u7801\u767B\u5F55 github.com \u6216\u4F60\u7684 GitHub Enterprise \u4E3B\u673A\u3002\u63D2\u4EF6\u4F1A\u4FDD\u5B58\u957F\u671F OAuth \u51ED\u636E\uFF1BHarness \u8DEF\u7531\u4F1A\u81EA\u52A8\u5237\u65B0\u77ED\u671F Copilot token\uFF0C\u5E76\u52A8\u6001\u53D1\u73B0\u5F53\u524D\u8D26\u53F7\u53EF\u7528\u7684\u6A21\u578B\u3002",
  signedIn: "\u5DF2\u767B\u5F55",
  pending: "\u7B49\u5F85 GitHub \u6388\u6743",
  signedOut: "\u672A\u767B\u5F55",
  signIn: "\u767B\u5F55 GitHub Copilot",
  requesting: "\u6B63\u5728\u8BF7\u6C42\u2026",
  waiting: "\u7B49\u5F85\u6388\u6743\u2026",
  signOut: "\u9000\u51FA\u767B\u5F55",
  processing: "\u5904\u7406\u4E2D\u2026",
  refresh: "\u5237\u65B0\u72B6\u6001",
  pendingIntro: "\u8BF7\u6253\u5F00 GitHub \u8BBE\u5907\u767B\u5F55\u9875\u9762\uFF0C\u7136\u540E\u8F93\u5165\u4E0B\u9762\u7684\u8BBE\u5907\u7801\uFF1A",
  deviceCode: "\u8BBE\u5907\u7801",
  copyCode: "\u590D\u5236\u8BBE\u5907\u7801",
  copied: "\u5DF2\u590D\u5236",
  pendingHint: "\u5B8C\u6210\u6388\u6743\u540E\u672C\u9875\u4F1A\u81EA\u52A8\u66F4\u65B0\uFF1B\u65E0\u9700\u5728\u6B64\u7C98\u8D34\u4EFB\u4F55 token\u3002",
  signedInAt: "\u5DF2\u5728 {host} \u767B\u5F55\u3002",
  hiddenModelsTitle: "\u6A21\u578B\u53EF\u89C1\u6027",
  modelsSummary: "\u7BA1\u7406 GitHub Copilot \u8D26\u53F7\uFF0C\u5E76\u9009\u62E9\u5728\u6A21\u578B\u9009\u62E9\u5668\u4E2D\u663E\u793A\u7684\u6A21\u578B\u3002",
  accountTab: "\u8D26\u53F7",
  modelsTab: "\u6A21\u578B",
  loadingAccount: "\u6B63\u5728\u52A0\u8F7D\u8D26\u53F7\u2026",
  searchModels: "\u641C\u7D22\u6A21\u578B\u2026",
  loadingModels: "\u6B63\u5728\u52A0\u8F7D\u6A21\u578B\u2026",
  modelsSignIn: "\u8BF7\u5148\u5728 \u63D2\u4EF6 \u2192 GitHub Copilot \u2192 \u8D26\u53F7 \u4E2D\u767B\u5F55\uFF0C\u518D\u7BA1\u7406\u6A21\u578B\u53EF\u89C1\u6027\u3002",
  noAvailableModels: "\u6B64\u8D26\u53F7\u6CA1\u6709\u53EF\u7528\u6A21\u578B\u3002",
  visibility: "\u53EF\u89C1",
  modelName: "\u540D\u79F0",
  contextSize: "\u4E0A\u4E0B\u6587\u5927\u5C0F",
  capabilities: "\u80FD\u529B",
  modelCost: "\u8D39\u7528\uFF08\u79EF\u5206 / \u767E\u4E07 token\uFF09",
  modelMetadataNote: "\u2014 \u8868\u793A\u5143\u6570\u636E\u4E0D\u53EF\u7528\uFF0C\u4E0D\u4EE3\u8868\u514D\u8D39\u3002\u5B9E\u65F6\u4EF7\u683C\u9700\u8981\u6709\u6548\u7684 Copilot \u8BBF\u95EE\u4EE4\u724C\uFF1B\u5982\u6709\u9700\u8981\uFF0C\u8BF7\u5148\u53D1\u8D77\u4E00\u6B21 Copilot \u8BF7\u6C42\u3002",
  priceInput: "\u8F93\u5165\uFF1A{amount}",
  priceOutput: "\u8F93\u51FA\uFF1A{amount}",
  priceCacheRead: "\u7F13\u5B58\u8BFB\u53D6\uFF1A{amount}",
  priceCacheWrite: "\u7F13\u5B58\u5199\u5165\uFF1A{amount}",
  defaultPricing: "\u63D0\u4F9B\u5546\u62A5\u544A\u7684\u9ED8\u8BA4\u4E0A\u4E0B\u6587\u4EF7\u683C\uFF0C\u6B64\u5904\u4E0D\u4F1A\u989D\u5916\u53E0\u52A0\u4FC3\u9500\u6298\u6263\u3002",
  longContextPricing: "\u957F\u4E0A\u4E0B\u6587\u4EF7\u683C",
  aboveContextPricing: "\u8D85\u8FC7 {context} token \u7684\u4EF7\u683C",
  retiring: "\u5373\u5C06\u505C\u7528",
  modelDiscount: "\u4F18\u60E0 {percent}%",
  promotionEnds: "\u4F18\u60E0\u7ED3\u675F\uFF1A{date}",
  textInput: "\u6587\u672C",
  vision: "\u89C6\u89C9",
  audioInput: "\u97F3\u9891",
  videoInput: "\u89C6\u9891",
  showModel: "\u663E\u793A {id}",
  retry: "\u91CD\u8BD5",
  modelListPending: "\u9996\u6B21\u8BF7\u6C42 github-copilot \u63D0\u4F9B\u65B9\u540E\u5C06\u663E\u793A\u6A21\u578B\u5217\u8868\u3002",
  modelCounts: "{available} \u4E2A\u53EF\u7528\uFF0C{hidden} \u4E2A\u5DF2\u9690\u85CF",
  modelsShowing: "\uFF0C\u663E\u793A {shown} \u4E2A",
  filterModels: "\u7B5B\u9009\u6A21\u578B",
  clearModelFilter: "\u6E05\u9664\u6A21\u578B\u7B5B\u9009",
  hideModel: "\u9690\u85CF {id}",
  noMatchingModels: "\u6CA1\u6709\u5339\u914D\u7684\u6A21\u578B",
  hiddenModelsReadOnly: "\u6B64\u914D\u7F6E\u6863\u65E0\u6CD5\u5728\u8FD9\u91CC\u4FDD\u5B58\u8BBE\u7F6E\uFF08\u7F3A\u5C11\u8BBE\u7F6E\u670D\u52A1\u6216\u914D\u7F6E\u6761\u76EE\uFF09\u3002\u8BF7\u5728\u914D\u7F6E\u6863\u7684 cordis.patch.yml \u4E2D\u8BBE\u7F6E hiddenModels\u3002",
  hiddenModelsWarning: "\u9690\u85CF\u6B63\u5728\u4F7F\u7528\u7684\u6A21\u578B\u5C06\u5BFC\u81F4\u8BE5\u4F1A\u8BDD\u7684\u4E0B\u6B21\u8BF7\u6C42\u62A5 UNKNOWN_MODEL\uFF0C\u6A21\u578B\u9009\u62E9\u5668\u5C06\u663E\u793A\u201C\u9009\u62E9\u6A21\u578B\u201D\u3002",
  whereToSelect: '\u767B\u5F55\u540E\u51ED\u636E\u4F1A\u53D1\u5E03\u7ED9 "{provider}" \u63D0\u4F9B\u65B9\u3002\u8BF7\u5230\u8BBE\u7F6E \u2192 \u6A21\u578B \u4E2D\u9009\u62E9\u8BE5\u63D0\u4F9B\u65B9\u4E0B\u7684\u6A21\u578B\u3002',
  commandHint: "\u804A\u5929\u754C\u9762\u4ECD\u53EF\u4F7F\u7528 /copilot-login\u3001/copilot-status \u548C /copilot-logout\u3002",
  pluginVersion: "\u63D2\u4EF6\u7248\u672C\uFF1A",
  hostTitle: "GitHub \u4E3B\u673A",
  hostIntro: "\u5F53\u524D\u767B\u5F55\u76EE\u6807\u4E3A {host}\u3002\u8F93\u5165\u4F60\u7684 GitHub Enterprise \u5730\u5740\uFF08\u4F8B\u5982 https://<company>.ghe.com/\uFF09\u5373\u53EF\u6539\u4E3A\u5728\u8BE5\u4E3B\u673A\u767B\u5F55\u3002\u8BE5\u503C\u4FDD\u5B58\u5728\u6B64\u914D\u7F6E\u6863\u7684\u914D\u7F6E\u6587\u4EF6\u4E2D\u3002",
  hostLabel: "GitHub Enterprise \u5730\u5740",
  hostPlaceholder: "https://<company>.ghe.com/",
  saveHost: "\u4FDD\u5B58",
  saving: "\u6B63\u5728\u4FDD\u5B58\u2026",
  resetHost: "\u4F7F\u7528 github.com",
  hostSaved: "\u5DF2\u4FDD\u5B58\u3002\u767B\u5F55\u76EE\u6807\u73B0\u4E3A {host}\u3002",
  hostMismatch: "\u5DF2\u4FDD\u5B58\u7684\u51ED\u636E\u6765\u81EA {signedIn}\uFF0C\u4F46\u5F53\u524D\u914D\u7F6E\u7684\u4E3B\u673A\u662F {host}\u3002\u8BF7\u9000\u51FA\u5E76\u91CD\u65B0\u767B\u5F55\u4EE5\u5207\u6362\u3002",
  hostReadOnly: "\u6B64\u914D\u7F6E\u6863\u65E0\u6CD5\u5728\u8FD9\u91CC\u4FDD\u5B58\u8BBE\u7F6E\uFF08\u7F3A\u5C11\u8BBE\u7F6E\u670D\u52A1\u6216\u914D\u7F6E\u6761\u76EE\uFF09\u3002\u8BF7\u5728\u914D\u7F6E\u6863\u7684 cordis.patch.yml \u4E2D\u8BBE\u7F6E enterpriseUrl\u3002",
  loginDialogTitle: "\u767B\u5F55 GitHub Copilot",
  loginDialogDescription: "\u6253\u5F00 GitHub \u8BBE\u5907\u767B\u5F55\u9875\u9762\uFF0C\u7136\u540E\u8F93\u5165\u4E0B\u9762\u7684\u8BBE\u5907\u7801\u3002",
  openGitHub: "\u6253\u5F00 GitHub",
  close: "\u5173\u95ED",
  logoutOption: "\u9000\u51FA GitHub Copilot",
  logoutOptionDetail: "\u5220\u9664\u672C\u673A\u4FDD\u5B58\u7684 GitHub OAuth \u51ED\u636E",
  logoutConfirmTitle: "\u786E\u8BA4\u9000\u51FA GitHub Copilot\uFF1F",
  logoutConfirmDescription: "\u9000\u51FA\u540E\u5C06\u5220\u9664\u672C\u673A\u4FDD\u5B58\u7684 OAuth \u51ED\u636E\uFF0C\u4FDD\u7559\u63D0\u4F9B\u65B9\u914D\u7F6E\u3002\u4EE5\u540E\u4ECD\u53EF\u91CD\u65B0\u767B\u5F55\u3002",
  logoutAcknowledge: "\u6211\u786E\u8BA4\u8981\u9000\u51FA GitHub Copilot",
  cancel: "\u53D6\u6D88",
  logoutConfirm: "\u9000\u51FA\u767B\u5F55",
  sessionUnavailable: "\u5F53\u524D\u4F1A\u8BDD\u5C1A\u672A\u5C31\u7EEA\u3002",
  logoutFailed: "GitHub Copilot \u9000\u51FA\u5931\u8D25\uFF1A{message}",
  commandUnavailable: "\u5F53\u524D Host \u6CA1\u6709\u63D0\u4F9B /copilot-logout \u547D\u4EE4\u3002",
  cardSignedIn: "\u5DF2\u901A\u8FC7 dsh-copilot-bridge \u5728 {host} \u767B\u5F55 GitHub Copilot\u3002\u65E0\u9700 API \u5BC6\u94A5\uFF0C\u5C06\u4F7F\u7528\u5DF2\u4FDD\u5B58\u7684\u767B\u5F55\u51ED\u636E\u3002",
  cardApply: "\u8BF7\u5C06 API \u5BC6\u94A5\u7559\u7A7A\uFF0C\u76F4\u63A5\u70B9\u51FB\u300C{apply}\u300D\u3002",
  cardSignedOut: "\u65E0\u9700 API \u5BC6\u94A5\uFF1A\u8BF7\u5148\u5728 \u63D2\u4EF6 \u2192 GitHub Copilot \u2192 \u8D26\u53F7 \u4E2D\u767B\u5F55\uFF0C\u7136\u540E\u5C06 API \u5BC6\u94A5\u7559\u7A7A\u3002",
  modelsApply: "\u4FDD\u5B58"
};
var DICTIONARIES = { en: EN, zh: ZH };
var runtime;
function bindLocale(locale) {
  runtime = locale;
}
function text(key, params) {
  const template = (runtime?.getSnapshot().active === "zh" ? ZH : EN)[key];
  if (params === void 0) return template;
  return template.replace(/\{([^}]+)\}/g, (match, name) => name in params ? String(params[name]) : match);
}
var subscribe = (listener) => runtime?.subscribe(listener) ?? (() => {
});
var revision = () => runtime?.getSnapshot().revision ?? 0;
function useLocaleRevision() {
  (0, import_react.useSyncExternalStore)(subscribe, revision, () => 0);
}

// src/client/api.ts
async function call(path, init = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { accept: "application/json", ...init.body === void 0 ? {} : { "content-type": "application/json" } },
    cache: "no-store"
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`GitHub Copilot request failed (HTTP ${response.status})`);
  }
  if (!payload.ok) throw new Error(payload.error);
  if (!response.ok) throw new Error(`GitHub Copilot request failed (HTTP ${response.status})`);
  return payload.value;
}
var api = {
  status: () => call("/status"),
  models: () => call("/models"),
  login: () => call("/login", { method: "POST" }),
  logout: () => call("/logout", { method: "POST" }),
  setHiddenModels: (hiddenModels) => {
    const body = { hiddenModels };
    return call("/hidden-models", { method: "POST", body: JSON.stringify(body) });
  },
  setEnterpriseUrl: (enterpriseUrl) => {
    const body = { enterpriseUrl };
    return call("/enterprise-url", { method: "POST", body: JSON.stringify(body) });
  }
};
var errorMessage = (error) => error instanceof Error ? error.message : String(error);

// src/client/store.ts
function createStore(initial) {
  let snapshot = initial;
  const listeners = /* @__PURE__ */ new Set();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      snapshot = next;
      for (const listener of listeners) listener();
    }
  };
}
var authRevision = createStore(0);
var bumpAuthRevision = () => authRevision.set(authRevision.getSnapshot() + 1);
var CLOSED = { open: false, verificationUri: "", userCode: "" };
var loginDialog = createStore(CLOSED);
var closeLoginDialog = () => loginDialog.set(CLOSED);
async function closeLoginDialogWhenAuthenticated() {
  if (!loginDialog.getSnapshot().open) return;
  try {
    if ((await api.status()).authenticated) closeLoginDialog();
  } catch {
  }
}
function showLoginResult(commandName, resultText) {
  if (commandName !== "copilot-login" || resultText === void 0) return;
  const verificationUri = resultText.match(/https:\/\/\S+/)?.[0];
  const userCode = resultText.match(/Enter this code:\s*([A-Z0-9-]+)/i)?.[1];
  if (verificationUri === void 0 || userCode === void 0) return;
  loginDialog.set({ open: true, verificationUri, userCode });
}

// src/client/styles.ts
var css = {
  section: { display: "flex", flexDirection: "column", gap: 16, maxWidth: 760, paddingBottom: 32 },
  title: { margin: 0, fontSize: 22, lineHeight: "30px", fontWeight: 600, color: "var(--dsw-alias-label-primary)" },
  subtitle: { margin: 0, fontSize: 15, lineHeight: "22px", fontWeight: 600, color: "var(--dsw-alias-label-primary)" },
  intro: { margin: 0, fontSize: 14, lineHeight: "22px", color: "var(--dsw-alias-label-secondary)" },
  card: { display: "flex", flexDirection: "column", gap: 16, padding: 18, border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 12, background: "var(--dsw-alias-bg-layer-1)" },
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  status: { display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 500, color: "var(--dsw-alias-label-primary)" },
  actions: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  field: { display: "flex", flexDirection: "column", gap: 8 },
  label: { fontSize: 13, fontWeight: 500, color: "var(--dsw-alias-label-secondary)" },
  inputRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  link: { color: "var(--dsw-alias-brand-primary)", fontSize: 14, lineHeight: "22px", overflowWrap: "anywhere" },
  hint: { margin: 0, fontSize: 13, lineHeight: "20px", color: "var(--dsw-alias-label-tertiary)" },
  body: { margin: 0, fontSize: 14, lineHeight: "22px", color: "var(--dsw-alias-label-primary)" },
  error: { margin: 0, whiteSpace: "pre-wrap", color: "var(--dsw-alias-label-error, var(--dsw-alias-state-danger-label))" },
  modalBody: { display: "flex", flexDirection: "column", gap: 14 },
  codeRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  code: { width: "180px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: "2px", fontWeight: 600 },
  versionLink: { color: "var(--dsw-alias-brand-primary)" },
  modelList: { maxHeight: 240, overflowY: "auto", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 8, padding: 8 },
  modelRow: { padding: "6px 4px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13, overflowWrap: "anywhere" }
};

// src/client/components.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function StateLabel({ status }) {
  useLocaleRevision();
  const authenticated = status?.authenticated === true;
  const pending = status?.state === "pending";
  const state = authenticated ? "done" : pending ? "ongoing" : "error";
  const label = authenticated ? text("signedIn") : pending ? text("pending") : text("signedOut");
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: css.status, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.StateDot, { state }),
    label
  ] });
}
function DeviceCodeField({ value, copied, onCopy }) {
  useLocaleRevision();
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: css.field, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: css.label, children: text("deviceCode") }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: css.codeRow, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_dsh_client_ui_primitives.Input,
        {
          readOnly: true,
          value,
          "aria-label": text("deviceCode"),
          onFocus: (event) => event.currentTarget.select(),
          style: css.code
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", onClick: onCopy, children: copied ? text("copied") : text("copyCode") })
    ] })
  ] });
}
function LoginDialog() {
  useLocaleRevision();
  const state = (0, import_react2.useSyncExternalStore)(loginDialog.subscribe, loginDialog.getSnapshot, loginDialog.getSnapshot);
  const [copied, setCopied] = (0, import_react2.useState)(false);
  (0, import_react2.useEffect)(() => {
    if (state.open) setCopied(false);
  }, [state.open, state.userCode]);
  (0, import_react2.useEffect)(() => {
    if (!state.open) return;
    const timer = setInterval(() => {
      void closeLoginDialogWhenAuthenticated();
    }, 2e3);
    return () => clearInterval(timer);
  }, [state.open, state.userCode]);
  const copy = async () => {
    if (await (0, import_dsh_client_ui_primitives.writeClipboard)(state.userCode)) setCopied(true);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_dsh_client_ui_primitives.Modal,
    {
      open: state.open,
      onClose: closeLoginDialog,
      title: text("loginDialogTitle"),
      closeLabel: text("close"),
      description: text("loginDialogDescription"),
      footer: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", onClick: closeLoginDialog, children: text("close") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "primary", onClick: () => {
          globalThis.open(state.verificationUri, "_blank", "noopener,noreferrer");
        }, children: text("openGitHub") })
      ] }),
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: css.modalBody, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href: state.verificationUri, target: "_blank", rel: "noreferrer", style: css.link, children: state.verificationUri }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DeviceCodeField, { value: state.userCode, copied, onCopy: () => {
          void copy();
        } })
      ] })
    }
  );
}

// src/client/plugin-page.tsx
var import_react6 = require("react");
var import_dsh_client_ui_primitives5 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/models-page.tsx
var import_react4 = require("react");
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/hidden-models-card.tsx
var import_react3 = require("react");
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/promotion-expiry.ts
function promotionActive(promotion, now = Date.now()) {
  return promotion.endsAt === void 0 || Date.parse(promotion.endsAt) > now;
}
function watchPromotionExpiry(models, expired) {
  let timer;
  const schedule = () => {
    const now = Date.now();
    const dates = models.flatMap((model) => model.promotion?.endsAt ? [Date.parse(model.promotion.endsAt)] : []).filter((date) => date > now);
    if (!dates.length) return;
    timer = setTimeout(() => {
      expired();
      schedule();
    }, Math.min(Math.min(...dates) - now, 2147483647));
  };
  expired();
  schedule();
  return () => {
    if (timer !== void 0) clearTimeout(timer);
  };
}

// src/client/model-styles.ts
var modelCss = {
  page: { display: "flex", flexDirection: "column", gap: 16, minWidth: 0, paddingBottom: 24 },
  toolbar: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 },
  // Grid stretches Input's wrapper span as well as the native input it contains.
  search: { display: "grid", gridTemplateColumns: "18px minmax(0, 1fr)", alignItems: "center", gap: 8, flex: "1 1 240px", minWidth: 0 },
  counts: { margin: 0, color: "var(--dsw-alias-label-secondary)", fontSize: 13, fontVariantNumeric: "tabular-nums" },
  viewport: { overflow: "auto", maxHeight: "65vh", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 8 },
  table: { width: "100%", minWidth: 680, borderCollapse: "collapse", textAlign: "left", fontSize: 14, color: "var(--dsw-alias-label-primary)" },
  heading: { position: "sticky", top: 0, zIndex: 1, padding: "12px 16px", background: "var(--dsw-alias-bg-layer-1)", fontSize: 13, fontWeight: 600, color: "var(--dsw-alias-label-secondary)", whiteSpace: "nowrap" },
  cell: { padding: "8px 16px", borderTop: "1px solid var(--dsw-alias-border-l2)", verticalAlign: "middle" },
  eyeCell: { padding: "4px 8px", width: 48, borderTop: "1px solid var(--dsw-alias-border-l2)" },
  eye: { padding: 8, minWidth: 36, width: 36, height: 36, color: "var(--dsw-alias-label-secondary)" },
  modelName: { fontWeight: 500, lineHeight: "22px" },
  modelId: { fontSize: 12, lineHeight: "18px", color: "var(--dsw-alias-label-tertiary)", overflowWrap: "anywhere" },
  numeric: { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  badges: { display: "flex", flexWrap: "wrap", gap: 6 },
  badge: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 4, padding: "1px 6px", fontSize: 12, lineHeight: "18px", whiteSpace: "nowrap", color: "var(--dsw-alias-label-secondary)" },
  empty: { padding: 32, textAlign: "center", color: "var(--dsw-alias-label-secondary)" }
};

// src/client/hidden-models-card.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function Eye({ visible }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "12", cy: "12", r: "3" }),
    !visible ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "m3 3 18 18" }) : null
  ] });
}
var contextSize = (tokens) => tokens === void 0 ? "\u2014" : tokens >= 1e6 ? `${Number((tokens / 1e6).toFixed(2))}M` : tokens >= 1e3 ? `${Number((tokens / 1e3).toFixed(1))}K` : String(tokens);
function PriceLine({ prices }) {
  const amount = (value) => value === void 0 ? "\u2014" : new Intl.NumberFormat(void 0, { maximumSignificantDigits: 10 }).format(value);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", flexWrap: "wrap", gap: "4px 16px", fontVariantNumeric: "tabular-nums" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: text("priceInput", { amount: amount(prices.input) }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: text("priceOutput", { amount: amount(prices.output) }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: text("priceCacheRead", { amount: amount(prices.cacheRead) }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: text("priceCacheWrite", { amount: amount(prices.cacheWrite) }) })
  ] });
}
function MetadataBadge({ label, details }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { style: { maxWidth: "100%" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { style: { ...modelCss.badge, cursor: "pointer" }, title: details, children: label }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { ...modelCss.modelId, whiteSpace: "pre-line", maxWidth: 360 }, children: details })
  ] });
}
function ModelsTable({ status, models, busy, onSave }) {
  useLocaleRevision();
  const [filter, setFilter] = (0, import_react3.useState)("");
  const [, refreshPromotion] = (0, import_react3.useState)(0);
  (0, import_react3.useEffect)(() => watchPromotionExpiry(models, () => refreshPromotion((value) => value + 1)), [models]);
  const hidden = status.hiddenModels ?? [];
  const query = filter.trim().toLowerCase();
  const shown = models.filter((model) => `${model.name}
${model.id}`.toLowerCase().includes(query));
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: modelCss.toolbar, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: modelCss.search, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.7", "aria-hidden": "true", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "10", cy: "10", r: "6" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "m15 15 5 5" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Input, { type: "search", "aria-label": text("filterModels"), placeholder: text("searchModels"), value: filter, onChange: (event) => setFilter(event.currentTarget.value), style: { minWidth: 0, width: "100%" } })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { role: "status", style: modelCss.counts, children: [
        text("modelCounts", { available: models.length, hidden: hidden.length }),
        query.length > 0 ? text("modelsShowing", { shown: shown.length }) : null
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: modelCss.viewport, role: "region", "aria-label": text("hiddenModelsTitle"), tabIndex: 0, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("table", { style: modelCss.table, "aria-label": text("hiddenModelsTitle"), "aria-busy": busy, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("tr", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("th", { scope: "col", style: { ...modelCss.heading, width: 48 }, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { title: text("visibility"), children: text("visibility") }) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("th", { scope: "col", style: modelCss.heading, children: text("modelName") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("th", { scope: "col", style: modelCss.heading, children: text("contextSize") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("th", { scope: "col", style: modelCss.heading, children: text("capabilities") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("th", { scope: "col", style: modelCss.heading, children: text("modelCost") })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("tbody", { children: [
        shown.map((model) => {
          const visible = !hidden.includes(model.id);
          const label = text(visible ? "hideModel" : "showModel", { id: model.name });
          return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("tr", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("td", { style: modelCss.eyeCell, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Button, { type: "button", variant: "ghost", style: modelCss.eye, "aria-label": label, title: label, "aria-pressed": visible, disabled: busy || !status.configWritable, onClick: () => {
              void onSave(visible ? [...hidden, model.id] : hidden.filter((id) => id !== model.id));
            }, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Eye, { visible }) }) }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("td", { style: modelCss.cell, children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { ...modelCss.badges, alignItems: "center" }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { ...modelCss.modelName, color: visible ? void 0 : "var(--dsw-alias-label-tertiary)" }, children: model.name }),
                model.retiring ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(MetadataBadge, { label: text("retiring"), details: model.retiring }) : null,
                model.promotion && promotionActive(model.promotion) ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(MetadataBadge, { label: text("modelDiscount", { percent: model.promotion.discountPercent }), details: [
                  model.promotion.message,
                  model.promotion.endsAt ? text("promotionEnds", { date: model.promotion.endsAt }) : void 0
                ].filter(Boolean).join("\n") || text("defaultPricing") }) : null
              ] }),
              model.name !== model.id ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: modelCss.modelId, children: model.id }) : null
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("td", { style: { ...modelCss.cell, ...modelCss.numeric }, children: contextSize(model.contextWindow) }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("td", { style: modelCss.cell, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: modelCss.badges, children: [
              model.inputModalities?.includes("text") ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: modelCss.badge, children: text("textInput") }) : null,
              model.inputModalities?.includes("image") ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: modelCss.badge, children: text("vision") }) : null,
              model.inputModalities?.includes("audio") ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: modelCss.badge, children: text("audioInput") }) : null,
              model.inputModalities?.includes("video") ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: modelCss.badge, children: text("videoInput") }) : null,
              !model.inputModalities?.length ? "\u2014" : null
            ] }) }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("td", { style: { ...modelCss.cell, minWidth: 280 }, children: [
              model.pricing ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { title: text("defaultPricing"), children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(PriceLine, { prices: model.pricing }) }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { title: text("modelMetadataNote"), children: "\u2014" }),
              model.longContextPricing ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { style: { marginTop: 6, fontSize: 12 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { style: { cursor: "pointer" }, children: model.defaultContextMax === void 0 ? text("longContextPricing") : text("aboveContextPricing", { context: contextSize(model.defaultContextMax) }) }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(PriceLine, { prices: model.longContextPricing })
              ] }) : null
            ] })
          ] }, model.id);
        }),
        shown.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("tr", { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("td", { colSpan: 5, style: modelCss.empty, children: text(models.length === 0 ? "noAvailableModels" : "noMatchingModels") }) }) : null
      ] })
    ] }) })
  ] });
}

// src/client/models-page.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
function CopilotModelsPage({ onStatusChange }) {
  useLocaleRevision();
  const revision2 = (0, import_react4.useSyncExternalStore)(authRevision.subscribe, authRevision.getSnapshot, authRevision.getSnapshot);
  const [catalog, setCatalog] = (0, import_react4.useState)();
  const [busy, setBusy] = (0, import_react4.useState)(false);
  const [loadError, setLoadError] = (0, import_react4.useState)();
  const [saveError, setSaveError] = (0, import_react4.useState)();
  const [retry, setRetry] = (0, import_react4.useState)(0);
  const saving = (0, import_react4.useRef)(false);
  const mounted = (0, import_react4.useRef)(false);
  (0, import_react4.useEffect)(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  (0, import_react4.useEffect)(() => {
    if (busy) return;
    let alive = true;
    api.models().then(
      (value) => {
        if (!alive || revision2 !== authRevision.getSnapshot()) return;
        setCatalog(value);
        setLoadError(void 0);
        if (!value.status.authenticated) onStatusChange(value.status);
      },
      (cause) => {
        if (alive) setLoadError(errorMessage(cause));
      }
    );
    return () => {
      alive = false;
    };
  }, [revision2, retry, busy, onStatusChange]);
  const save = async (ids) => {
    if (saving.current) return;
    saving.current = true;
    const saveRevision = authRevision.getSnapshot();
    const current = () => mounted.current && saveRevision === authRevision.getSnapshot();
    setBusy(true);
    setSaveError(void 0);
    try {
      const status2 = await api.setHiddenModels(ids);
      if (!current()) return;
      setCatalog((current2) => current2 === void 0 ? current2 : { ...current2, status: status2 });
      if (!status2.authenticated) onStatusChange(status2);
    } catch (cause) {
      if (current()) setSaveError(errorMessage(cause));
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const status = catalog?.status;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { style: modelCss.page, "aria-label": text("hiddenModelsTitle"), children: [
    loadError === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { role: "alert", style: css.error, children: [
      loadError,
      " ",
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { type: "button", variant: "outline", disabled: busy, onClick: () => setRetry((value) => value + 1), children: text("retry") })
    ] }),
    saveError === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { role: "alert", style: css.error, children: saveError }),
    catalog === void 0 && loadError === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { role: "status", style: css.hint, children: text("loadingModels") }) : null,
    status?.authenticated === false ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { style: css.body, children: text("modelsSignIn") }) : null,
    status?.authenticated === true && status.availableModels === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { style: css.hint, children: text("modelListPending") }) : null,
    status?.authenticated === true && status.availableModels !== void 0 && catalog !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ModelsTable, { status, models: catalog.models.filter((model) => status.availableModels?.includes(model.id)), busy, onSave: save }),
      !status.configWritable ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { style: css.hint, children: text("hiddenModelsReadOnly") }) : null,
      !!status.hiddenModels?.length ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { style: css.hint, children: text("hiddenModelsWarning") }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { style: css.hint, children: text("modelMetadataNote") })
    ] }) : null
  ] });
}

// src/client/settings-page.tsx
var import_react5 = require("react");
var import_dsh_client_ui_primitives4 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime4 = require("react/jsx-runtime");
var REPOSITORY = "https://github.com/leilengma/dsh-copilot-bridge";
function EnterpriseUrlCard({ status, busy, onSave }) {
  useLocaleRevision();
  const [draft, setDraft] = (0, import_react5.useState)("");
  const [saved, setSaved] = (0, import_react5.useState)();
  const saveDraft = async (value) => {
    if (await onSave(value)) {
      setDraft("");
      setSaved(value);
    }
  };
  const writable = status?.configWritable === true;
  const configured = status?.enterpriseUrl ?? "";
  const githubHost = status?.githubHost ?? "github.com";
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: css.card, children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h3", { style: css.subtitle, children: text("hostTitle") }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { style: css.intro, children: text("hostIntro", { host: githubHost }) }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
      "form",
      {
        style: css.field,
        onSubmit: (event) => {
          event.preventDefault();
          if (draft.trim().length > 0) void saveDraft(draft);
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("label", { style: css.label, htmlFor: "copilot-bridge-enterprise-url", children: text("hostLabel") }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: css.inputRow, children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
              import_dsh_client_ui_primitives4.Input,
              {
                id: "copilot-bridge-enterprise-url",
                type: "url",
                inputMode: "url",
                autoComplete: "off",
                spellCheck: false,
                value: draft,
                placeholder: configured.length > 0 ? configured : text("hostPlaceholder"),
                disabled: busy || !writable,
                onChange: (event) => {
                  setDraft(event.currentTarget.value);
                  setSaved(void 0);
                },
                style: { minWidth: 320, flex: "1 1 320px" }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Button, { type: "submit", variant: "primary", disabled: busy || !writable || draft.trim().length === 0, children: busy ? text("saving") : text("saveHost") }),
            configured.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Button, { type: "button", variant: "outline", disabled: busy || !writable, onClick: () => {
              void saveDraft("");
            }, children: text("resetHost") }) : null
          ] })
        ]
      }
    ),
    !writable && status !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { style: css.hint, children: text("hostReadOnly") }) : null,
    saved !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "status", style: css.hint, children: text("hostSaved", { host: githubHost }) }) : null,
    status?.signedInHost !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "status", style: css.body, children: text("hostMismatch", { signedIn: status.signedInHost, host: githubHost }) }) : null
  ] });
}
function CopilotAccount({ status, onStatusChange }) {
  useLocaleRevision();
  const [busy, setBusy] = (0, import_react5.useState)(false);
  const [error, setError] = (0, import_react5.useState)();
  const [copied, setCopied] = (0, import_react5.useState)(false);
  const [confirmLogout, setConfirmLogout] = (0, import_react5.useState)(false);
  const [acknowledged, setAcknowledged] = (0, import_react5.useState)(false);
  const act = async (action) => {
    setBusy(true);
    setError(void 0);
    try {
      onStatusChange(await action());
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    const revision2 = authRevision.getSnapshot();
    try {
      const value = await api.status();
      if (revision2 !== authRevision.getSnapshot()) return;
      onStatusChange(value);
      setError(void 0);
    } catch (cause) {
      if (revision2 === authRevision.getSnapshot()) setError(errorMessage(cause));
    }
  };
  (0, import_react5.useEffect)(() => {
    if (status?.state !== "pending") return;
    setCopied(false);
    const timer = setInterval(() => {
      void refresh();
    }, 2e3);
    return () => clearInterval(timer);
  }, [status?.state, status?.userCode]);
  const logout = async () => {
    if (await act(api.logout)) {
      setConfirmLogout(false);
      setAcknowledged(false);
    }
  };
  const copy = async () => {
    if (await (0, import_dsh_client_ui_primitives4.writeClipboard)(status?.userCode ?? "")) setCopied(true);
  };
  const pending = status?.state === "pending";
  const authenticated = status?.authenticated === true;
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { style: css.section, children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h2", { style: css.title, children: text("title") }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { style: css.intro, children: text("intro") }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(EnterpriseUrlCard, { status, busy, onSave: (value) => act(() => api.setEnterpriseUrl(value)) }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: css.card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: css.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(StateLabel, { status }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: css.actions, children: [
          authenticated ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "outline", disabled: busy, onClick: () => {
            setAcknowledged(false);
            setConfirmLogout(true);
          }, children: busy ? text("processing") : text("signOut") }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "primary", disabled: busy || pending || status === void 0, onClick: () => {
            void act(api.login);
          }, children: busy ? text("requesting") : pending ? text("waiting") : text("signIn") }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "outline", disabled: busy, onClick: () => {
            void refresh();
          }, children: text("refresh") })
        ] })
      ] }),
      error === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "alert", style: css.error, children: error }),
      pending ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { style: css.body, children: text("pendingIntro") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("a", { href: status.verificationUri, target: "_blank", rel: "noreferrer", style: css.link, children: status.verificationUri }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DeviceCodeField, { value: status.userCode ?? "", copied, onCopy: () => {
          void copy();
        } }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { style: css.hint, children: text("pendingHint") })
      ] }) : null,
      !authenticated && !pending && status?.message !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { style: css.error, children: status.message }) : null,
      authenticated ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { style: css.body, children: text("signedInAt", { host: status.signedInHost ?? status.githubHost }) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { style: css.hint, children: text("whereToSelect", { provider: status.provider }) })
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { style: css.hint, children: text("commandHint") }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { style: css.hint, children: [
      text("pluginVersion"),
      " ",
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("a", { href: `${REPOSITORY}/releases/tag/v${"0.1.0"}`, target: "_blank", rel: "noreferrer", style: css.versionLink, children: [
        "dsh-copilot-bridge v",
        "0.1.0"
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      import_dsh_client_ui_primitives4.RiskConfirmation,
      {
        open: confirmLogout,
        title: text("logoutConfirmTitle"),
        description: text("logoutConfirmDescription"),
        acknowledgeLabel: text("logoutAcknowledge"),
        cancelLabel: text("cancel"),
        closeLabel: text("close"),
        confirmLabel: text("logoutConfirm"),
        acknowledged,
        disabled: busy,
        onAcknowledgedChange: setAcknowledged,
        onCancel: () => {
          if (!busy) {
            setConfirmLogout(false);
            setAcknowledged(false);
          }
        },
        onConfirm: () => {
          void logout();
        }
      }
    )
  ] });
}

// src/client/plugin-page.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
function CopilotPluginEntry({ view }) {
  useLocaleRevision();
  return view === "summary" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_jsx_runtime5.Fragment, { children: text("modelsSummary") }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(CopilotPluginPage, {});
}
function CopilotPluginPage() {
  useLocaleRevision();
  const revision2 = (0, import_react6.useSyncExternalStore)(authRevision.subscribe, authRevision.getSnapshot, authRevision.getSnapshot);
  const [status, setStatus] = (0, import_react6.useState)();
  const [tab, setTab] = (0, import_react6.useState)("account");
  const [error, setError] = (0, import_react6.useState)();
  const [retry, setRetry] = (0, import_react6.useState)(0);
  const generation = (0, import_react6.useRef)(0);
  const acceptStatus = (0, import_react6.useCallback)((value) => {
    generation.current++;
    setStatus(value);
    setError(void 0);
    if (!value.authenticated) setTab("account");
  }, []);
  (0, import_react6.useEffect)(() => {
    let alive = true;
    const request = ++generation.current;
    api.status().then(
      (value) => {
        if (alive && request === generation.current && revision2 === authRevision.getSnapshot()) acceptStatus(value);
      },
      (cause) => {
        if (alive && request === generation.current && revision2 === authRevision.getSnapshot()) setError(errorMessage(cause));
      }
    );
    return () => {
      alive = false;
    };
  }, [revision2, retry, acceptStatus]);
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("section", { style: { display: "flex", flexDirection: "column", gap: 16 }, children: [
    error === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("p", { role: "alert", style: css.error, children: [
      error,
      " ",
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Button, { type: "button", variant: "outline", onClick: () => setRetry((value) => value + 1), children: text("retry") })
    ] }),
    status === void 0 && error === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { role: "status", style: css.hint, children: text("loadingAccount") }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(CopilotPluginTabs, { status, tab, onTabChange: setTab, onStatusChange: acceptStatus })
  ] });
}
function CopilotPluginTabs({ status, tab, onTabChange, onStatusChange }) {
  useLocaleRevision();
  const authenticated = status?.authenticated === true;
  const selected = authenticated ? tab : "account";
  const items = [
    { value: "account", label: text("accountTab"), id: "copilot-account-tab", panelId: "copilot-account-panel" }
  ];
  if (authenticated) items.push({ value: "models", label: text("modelsTab"), id: "copilot-models-tab", panelId: "copilot-models-panel" });
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { maxWidth: 320 }, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.SegmentedTabs, { items, value: selected, onChange: onTabChange, label: text("nav"), size: "sm" }) }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { role: "tabpanel", id: "copilot-account-panel", "aria-labelledby": "copilot-account-tab", hidden: selected !== "account", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(CopilotAccount, { status, onStatusChange }) }),
    authenticated ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { role: "tabpanel", id: "copilot-models-panel", "aria-labelledby": "copilot-models-tab", hidden: selected !== "models", children: selected === "models" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(CopilotModelsPage, { onStatusChange }) : null }) : null
  ] });
}

// src/client/provider-card.tsx
var import_react7 = require("react");
var import_jsx_runtime6 = require("react/jsx-runtime");
var notice = {
  ...css.hint,
  color: "var(--dsw-alias-label-secondary)",
  padding: "8px 12px",
  borderRadius: 8,
  background: "var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1))"
};
function CopilotProviderCardNotice({ provider, configured }) {
  useLocaleRevision();
  const revision2 = (0, import_react7.useSyncExternalStore)(authRevision.subscribe, authRevision.getSnapshot);
  const [status, setStatus] = (0, import_react7.useState)();
  const isCopilot = provider.provider === PI_AI_PROVIDER;
  (0, import_react7.useEffect)(() => {
    if (!isCopilot) return;
    let live = true;
    api.status().then((next) => {
      if (live) setStatus(next);
    }, () => {
      if (live) setStatus(void 0);
    });
    return () => {
      live = false;
    };
  }, [isCopilot, revision2]);
  if (!isCopilot || status === void 0) return null;
  if (!status.authenticated) {
    return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { role: "note", style: notice, children: text("cardSignedOut") });
  }
  const host = status.signedInHost ?? status.githubHost;
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("p", { role: "note", style: notice, children: [
    "\u2713 ",
    text("cardSignedIn", { host }),
    configured ? null : /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
      " ",
      text("cardApply", { apply: text("modelsApply") })
    ] })
  ] });
}

// src/client/index.tsx
var SECTION_ID = "copilot-bridge";
var PI_AI_SETTINGS_NS = "llm-pi-ai";
var inject = ["slots", "commandUi", "sessions", "locale", "remote"];
function apply(ctx) {
  bindLocale(ctx.locale);
  ctx.effect(() => ctx.locale.register(LOCALE_NS, DICTIONARIES), `${SECTION_ID}: locale dictionaries`);
  ctx.on("command/executed", (_sessionId, commandName, result) => showLoginResult(commandName, result.text));
  ctx.effect(
    () => ctx.remote.$on("credentials/reference-updated", () => {
      bumpAuthRevision();
      void closeLoginDialogWhenAuthenticated();
    }),
    `${SECTION_ID}: close login dialog after credential commit`
  );
  ctx.effect(
    () => ctx.remote.$on("credentials/record-updated", (ref) => {
      if (ref === PI_AI_RECORD_KEY) bumpAuthRevision();
    }),
    `${SECTION_ID}: refresh discovered models`
  );
  ctx.effect(() => ctx.commandUi.decorate({
    name: "copilot-logout",
    available: () => true,
    ui: {
      kind: "popupSelect",
      options: async () => [{
        id: "logout",
        label: text("logoutOption"),
        detail: text("logoutOptionDetail"),
        confirmation: {
          title: text("logoutConfirmTitle"),
          description: text("logoutConfirmDescription"),
          acknowledgeLabel: text("logoutAcknowledge"),
          cancelLabel: text("cancel"),
          confirmLabel: text("logoutConfirm")
        }
      }],
      onSelect: async (_option, session) => {
        const live = ctx.sessions.binding(session.sessionId)?.session;
        if (live === void 0) throw new Error(text("sessionUnavailable"));
        const result = await live.command("/copilot-logout");
        if (!result.ok) throw new Error(text("logoutFailed", { message: result.error.message }));
        if (!result.value.matched) throw new Error(text("commandUnavailable"));
      }
    }
  }), `${SECTION_ID}: confirm /copilot-logout`);
  ctx.slots.inject("conversation.input.overlay", () => ctx.slots.register({
    name: "conversation.input.overlay",
    id: `${SECTION_ID}-login-dialog`,
    order: 50,
    locale: LOCALE_NS
  }, LoginDialog));
  ctx.slots.inject("plugins.item", () => ctx.slots.register({
    name: "plugins.item",
    id: `${SECTION_ID}-models`,
    order: 20,
    locale: LOCALE_NS,
    label: () => text("nav")
  }, CopilotPluginEntry));
  ctx.slots.inject("settings.models.provider-card", () => {
    try {
      return ctx.slots.register({
        name: "settings.models.provider-card",
        key: PI_AI_SETTINGS_NS,
        locale: LOCALE_NS
      }, CopilotProviderCardNotice);
    } catch (error) {
      console.warn(`[${SECTION_ID}] Models page notice not registered:`, error);
      return () => {
      };
    }
  });
}
    return module.exports;
  }
});
