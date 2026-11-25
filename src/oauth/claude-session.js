(function initClaudeSession(global) {
  'use strict';

  // Claude 网页登录 Cookie：
  //   sessionKey           — 主会话密钥（sk-ant-sid01-...），登录必需
  //   lastActiveOrg        — 上次使用的组织 UUID（可选）
  //   anthropic-device-id  — 设备标识（可选）
  //   routingHint          — 路由提示（可选）
  const SESSION_COOKIE_NAMES = ['sessionKey', 'lastActiveOrg', 'anthropic-device-id', 'routingHint'];

  function isLikelyClaudeSessionKey(value) {
    if (typeof value !== 'string') return false;
    const token = value.trim();
    return token.startsWith('sk-ant-') && token.length >= 20;
  }

  function parseCookieHeader(text) {
    const map = {};
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

  function parseClaudeSessionImport(input) {
    const text = String(input || '').trim();
    if (!text) throw new Error('请粘贴 Claude sessionKey 或 Cookie 字符串');

    // 1) 直接粘贴 sessionKey
    if (isLikelyClaudeSessionKey(text)) {
      return {
        sessionKey: text.trim(),
        lastActiveOrg: '',
        anthropicDeviceId: '',
        routingHint: ''
      };
    }

    // 2) Cookie 头（DevTools 复制的 cookie 字符串）
    const cookieMap = parseCookieHeader(text);
    const sessionKeyFromCookie = cookieMap.sessionKey || '';
    if (sessionKeyFromCookie) {
      if (!isLikelyClaudeSessionKey(sessionKeyFromCookie)) {
        throw new Error('Cookie 中的 sessionKey 不是有效的 Claude sessionKey');
      }
      return {
        sessionKey: sessionKeyFromCookie,
        lastActiveOrg: cookieMap.lastActiveOrg || '',
        anthropicDeviceId: cookieMap['anthropic-device-id'] || '',
        routingHint: cookieMap.routingHint || ''
      };
    }

    // 3) JSON
    let data = null;
    if (text.startsWith('{')) {
      try { data = JSON.parse(text); }
      catch (error) { throw new Error('JSON 解析失败: ' + error.message); }
    }
    if (data && typeof data === 'object') {
      const sessionKey = data.sessionKey || data.session_key || data.sessionkey || '';
      if (sessionKey) {
        if (!isLikelyClaudeSessionKey(sessionKey)) {
          throw new Error('JSON 中的 sessionKey 不是有效的 Claude sessionKey');
        }
        return {
          sessionKey: String(sessionKey).trim(),
          lastActiveOrg: data.lastActiveOrg || data.last_active_org || '',
          anthropicDeviceId: data.anthropicDeviceId || data['anthropic-device-id'] || '',
          routingHint: data.routingHint || data.routing_hint || ''
        };
      }
    }

    throw new Error('未找到有效的 Claude sessionKey');
  }

  const api = {
    SESSION_COOKIE_NAMES,
    isLikelyClaudeSessionKey,
    parseCookieHeader,
    parseClaudeSessionImport
  };
  global.ClaudeSession = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
