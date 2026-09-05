# Contributing

Thanks for improving Token Interceptor. Keep changes small, provider-scoped and testable.

## Development setup

1. Install Node.js 20 or newer.
2. Run `npm run verify` from the project root.
3. Load the project root as an unpacked Chrome or Edge extension.
4. Reload the extension after changing Manifest or service-worker code.

Antigravity development additionally requires a local credential file:

```powershell
npm run setup:antigravity -- "path-to-Antigravity-Manager"
```

Never commit `config/antigravity-credentials.local.json`.

## Change rules

- Keep OAuth constants and parsing rules in the matching module under `src/oauth/`.
- Keep provider storage and message types namespaced.
- Validate external URLs, callback state and response shape at the boundary.
- Do not log, fixture or snapshot real tokens, authorization codes, cookies or client secrets.
- Do not add silent fallbacks for failed exchanges.
- Do not broaden host permissions without documenting the reason in `SECURITY.md`.
- Preserve the popup's keyboard access and narrow-width layout.

## Tests

Run before opening a pull request:

```powershell
npm run verify
```

Add or update tests when changing:

- OAuth query parameters or callback validation.
- Token response parsing.
- Manifest paths or permissions.
- Background message contracts.

Manual checks should cover the modified provider, popup switching and extension reload without service-worker errors.

## Pull requests

Describe the user-visible behavior, protocol or permission impact, verification performed and any remaining risk. Keep unrelated refactors out of the same pull request.
