// injected.js — 运行在页面真实 JS 环境中（非沙箱）
// 通过 script 标签注入到 window 上下文，可以 Hook fetch/XHR
(function () {
  'use strict';

  const TARGET_HOST = 'auth.openai.com';
  const TOKEN_PATH  = '/oauth/token';
  const CB_PATH     = '/auth/callback';

  function isTokenURL(url) {
    try {
      const u = new URL(url, location.href);
      return u.hostname === TARGET_HOST && u.pathname === TOKEN_PATH;
    } catch { return false; }
  }

  function isCallbackURL(url) {
    try {
      const u = new URL(url, location.href);
      return (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
          && u.port === '1455'
          && u.pathname.startsWith(CB_PATH);
    } catch { return false; }
  }

  function dispatch(type, detail) {
    window.dispatchEvent(new CustomEvent('__oai_token_interceptor__', {
      detail: JSON.stringify({ type, ...detail })
    }));
  }

  // ── Hook fetch ──────────────────────────────────────────────
  const _fetch = window.fetch;
  window.fetch = async function (...args) {
    const input  = args[0];
    const init   = args[1] || {};
    const url    = typeof input === 'string' ? input
                 : input instanceof Request  ? input.url
                 : String(input);

    // 拦截 /oauth/token 响应
    if (isTokenURL(url)) {
      const res = await _fetch.apply(this, args);
      const clone = res.clone();
      clone.json().then(data => {
        if (data && data.access_token) {
          dispatch('TOKEN_RESPONSE', { data });
        }
      }).catch(() => {});
      return res;
    }

    // 拦截向 localhost:1455 的 fetch（如有）
    if (isCallbackURL(url)) {
      const u = new URL(url);
      const code = u.searchParams.get('code');
      if (code) dispatch('CALLBACK_CODE', { code, url });
      return _fetch.apply(this, args).catch(e => { throw e; });
    }

    return _fetch.apply(this, args);
  };

  // ── Hook XHR ────────────────────────────────────────────────
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._oai_url = url;
    return _open.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (isTokenURL(this._oai_url)) {
      this.addEventListener('load', function () {
        try {
          const data = JSON.parse(this.responseText);
          if (data && data.access_token) {
            dispatch('TOKEN_RESPONSE', { data });
          }
        } catch {}
      });
    }
    return _send.apply(this, args);
  };

  // ── 扫描页面里已有的 Token ──
  function scanPage() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const v = localStorage.getItem(k);
        if (v && v.includes('access_token')) {
          try {
            const j = JSON.parse(v);
            if (j.access_token) { dispatch('TOKEN_RESPONSE', { data: j }); return; }
          } catch {}
        }
        if (v && v.startsWith('eyJ') && v.length > 100) {
          dispatch('TOKEN_RESPONSE', { data: { access_token: v } });
          return;
        }
      }
    } catch {}

    const keys = ['__accessToken','access_token','_accessToken','userToken','authToken'];
    for (const k of keys) {
      const v = window[k];
      if (v && typeof v === 'string' && v.startsWith('eyJ')) {
        dispatch('TOKEN_RESPONSE', { data: { access_token: v } });
        return;
      }
      if (v && typeof v === 'object' && v.access_token) {
        dispatch('TOKEN_RESPONSE', { data: v });
        return;
      }
    }

    document.querySelectorAll('script[type="application/json"], script#__NEXT_DATA__').forEach(s => {
      try {
        const j = JSON.parse(s.textContent);
        const tok = j?.props?.pageProps?.user?.accessToken
                 || j?.accessToken
                 || j?.access_token;
        if (tok) dispatch('TOKEN_RESPONSE', { data: { access_token: tok } });
      } catch {}
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanPage);
  } else {
    setTimeout(scanPage, 500);
  }

  console.log('[Token Interceptor] OpenAI 页面监听已启用');
})();
