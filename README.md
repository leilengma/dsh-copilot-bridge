# dsh-copilot-bridge

**GitHub Copilot Bridge** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), on github.com **or a GitHub Enterprise host** such as `https://<company>.ghe.com/`.

The plugin registers its own **`copilot-bridge`** provider with your account's live Copilot model catalog. It provides a **GitHub Copilot** sidebar entry with full-page **Account / Models** tabs for device-flow sign-in, account usage and model visibility. Supported live models become available without restarting Harness, signing in again or sending a preliminary chat request.

The bridge stores its GitHub OAuth credential in its own Harness credential record, **`copilot-bridge/github`**. Short-lived Copilot access tokens and the discovered catalog stay in host memory; access tokens are refreshed automatically. The native **`github-copilot`** provider belongs to you: the bridge never creates, modifies, filters or deletes its profiles or credentials.

## Upgrading from the native-provider bridge

- **Sign in again** under **GitHub Copilot → Account** after upgrading. There is **no token import** from `llm-pi-ai/github-copilot`, environment variables or API-key/PAT fields; bridge sign-in uses the GitHub OAuth device flow only.
- Select a model under **GitHub Copilot Bridge** (`copilot-bridge`) in the session's model picker. Existing sessions are not automatically moved to the new provider.
- Sessions using **`github-copilot/*`** keep working only with **your own native provider profile and credential**. If that profile is unavailable, the picker shows **Select model**; choose a bridge model or configure the native provider yourself.
- Existing native profiles and credentials are left untouched, including on bridge sign-out. The bridge no longer manages or supplies authentication to the native provider, which can use another account independently.

## Install

Use the `dsh` CLI that ships with the desktop app:

```sh
alias dsh="'/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'"
dsh plugin --profile desktop add github:leilengma/dsh-copilot-bridge
```

Restart the app to load the plugin and its client registrations.

## Use

1. In the Harness sidebar, click **GitHub Copilot** and open **Account**. You can also use **Plugins → Installed → GitHub Copilot → Open GitHub Copilot**. The sidebar, page header and installed plugin card use the supplied Copilot artwork (black in light mode, white in dark mode).
2. If you use GitHub Enterprise, enter your Enterprise URL (for example `https://octocorp.ghe.com/`) under **GitHub host** and click **Save**. For a personal GitHub account, leave **github.com** selected; **Use github.com** clears a saved Enterprise host. Host controls are shown only while signed out.
3. Click **Sign in to GitHub Copilot**, open the device page (`https://<host>/login/device`) and enter the displayed code. The bridge saves its own OAuth credential and discovers the live catalog. No API key, native provider setup or preliminary chat request is needed. The **Account** tab shows usage and **Models** becomes available after sign-in.
4. Open **GitHub Copilot → Models**. The leftmost **eye** button controls whether a supported model appears under **GitHub Copilot Bridge** in the picker: an open eye means visible; a crossed-out eye means hidden. Changes save immediately. Hidden rows stay in the management table, even when every supported model is hidden, so they can be restored.
   Use the **pushpin immediately beside the eye** to **Pin model** (horizontal pin) or **Unpin model** (diagonal pin). Pins save immediately and move models to the top of both this table and the bridge picker, preserving catalog order within each group. Pinning never reveals a hidden model; a hidden pin can be unpinned without showing it. Disabled models have neither toggle.
5. Click **Refresh** to discover the catalog again. Loading is shown inline. Discovery failures show an error and **Retry**; the last good rows and visibility choices are retained. The bridge has **no static catalog fallback**. A successfully discovered empty catalog is shown as empty, not as a loading or fallback list.
6. Select a visible **GitHub Copilot Bridge** model in a new or existing session. Hiding a model removes it from the picker but does **not** prevent sessions already using it from continuing. Other providers with the same model id are unaffected.

Models that cannot be used remain visible as **disabled rows without an eye toggle**: **Unsupported protocol** means none of their advertised endpoints is supported; **Not offered for selection** means Copilot has disabled model selection for that model. They cannot be revealed. Non-chat models and models with no advertised endpoints are omitted. Supported endpoint selection is based on the live descriptor, preferring Anthropic Messages, then OpenAI Responses, then Chat Completions—not on model names.

