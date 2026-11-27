# Changelog

## Unreleased

### Added

- Dedicated **GitHub Copilot Bridge** provider (`copilot-bridge`) with an account-specific live catalog, per-model protocol selection and bridge-owned sign-in credentials. Short-lived access tokens and catalog snapshots stay in host memory.
- Models **Refresh** action, loading and retryable error states that retain the last good rows, and disabled rows with localized **Unsupported protocol** / **Not offered for selection** reasons instead of eye toggles. No static catalog fallback.

### Changed

- Bundle the three public pi-ai Copilot transports at build time instead of installing pi-ai's full runtime dependency tree. Prepared npm/tarball installs no longer pull in unused `@google/genai` / `protobufjs` build scripts; pnpm approval policy is unchanged. Include bundled third-party license notices and packed-runtime regression coverage.
- **Upgrade: sign in again** under **GitHub Copilot → Account** using the device flow. There is **no token import** from the native provider, environment variables or API-key/PAT fields.
- Select models from **GitHub Copilot Bridge** (`copilot-bridge`). Existing sessions on **`github-copilot/*`** require the user's own native provider profile and credential; otherwise the picker shows **Select model**. Sessions are not migrated automatically.
- The native **`github-copilot`** provider, profiles and credentials are **left untouched**. The bridge no longer creates native profiles, supplies native authentication, filters the native picker or attaches guidance to the native provider card.
- Hidden-model choices apply only to `copilot-bridge`. Hidden rows stay restorable and supported hidden models continue to resolve for existing sessions. Bridge sign-out clears only its credential, in-memory tokens/catalog and hidden-model choices; Enterprise host configuration and native credentials/profiles are retained.

## 1.0.0

### Added

- Dedicated **GitHub Copilot** sidebar entry with a full-page **Account / Models** view and an **Open GitHub Copilot** shortcut in the installed plugin page.
- Theme-aware Copilot artwork and English/Chinese plugin metadata and UI text.
- Automatic native `github-copilot` provider setup after sign-in. Existing settings are preserved; read-only settings, concurrent edits and setup failures keep authentication valid and offer manual guidance and an OAuth-free retry.
- Account credit usage with an accessible progress bar, exact values on hover/focus, provider reset time and manual refresh. Credentials and raw quota responses remain on the host.
- Searchable model management with immediate-save eye toggles, context size, input capabilities, live credit prices, active discounts and informational **Retiring** warnings. Missing metadata is shown as **—**, never guessed.
- Profile-level `hiddenModels` with live hand edits, exact-id matching, automatic pruning and re-filtering after provider refresh. Full model bookkeeping survives restarts so hidden rows remain restorable.

### Changed

- Move sign-in, status, sign-out and GitHub Enterprise host configuration to **GitHub Copilot → Account**. Host configuration is shown only while signed out; Models is available only while signed in.
- Populate Models immediately after provider setup without requiring a chat request. Until the account catalog is discovered, show a labelled full provider catalog; known account catalogs, including an empty one, take precedence.
- Reset hidden-model choices on every sign-out and completed sign-in. Provider configuration is retained on sign-out.

### Fixed

- Remove Copilot models from cached pickers on sign-out, discard discovery responses that finish after logout and restore models after a new sign-in. Other providers are unaffected.
- Filter Harness 0.2.2-rc.5's static picker catalog as well as credential model ids. Refresh cached selectors on credential/configuration changes and restore the original service method on bridge unload.
- Keep hidden models visible in the management table, including when every model is hidden, so they can be restored.

### Removed

- **Breaking:** remove `/copilot-login`, `/copilot-status` and `/copilot-logout`, their composer device-code dialog and command UI hooks. Use **GitHub Copilot → Account** instead.
- Remove the redundant credential/model-picker hint from Account.

## 0.1.0

First release.

- Signs in to GitHub Copilot with the OAuth device flow, on github.com or a GitHub Enterprise host (for example `https://<company>.ghe.com/`). The credential goes to the Harness `github-copilot` route under `llm-pi-ai` / `github-copilot`. For an Enterprise host it also records `enterpriseUrl`.
- **Settings → GitHub Copilot** page with the same sign-in, sign-out and status UI as `@lujianjun19/dsh-llm-github-copilot`.
- **GitHub host** field on that page. **Save** writes `enterpriseUrl` to the profile's `cordis.patch.yml`, and the saved value is shown as the field's placeholder. **Use github.com** clears it. Changing the host cancels a sign-in that is still waiting. A credential issued by a different host is reported.
- Notice on the Models page `github-copilot` card: no API key is needed, so leave the key field empty and click **Apply**.
- `/copilot-login`, `/copilot-status` and `/copilot-logout` commands, with the device-code dialog and a sign-out confirmation.
- Written in TypeScript. Host and client share their request and response types through `src/shared/contract.ts`.
