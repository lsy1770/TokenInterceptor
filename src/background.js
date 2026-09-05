importScripts('oauth/claude-flow.js', 'oauth/claude-token-parser.js', 'oauth/antigravity.js');

// background.js v4.1.1
// 两条获取路径：
//   A) 插件自己发起 PKCE → 拦截 localhost:1455 回调 → 换 Token
//   B) content.js 从 chatgpt.com 页面直接捕获 Token 响应

// ================================================================
// PKCE
// ================================================================
function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
async function newVerifier() { return b64url(crypto.getRandomValues(new Uint8Array(32))); }
async function mkChallenge(v) {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
}
function newState() { return b64url(crypto.getRandomValues(new Uint8Array(32))); }

// ================================================================
// 常量
// ================================================================
const CLIENT_ID    = 'app_EMoamEEZ73f0CkXaXp7hrann';
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const AUTH_BASE    = 'https://auth.openai.com/oauth/authorize';   // ← 与 Node.js 参考一致
const TOKEN_URL    = 'https://auth.openai.com/oauth/token';
const SCOPE        = 'openid profile email offline_access';        // ← 与 Node.js 参考一致
const CHATGPT_URL  = 'https://chatgpt.com/';
const SESSION_COOKIE_BASE = '__Secure-next-auth.session-token';
const SESSION_COOKIE_CHUNK_SIZE = 3900;

const CLAUDE_KEYS = {
  active: 'claudeCaptureActive',
  attachedTabs: 'claudeCaptureAttachedTabs',
  token: 'claudeCapturedToken',
  error: 'claudeCaptureError',
  oauthVerifier: 'claudeOAuthCodeVerifier',
  oauthState: 'claudeOAuthState',
  oauthURL: 'claudeOAuthAuthorizeURL',
  oauthStartedAt: 'claudeOAuthStartedAt',
  exchanging: 'claudeOAuthExchangeInProgress'
};
const CLAUDE_PAGE_HOSTS = new Set([
  'claude.com',
  'platform.claude.com',
  'console.anthropic.com',
  'api.anthropic.com'
]);
const claudePendingTokenRequests = new Map();
let claudeAttachQueue = Promise.resolve();

const ANTIGRAVITY_KEYS = {
  token: 'antigravityCapturedToken',
  error: 'antigravityError',
  oauthState: 'antigravityOAuthState',
  oauthURL: 'antigravityOAuthAuthorizeURL',
  oauthStartedAt: 'antigravityOAuthStartedAt',
  exchanging: 'antigravityOAuthExchangeInProgress'
};
const handledAntigravityCodes = new Set();

// ================================================================
// 构建授权 URL
// forceNew=false: 若 session 中已有未使用的 PKCE（5分钟内）则复用，避免
//                 多次点击导致 state 失效
// forceNew=true : 强制重新生成（用户明确要刷新时）
// ================================================================
async function buildAuthURL(forceNew = false) {
  const existing = await chrome.storage.session.get(['pkce_verifier','pkce_state','pkce_ch','pkce_ts']);
  const age = Date.now() - (existing.pkce_ts || 0);
  const FIVE_MIN = 5 * 60 * 1000;

  let verifier, ch, state;

  if (!forceNew && existing.pkce_verifier && existing.pkce_ch && age < FIVE_MIN) {
    // 复用已有的 PKCE，不重新生成，state 不变
    verifier = existing.pkce_verifier;
    ch       = existing.pkce_ch;
    state    = existing.pkce_state;
  } else {
    // 生成全新 PKCE
    verifier = await newVerifier();
    ch       = await mkChallenge(verifier);
    state    = newState();
    await chrome.storage.session.set({
      pkce_verifier : verifier,
      pkce_ch       : ch,
      pkce_state    : state,
      pkce_ts       : Date.now()
    });
  }

  const p = new URLSearchParams({
    response_type              : 'code',               // Node.js 参考中的顺序
    client_id                  : CLIENT_ID,
    redirect_uri               : REDIRECT_URI,
    scope                      : SCOPE,
    code_challenge             : ch,
    code_challenge_method      : 'S256',
    state,
    id_token_add_organizations : 'true',
    codex_cli_simplified_flow  : 'true',
    originator                 : 'codex_cli_rs'
  });
  return `${AUTH_BASE}?${p}`;
}

// ================================================================
// Token 存储
// ================================================================
let tokens = [];

async function loadTokens() {
  const r = await chrome.storage.local.get('tokens');
  tokens = r.tokens || [];
  setBadge(tokens.length);
}

