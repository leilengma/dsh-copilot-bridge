# dsh-copilot-bridge

GitHub Copilot sign-in for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), on github.com **or a GitHub Enterprise host** such as `https://<company>.ghe.com/`.

It provides an **Account** tab under **Plugins → GitHub Copilot** for sign-in, with a **GitHub host** field: you enter your Enterprise URL, click **Save**, and the plugin writes it to the profile's configuration file.

The plugin handles sign-in and model visibility. It runs the OAuth device flow against the configured host and stores the long-lived credential in the Harness credential store under `llm-pi-ai` / `github-copilot`, together with `enterpriseUrl` when a host is set. The built-in `github-copilot` model route reads that record, refreshes short-lived Copilot tokens from `api.<host>`, and lists the models available to your account.

## Install

Use the `dsh` CLI that ships with the desktop app:

```sh
alias dsh="'/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'"
dsh plugin --profile desktop add github:leilengma/dsh-copilot-bridge
```

Restart the app.

## Use

1. In the Harness sidebar, click **Plugins**, open **GitHub Copilot**, and select the **Account** tab. Sign-in is on this plugin page, not in Harness Settings.
2. If you use GitHub Enterprise, enter your Enterprise URL (for example `https://octocorp.ghe.com/`) under **GitHub host** and click **Save**. For a personal GitHub account, leave the default **github.com** host; **Use github.com** clears a previously saved Enterprise host. This section is shown only while signed out.
3. On the **Account** tab, click **Sign in to GitHub Copilot**, open the device page (`https://<host>/login/device`), and enter the code shown. After sign-in, this tab shows your account usage and the **Models** tab becomes available.
4. Separately, configure the built-in provider in Harness **Settings → Models**: add or select `github-copilot`, leave its API key blank, and click **Apply**. This Settings page configures the provider; it is not the GitHub Copilot sign-in page.
5. After the provider's first request populates its model list, open **Plugins → GitHub Copilot → Models**. The **Models** tab appears only after sign-in; sign-out hides it and returns you to **Account**. The leftmost **eye** button controls whether a model appears in model selection: an open eye means visible; a crossed-out eye means hidden. Click again to restore it. Changes save immediately. Search matches model names and ids without changing the saved selection; counts always describe the whole account, with a shown count while searching.

The Plugins table includes context size and input capabilities from Harness metadata, even for hidden models. It also reads Copilot's live catalog for **input/output/cache-read/cache-write credit prices per 1M tokens**, **discount badges** and **Retiring warnings** (hover for the provider's message). Long-context prices, when supplied, expand below the default prices. Prices use the provider's reported amounts without applying a promotional discount again. Expired promotions are omitted. These are informational only: eligibility and your eye-toggle settings are unchanged; retiring models are not automatically hidden.

Missing metadata is shown as **—**, never guessed or treated as zero. Live metadata requires a valid short-lived access token from the built-in Copilot route; make a Copilot request first if needed. Metadata failures do not block model management. There are no Add Models or Install Model Providers actions. The **Account** tab contains authentication and the Enterprise host; **Models** contains search, visibility and pricing. There is no separate GitHub Copilot Settings section.

Sign-in, status and sign-out are available on **Plugins → GitHub Copilot → Account**, not through chat commands.

To switch GitHub hosts, open **Plugins → GitHub Copilot → Account**, sign out, choose and save the new **GitHub host**, then sign in again. The host section is hidden while signed in.

### Account usage

While signed in, the **Account** tab shows usage directly beneath **Signed in at …**: percentage used, progress and the provider's reset time. Hover or keyboard-focus the percentage for exact used / total credits (or requests on request-based plans). Unlimited and unavailable quotas are labelled rather than displayed as zero.

Usage refreshes when Account opens or credentials change. The small **Refresh usage** icon fetches a fresh snapshot; there is no continuous polling. Unlike VS Code, Harness does not currently expose the per-response quota headers to plugins, so usage is not live-updated after every model request.

The authenticated `/api/copilot-bridge/usage` route reads `copilot_internal/user` host-side using the saved grant's issuer and OAuth credential, shared proxy transport, a 5-second timeout and no redirects. Concurrent reads for the same credential are coalesced, but results are not persistently cached. Only allowlisted display fields reach the browser; credential changes invalidate in-flight results. Usage errors do not prevent signing out or changing settings.

