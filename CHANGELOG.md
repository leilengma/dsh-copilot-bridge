# Changelog

## Unreleased

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