async function storeToken(data, source) {
  // 去重：access_token 末尾 30 字符
  const key = (data.access_token||'').slice(-30);
  if (key && tokens.some(t => t.access_token.slice(-30) === key)) return null;

  const entry = {
    id           : Date.now(),
    capturedAt   : new Date().toISOString(),
    source,
    access_token : data.access_token  || '',
    refresh_token: data.refresh_token || '',
    id_token     : data.id_token      || '',
    token_type   : data.token_type    || 'bearer',
    scope        : data.scope         || '',
    expires_in   : data.expires_in    || 0
  };
  tokens.unshift(entry);
  if (tokens.length > 20) tokens = tokens.slice(0,20);
  await chrome.storage.local.set({ tokens });
  setBadge(tokens.length);

  return entry;
}

function setBadge(n) {
  chrome.action.setBadgeText({ text: n > 0 ? String(n) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
}

// ================================================================
// 换 Token（POST /oauth/token）
// ================================================================
async function exchangeToken(code, verifier) {
  const res = await fetch(TOKEN_URL, {
    method : 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept'      : 'application/json',               // ← 与 Node.js 参考一致
      'User-Agent'  : 'OpenAI-Codex-CLI/1.0'           // ← 与 Node.js 参考一致
    },
    body: new URLSearchParams({
      grant_type    : 'authorization_code',
      client_id     : CLIENT_ID,
      code,
      redirect_uri  : REDIRECT_URI,
      code_verifier : verifier
    }).toString()
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`解析失败(${res.status}): ${text.slice(0,150)}`); }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${data.error_description||data.error||text.slice(0,100)}`);
  if (!data.access_token) throw new Error('响应无 access_token');
  return data;
}

// ================================================================
// 处理回调 URL（tabs / webNavigation）
// ================================================================
const handledCodes = new Set();

async function handleCallbackURL(url) {
  let u; try { u = new URL(url); } catch { return; }
  if (!['localhost','127.0.0.1'].includes(u.hostname)) return;
  if (u.port !== '1455') return;
  if (!u.pathname.startsWith('/auth/callback')) return;

  const code = u.searchParams.get('code');
  if (!code) return;
  if (handledCodes.has(code.slice(0,30))) return;
  handledCodes.add(code.slice(0,30));
  setTimeout(() => handledCodes.delete(code.slice(0,30)), 120000);

  await doExchange(code);
}

async function doExchange(code) {
  const sess = await chrome.storage.session.get(['pkce_verifier','pkce_state']);
  if (!sess.pkce_verifier) {
    await chrome.storage.local.set({ pendingCode: code });
    notify('⚠️ 已捕获授权码', '点击插件图标 → 手动换取（需填 verifier）');
    return;
  }
  notify('🔄 正在换取 Token…','');
  try {
    const data = await exchangeToken(code, sess.pkce_verifier);
    await storeToken(data, 'auto_callback');
    await chrome.storage.session.remove(['pkce_verifier','pkce_state','pkce_ts']);
    await chrome.storage.local.remove(['pendingCode','pendingVerifier']);
    notify('✅ Token 已获取！','点击插件图标查看并导出');
  } catch (err) {
    await chrome.storage.local.set({ pendingCode: code, pendingVerifier: sess.pkce_verifier });
    notify('❌ 换取失败', err.message.slice(0,100));
  }
}

// ================================================================
// 监听 tabs / webNavigation
// ================================================================
chrome.webNavigation.onBeforeNavigate.addListener(
  d => {
    if (d.frameId !== 0) return;
    void handleCallbackURL(d.url);
    void handleAntigravityCallbackURL(d.url);
  }
);
chrome.tabs.onUpdated.addListener((id, info) => {
  if (!info.url) return;
  void handleCallbackURL(info.url);
  void handleAntigravityCallbackURL(info.url);
});

// ================================================================
// 消息处理
// ================================================================

// ================================================================
// ChatGPT sessionToken import login
// ================================================================
function parseChatGPTSessionImport(input) {
  const text = String(input || '').trim();
  if (!text) throw new Error('请粘贴 sessionToken 或 /api/auth/session 返回的 JSON');

  const cookieToken = extractSessionTokenFromCookieHeader(text);
  if (cookieToken) return { sessionToken: cookieToken };

  let data = null;
  if (text.startsWith('{')) {
    try { data = JSON.parse(text); }
    catch (e) { throw new Error('JSON 解析失败: ' + e.message); }
  }

  if (!data) {
    const m = text.match(/"sessionToken"\s*:\s*"((?:\\.|[^"\\])+)"/);
    if (m) {
      try { data = { sessionToken: JSON.parse('"' + m[1] + '"') }; }
      catch { data = { sessionToken: m[1] }; }
    }
  }

  if (!data) data = { sessionToken: text };

  const sessionToken = data.sessionToken || data.session_token || data.token;
  if (!isLikelyChatGPTSessionToken(sessionToken)) {
    throw new Error('未找到有效的 ChatGPT sessionToken');
  }

  return {
    sessionToken,
    expires: data.expires,
    accessToken: data.accessToken || data.access_token || '',
    user: data.user || null,
    account: data.account || null
  };
}

function extractSessionTokenFromCookieHeader(text) {
  const chunks = [];
  let single = '';
  text.split(/;\s*/).forEach(part => {
    const i = part.indexOf('=');
    if (i <= 0) return;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (name === SESSION_COOKIE_BASE) single = value;
    if (name.startsWith(SESSION_COOKIE_BASE + '.')) {
      const n = Number(name.slice(SESSION_COOKIE_BASE.length + 1));
      if (Number.isInteger(n) && n >= 0) chunks[n] = value;
    }
  });
  if (chunks.length && chunks.filter(v => typeof v === 'string').length === chunks.length) return chunks.join('');
  return single;
}

function isLikelyChatGPTSessionToken(value) {
  if (typeof value !== 'string') return false;
  const token = value.trim();
  if (token.length < 100) return false;
  const parts = token.split('.');
  return parts.length === 5 && token.startsWith('eyJ');
}

function chunkString(value, size) {
  const chunks = [];
  for (let i = 0; i < value.length; i += size) chunks.push(value.slice(i, i + size));
  return chunks;
}

function parseCookieExpiry(expires) {
  if (expires) {
    const ms = Date.parse(expires);
    if (!Number.isFinite(ms)) throw new Error('expires 时间格式无效');
    if (ms <= Date.now()) throw new Error('sessionToken 已过期');
    return Math.floor(ms / 1000);
  }
  return Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000);
}

function cookiesGetAll(details) {
  return new Promise((resolve, reject) => {
    chrome.cookies.getAll(details, cookies => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message)); else resolve(cookies || []);
    });
  });
}

function cookiesSet(details) {
  return new Promise((resolve, reject) => {
    chrome.cookies.set(details, cookie => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else if (!cookie) reject(new Error('Cookie 写入失败'));
      else resolve(cookie);
    });
  });
}

function cookiesRemove(details) {
  return new Promise((resolve, reject) => {
    chrome.cookies.remove(details, removed => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message)); else resolve(removed);
    });
  });
}

async function clearChatGPTSessionCookies() {
  if (!chrome.cookies) throw new Error('缺少 cookies 权限，请重新加载扩展');
  const cookies = await cookiesGetAll({ url: CHATGPT_URL });
  const targets = cookies.filter(c =>
    c.name === SESSION_COOKIE_BASE ||
    c.name.startsWith(SESSION_COOKIE_BASE + '.') ||
    c.name === 'next-auth.session-token' ||
    c.name.startsWith('next-auth.session-token.')
  );
  await Promise.all(targets.map(c => cookiesRemove({ url: CHATGPT_URL, name: c.name })));
}

async function writeChatGPTSessionCookies(sessionToken, expires) {
  await clearChatGPTSessionCookies();

  const expirationDate = parseCookieExpiry(expires);
  const chunks = chunkString(sessionToken.trim(), SESSION_COOKIE_CHUNK_SIZE);
  const baseDetails = {
    url: CHATGPT_URL,
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    expirationDate
  };

  if (chunks.length === 1) {
    await cookiesSet({ ...baseDetails, name: SESSION_COOKIE_BASE, value: chunks[0] });
  } else {
    for (let i = 0; i < chunks.length; i++) {
      await cookiesSet({ ...baseDetails, name: SESSION_COOKIE_BASE + '.' + i, value: chunks[i] });
    }
  }

  await cookiesSet({
    url: CHATGPT_URL,
    path: '/',
    name: '__Secure-next-auth.callback-url',
    value: 'https%3A%2F%2Fchatgpt.com',
    secure: true,
    httpOnly: false,
    sameSite: 'lax',
    expirationDate
  });

  return { chunkCount: chunks.length, expiresAt: new Date(expirationDate * 1000).toISOString() };
}

function jwtExpiresIn(token) {
  try {
    const part = String(token).split('.')[1];
    if (!part) return 0;
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return json.exp ? Math.max(0, json.exp - Math.floor(Date.now() / 1000)) : 0;
  } catch { return 0; }
}

async function importChatGPTSession(input) {
  const parsed = parseChatGPTSessionImport(input);
  const cookieInfo = await writeChatGPTSessionCookies(parsed.sessionToken, parsed.expires);

  let accessTokenStored = false;
  if (parsed.accessToken) {
    await loadTokens();
    const entry = await storeToken({
      access_token: parsed.accessToken,
      token_type: 'bearer',
      expires_in: jwtExpiresIn(parsed.accessToken)
    }, 'session_import');
    accessTokenStored = !!entry;
  }

  await chrome.storage.local.set({
    lastChatGPTSessionImport: {
      importedAt: new Date().toISOString(),
      email: parsed.user && parsed.user.email || '',
      planType: parsed.account && parsed.account.planType || '',
      expiresAt: cookieInfo.expiresAt,
      chunkCount: cookieInfo.chunkCount,
      accessTokenStored
    }
  });

  return {
    ok: true,
    email: parsed.user && parsed.user.email || '',
    planType: parsed.account && parsed.account.planType || '',
    expiresAt: cookieInfo.expiresAt,
    chunkCount: cookieInfo.chunkCount,
    accessTokenStored
  };
}

// ================================================================
// Claude OAuth 与兼容捕获
// ================================================================
function randomBase64URL(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

async function createPKCE() {
  const verifier = randomBase64URL(32);
  return { verifier, challenge: await mkChallenge(verifier) };
}

function isAllowedClaudePage(rawURL) {
  try {
    const { protocol, hostname } = new URL(rawURL);
    return protocol === 'https:'
      && (CLAUDE_PAGE_HOSTS.has(hostname) || hostname.endsWith('.claude.com'));
  } catch {
    return false;
  }
}

function debuggerAttach(tabId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      chrome.debugger.sendCommand({ tabId }, 'Network.enable', {}, () => {
        const enableError = chrome.runtime.lastError;
        if (enableError) {
          chrome.debugger.detach({ tabId }, () => reject(new Error(enableError.message)));
          return;
        }
        resolve();
      });
    });
  });
}

function debuggerDetach(tabId) {
  return new Promise(resolve => chrome.debugger.detach({ tabId }, () => resolve()));
}

function debuggerCommand(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, result => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}

async function waitForTabComplete(tabId, timeoutMs = 20000) {
  const currentTab = await chrome.tabs.get(tabId);
  if (currentTab.status === 'complete') return;
  await new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
    };
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      cleanup();
      resolve();
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('Claude Token 页面加载超时'));
    }, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function generateClaudeAuthorizationURL() {
  await stopClaudeCapture();
  const pkce = await createPKCE();
  const state = randomBase64URL(32);
  const url = ClaudeOAuthFlow.buildAuthorizeURL(pkce.challenge, state);
  await chrome.storage.session.set({
    [CLAUDE_KEYS.oauthVerifier]: pkce.verifier,
    [CLAUDE_KEYS.oauthState]: state,
    [CLAUDE_KEYS.oauthURL]: url,
    [CLAUDE_KEYS.oauthStartedAt]: new Date().toISOString(),
    [CLAUDE_KEYS.exchanging]: false
  });
  await chrome.storage.session.remove([CLAUDE_KEYS.token, CLAUDE_KEYS.error]);
  await chrome.tabs.create({ url, active: true });
  return url;
}

async function exchangeTokenInClaudeTab(payload) {
  const tab = await chrome.tabs.create({ url: ClaudeOAuthFlow.TOKEN_URL, active: false });
  if (!Number.isInteger(tab.id)) throw new Error('无法创建 Claude Token 交换标签页');

  let attached = false;
  try {
    await waitForTabComplete(tab.id);
    await debuggerAttach(tab.id);
    attached = true;
    await debuggerCommand(tab.id, 'Network.setUserAgentOverride', {
      userAgent: 'claude-cli/2.1.97 (external, cli)',
      acceptLanguage: 'en-US,en;q=0.9',
      platform: 'Windows'
    });
    const requestBody = JSON.stringify(payload);
    const expression = `
      (async () => {
        const response = await fetch(${JSON.stringify(ClaudeOAuthFlow.TOKEN_URL)}, {
          method: 'POST',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json'
          },
          body: ${JSON.stringify(requestBody)}
        });
        return {
          status: response.status,
          retryAfter: response.headers.get('retry-after') || '',
          body: await response.text()
        };
      })()
    `;
    const evaluation = await debuggerCommand(tab.id, 'Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (evaluation?.exceptionDetails) throw new Error('Claude 浏览器上下文执行 Token 交换失败');
    const result = evaluation?.result?.value;
    if (!result || !Number.isInteger(result.status)) {
      throw new Error('Claude Token 交换没有返回有效响应');
    }
    return result;
  } finally {
    if (attached) await debuggerDetach(tab.id);
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function exchangeClaudeAuthorizationCode(rawValue) {
  const stored = await chrome.storage.session.get([
    CLAUDE_KEYS.oauthVerifier,
    CLAUDE_KEYS.oauthState,
    CLAUDE_KEYS.exchanging
  ]);
  if (stored[CLAUDE_KEYS.exchanging]) return;
  const verifier = stored[CLAUDE_KEYS.oauthVerifier];
  const expectedState = stored[CLAUDE_KEYS.oauthState];
  if (!verifier || !expectedState) throw new Error('请先生成 Claude 授权 URL');

  const callback = ClaudeOAuthFlow.extractAuthorizationCode(rawValue, expectedState);
  if (!callback?.code) throw new Error('没有找到有效的 authorization code');
  await chrome.storage.session.set({ [CLAUDE_KEYS.exchanging]: true });
  try {
    const response = await exchangeTokenInClaudeTab({
      grant_type: 'authorization_code',
      client_id: ClaudeOAuthFlow.CLIENT_ID,
      code: callback.code,
      redirect_uri: callback.redirectURI || ClaudeOAuthFlow.REDIRECT_URI,
      code_verifier: verifier,
      state: expectedState
    });
    if (response.status < 200 || response.status >= 300) {
      const retryHint = response.retryAfter ? `，${response.retryAfter} 秒后重试` : '';
      throw new Error(`Claude Token 交换失败（HTTP ${response.status}${retryHint}）`);
    }
    const token = ClaudeOAuthTokenParser.parseTokenResponse(response.body, ClaudeOAuthFlow.TOKEN_URL);
    if (!token) throw new Error('Token 响应中没有同时找到 access_token 和 refresh_token');
    await chrome.storage.session.set({
      [CLAUDE_KEYS.token]: token,
      [CLAUDE_KEYS.error]: '',
      [CLAUDE_KEYS.exchanging]: false
    });
    await chrome.storage.session.remove([
      CLAUDE_KEYS.oauthVerifier,
      CLAUDE_KEYS.oauthState,
      CLAUDE_KEYS.oauthStartedAt
    ]);
    await stopClaudeCapture();
  } catch (error) {
    await chrome.storage.session.set({
      [CLAUDE_KEYS.error]: error.message,
      [CLAUDE_KEYS.exchanging]: false
    });
    throw error;
  }
}

async function getClaudeAttachedTabs() {
  const stored = await chrome.storage.session.get(CLAUDE_KEYS.attachedTabs);
  const tabIds = stored[CLAUDE_KEYS.attachedTabs];
  return Array.isArray(tabIds) ? tabIds.filter(Number.isInteger) : [];
}

async function setClaudeAttachedTabs(tabIds) {
  await chrome.storage.session.set({ [CLAUDE_KEYS.attachedTabs]: [...new Set(tabIds)] });
}

async function attachClaudeTab(tabId, rawURL) {
  if (!Number.isInteger(tabId) || !isAllowedClaudePage(rawURL)) return;
  const attachedTabs = await getClaudeAttachedTabs();
  if (attachedTabs.includes(tabId)) return;
  try {
    await debuggerAttach(tabId);
    await setClaudeAttachedTabs([...attachedTabs, tabId]);
    await chrome.storage.session.remove(CLAUDE_KEYS.error);
  } catch (error) {
    await chrome.storage.session.set({
      [CLAUDE_KEYS.error]: `无法监听 Claude 标签页：${error.message}`
    });
  }
}

async function attachExistingClaudeTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) await attachClaudeTab(tab.id, tab.url);
}

async function stopClaudeCapture() {
  const attachedTabs = await getClaudeAttachedTabs();
  await Promise.all(attachedTabs.map(debuggerDetach));
  await chrome.storage.session.set({
    [CLAUDE_KEYS.active]: false,
    [CLAUDE_KEYS.attachedTabs]: []
  });
}

async function startClaudeCapture() {
  await stopClaudeCapture();
  await chrome.storage.session.set({
    [CLAUDE_KEYS.active]: true,
    [CLAUDE_KEYS.attachedTabs]: []
  });
  await chrome.storage.session.remove([CLAUDE_KEYS.token, CLAUDE_KEYS.error]);
  await attachExistingClaudeTabs();
}

function decodeBase64UTF8(value) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function captureClaudeResponseBody(debuggee, requestId, sourceURL) {
  try {
    const result = await debuggerCommand(debuggee.tabId, 'Network.getResponseBody', { requestId });
    const rawBody = result.base64Encoded ? decodeBase64UTF8(result.body) : result.body;
    const token = ClaudeOAuthTokenParser.parseTokenResponse(rawBody, sourceURL);
    if (!token) {
      await chrome.storage.session.set({
        [CLAUDE_KEYS.error]: 'Token 响应中没有同时找到 access_token 和 refresh_token'
      });
      return;
    }
    await chrome.storage.session.set({
      [CLAUDE_KEYS.token]: token,
      [CLAUDE_KEYS.error]: ''
    });
    await stopClaudeCapture();
  } catch (error) {
    await chrome.storage.session.set({
      [CLAUDE_KEYS.error]: error.message || '读取 Token 响应失败'
    });
  }
}

async function getClaudeState() {
  const state = await chrome.storage.session.get(Object.values(CLAUDE_KEYS));
  return {
    captureActive: Boolean(state[CLAUDE_KEYS.active]),
    capturedToken: state[CLAUDE_KEYS.token] || null,
    captureError: state[CLAUDE_KEYS.error] || '',
    oauthAuthorizeURL: state[CLAUDE_KEYS.oauthURL] || '',
    oauthCodeVerifier: state[CLAUDE_KEYS.oauthVerifier] || '',
    oauthState: state[CLAUDE_KEYS.oauthState] || '',
    oauthExchangeInProgress: Boolean(state[CLAUDE_KEYS.exchanging])
  };
}

// ================================================================
// Antigravity Google OAuth
// ================================================================
async function generateAntigravityAuthorizationURL() {
  const state = randomBase64URL(32);
  const authURL = AntigravityOAuth.buildAuthorizeURL(state);
  await chrome.storage.session.set({
    [ANTIGRAVITY_KEYS.oauthState]: state,
    [ANTIGRAVITY_KEYS.oauthURL]: authURL,
    [ANTIGRAVITY_KEYS.oauthStartedAt]: new Date().toISOString(),
    [ANTIGRAVITY_KEYS.exchanging]: false
  });
  await chrome.storage.session.remove([ANTIGRAVITY_KEYS.token, ANTIGRAVITY_KEYS.error]);
  await chrome.tabs.create({ url: authURL, active: true });
  return authURL;
}

function antigravityTokenError(status, body) {
  try {
    const data = JSON.parse(body);
    return data.error_description || data.error || `HTTP ${status}`;
  } catch {
    return body.slice(0, 160) || `HTTP ${status}`;
  }
}

async function fetchAntigravityUserInfo(accessToken) {
  const response = await fetch(AntigravityOAuth.USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error(`Google 用户信息请求失败（HTTP ${response.status}）`);
  const data = await response.json();
  return {
    email: typeof data.email === 'string' ? data.email : '',
    name: typeof data.name === 'string' ? data.name : ''
  };
}

async function exchangeAntigravityAuthorizationCode(rawValue) {
  const stored = await chrome.storage.session.get([
    ANTIGRAVITY_KEYS.oauthState,
    ANTIGRAVITY_KEYS.exchanging
  ]);
  if (stored[ANTIGRAVITY_KEYS.exchanging]) return;
  const expectedState = stored[ANTIGRAVITY_KEYS.oauthState];
  if (!expectedState) throw new Error('请先生成 Antigravity 授权 URL');

  const callback = AntigravityOAuth.extractAuthorizationCode(rawValue, expectedState);
  if (!callback?.code) throw new Error('没有找到有效的 Antigravity authorization code');
  await chrome.storage.session.set({ [ANTIGRAVITY_KEYS.exchanging]: true });

  try {
    const response = await fetch(AntigravityOAuth.TOKEN_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: AntigravityOAuth.CLIENT_ID,
        client_secret: AntigravityOAuth.CLIENT_SECRET,
        code: callback.code,
        redirect_uri: AntigravityOAuth.REDIRECT_URI,
        grant_type: 'authorization_code'
      }).toString()
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Antigravity Token 交换失败：${antigravityTokenError(response.status, body)}`);
    }
    const parsed = AntigravityOAuth.parseTokenResponse(body);
    if (!parsed) throw new Error('Antigravity Token 响应缺少 access_token');

    let userInfo = { email: '', name: '' };
    let userInfoError = '';
    try {
      userInfo = await fetchAntigravityUserInfo(parsed.access_token);
    } catch (error) {
      userInfoError = error.message;
    }
    const capturedAt = new Date();
    const token = {
      provider: 'antigravity',
      ...parsed,
      email: userInfo.email,
      name: userInfo.name,
      userinfo_error: userInfoError,
      captured_at: capturedAt.toISOString(),
      expires_at: parsed.expires_in
        ? new Date(capturedAt.getTime() + parsed.expires_in * 1000).toISOString()
        : '',
      oauth_client_key: 'antigravity_enterprise',
      client_id: AntigravityOAuth.CLIENT_ID,
      redirect_uri: AntigravityOAuth.REDIRECT_URI,
      token_url: AntigravityOAuth.TOKEN_URL
    };
    await chrome.storage.session.set({
      [ANTIGRAVITY_KEYS.token]: token,
      [ANTIGRAVITY_KEYS.error]: '',
      [ANTIGRAVITY_KEYS.exchanging]: false
    });
    await chrome.storage.session.remove([
      ANTIGRAVITY_KEYS.oauthState,
      ANTIGRAVITY_KEYS.oauthStartedAt
    ]);
    return token;
  } catch (error) {
    await chrome.storage.session.set({
      [ANTIGRAVITY_KEYS.error]: error.message,
      [ANTIGRAVITY_KEYS.exchanging]: false
    });
    throw error;
  }
}

