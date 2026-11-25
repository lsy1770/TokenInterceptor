<p align="center">
  <img src="docs/assets/hero.svg" alt="Token Interceptor" width="100%">
</p>

<p align="center">
  English · <a href="README.md">简体中文</a>
</p>

<p align="center">
  <img alt="Manifest V3" src="https://img.shields.io/badge/Manifest-V3-b7f34a?style=flat-square&labelColor=11140e">
  <img alt="Chrome" src="https://img.shields.io/badge/Chrome-supported-b7f34a?style=flat-square&labelColor=11140e">
  <img alt="Edge" src="https://img.shields.io/badge/Edge-supported-ff7448?style=flat-square&labelColor=11140e">
  <img alt="Dependencies" src="https://img.shields.io/badge/runtime_dependencies-0-f3d451?style=flat-square&labelColor=11140e">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-f0ecdf?style=flat-square&labelColor=11140e">
</p>

# openai/claude Token Interceptor

A developer-focused browser OAuth toolkit that handles authorization, callback capture, and token export for OpenAI, Claude, and Antigravity in one Manifest V3 extension, with Grok SSO cookie import for login and one-click account credential export.

It is not an account manager and does not upload credentials. Sensitive data stays in local browser storage or the current browser session.

## Why this project

| Capability | OpenAI | Claude | Antigravity | Grok |
| --- | :---: | :---: | :---: | :---: |
| Generate an official authorization URL | ✓ | ✓ | ✓ | ✓ |
| Detect OAuth callbacks automatically | ✓ | ✓ | ✓ | ✓ |
| Accept a manually pasted code | ✓ | ✓ | ✓ | ✓ |
| Access and refresh tokens | ✓ | ✓ | ✓ | ✓ |
| Import a login session | ✓ | ✓ | - | ✓ |
| Observe an existing token request | - | ✓ | - | - |
| Capture account credentials (cookie/session) | ✓ | ✓ | - | ✓ |
| Export local JSON / TXT | ✓ | ✓ | ✓ | ✓ |

- **One entry point:** no separate throwaway extension for every provider.
- **Real OAuth flows:** authorization uses provider-owned pages and token endpoints.
- **Isolated state:** provider state machines and storage keys do not overlap.
- **Zero runtime dependencies:** no bundler and no install step at runtime.
- **Auditable:** the extension is plain HTML, CSS, and JavaScript.

## Quick start

OpenAI, Claude, Antigravity, and Grok require no additional configuration.

### 1. Download and load the extension