Search matches model names and ids without changing the saved visibility choices. Counts describe the full displayed catalog, with a shown count while searching. The table includes context size, input capabilities and provider-reported **input/output/cache-read/cache-write credit prices per 1M tokens**, **discount badges** and **Retiring warnings** when available. Expand a badge for its details or long-context prices below the default prices. Promotion discounts are not applied twice; expired promotions are omitted. Retiring models are not automatically hidden.

Missing metadata is shown as **—**, never guessed or treated as zero. Metadata comes from the live catalog; missing prices do not block model management. There are no Add Models or Install Model Providers actions. Authentication, status, sign-out and the Enterprise host live on **Account**, not in chat commands or a separate GitHub Copilot Settings section.

Signing out deletes only the bridge credential, drops its in-memory access tokens and catalog, and unsets `hiddenModels` and `pinnedModels`. The bridge picker empties immediately; Enterprise host configuration is retained. The native `github-copilot` provider and other providers are unaffected. To switch GitHub hosts, sign out, save the new **GitHub host**, then sign in again.

### Thinking compatibility

Reasoning choices come only from the live model's advertised `reasoning_effort` values that pi-ai understands; an unsupported choice is rejected before inference HTTP. Endpoint selection still comes only from `supported_endpoints`, never the model name.

For Messages, the bridge copies **only** `forceAdaptiveThinking` for the exact Copilot IDs verified in pinned pi-ai 1.3.0's `dist/providers/data/github-copilot.json`: `claude-fable-5`, `claude-fable-5.1`, `claude-haiku-5.5`, `claude-opus-4.7`, `claude-opus-4.8`, `claude-opus-5`, `claude-opus-5.5`, `claude-sonnet-4.6`, `claude-sonnet-5`, and `claude-sonnet-5.5`. Explicit advertised efforts use adaptive thinking plus `output_config.effort`, not legacy token budgets. This is a narrow compatibility list, **not** a static catalog fallback or a rule for all Anthropic models. Genuine older models such as Haiku 4.5 retain pi-ai's budget handling.

Opus 5.5, Sonnet 5.5, Fable 5 and Fable 5.1 cannot accept disabled thinking. With no effort selected, their requests explicitly enable adaptive thinking through pi-ai's public `stream` export, **omitting effort** so the server chooses its default (currently medium on Opus 5.5). This also works if no effort choices are advertised: no choice is invented or exposed. Other models retain their supported no-effort/off behavior. Merely setting `forceAdaptiveThinking` on `streamSimple` would not fix the no-effort path: pi-ai 1.3.0 still selects disabled. The bridge does not claim mid-conversation effort, system-message, tool-change or thinking-binding capabilities as a workaround.

Policy sources: Anthropic's [thinking configuration table](https://platform.claude.com/docs/en/build-with-claude/thinking#configuring-thinking), [thinking support and rejected configurations](https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting#thinking-support-defaults-and-rejected-configurations-by-model), and [effort defaults](https://platform.claude.com/docs/en/build-with-claude/effort#how-effort-works); pinned pi-ai `dist/api/anthropic-messages.js` (`streamSimple`, `buildParams`) and `dist/api/anthropic-messages.d.ts` (`thinkingEnabled`, `effort`). The reported Opus 5.5 HTTP 400 matches the documented rejection of `thinking.type.disabled`. Recheck these exact-ID policies when deliberately upgrading pi-ai; new IDs are not inferred. Deterministic fake-HTTP tests verify wire requests, not live inference.

### Account usage

While signed in, **Account** shows usage directly beneath **Signed in at …**: percentage used, progress and the provider's reset time. Hover or keyboard-focus the percentage for exact used / total credits (or requests on request-based plans). Unlimited and unavailable quotas are labelled rather than displayed as zero.

Usage refreshes when Account opens or credentials change. The **Refresh usage** icon fetches a fresh snapshot; there is no continuous polling. Harness does not currently expose per-response quota headers to plugins, so usage is not live-updated after every model request.

