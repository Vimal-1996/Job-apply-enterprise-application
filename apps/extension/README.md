# Job Apply Chrome extension

Fills job applications on **Greenhouse** and **Lever** from your Job Apply profile. You review every field and click **Submit** yourself: the extension never submits, never answers demographic (EEO) questions, and never runs on LinkedIn or Indeed.

## Install (developer mode)

```sh
cd apps/extension
npm ci
npm run build        # or: npm run watch (rebuilds on save)
```

1. Open `chrome://extensions` and switch on **Developer mode**.
2. Click **Load unpacked** and choose `apps/extension/dist`.
3. Pin **Job Apply** and click its icon to open the side panel. Sign in with your Job Apply account.

The extension ID is always `cokfldkgmphbfkjjndlgbmplcekepkdh` (fixed by the `key` in `static/manifest.json`). Its sign-in return address, `https://cokfldkgmphbfkjjndlgbmplcekepkdh.chromiumapp.org/`, is allowed on the Cognito web client (infra: `extension_ids`).

## Environments

The build defaults to **local development**: API `http://localhost:3000` and the dev Cognito pool. For production, open the extension's **Options** and set:

- **API address:** `https://<site>.cloudfront.net/api`
- **Sign-in domain** and **Client ID:** the web app's `VITE_COGNITO_DOMAIN` and `VITE_COGNITO_CLIENT_ID`

Or build with `EXT_API_URL`, `EXT_COGNITO_DOMAIN` and `EXT_COGNITO_CLIENT_ID` set.

## How it works

- **Side panel** (`src/panel.ts`): signs in, reads the job on the current page, links it to a saved job (same address, else same company and a very similar title), or adds it and shows your match. **Fill from my profile** sends your details and resume to the page, and **Mark as applied** updates the tracker.
- **Content script** (`src/content.ts`, Greenhouse and Lever only): reads the job and fills the form when asked. Filled fields are outlined green, and questions left for you amber.
- **Form filling** (`src/fill/fields.ts`): works from each field's label, fills only what your profile supports (name, email, phone, location, links, current company and title, sponsorship from your preferences, resume), and never overwrites what you've typed.
- **Sign-in** (`src/auth.ts`): the same Cognito login as the web app (code flow with PKCE) via `chrome.identity`. Tokens are kept in session storage, which Chrome clears when it closes.
