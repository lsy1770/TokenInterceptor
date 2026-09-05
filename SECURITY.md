# Security Policy

## Supported version

Security fixes target the latest release on the default branch.

## Reporting a vulnerability

Use the repository host's private security advisory feature when available. Do not include live tokens, cookies, authorization codes, account identifiers or Client Secrets in a public issue.

Include the affected version, provider flow, reproduction steps, impact and a redacted proof of concept.

## Sensitive local files

`config/antigravity-credentials.local.json` contains OAuth client material and is excluded by `.gitignore`. Do not commit, attach, screenshot or publish it. Regenerate it locally with `npm run setup:antigravity -- <manager-path>`.

## Permission rationale

| Permission | Purpose |
| --- | --- |
| `storage` | Provider state and Token storage |
| `tabs` | Open authorization pages and temporary exchange tabs |
| `notifications` | Report background callback results |
| `webNavigation` | Capture loopback OAuth callbacks before navigation fails |
| `scripting` | Support page-context integration |
| `cookies` | Import a user-supplied ChatGPT session locally |
| `debugger` | User-initiated Claude response capture and exchange context |
| `activeTab` | Scope user-initiated browser interaction |
| `clipboardWrite` | Copy user-requested URLs and Token JSON |

Host permissions are restricted to provider OAuth/API domains and loopback callback addresses. Any new host must be justified by a concrete runtime request.

## Threat model

The extension assumes the local browser profile and unpacked extension directory are trusted. It does not protect credentials from malware, a compromised browser profile, another process with filesystem access, or a maliciously modified extension package.

The extension must never transmit captured credentials to project-owned analytics, telemetry or remote storage.