async function getAntigravityState() {
  const state = await chrome.storage.session.get(Object.values(ANTIGRAVITY_KEYS));
  return {
    capturedToken: state[ANTIGRAVITY_KEYS.token] || null,
    error: state[ANTIGRAVITY_KEYS.error] || '',
    oauthAuthorizeURL: state[ANTIGRAVITY_KEYS.oauthURL] || '',
    oauthPending: Boolean(state[ANTIGRAVITY_KEYS.oauthState]),
    exchanging: Boolean(state[ANTIGRAVITY_KEYS.exchanging])
  };
}

async function handleAntigravityCallbackURL(rawURL) {
  let url;
  try {
    url = new URL(rawURL);
  } catch {
    return;
  }
  if (!AntigravityOAuth.isCallbackURL(url)) return;
  const code = url.searchParams.get('code');
  if (!code) {
    const oauthError = url.searchParams.get('error');
    if (oauthError) {
      await chrome.storage.session.set({
        [ANTIGRAVITY_KEYS.error]: `Google 授权失败：${oauthError}`
      });
    }
    return;
  }
  const codeKey = code.slice(0, 40);
  if (handledAntigravityCodes.has(codeKey)) return;
  handledAntigravityCodes.add(codeKey);
  setTimeout(() => handledAntigravityCodes.delete(codeKey), 120000);
  try {
    await exchangeAntigravityAuthorizationCode(rawURL);
    notify('Antigravity Token 已获取', '点击扩展图标查看并复制');
  } catch (error) {
    notify('Antigravity Token 获取失败', error.message.slice(0, 100));
  }
}

