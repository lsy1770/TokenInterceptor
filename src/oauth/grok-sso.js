(function initGrokSSO(global) {
  'use strict';

  // Grok SSO 登录 Cookie：
  //   sso     — 只读会话 JWT（payload 为 { session_id }）
  //   sso-rw  — 读写会话 JWT（与 sso 相同）
  //   x-userid— 用户 UUID（可选，grok.com 会自行从会话解析）
  const SSO_COOKIE_NAMES = ['sso', 'sso-rw'];
  const USERID_COOKIE_NAMES = ['x-userid'];

  function decodeBase64URL(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function isLikelyGrokSSOToken(value) {
    if (typeof value !== 'string') return false;
    const token = value.trim();
    if (token.length < 50) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    if (!parts[0].startsWith('eyJ')) return false;
    try {
      const payload = JSON.parse(decodeBase64URL(parts[1]));
      return typeof payload.session_id === 'string' && payload.session_id.length > 0;
    } catch {
      return false;
    }
  }

  function parseCookieHeader(text) {
    const map = {};
    // 去掉可能的前缀「cookie:」并逐段解析
    const body = String(text).replace(/^cookie\s*:\s*/i, '');
    body.split(/;\s*/).forEach(part => {
      const index = part.indexOf('=');
      if (index <= 0) return;
      const name = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (!name || value === '') return;
      if (map[name] === undefined) map[name] = value;
    });
    return map;
  }

  function firstPresent(map, names) {
    for (const name of names) {
      if (typeof map[name] === 'string' && map[name]) return map[name];
    }
    return '';
  }

  function parseGrokSSOImport(input) {
    const text = String(input || '').trim();
    if (!text) throw new Error('请粘贴 Grok sso Cookie 或 /api/auth/session 返回的 JSON');

    // 1) 直接粘贴 sso JWT
    if (isLikelyGrokSSOToken(text)) {
      const token = text.trim();
      return { sso: token, ssoRw: token, userId: '', email: '', xUsername: '' };
    }

    // 2) Cookie 头（DevTools 复制的 cookie 字符串）
    const cookieMap = parseCookieHeader(text);
    const ssoFromCookie = firstPresent(cookieMap, SSO_COOKIE_NAMES);
    if (ssoFromCookie) {
      if (!isLikelyGrokSSOToken(ssoFromCookie)) {
        throw new Error('Cookie 中的 sso 不是有效的 Grok SSO Token');
      }
      return {
        sso: ssoFromCookie,
        ssoRw: firstPresent(cookieMap, ['sso-rw']) || ssoFromCookie,
        userId: firstPresent(cookieMap, USERID_COOKIE_NAMES),
        email: '',
        xUsername: ''
      };
    }

    // 3) /api/auth/session 返回的 JSON
    let data = null;
    if (text.startsWith('{')) {
      try { data = JSON.parse(text); }
      catch (error) { throw new Error('JSON 解析失败: ' + error.message); }
    }

    if (data && typeof data === 'object') {
      const session = data.session && typeof data.session === 'object' ? data.session : data;
      const ssoFromJSON = data.sso || data.sso_rw || session.sso || '';
      if (isLikelyGrokSSOToken(ssoFromJSON)) {
        return {
          sso: ssoFromJSON.trim(),
          ssoRw: (data.sso_rw || data.ssoRw || ssoFromJSON).trim(),
          userId: typeof session.userId === 'string' ? session.userId : '',
          email: typeof session.email === 'string' ? session.email : '',
          xUsername: typeof session.xUsername === 'string' ? session.xUsername : ''
        };
      }
      if (session.sessionId || session.userId || session.email) {
        throw new Error('JSON 中未包含 sso Cookie 值，请粘贴 Grok 的 sso Cookie（JWT）');
      }
    }

    throw new Error('未找到有效的 Grok sso Cookie');
  }

  const api = {
    SSO_COOKIE_NAMES,
    USERID_COOKIE_NAMES,
    decodeBase64URL,
    isLikelyGrokSSOToken,
    parseCookieHeader,
    parseGrokSSOImport
  };
  global.GrokSSO = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
