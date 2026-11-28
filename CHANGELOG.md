# Changelog

All notable changes are documented here. Versions follow Semantic Versioning where practical.

## 4.5.0

### Changed

- **Google One / Gemini Cookie 严格导出门禁**：一键取 Cookie 新增完整性强校验，必须齐全 9 项核心登录与签名 Cookie（`SID`、`HSID`、`SSID`、`APISID`、`SAPISID`、`__Secure-1PSID`、`__Secure-3PSID`、`__Secure-1PAPISID`、`__Secure-3PAPISID`）、会话校验令牌（`SIDCC` / `__Secure-1PSIDCC` / `__Secure-3PSIDCC`）、`play.google.com` 域会话（`OSID` / `__Secure-OSID`）以及 `accounts.google.com` 域会话（`LSID` / `__Host-1PLSID` / `__Host-3PLSID`）才允许导出。
- **缺失提示与域名快捷补齐**：Cookie 不齐全时清空导出区并禁用全部复制/下载按钮，明确逐项列出缺少的 Cookie，并展示需打开补齐的域名（`accounts.google.com`、`play.google.com`、`one.google.com`）及逐个/批量一键打开按钮。
- 移除已退出登录仍可能残留的 `ACCOUNT_CHOOSER` 误判，避免把失效账号判为就绪。

## 4.4.0

### Added

- **Google One / Gemini 面板（新平台）**：面向 Google One 订阅开通与取消续费的两步操作。
- **一键取 Cookie**：直接从 Chrome Cookie 存储读取全部 `google.com` 域登录态（含非 `Secure` 的 `SID`、`HSID`、`APISID` 以及带路径或 `__Host-` 前缀 Cookie，不依赖打开标签页也不轮换会话），导出四种格式：
  - Netscape `cookies.txt`（可直接 `google_one_daichong.py --cookie-file`）
  - Cookie header 串
  - 完整 JSON（含 `summary` 能力判定与 `cookies` 数组）
  - Python 直贴片段（`COOKIES` 列表 + `sapisidhash()` 实现）
  - 能力判定会检查 `SAPISID`/`__Secure-1PAPISID`（签名材料）、`SID`+`HSID`+`SSID`（强会话）、`play.google.com` 会话三者是否齐全。
- **Cookie 注入登录**：粘贴 `cookies.txt` / header 串 / 本插件导出的 JSON，自动解析并写入 Chrome Cookie 存储，支持“先清会话防串号”、注入后直接打开 Play 订阅页；写入前自动快照当前 Google 登录态，可一键回滚。
- **账号探测**：拉取 `one.google.com/u/0/ai` 解析 `SNlM0e`（at）、`S06Grb`（GAIA）、邮箱，判断当前登录账号与凭据齐备度。
- **Grok OAuth & SSO**：新增 Grok PKCE (S256) OAuth 授权码流程（`127.0.0.1:51234/callback` 自动捕获与 `auth.x.ai` Token 交换），以及 Grok `sso` JWT / Cookie / Session JSON 导入登录。
- **Claude Session 导入**：支持粘贴 Claude `sessionKey`（或完整 Cookie 字符串 / JSON），写入 `sessionKey`、`lastActiveOrg`、`anthropic-device-id`、`routingHint`。
- **统一凭据捕获**：新增「凭据」面板，一键从当前浏览器已登录站点捕获 OpenAI、Claude、Grok 账户凭据并导出为 JSON。
- **发布打包脚本**：新增零依赖打包脚本 `scripts/package-extension.js`（`npm run package`），生成可直接解压加载的浏览器扩展 ZIP 包。

### Changed

- `manifest.json` 增加 `grok.com`、`auth.x.ai`、`claude.ai` 与 `*://*.google.com/*` 等 host 权限，确保完整读取 HTTP/HTTPS Google 会话 Cookie。
- 补充 Grok、Claude Session、Google Cookie 采集与权限回归测试，并同步更新校验脚本与文档。

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
