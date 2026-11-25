# dsh-copilot-bridge

GitHub Copilot sign-in for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), on github.com **or a GitHub Enterprise host** such as `https://<company>.ghe.com/`.

It provides a Settings page and commands for sign-in, with a **GitHub host** field: you enter your Enterprise URL, click **Save**, and the plugin writes it to the profile's configuration file.

The plugin handles sign-in and model visibility. It runs the OAuth device flow against the configured host and stores the long-lived credential in the Harness credential store under `llm-pi-ai` / `github-copilot`, together with `enterpriseUrl` when a host is set. The built-in `github-copilot` model route reads that record, refreshes short-lived Copilot tokens from `api.<host>`, and lists the models available to your account.

## Install

Use the `dsh` CLI that ships with the desktop app:

```sh
alias dsh="'/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'"
dsh plugin --profile desktop add github:leilengma/dsh-copilot-bridge
```

Restart the app.

## Use

1. Open **Settings → GitHub Copilot**.
2. Under **GitHub host**, enter your Enterprise URL (for example `https://octocorp.ghe.com/`) and click **Save**. The input shows the saved value as its placeholder. **Use github.com** clears it.
3. Click **Sign in to GitHub Copilot**, open the device page (`https://<host>/login/device`) and enter the code shown.
4. In **Settings → Models**, add or select the `github-copilot` provider. Leave its API key blank. The card shows a notice that no API key is needed and that you only need to click **Apply**. If you are not signed in yet, the notice tells you to sign in first.
5. After the provider's first request populates its model list, return to **Settings → GitHub Copilot → Model visibility**. Check **Hide** beside a raw model id to remove it from model selection; uncheck to restore it. Changes save immediately. The case-insensitive text filter only narrows this list, not the saved selection. Counts always describe the whole account, with a shown count while filtering.

The `/copilot-login`, `/copilot-status` and `/copilot-logout` commands work on chat surfaces too. Status includes the hidden count when nonzero.

If you change the host while signed in, the page tells you that the stored credential belongs to the other host. Sign out and sign in again to switch.

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

The bridge re-applies hiding after every provider credential refresh; a brief reappearance during refresh is possible. Its full-list bookkeeping is stored alongside the filtered catalog in the credential record, so a restart preserves hidden models and still lets you restore them.

Every sign-out and completed sign-in **unsets `hiddenModels`**, regardless of account identity; visibility choices are not remembered per account. A reset write failure is logged without failing authentication/sign-out.

Hiding the model a session is using is allowed: its next request fails with `UNKNOWN_MODEL` and its picker shows **Select model**. Hiding every model removes the `github-copilot` group from the picker. Settings controls are read-only when the settings service or profile entry is unavailable.

## Development

Requires Node 24 or newer.

```sh
npm ci
npm run check        # tsc --noEmit, esbuild bundle to lib/, node --test (type-stripped .ts)
```

- `src/host/`: Host plugin. Device flow, auth controller, credential grant, `/api/copilot-bridge/*` routes, commands and config writes.
- `src/client/`: React Settings page, login dialog and logout confirmation.
- `src/shared/contract.ts`: request and response types shared by the Host and the client.

`lib/` is committed so that `github:` installs work without a build step. Run `npm run build` before you commit.

To test a local checkout without touching your desktop profile:

```sh
export DSH_HOME=~/dsh-test
dsh plugin --profile web add "$PWD" -w
dsh web --port 0
```
