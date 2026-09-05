(function initClaudeOAuthFlow(global) {
  'use strict';

  const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
  const AUTHORIZE_URL = 'https://claude.com/cai/oauth/authorize';
  const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
  const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
  const SCOPES = [
    'org:create_api_key',
    'user:profile',
    'user:inference',
    'user:sessions:claude_code',
    'user:mcp_servers',
    'user:file_upload'
  ];
  const CALLBACK_HOSTS = new Set(['console.anthropic.com', 'platform.claude.com']);

  function normalizeCallbackURL(rawValue) {
    try {
      const url = new URL(rawValue);
      if (url.protocol !== 'https:' || !CALLBACK_HOSTS.has(url.hostname)
          || url.pathname !== '/oauth/code/callback') {
        return '';
      }
      return `${url.protocol}//${url.hostname}${url.pathname}`;
    } catch {
      return '';
    }
  }

  function buildAuthorizeURL(codeChallenge, state) {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('code', 'true');
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('scope', SCOPES.join(' '));
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    return url.toString();
  }

  function readCodeFromURL(rawValue) {
    try {
      const url = new URL(rawValue);
      const queryCode = url.searchParams.get('code');
      if (queryCode) {
        return {
          code: queryCode,
          state: url.searchParams.get('state') || '',
          redirectURI: normalizeCallbackURL(rawValue)
        };
      }

      const fragment = url.hash.replace(/^#\??/, '');
      const params = new URLSearchParams(fragment);
      const fragmentCode = params.get('code');
      if (fragmentCode) {
        return {
          code: fragmentCode,
          state: params.get('state') || '',
          redirectURI: normalizeCallbackURL(rawValue)
        };
      }
    } catch {
      return null;
    }
    return null;
  }

  function extractAuthorizationCode(rawValue, expectedState) {
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!value) return null;

    const isCallbackValue = /^https?:\/\//i.test(value) || value.includes('code=') || value.includes('#');
    const isStructuredCallback = /^https?:\/\//i.test(value) || value.includes('code=');
    let result = readCodeFromURL(value);
    if (!result && value.includes('code=')) {
      const params = new URLSearchParams(value.replace(/^\?/, ''));
      const code = params.get('code');
      if (code) result = { code, state: params.get('state') || '', redirectURI: '' };
    }
    if (!result && isStructuredCallback) return null;
    if (!result) {
      const separatorIndex = value.indexOf('#');
      result = separatorIndex > 0
        ? { code: value.slice(0, separatorIndex).trim(), state: value.slice(separatorIndex + 1).trim() }
        : { code: value, state: '' };
    }
    if (!result.code) return null;
    if (isCallbackValue && expectedState && result.state !== expectedState) {
      throw new Error('OAuth state 不匹配，已拒绝交换 Token');
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
    extractAuthorizationCode,
    normalizeCallbackURL
  };
  global.ClaudeOAuthFlow = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