function notify(title, message) {
  chrome.notifications.create('oai'+Date.now(), {
    type:'basic', iconUrl:'assets/icons/icon48.png', title, message
  });
}

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  run(msg, sender).then(send).catch(e => send({ ok:false, error:e.message }));
  return true;
});

async function run(msg, sender) {
  switch (msg.type) {

    // ── 路径 A：插件主动发起授权 ──
    // forceNew=true 时强制刷新 PKCE（popup 点「重新生成」时用）
    case 'START_AUTH': {
      const url = await buildAuthURL(msg.forceNew || false);
      await chrome.tabs.create({ url });
      return { ok: true, url };
    }

    // ── 仅获取授权 URL，不打开新标签（popup 展示用）──
    case 'GET_AUTH_URL': {
      const url = await buildAuthURL(msg.forceNew || false);
      return { ok: true, url };
    }

    // ── 路径 B：content.js 从页面捕获到完整 Token ──
    case 'TOKEN_FROM_PAGE': {
      if (!msg.data || !msg.data.access_token) return { ok:false };
      const entry = await storeToken(msg.data, 'page_capture');
      if (entry) notify('✅ 已从页面捕获 Token！','点击插件图标查看并导出');
      return { ok: !!entry };
    }

    // ── 路径 B 辅助：content.js 捕获到回调 code ──
    case 'CALLBACK_CODE': {
      if (!msg.code) return { ok:false };
      if (handledCodes.has(msg.code.slice(0,30))) return { ok:true };
      handledCodes.add(msg.code.slice(0,30));
      setTimeout(() => handledCodes.delete(msg.code.slice(0,30)), 120000);
      await doExchange(msg.code);
      return { ok:true };
    }

    // ── Popup 请求 ──
    case 'GET_TOKENS': {
      const r = await chrome.storage.local.get(['tokens','pendingCode','pendingVerifier']);
      return { ok:true, tokens:r.tokens||[], pendingCode:r.pendingCode||'', pendingVerifier:r.pendingVerifier||'' };
    }

    case 'MANUAL_EXCHANGE': {
      if (!msg.code || !msg.verifier) throw new Error('code 和 verifier 均必填');
      const data = await exchangeToken(msg.code, msg.verifier);
      await storeToken(data, 'manual');
      await chrome.storage.local.remove(['pendingCode','pendingVerifier']);
      return { ok:true };
    }

    case 'IMPORT_CHATGPT_SESSION': {
      const result = await importChatGPTSession(msg.payload);
      if (msg.openChatGPT) await chrome.tabs.create({ url: CHATGPT_URL });
      notify('ChatGPT session 已导入', result.email || 'Cookie 已写入 chatgpt.com');
      return result;
    }

    case 'CLEAR_TOKENS': {
      tokens = [];
      await chrome.storage.local.set({ tokens:[] });
      setBadge(0);
      return { ok:true };
    }

    case 'CLEAR_PENDING':
      await chrome.storage.local.remove(['pendingCode','pendingVerifier']);
      return { ok:true };

    // ── 只打开 URL（不重新生成 PKCE）──
    case 'OPEN_URL': {
      if (!msg.url) throw new Error('No URL');
      await chrome.tabs.create({ url: msg.url });
      return { ok: true };
    }

    // ── 返回当前 session 里的 verifier（供 popup 填入手动换取框）──
    case 'GET_VERIFIER': {
      const s = await chrome.storage.session.get('pkce_verifier');
      return { ok: true, verifier: s.pkce_verifier || '' };
    }

    case 'CLAUDE_GET_STATE':
      return { ok: true, state: await getClaudeState() };

    case 'CLAUDE_GENERATE_AUTH':
      return { ok: true, url: await generateClaudeAuthorizationURL() };

    case 'CLAUDE_EXCHANGE':
    case 'CLAUDE_CALLBACK_CANDIDATE':
      await exchangeClaudeAuthorizationCode(msg.value);
      return { ok: true };

    case 'CLAUDE_CAPTURE_START':
      await startClaudeCapture();
      return { ok: true };

    case 'CLAUDE_CAPTURE_STOP':
      await stopClaudeCapture();
      return { ok: true };

    case 'CLAUDE_CLEAR':
      await stopClaudeCapture();
      await chrome.storage.session.remove([
        CLAUDE_KEYS.token,
        CLAUDE_KEYS.error,
        CLAUDE_KEYS.oauthVerifier,
        CLAUDE_KEYS.oauthState,
        CLAUDE_KEYS.oauthURL,
        CLAUDE_KEYS.oauthStartedAt,
        CLAUDE_KEYS.exchanging
      ]);
      return { ok: true };

    case 'ANTIGRAVITY_GET_STATE':
      return { ok: true, state: await getAntigravityState() };

    case 'ANTIGRAVITY_GENERATE_AUTH':
      return {
        ok: true,
        url: await generateAntigravityAuthorizationURL()
      };

    case 'ANTIGRAVITY_EXCHANGE':
      await exchangeAntigravityAuthorizationCode(msg.value);
      return { ok: true };

    case 'ANTIGRAVITY_CLEAR':
      await chrome.storage.session.remove(Object.values(ANTIGRAVITY_KEYS));
      return { ok: true };

    default: throw new Error('Unknown: '+msg.type);
  }
}

