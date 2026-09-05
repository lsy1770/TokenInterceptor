<p align="center">
  <img src="docs/assets/hero.svg" alt="Token Interceptor" width="100%">
</p>

<p align="center">
  <a href="README_EN.md">English</a> · 简体中文
</p>

<p align="center">
  <img alt="Manifest V3" src="https://img.shields.io/badge/Manifest-V3-b7f34a?style=flat-square&labelColor=11140e">
  <img alt="Chrome" src="https://img.shields.io/badge/Chrome-supported-b7f34a?style=flat-square&labelColor=11140e">
  <img alt="Edge" src="https://img.shields.io/badge/Edge-supported-ff7448?style=flat-square&labelColor=11140e">
  <img alt="Dependencies" src="https://img.shields.io/badge/runtime_dependencies-0-f3d451?style=flat-square&labelColor=11140e">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-f0ecdf?style=flat-square&labelColor=11140e">
</p>

# openai/claude Token Interceptor

一个面向开发者的浏览器 OAuth 工具箱，在同一个 Manifest V3 扩展中完成 OpenAI、Claude 和 Antigravity 的授权、回调捕获与 Token 导出。

它不是账号管理器，也不上传凭据。所有敏感数据只保存在浏览器本地或当前浏览器会话。

## 为什么用它

| 能力 | OpenAI | Claude | Antigravity |
| --- | :---: | :---: | :---: |
| 一键生成官方授权 URL | ✓ | ✓ | ✓ |
| 自动识别 OAuth 回调 | ✓ | ✓ | ✓ |
| 手动粘贴授权码 | ✓ | ✓ | ✓ |
| Access / Refresh Token | ✓ | ✓ | ✓ |
| Session 登录导入 | ✓ | - | - |
| 兼容监听已有 Token 请求 | - | ✓ | - |
| 本地 JSON / TXT 导出 | ✓ | ✓ | ✓ |

- **一个入口**：不再为每个提供商安装一套临时脚本或扩展。
- **真实 OAuth**：使用各平台官方授权页和 Token 端点。
- **清晰隔离**：三套流程使用独立存储键和状态机，互不覆盖。
- **零运行依赖**：没有构建步骤，没有 npm 运行依赖，加载目录即可使用。
- **可审计**：协议、权限和数据存储均为普通 HTML/CSS/JavaScript。

## 快速开始

OpenAI、Claude 和 Antigravity 均无需填写额外配置。

### 1. 加载扩展

1. 打开 `chrome://extensions/` 或 `edge://extensions/`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目根目录，也就是包含 `manifest.json` 的目录。

### 2. 开始授权

点击浏览器工具栏中的扩展图标，选择 OpenAI、Claude 或 Antigravity，然后点击平台面板中的主按钮。

## 平台说明

### OpenAI

扩展生成 PKCE 参数并打开 OpenAI 授权页。授权完成后浏览器会访问 `localhost:1455/auth/callback`，扩展在导航发生前捕获 code 并自动交换 Token。

额外支持：

- 从 OpenAI 页面响应中捕获 Token。
- 手动输入 authorization code 和 code verifier。
- 导入 ChatGPT `sessionToken` 并写入本机登录 Cookie。
- 将最多 20 条历史记录导出为 TXT 或 JSON。

### Claude

扩展生成 Claude PKCE 授权 URL，并从 Anthropic 官方回调页面识别授权码。Token 交换在临时的 `platform.claude.com` 浏览器上下文中完成。

“监听已有请求”是兼容模式，会临时使用 `chrome.debugger` 读取 Claude Token 响应体。完成或手动停止后会立即解除监听。

### Antigravity

扩展通过内置的 Google 桌面 OAuth 流程获取 Antigravity 离线凭据：

- 六个 Antigravity/Google scope。
- `access_type=offline` 和 `prompt=consent`。
- 独立 loopback 回调 `localhost:1456/oauth-callback`。
- 自动读取 Google 邮箱和账号名称。
- 导出 `access_token`、`refresh_token`、`id_token` 和 OAuth 元数据。

## 安全边界

- OpenAI 历史 Token 保存在 `chrome.storage.local`，最多 20 条，可随时清除。
- Claude 和 Antigravity Token 保存在 `chrome.storage.session`，浏览器会话结束后自动清除。
- 扩展不会上传 Token，不接入遥测或第三方分析。
- Claude 的 `debugger` 权限只用于用户主动开启的兼容监听和浏览器上下文 Token 交换。
- 外部回调会校验主机、路径和 OAuth state，拒绝不匹配的输入。

完整说明见 [安全策略](SECURITY.md)、[隐私说明](docs/PRIVACY.md) 和 [架构文档](docs/ARCHITECTURE.md)。

## 项目结构

```text
.
├── assets/icons/             # 扩展图标
├── docs/                     # 架构与品牌资源
├── scripts/                  # 项目校验脚本
├── src/
│   ├── oauth/                # Claude / Antigravity 协议模块
│   ├── background.js         # Service worker 与消息路由
│   ├── callback.js           # Claude 回调页面识别
│   ├── content.js            # OpenAI 内容脚本桥接
│   └── injected.js           # OpenAI 页面上下文监听
├── tests/                    # Node.js 零依赖测试
├── ui/                       # Popup HTML / CSS / JavaScript
├── manifest.json
└── package.json
```

## 开发与验证

要求 Node.js 20 或更高版本，仅用于测试和校验，扩展运行本身不依赖 Node.js。

```powershell
npm test          # OAuth 解析、Token 解析与后台 smoke test
npm run check     # Manifest、路径、JavaScript 和 DOM 引用检查
npm run verify    # 执行全部质量检查
```

修改扩展后，在扩展管理页点击“重新加载”。协议或权限变更必须同步更新测试与文档。

## 常见问题

**授权回调页面显示无法访问，是否失败？**

不一定。OpenAI 和 Antigravity 使用 loopback 地址，扩展会在导航阶段捕获 code。返回弹窗查看状态即可。

**为什么 Chrome 显示“正在调试此浏览器”？**

这是 Claude 兼容监听模式使用 `chrome.debugger` 时的浏览器提示。不开启兼容监听时不会持续附加 Claude 标签页。

**Antigravity 没有返回 refresh_token？**

Google 有时不会为已经授权过的应用再次签发 refresh token。撤销该应用的历史授权后重新执行 consent 流程。


## 参与贡献

提交前运行 `npm run verify`。问题报告和开发约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

[MIT](LICENSE)
