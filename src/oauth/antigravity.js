(function initAntigravityOAuth(global) {
  'use strict';

  const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
  const TOKEN_URL = 'https://oauth2.googleapis.com/token';
  const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
  const REDIRECT_URI = 'http://localhost:1456/oauth-callback';
  const CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
  const SCOPES = [
    'openid',
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cclog',
    'https://www.googleapis.com/auth/experimentsandconfigs'
  ];

  function buildAuthorizeURL(state) {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPES.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('state', state);
    return url.toString();
  }

  function isCallbackURL(url) {
    return url.protocol === 'http:'
      && ['localhost', '127.0.0.1'].includes(url.hostname)
      && url.port === '1456'
      && url.pathname === '/oauth-callback';
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
        throw new Error(`Google 授权失败：${url.searchParams.get('error')}`);
      }
      code = url.searchParams.get('code') || '';
      state = url.searchParams.get('state') || '';
    } else if (value.includes('code=')) {
      structured = true;
      const params = new URLSearchParams(value.replace(/^\?/, ''));
      if (params.get('error')) throw new Error(`Google 授权失败：${params.get('error')}`);
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

  const api = {
    AUTHORIZE_URL,
    CLIENT_ID,
    REDIRECT_URI,
    SCOPES,
    TOKEN_URL,
    USERINFO_URL,
    buildAuthorizeURL,
    extractAuthorizationCode,
    isCallbackURL,
    parseTokenResponse
  };
  global.AntigravityOAuth = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
