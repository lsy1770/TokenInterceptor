// content.js — 在 chatgpt.com / auth.openai.com 的内容脚本沙箱中运行
// 职责：
//   1. 把 injected.js 注入到真实页面上下文（绕过内容脚本沙箱）
//   2. 监听 injected.js 通过 CustomEvent 发来的 Token 数据
//   3. 转发给 background.js

(function () {
  'use strict';

  // ── 1. 注入 injected.js 到页面真实上下文 ──────────────────
  function inject() {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('src/injected.js');
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  }

  // 尽可能早注入
  if (document.readyState === 'loading') {
    inject();
  } else {
    inject();
  }

  // ── 2. 监听页面发来的事件 ──────────────────────────────────
  const seen = new Set();

  window.addEventListener('__oai_token_interceptor__', e => {
    let payload;
    try { payload = JSON.parse(e.detail); } catch { return; }

    if (payload.type === 'TOKEN_RESPONSE') {
      const data = payload.data;
      if (!data || !data.access_token) return;

      // 去重
      const key = data.access_token.slice(-20);
      if (seen.has(key)) return;
      seen.add(key);

      chrome.runtime.sendMessage({
        type   : 'TOKEN_FROM_PAGE',
        source : location.href,
        data
      });
    }

    if (payload.type === 'CALLBACK_CODE') {
      if (!payload.code) return;
      chrome.runtime.sendMessage({
        type : 'CALLBACK_CODE',
        code : payload.code,
        url  : payload.url
      });
    }

  });

  // ── 3. 也直接扫描 URL（如果当前页面就是回调地址）──────────
  function checkCurrentURL() {
    const u = new URL(location.href);
    if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1')
        && u.port === '1455'
        && u.pathname.startsWith('/auth/callback')) {
      const code = u.searchParams.get('code');
      if (code) {
        chrome.runtime.sendMessage({ type: 'CALLBACK_CODE', code, url: location.href });
      }
    }
  }

  checkCurrentURL();
})();
