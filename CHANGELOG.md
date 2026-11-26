# Changelog

## Unreleased

- Enrich the Plugins model table with live Copilot credit prices (including long-context tiers), active discount badges and informational **Retiring** warnings. Read metadata host-side using the route-owned access token, with bounded caching, proxy support and fail-open missing data; model eligibility and visibility are unchanged.

- Move model visibility from Settings into **Plugins → GitHub Copilot**: searchable model table with immediate-save eye toggles, context size and available input capabilities. Preserve hidden rows for restoration and show unavailable costs/metadata as **—**. Settings retains authentication and Enterprise host configuration.

- Fix hidden Copilot models remaining visible in Harness 0.2.2-rc.5's static picker catalog: filter the advertised LLM listing as well as the grant, invalidate cached selectors on changes, and restore the service method on bridge unload. Add a regression check using the installed Harness adapter and LLM service.

- Model visibility in **Settings → GitHub Copilot**: hide raw model ids with immediate-save checkboxes, a scrollable list, case-insensitive search, whole-account counts, and English/Chinese copy.
- Profile-level `hiddenModels` configuration with live hand edits, exact-id matching, automatic pruning, and re-filtering after Copilot token refreshes. The full catalog is retained in credential bookkeeping across restarts.
- Hidden choices reset on every sign-out and completed sign-in. `/copilot-status` reports the hidden count. Hiding an active model or every model is allowed, with a warning in Settings.

## 0.1.0

First release.

- Signs in to GitHub Copilot with the OAuth device flow, on github.com or a GitHub Enterprise host (for example `https://<company>.ghe.com/`). The credential goes to the Harness `github-copilot` route under `llm-pi-ai` / `github-copilot`. For an Enterprise host it also records `enterpriseUrl`.
- **Settings → GitHub Copilot** page with the same sign-in, sign-out and status UI as `@lujianjun19/dsh-llm-github-copilot`.
- **GitHub host** field on that page. **Save** writes `enterpriseUrl` to the profile's `cordis.patch.yml`, and the saved value is shown as the field's placeholder. **Use github.com** clears it. Changing the host cancels a sign-in that is still waiting. A credential issued by a different host is reported.
- Notice on the Models page `github-copilot` card: no API key is needed, so leave the key field empty and click **Apply**.
- `/copilot-login`, `/copilot-status` and `/copilot-logout` commands, with the device-code dialog and a sign-out confirmation.
- Written in TypeScript. Host and client share their request and response types through `src/shared/contract.ts`.