The authenticated `/api/copilot-bridge/usage` route reads `copilot_internal/user` host-side using the bridge's saved issuer and OAuth credential, shared proxy transport, a 5-second timeout and no redirects. Concurrent reads for the same credential are coalesced, but results are not persistently cached. Only allowlisted display fields reach the browser; credential changes invalidate in-flight results. Usage errors do not prevent signing out or changing settings.

## Configuration

**Save** writes values to the profile's own patch file, `~/.dsh/profiles/<profile>/cordis.patch.yml`:

```yaml
- id: copilot-bridge
  config:
    enterpriseUrl: https://octocorp.ghe.com/
    hiddenModels:
      - mai-code-2
    pinnedModels:
      - mai-code-2-flash
```

You can also edit that file by hand. A blank `enterpriseUrl` or `github.com` means github.com. The host field accepts a full URL or a bare host, and only the hostname is used.

`hiddenModels` applies **only to `copilot-bridge`** and matches **exact, case-sensitive model ids**, not names or patterns. Hand edits take effect live through the Loader's volatile-config notification. Unknown ids are kept while the catalog is unknown; discovery failures do not prune visibility choices. Removing the last hidden id unsets the key. `pinnedModels` uses the same exact-ID, bridge-only matching; hidden pins stay saved but are excluded from the picker until revealed. Removing the last pin unsets its key. Visibility and pin controls are read-only when the settings service or profile entry is unavailable; search still works.

Every sign-out, completed sign-in and configured-host change **unsets `hiddenModels` and `pinnedModels`**, regardless of account identity; choices are not remembered per account. A reset write failure is logged without failing authentication/sign-out. Hidden ids are plugin configuration—not filtering or bookkeeping in a native credential record. Catalog snapshots are memory-only and rediscovered after restart when signed in.

Hiding every supported model removes the bridge group from the picker while leaving the full management table restorable. Existing sessions can still resolve supported hidden models. The bridge never wraps or filters the native provider's model listing.

## Development

Requires Node 24 or newer.

```sh
npm ci
npm run check        # tsc --noEmit, esbuild bundle to lib/, node --test (type-stripped .ts)
git diff --check
```

- `src/host/`: device flow, bridge-owned credentials, in-memory access-token lifecycle, live discovery, the dedicated LLM adapter, authenticated `/api/copilot-bridge/*` routes and config writes.
- `src/client/`: sidebar Account/Models view and installed-plugin shortcut, localized device-code sign-in, bridge ownership/migration guidance, refresh/retry, disabled rows and immediate-save visibility/pin controls.
- `src/shared/contract.ts`: safe request/response types shared by the host and client. `GET /api/copilot-bridge/models` and `POST /api/copilot-bridge/models/refresh` return management rows, including hidden and disabled models, plus `state: loading | ready | error` and an optional last error. They never expose credential payloads or raw Copilot responses.
- Discovery feeds the bridge picker, resolution and per-model transport selection from one snapshot. Transports use the public `@earendil-works/pi-ai` exports; the Harness-facing route remains `copilot-bridge`.

`lib/` is committed so that `github:` installs work without a build step. Run `npm run build` before committing.

For deterministic installed desktop integration, build first and run:

```sh
ELECTRON_RUN_AS_NODE=1 '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' \
  scripts/test-installed-harness.cjs \
  '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules'
ELECTRON_RUN_AS_NODE=1 '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' \
  scripts/test-installed-picker.cjs \
  '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules'
```

Installed checks use in-memory fixtures, not desktop credentials or profiles. Deterministic tests and installed-runtime checks do not replace browser acceptance or authorize live inference; any live smoke test requires separate approval.

For an isolated rendered Models test, run `node scripts/serve-client-ui-fixture.mjs` and open its localhost URL in a scratch browser tab. It uses production components/state with fake HTTP and semantic adapters for Harness presentation primitives. With that page owned by a Tabbit task, run `tabbit-cli nodejs --task <task> < tests/client-ui.browser.js` for keyboard pin/unpin, pending, failure/retry, hidden pins, order, filter and locale assertions. This does not exercise the installed desktop shell or the physical picker transport.

To test a local checkout without touching your desktop profile:

```sh
export DSH_HOME=~/dsh-test
dsh plugin --profile web add "$PWD" -w
dsh web --port 0
```
