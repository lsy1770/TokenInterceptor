# Privacy Notice / 隐私说明

## 中文

Token Interceptor 仅在用户主动操作时处理 OAuth 授权码、Token、Cookie 和账号基础信息。项目不提供服务器，不包含遥测、广告、第三方分析或项目方控制的远程存储，也不会向项目维护者发送这些数据。

- OpenAI Token 历史保存在浏览器的 `chrome.storage.local`，最多 20 条，用户可在扩展中清除。
- Claude 和 Antigravity Token 保存在 `chrome.storage.session`，随浏览器会话结束而清除。
- 用户手动提供的 ChatGPT `sessionToken` 只用于在本机浏览器写入目标 Cookie。
- `chrome.debugger` 只在用户主动开启 Claude 兼容监听或进行临时交换时使用，流程结束后立即解除。
- Antigravity Client Secret 只保存在被版本控制忽略的 `config/antigravity-credentials.local.json`，不会显示或导出。
- Token 仅会发送给完成授权所必需的平台官方端点；具体域名和权限以 `manifest.json` 为准。

卸载扩展会删除其浏览器存储。若使用过 ChatGPT Cookie 导入，请按需在浏览器站点数据设置中单独删除对应 Cookie。

## English

Token Interceptor processes OAuth authorization codes, tokens, cookies, and basic account profile data only after a user action. The project operates no backend and includes no telemetry, advertising, third-party analytics, or project-controlled remote storage. It does not send this data to project maintainers.

- OpenAI token history is stored in `chrome.storage.local`, capped at 20 records, and can be cleared from the extension.
- Claude and Antigravity tokens are stored in `chrome.storage.session` and expire with the browser session.
- A user-supplied ChatGPT `sessionToken` is used only to write the target cookie in the local browser.
- `chrome.debugger` is used only for a user-initiated Claude compatibility listener or temporary exchange context and is detached when the flow ends.
- The Antigravity client secret exists only in the version-control-ignored `config/antigravity-credentials.local.json`; it is never displayed or exported.
- Tokens are sent only to the provider endpoints required to complete authorization. The authoritative domain and permission list is in `manifest.json`.

Uninstalling the extension removes its browser-managed storage. If ChatGPT cookie import was used, remove that cookie separately from the browser's site-data settings when needed.
