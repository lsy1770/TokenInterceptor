(function initGrokOAuth(global) {
  'use strict';

  // Grok CLI OAuth（authorization code + PKCE S256 + loopback 回调）。
  // 客户端元数据取自 Grok CLI（grok-pager/1.0.88）登录流程。
  const CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
  const AUTHORIZE_URL = 'https://auth.x.ai/oauth2/authorize';
  const TOKEN_URL = 'https://auth.x.ai/oauth2/token';
  const REDIRECT_URI = 'http://127.0.0.1:51234/callback';
  const SCOPES = [
    'openid',
    'profile',
    'email',
    'offline_access',
    'grok-cli:access',
    'api:access',
    'conversations:read',
    'conversations:write',
    'workspaces:read',
    'workspaces:write'
  ];

  function buildAuthorizeURL(codeChallenge, state) {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('scope', SCOPES.join(' '));
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    return url.toString();
  }

  function isCallbackURL(url) {
    return url.protocol === 'http:'
      && ['127.0.0.1', 'localhost'].includes(url.hostname)
      && url.port === '51234'
      && url.pathname === '/callback';
  }

  function extractAuthorizationCode(rawValue, expectedState) {
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!value) return null;

    let code = '';
    let state = '';
    let structured = false;
    if (/^https?:\/\//i.test(value)) {
      structured = true;
      let url;
      try {
        url = new URL(value);
      } catch {
        return null;
      }
      if (!isCallbackURL(url)) return null;
      if (url.searchParams.get('error')) {
        throw new Error(`Grok 授权失败：${url.searchParams.get('error')}`);
      }
      code = url.searchParams.get('code') || '';
      state = url.searchParams.get('state') || '';
    } else if (value.includes('code=')) {
      structured = true;
      const params = new URLSearchParams(value.replace(/^\?/, ''));
      if (params.get('error')) throw new Error(`Grok 授权失败：${params.get('error')}`);
      code = params.get('code') || '';
      state = params.get('state') || '';
    } else {
      code = value.split('#', 1)[0].trim();
    }

    if (!code) return null;
    if (structured && expectedState && state !== expectedState) {
      throw new Error('OAuth state 不匹配，已拒绝交换 Token');
    }
    return { code, state };
  }

  function parseTokenResponse(rawBody) {
    if (typeof rawBody !== 'string') return null;
    let data;
    try {
      data = JSON.parse(rawBody);
    } catch {
      return null;
    }
    if (!data || typeof data.access_token !== 'string' || !data.access_token.trim()) return null;
    const expiresIn = Number(data.expires_in);
    return {
      access_token: data.access_token.trim(),
      refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token.trim() : '',
      id_token: typeof data.id_token === 'string' ? data.id_token.trim() : '',
      expires_in: Number.isFinite(expiresIn) ? expiresIn : 0,
      scope: typeof data.scope === 'string' ? data.scope.trim() : '',
      token_type: typeof data.token_type === 'string' ? data.token_type.trim() : 'Bearer'
    };
  }

  function decodeBase64URL(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function decodeIDToken(idToken) {
    const result = { email: '', givenName: '', familyName: '', name: '' };
    if (typeof idToken !== 'string' || !idToken) return result;
    const parts = idToken.split('.');
    if (parts.length < 2) return result;
    try {
      const claims = JSON.parse(decodeBase64URL(parts[1]));
      result.email = typeof claims.email === 'string' ? claims.email : '';
      result.givenName = typeof claims.given_name === 'string' ? claims.given_name : '';
      result.familyName = typeof claims.family_name === 'string' ? claims.family_name : '';
      const nameParts = [result.givenName, result.familyName].filter(Boolean);
      result.name = nameParts.join(' ');
    } catch {
      return result;
    }
    return result;
  }

  const api = {
    AUTHORIZE_URL,
    CLIENT_ID,
    REDIRECT_URI,
    SCOPES,
    TOKEN_URL,
    buildAuthorizeURL,
    decodeIDToken,
    extractAuthorizationCode,
    isCallbackURL,
    parseTokenResponse
  };
  global.GrokOAuth = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
