# Privacy Notice / 隐私说明

## 中文

Token Interceptor 仅在用户主动操作时处理 OAuth 授权码、Token、Cookie 和账号基础信息。项目不提供服务器，不包含遥测、广告、第三方分析或项目方控制的远程存储，也不会向项目维护者发送这些数据。

- OpenAI Token 历史保存在浏览器的 `chrome.storage.local`，最多 20 条，用户可在扩展中清除。
- Claude、Antigravity 和 Grok OAuth Token 保存在 `chrome.storage.session`，随浏览器会话结束而清除。
- 用户手动提供的 ChatGPT `sessionToken` 只用于在本机浏览器写入目标 Cookie。
- 用户手动提供的 Claude `sessionKey` 只用于在本机浏览器写入 Claude 登录 Cookie。
- 用户手动提供的 Grok `sso` Cookie 只用于在本机浏览器写入 grok.com 的登录 Cookie，不保存到扩展存储。
- 「凭据」功能只在本机读取已登录站点的 Cookie 或 Session，结果仅保存在 popup 内存与用户导出的文件中，不写入扩展存储、不上传。
- `chrome.debugger` 只在用户主动开启 Claude 兼容监听或进行临时交换时使用，流程结束后立即解除。
- Antigravity OAuth 客户端元数据不会进入 UI、浏览器存储或 Token 导出结果。
- Token 仅会发送给完成授权所必需的平台官方端点；具体域名和权限以 `manifest.json` 为准。

卸载扩展会删除其浏览器存储。若使用过 ChatGPT 或 Grok Cookie 导入，请按需在浏览器站点数据设置中单独删除对应 Cookie。

## English

Token Interceptor processes OAuth authorization codes, tokens, cookies, and basic account profile data only after a user action. The project operates no backend and includes no telemetry, advertising, third-party analytics, or project-controlled remote storage. It does not send this data to project maintainers.

- OpenAI token history is stored in `chrome.storage.local`, capped at 20 records, and can be cleared from the extension.
- Claude, Antigravity, and Grok OAuth tokens are stored in `chrome.storage.session` and expire with the browser session.
- A user-supplied ChatGPT `sessionToken` is used only to write the target cookie in the local browser.
- A user-supplied Claude `sessionKey` is used only to write the Claude login cookie in the local browser.
- A user-supplied Grok `sso` cookie is used only to write the grok.com login cookie in the local browser and is not kept in extension storage.
- The Credentials feature reads cookies and sessions only locally from signed-in sites; results stay in popup memory and user-exported files and are never stored or uploaded.
- `chrome.debugger` is used only for a user-initiated Claude compatibility listener or temporary exchange context and is detached when the flow ends.
- Antigravity OAuth client metadata never enters the UI, browser storage, or exported token records.
- Tokens are sent only to the provider endpoints required to complete authorization. The authoritative domain and permission list is in `manifest.json`.

Uninstalling the extension removes its browser-managed storage. If ChatGPT or Grok cookie import was used, remove that cookie separately from the browser's site-data settings when needed.