// ================================================================
// 初始化
// ================================================================
chrome.runtime.onInstalled.addListener(loadTokens);
chrome.runtime.onStartup.addListener(loadTokens);
loadTokens();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && !tab.url) return;
  chrome.storage.session.get(CLAUDE_KEYS.active).then(stored => {
    if (!stored[CLAUDE_KEYS.active]) return;
    claudeAttachQueue = claudeAttachQueue.then(
      () => attachClaudeTab(tabId, changeInfo.url || tab.url)
    );
  });
});

chrome.debugger.onEvent.addListener((debuggee, method, params) => {
  if (method === 'Network.responseReceived') {
    const sourceURL = params?.response?.url || '';
    if (ClaudeOAuthTokenParser.isClaudeTokenEndpoint(sourceURL)) {
      claudePendingTokenRequests.set(`${debuggee.tabId}:${params.requestId}`, sourceURL);
    }
  }
  if (method === 'Network.loadingFinished') {
    const key = `${debuggee.tabId}:${params.requestId}`;
    const sourceURL = claudePendingTokenRequests.get(key);
    if (sourceURL) {
      claudePendingTokenRequests.delete(key);
      void captureClaudeResponseBody(debuggee, params.requestId, sourceURL);
    }
  }
  if (method === 'Network.loadingFailed') {
    claudePendingTokenRequests.delete(`${debuggee.tabId}:${params.requestId}`);
  }
});

chrome.debugger.onDetach.addListener(debuggee => {
  if (!Number.isInteger(debuggee.tabId)) return;
  void getClaudeAttachedTabs().then(tabIds => (
    setClaudeAttachedTabs(tabIds.filter(tabId => tabId !== debuggee.tabId))
  ));
});