## Configuration

**Save** writes the value to the profile's own patch file, `~/.dsh/profiles/<profile>/cordis.patch.yml`:

```yaml
- id: copilot-bridge
  config:
    enterpriseUrl: https://octocorp.ghe.com/
    hiddenModels:
      - gpt-4o
```

You can also edit that file by hand. A blank `enterpriseUrl` or `github.com` means github.com. The host field accepts a full URL or a bare host, and only the hostname is used.

`hiddenModels` defaults to an empty list and matches **exact, case-sensitive model ids** (not names or patterns). Hand edits take effect live through the Loader's volatile-config notification. Once the full account catalog is known, unknown or removed ids are pruned from the saved list. Removing the last hidden id unsets the key. Without a known catalog, the list is kept until the provider discovers models. If settings are unavailable or pruning cannot be saved, valid hidden ids still apply and status/sign-out remain usable; failed pruning writes are logged and retried on the next reconciliation.

The bridge re-applies credential filtering after every provider refresh. Its full-list bookkeeping is stored alongside the filtered catalog in the credential record, so a restart preserves hidden models and still lets you restore them.

Harness 0.2.2-rc.5 advertises a static pi-ai catalog without reading the grant's allowed ids. For that version, the bridge also installs a lifetime-scoped compatibility wrapper on the LLM service's model listing, excluding only the configured `github-copilot` ids and notifying cached pickers on mount, edits, and unload. Other providers and model execution are unchanged; unloading the bridge removes its filter. This wrapper can be removed once Harness exposes an equivalent public catalog-filter hook.

Every sign-out and completed sign-in **unsets `hiddenModels`**, regardless of account identity; visibility choices are not remembered per account. A reset write failure is logged without failing authentication/sign-out.

Hiding the model a session is using is allowed: its next request fails with `UNKNOWN_MODEL` and its picker shows **Select model**. Hiding every model removes the `github-copilot` group from the picker. Visibility controls are read-only when the settings service or profile entry is unavailable; search still works.

## Development

Requires Node 24 or newer.

```sh
npm ci
npm run check        # tsc --noEmit, esbuild bundle to lib/, node --test (type-stripped .ts)
```

- `src/host/`: Host plugin. Device flow, auth controller, credential grant, model-selection compatibility filter, `/api/copilot-bridge/*` routes and config writes.
- `src/client/`: Plugins Account/Models tabs, including device-code sign-in and sign-out confirmation on Account.
- Authenticated `GET /api/copilot-bridge/models` returns the full account model list plus display-only metadata, including hidden models; it never includes credential payloads or uses the filtered picker list.
- `src/host/copilot-metadata.ts` reuses the built-in route's access token for a host-only `/models` request. It never exchanges tokens or writes credentials. Requests use the shared proxy-aware transport, a 5-second timeout and no redirects. A single-flight, token/host-scoped in-memory cache lasts up to 5 minutes (bounded by token/promotion expiry); transport failures are retried on a later read after at most 30 seconds. Only allowlisted billing/warning fields for already-eligible ids reach the client. Copilot API fields follow [the official catalog schema](https://github.com/microsoft/vscode/blob/main/extensions/copilot/src/platform/endpoint/common/endpointProvider.ts) and [VS Code's badge semantics](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/browser/widget/input/modelPicker/modelPickerBadges.ts).
- `src/shared/contract.ts`: request and response types shared by the Host and the client.

`lib/` is committed so that `github:` installs work without a build step. Run `npm run build` before you commit.

For the installed desktop integration (no network, real credentials, or profile changes), build first and run:

```sh
ELECTRON_RUN_AS_NODE=1 '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' \
  scripts/test-installed-harness.cjs \
  '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules'
```

This checks the installed pi-ai adapter and LLM service, including removal of a hidden model from the advertised picker catalog and restoration on bridge unload.

To test a local checkout without touching your desktop profile:

```sh
export DSH_HOME=~/dsh-test
dsh plugin --profile web add "$PWD" -w
dsh web --port 0
```