- **Option A (Recommended, Release ZIP):** Download the latest packaged extension [`token-interceptor.zip`](https://github.com/lsy1770/TokenInterceptor/releases/latest/download/token-interceptor.zip) (or pick a specific version from [Releases](https://github.com/lsy1770/TokenInterceptor/releases)) and unzip it to a local folder.
- **Option B (From source):** Clone this repository.

Then load it in your browser:

1. Open `chrome://extensions/` or `edge://extensions/`.
2. Enable Developer mode.
3. Select **Load unpacked**.
4. Choose the unzipped folder (or this project root), i.e. the directory containing `manifest.json`.

### 2. Start a flow

Open the extension from the browser toolbar, choose OpenAI, Claude, Antigravity, or Grok, then use the primary action in that provider panel.

## Provider notes

### OpenAI

The extension creates PKCE parameters and opens the OpenAI authorization page. When the browser navigates to `localhost:1455/auth/callback`, the extension captures the code before navigation and exchanges it automatically.

It also supports page-response token capture, manual code/verifier exchange, ChatGPT `sessionToken` import, and TXT/JSON export for up to 20 local records.

### Claude

The extension generates a Claude PKCE URL and detects the authorization code on Anthropic's callback page. Token exchange runs inside a temporary `platform.claude.com` browser context.

The optional compatibility listener uses `chrome.debugger` to read an existing Claude token response. It detaches after capture or when stopped by the user.

It also supports importing a Claude `sessionKey` login cookie (or a full cookie string / JSON), writing `sessionKey`, `lastActiveOrg`, `anthropic-device-id`, and `routingHint` locally.

### Antigravity

The extension uses a built-in Google desktop OAuth flow to obtain Antigravity offline credentials:

- Six Antigravity/Google scopes.
- `access_type=offline` and `prompt=consent`.
- A dedicated `localhost:1456/oauth-callback` loopback URL.
- Google profile lookup for email and display name.
- Export of access, refresh, ID tokens, and OAuth metadata.

### Grok

The extension offers two ways to sign in to Grok.

**OAuth token acquisition**:

- Completes a PKCE (S256) authorization through the official Grok authorization page.
- Captures the `127.0.0.1:51234/callback` loopback and exchanges it for `access_token`, `refresh_token`, and `id_token`.
- Reads the email and name from the `id_token`, and also accepts a manually pasted code.

**SSO cookie import**:

- Paste the `sso` cookie value (JWT), a full cookie string, or the JSON from `/api/auth/session`.
- Writes `sso`, `sso-rw`, and the optional `x-userid` cookie locally.
- Optionally opens grok.com after import to verify the login state; importing overwrites the current Grok login state.

### Credential capture

The **Credentials** tab reads account credentials from the sites you are already signed in to and exports them as JSON:

- **OpenAI**: requests `chatgpt.com/api/auth/session`, saves the full session response, and reads the `__Secure-next-auth.session-token` cookie.
- **Claude**: reads the `anthropic-device-id`, `lastActiveOrg`, `sessionKey`, and `routingHint` cookies.
- **Grok**: reads the `sso` and `sso-rw` cookies (plus optional `x-userid`).

You can capture all providers at once or one at a time, then copy or download the result as JSON.

## Security model

- OpenAI history uses `chrome.storage.local`, capped at 20 entries.
- Claude and Antigravity tokens use `chrome.storage.session` and disappear with the browser session.
- Grok login cookies are written directly to the browser's grok.com cookie store and can be cleared or overwritten at any time.
- Credential capture only reads cookies and sessions locally from sites you are already signed in to; results stay in popup memory and exported files.
- The extension has no telemetry, analytics, or token upload path.
- `chrome.debugger` is limited to the user-initiated Claude compatibility flow and its temporary exchange context.
- Callback host, path, and OAuth state are validated at the extension boundary.

See the [security policy](SECURITY.md), [privacy notice](docs/PRIVACY.md), and [architecture guide](docs/ARCHITECTURE.md) for details.

## Repository layout

```text
.
├── assets/icons/             # Extension icons
├── docs/                     # Architecture and brand assets
├── scripts/                  # Project validation
├── src/
│   ├── oauth/                # Claude, Antigravity, and Grok protocol modules
│   ├── background.js         # Service worker and message router
│   ├── callback.js           # Claude callback extraction
│   ├── content.js            # OpenAI isolated-world bridge
│   └── injected.js           # OpenAI page-context observer
├── tests/                    # Dependency-free Node.js tests
├── ui/                       # Popup HTML, CSS, and JavaScript
├── manifest.json
└── package.json
```

## Development

Node.js 20 or newer is required for tests only. The browser extension itself has no Node.js dependency.

```powershell
npm test
npm run check
npm run verify
npm run package
```

Reload the unpacked extension after a change. Any protocol or permission change should include matching tests and documentation.

## FAQ

**The loopback callback page cannot be reached. Did the flow fail?**

Not necessarily. OpenAI and Antigravity callbacks are captured during navigation. Reopen the popup and check the provider state.

**Why does Chrome say that the browser is being debugged?**

That message appears while the optional Claude compatibility listener uses `chrome.debugger`. The extension does not keep tabs attached after capture or stop.

**Why is the Antigravity refresh token missing?**

Google may omit a refresh token for an application that was authorized previously. Revoke the earlier grant and repeat the consent flow.

**Can this be published to an extension store?**

Yes, after providing your own store assets and privacy policy and completing the target store's permission review.

## Contributing

Run `npm run verify` before submitting a change. See [CONTRIBUTING.md](CONTRIBUTING.md) for project conventions.

## License

[MIT](LICENSE)
