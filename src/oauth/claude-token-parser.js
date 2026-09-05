(function initClaudeTokenParser(global) {
  'use strict';

  const TOKEN_ENDPOINTS = new Set([
    'https://platform.claude.com/v1/oauth/token',
    'https://api.anthropic.com/v1/oauth/token'
  ]);

  function normalizeEndpoint(rawURL) {
    try {
      const url = new URL(rawURL);
      return `${url.protocol}//${url.hostname}${url.pathname.replace(/\/$/, '')}`;
    } catch {
      return '';
    }
  }

  function isClaudeTokenEndpoint(rawURL) {
    return TOKEN_ENDPOINTS.has(normalizeEndpoint(rawURL));
  }

  function readString(record, snakeCaseKey, camelCaseKey) {
    const value = record[snakeCaseKey] ?? record[camelCaseKey];
    return typeof value === 'string' ? value.trim() : '';
  }

  function findTokenObject(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 5) return null;
    if (!Array.isArray(value)) {
      const accessToken = readString(value, 'access_token', 'accessToken');
      const refreshToken = readString(value, 'refresh_token', 'refreshToken');
      if (accessToken && refreshToken) return value;
    }
    for (const nestedValue of Object.values(value)) {
      const found = findTokenObject(nestedValue, depth + 1);
      if (found) return found;
    }
    return null;
  }

  function normalizeScope(scope) {
    if (Array.isArray(scope)) return scope.filter(item => typeof item === 'string').join(' ');
    return typeof scope === 'string' ? scope.trim() : '';
  }

  function parseTokenResponse(rawBody, sourceURL) {
    if (!isClaudeTokenEndpoint(sourceURL) || typeof rawBody !== 'string') return null;
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return null;
    }
    const tokenObject = findTokenObject(payload);
    if (!tokenObject) return null;
    const expiresInValue = tokenObject.expires_in ?? tokenObject.expiresIn;
    return {
      access_token: readString(tokenObject, 'access_token', 'accessToken'),
      refresh_token: readString(tokenObject, 'refresh_token', 'refreshToken'),
      expires_in: Number.isFinite(Number(expiresInValue)) ? Number(expiresInValue) : 0,
      scope: normalizeScope(tokenObject.scope ?? tokenObject.scopes),
      token_type: readString(tokenObject, 'token_type', 'tokenType'),
      captured_at: new Date().toISOString(),
      source_url: normalizeEndpoint(sourceURL)
    };
  }

  const api = { isClaudeTokenEndpoint, normalizeEndpoint, parseTokenResponse };
  global.ClaudeOAuthTokenParser = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
