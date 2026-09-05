# Changelog

All notable changes are documented here. Versions follow Semantic Versioning where practical.

## 4.2.0

### Added

- Built-in Antigravity desktop OAuth flow with automatic loopback callback capture.
- Automatic `localhost:1456/oauth-callback` capture and state validation.
- Antigravity access, refresh and ID Token export with Google profile metadata.
- Local ignored credential synchronization script.
- Structured source, UI, asset, test and documentation directories.
- Dependency-free validation and unified npm scripts.

### Changed

- Rebuilt the popup as a three-provider interface.
- Renamed the extension to `openai/claude Token Interceptor`.
- Moved Claude Token capture into the combined extension.

### Removed

- Invite-based phone verification bypass UI and background workflow.
- Unreferenced legacy callback page and declarative rule file.

## 4.0.0

- Initial combined OpenAI and Claude release.
