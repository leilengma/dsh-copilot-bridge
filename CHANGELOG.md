# Changelog

## Unreleased

- Populate Models immediately after provider setup using the full configured provider catalog until account-specific models are discovered. Label the fallback, keep hidden rows restorable, and give a known account catalog (including an empty one) precedence. Remove the redundant credential/model-picker hint from Account.

- Fix Copilot models remaining selectable after sign-out: gate the static Harness catalog on the saved sign-in credential, discard discovery responses that finish after logout, and refresh cached pickers on credential changes. Keep the provider configuration and restore models on a new sign-in; other providers are unchanged.

- After sign-in, detect an existing Harness `github-copilot` provider and create its native profile only when absent, then refresh model pickers. Preserve existing settings and retain the provider on sign-out. Read-only, concurrent-edit or setup failures keep the user signed in and show manual setup guidance with an OAuth-free retry; continue status polling until provider setup finishes.

- Add a GitHub Copilot sidebar entry that opens Account/Models in a full-page panel. Keep an **Open GitHub Copilot** shortcut in the installed plugin page instead of embedding the controls there.

- Add the supplied GitHub Copilot plugin artwork, automatically rendered black in light mode and white in dark mode. Register an installed-bundle configuration shortcut so the plugin header uses package artwork rather than the official-settings fallback; export English and Chinese display metadata.

- Remove the `/copilot-login`, `/copilot-status` and `/copilot-logout` chat commands, their composer device-code dialog and command UI hooks. Sign-in, status and sign-out remain available under **Plugins → GitHub Copilot → Account**.

- Show authenticated account credit usage below **Signed in at …**, with a progress bar, provider reset time, exact used/total on hover or keyboard focus, and a manual refresh icon. Refresh on opening Account and credential changes without polling; keep OAuth credentials and raw quota responses on the host. Remove the duplicate Account-tab title and hide GitHub host configuration while signed in.

- Consolidate GitHub Copilot under **Plugins → GitHub Copilot** with **Account** and **Models** tabs. Move authentication and Enterprise host configuration out of Settings; show Models only while signed in, and return to Account on sign-out. Update sign-in guidance in English and Chinese.

- Enrich the Plugins model table with live Copilot credit prices (including long-context tiers), active discount badges and informational **Retiring** warnings. Read metadata host-side using the route-owned access token, with bounded caching, proxy support and fail-open missing data; model eligibility and visibility are unchanged.

- Move model visibility from Settings into **Plugins → GitHub Copilot**: searchable model table with immediate-save eye toggles, context size and available input capabilities. Preserve hidden rows for restoration and show unavailable costs/metadata as **—**. Settings retains authentication and Enterprise host configuration.

- Fix hidden Copilot models remaining visible in Harness 0.2.2-rc.5's static picker catalog: filter the advertised LLM listing as well as the grant, invalidate cached selectors on changes, and restore the service method on bridge unload. Add a regression check using the installed Harness adapter and LLM service.

- Model visibility in **Settings → GitHub Copilot**: hide raw model ids with immediate-save checkboxes, a scrollable list, case-insensitive search, whole-account counts, and English/Chinese copy.
- Profile-level `hiddenModels` configuration with live hand edits, exact-id matching, automatic pruning, and re-filtering after Copilot token refreshes. The full catalog is retained in credential bookkeeping across restarts.
- Hidden choices reset on every sign-out and completed sign-in. The Models tab reports the hidden count. Hiding an active model or every model is allowed, with a warning in Settings.

## 0.1.0

First release.

- Signs in to GitHub Copilot with the OAuth device flow, on github.com or a GitHub Enterprise host (for example `https://<company>.ghe.com/`). The credential goes to the Harness `github-copilot` route under `llm-pi-ai` / `github-copilot`. For an Enterprise host it also records `enterpriseUrl`.
- **Settings → GitHub Copilot** page with the same sign-in, sign-out and status UI as `@lujianjun19/dsh-llm-github-copilot`.
- **GitHub host** field on that page. **Save** writes `enterpriseUrl` to the profile's `cordis.patch.yml`, and the saved value is shown as the field's placeholder. **Use github.com** clears it. Changing the host cancels a sign-in that is still waiting. A credential issued by a different host is reported.
- Notice on the Models page `github-copilot` card: no API key is needed, so leave the key field empty and click **Apply**.
- `/copilot-login`, `/copilot-status` and `/copilot-logout` commands, with the device-code dialog and a sign-out confirmation.
- Written in TypeScript. Host and client share their request and response types through `src/shared/contract.ts`.
