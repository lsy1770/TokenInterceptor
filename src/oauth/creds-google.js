/* ============================================================
 * creds-google.js — Google One / Gemini 订阅凭据导出与 Cookie 注入
 *
 * 两件事：
 *   1) 一键导出「取消订阅所需的最小 Cookie 集」（Netscape cookies.txt / header 串 / JSON / Python）
 *      —— 对齐 workbench 里 google_one_daichong.py 的客户端要求：
 *         SAPISID（或 __Secure-1PAPISID / __Secure-3PAPISID，用来算 SAPISIDHASH）
 *         + SID/HSID/SSID/APISID（Google 账号的强会话）
 *         + Gemini / Play / One 三端的页面会话
 *   2) 把一份 Cookie 自动写回浏览器，实现「注入登录」，落库前先备份当前登录态，支持回滚
 * ============================================================ */
'use strict';

const GoogleCreds = (() => {

  // ---------------------------------------------------------------
  // 常量
  // ---------------------------------------------------------------

  // 强会话校验：缺了这几个，SAPISIDHASH 签出来也过不了 401
  const AUTH_CORE_NAMES = ['SAPISID', '__Secure-1PAPISID', '__Secure-3PAPISID', 'APISID'];

  // 取消订阅只要签名材料（SAPISID 系）+ 账号强会话（SID/HSID/SSID）；
  // __Secure-1PSID* 这类轮换 token 只做附加导出，不参与“是否齐备”的判定。
  const CREDENTIAL_NAMES = [
    'SAPISID', '__Secure-1PAPISID', '__Secure-3PAPISID', 'APISID',
    'SID', 'HSID', 'SSID',
    '__Secure-1PSID', '__Secure-3PSID',
    '__Secure-1PSIDTS', '__Secure-3PSIDTS',
    'LSID', '__Host-1PLSID', '__Host-3PLSID', '__Host-GAPS',
  ];

  // 取消订阅阶段真正会被服务端读到的作用域
  const DOMAIN_COOKIES = [
    { domain: 'play.google.com',   role: 'Play Store 订阅列表 / 取消续费（oC6RJb · UN6cfe · ekQxif · pHecBc）' },
    { domain: 'one.google.com',    role: 'Google One 套餐页（bTEHyc 购买意图 / GI6Jdd）' },
    { domain: 'accounts.google.com', role: 'Google 账号强会话（SID/HSID/SSID/SAPISID）' },
  ];

  // 注入时必须回写、用于「恢复上一账号」的名字前缀（Google 会用 __Secure-1PSID 这种）
  const BACKUP_PREFIX = '_gci_backup_';
  const BACKUP_KEY = 'googleCookieBackup';
  const LAST_EXPORT_KEY = 'lastGoogleCredsExport';

  const FLOW_MAIN_NAMES = new Set([
    'SID', 'HSID', 'SSID', 'APISID', 'SAPISID',
    '__Secure-1PSID', '__Secure-3PSID', '__Secure-1PAPISID', '__Secure-3PAPISID',
    '__Secure-1PSIDTS', '__Secure-3PSIDTS', '__Host-3PLSID', '__Host-GAPS',
    'LSID', '__Host-1PLSID',
  ]);

  // Google 现在主要发 __Secure-1PSID / __Secure-3PSID 两个影子会话，
  // 很多账号根本不会下发 SID / HSID，所以缺它们只标「degraded」，不直接判死。
  const STRONG_SESSION_NAMES = ['SID', 'HSID', 'SSID'];

  // 这几个缺了就会让 play.google.com 直接降到登录页，必须单独兜底抓取。
  // 实测：SID + HSID 共 170 字符，决定 Play 能不能用。
  const CRITICAL_COOKIE_NAMES = [
    'SID', 'HSID', 'SSID', 'APISID', 'SAPISID',
    '__Secure-1PSID', '__Secure-3PSID',
    '__Secure-1PAPISID', '__Secure-3PAPISID',
  ];

  // 需要登录态的站点点位（用于自动补全：打开这些站点让浏览器自己种 cookie）
  //
  // 硬性约束：这里只能放「能在标签页里直接打开并渲染」的页面地址。
  // accounts.google.com/ListAccounts 这类接口端点（返回 )]}' 开头的 proto 文本、
  // 且要求 x-requested-with: XmlHttpRequest）永远不能放进来 —— 浏览器导航打开只会得到 400。
  // SID / HSID 不需要打接口：只要在任意 Google 站点走一遍正常登录，Set-Cookie 就会下发。
  const SITE_TARGETS = [
    {
      key: 'gemini',
      url: 'https://gemini.google.com/app',
      host: 'gemini.google.com',
      why: 'Gemini 应用页（拿 GAIA + at）',
      probe: /SNlM0e\\?"\s*:/,
      autoOpen: true,
    },
    {
      key: 'play',
      url: 'https://play.google.com/store/account/subscriptions',
      host: 'play.google.com',
      why: 'Play 订阅页（取消续费全靠这个域）',
      probe: /SNlM0e\\?"\s*:/,
      autoOpen: true,
    },
    {
      key: 'one',
      url: 'https://one.google.com/u/0/ai',
      host: 'one.google.com',
      why: 'Google One 套餐页（购买意图 bTEHyc）',
      probe: /SNlM0e\\?"\s*:/,
      autoOpen: true,
    },
    {
      key: 'accounts',
      // 登录入口专用：登录完成后 myaccount / play / gemini 的会话会一并建立，
      // SID / HSID 也随之下发。不要用 myaccount.google.com 当打开地址 ——
      // 未登录时它会 302 到 ServiceLogin，绕一圈还容易触发限流。
      url: 'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmyaccount.google.com%2F',
      host: 'accounts.google.com',
      why: '统一登录入口（补 SID / HSID 与各域会话）',
      probe: /@[a-z0-9.-]+\.[a-z]{2,}/i,
      autoOpen: true,
      allowLoginPage: true,  // 它本身就是登录入口，rejectOpenReason 要放行
      skipProbe: true,     // 它本身就是登录页，探测没有意义（会把登录页误判成未登录的死循环）
    },
  ];

  // 探测节流：同站点 60s 内不重复打，两次探测之间至少间隔 1.5s
  const PROBE_CACHE_MS = 60_000;
  const PROBE_MIN_GAP_MS = 1500;
  const probeCache = new Map();   // key -> { at, result }
  let lastProbeAt = 0;

  // 绝对不能当页面打开的内部端点（防止以后误加进 SITE_TARGETS）
  const NON_NAVIGABLE_PATTERNS = [
    /ListAccounts/i,
    /batchexecute/i,
    /\/batch(?:exec)?(?:[/?]|$)/i,
    /\/_\/[A-Za-z]+\/data\//i,
    /\/v3\/signin\//i,
    /RotateCookies/i,
  ];

  // 判定「页面是应用页还是登录页」——和 Python 端 detect_login_page 保持一致
  const LOGGED_OUT_MARKERS = [
    '/v3/signin/_/AccountsSignInUi',
    'Im6cmf":"/v3/signin',
    'accounts.google.com/v3/signin',
    'ServiceLogin',
  ];

  /**
   * 校验一个 URL 能不能塞进标签页打开。
   * 返回 '' 表示可以，否则返回拒绝原因。
   */
  function rejectOpenReason(url, { allowLoginPage = false } = {}) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return 'URL 非法';
    }
    if (parsed.protocol !== 'https:') return '只允许 https';
    for (const pattern of NON_NAVIGABLE_PATTERNS) {
      if (pattern.test(parsed.pathname) || pattern.test(parsed.search)) {
        return `这是内部接口端点（命中 ${pattern}），浏览器打开只会得到 400/404`;
      }
    }
    if (!allowLoginPage) {
      // 登录入口本身就是允许打开的（accounts 点位用），其他点位不应指向登录页
      if (/ServiceLogin|\/v3\/signin/i.test(parsed.pathname + parsed.search)) {
        return '这是登录跳转地址，只允许 accounts 点位使用';
      }
    }
    return '';
  }

  // ---------------------------------------------------------------
  // 基础工具
  // ---------------------------------------------------------------

  function cookiesGetAll(details) {
    return new Promise((resolve, reject) => {
      if (!chrome.cookies) return reject(new Error('缺少 cookies 权限，请重新加载扩展'));
      chrome.cookies.getAll(details, cookies => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message)); else resolve(cookies || []);
      });
    });
  }

  function cookiesGet(details) {
    return new Promise((resolve, reject) => {
      chrome.cookies.get(details, cookie => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message)); else resolve(cookie || null);
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
      chrome.cookies.remove(details, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message)); else resolve(true);
      });
    });
  }

  function isSameSiteSupported(value) {
    return ['no_restriction', 'lax', 'strict', 'unspecified'].includes(value);
  }

  // 找登录页标记
  function detectLoginPage(html) {
    const text = String(html || '');
    for (const marker of LOGGED_OUT_MARKERS) {
      if (text.includes(marker)) return marker;
    }
    if (/"S06Grb"\s*:\s*""/.test(text) && /accounts\.google\.com\/(v3\/signin|ServiceLogin)/.test(text)) {
      return 'signin-link + empty gaia';
    }
    return '';
  }

  function toChromeSameSite(raw) {
    if (!raw) return 'unspecified';
    const v = String(raw).toLowerCase();
    if (v === 'none' || v === 'no_restriction') return 'no_restriction';
    if (v === 'lax') return 'lax';
    if (v === 'strict') return 'strict';
    return 'unspecified';
  }

  function normalizeDomain(domain) {
    const d = String(domain || '').trim().toLowerCase().replace(/^\./, '');
    return d || '';
  }

  // Google 的 domain cookie 至少要挂在 google.com 这一级，否则子域读不到
  function isGoogleDomain(domain) {
    const d = normalizeDomain(domain);
    return d === 'google.com' || d.endsWith('.google.com');
  }

  // Chrome 对 SameSite=None 的 cookie 强制要求 Secure，Python 侧无所谓
  function buildSetDetails(cookie) {
    const domain = normalizeDomain(cookie.domain);
    const sameSite = isSameSiteSupported(toChromeSameSite(cookie.sameSite))
      ? toChromeSameSite(cookie.sameSite) : 'unspecified';
    const secure = Boolean(cookie.secure) || sameSite === 'no_restriction';
    const details = {
      url: `https://${domain.replace(/^\./, '')}${cookie.path || '/'}`,
      name: cookie.name,
      value: cookie.value,
      path: cookie.path || '/',
      secure,
      httpOnly: Boolean(cookie.httpOnly),
      sameSite,
    };
    // 只对 google.com 这一级下 domain cookie；host-only 的走 url 默认
    if (cookie.hostOnly === false && isGoogleDomain(domain)) {
      details.domain = '.' + domain;
    }
    const exp = Number(cookie.expirationDate);
    if (cookie.session) {
      details.expirationDate = undefined;
    } else if (Number.isFinite(exp) && exp > Date.now() / 1000) {
      details.expirationDate = Math.floor(exp);
    } else {
      details.expirationDate = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    }
    return details;
  }

  // ---------------------------------------------------------------
  // 1) 导出
  // ---------------------------------------------------------------

  async function collectAll() {
    // The domain filter includes subdomains, host-only and HttpOnly cookies on every path.
    const cookies = await cookiesGetAll({ domain: 'google.com' });
    return cookies.sort((a, b) => {
      const d = normalizeDomain(a.domain).localeCompare(normalizeDomain(b.domain));
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
  }

  function pickCredentials(cookies) {
    const out = {};
    for (const name of CREDENTIAL_NAMES) {
      const hit = cookies.find(c => c.name === name
        && /(^|\.)google\.com$/.test(normalizeDomain(c.domain)));
      if (hit) out[name] = hit.value;
    }
    return out;
  }

  function classify(cookies) {
    const groups = {};
    for (const c of cookies) {
      const d = normalizeDomain(c.domain);
      const bucket = d.includes('accounts.google.com') ? 'accounts'
        : d.includes('play.google.com') ? 'play'
          : d.includes('one.google.com') ? 'one'
            : d.includes('gemini.google.com') ? 'gemini'
              : d.includes('payments.google.com') ? 'payments'
                : d.includes('www.google.com') ? 'www'
                  : d === 'google.com' || d.endsWith('.google.com') ? 'google' : 'other';
      (groups[bucket] = groups[bucket] || []).push(c.name);
    }
    for (const key of Object.keys(groups)) groups[key] = [...new Set(groups[key])].sort();
    return groups;
  }

  function toCookieHeader(cookies) {
    // 只输出 .google.com 级的 domain cookie。
    //
    // 注意：这是**有损**导出。play.google.com / one.google.com 的 host-only cookie
    // （__Secure-OSID、OSID）不会进来，但 Play 少了它们会直接掉登录页。
    // 要喂给 google_one_daichong.py，请用带 domain 的 JSON 导出，
    // 那边的 CookieJar 会按 host 分别下发；这里只适合快速肉眼检查账号级 cookie。
    return cookies
      .filter(c => !c.hostOnly && /(^|\.)google\.com$/.test(normalizeDomain(c.domain)))
      .map(c => `${c.name}=${c.value}`)
      .join('; ');
  }

  function toNetscape(cookies) {
    const lines = [
      '# Netscape HTTP Cookie File',
      '# 由 Token Interceptor 导出 — 供 google_one_daichong.py 使用',
      `# exported_at: ${new Date().toISOString()}`,
      '',
    ];
    for (const c of cookies) {
      const hostOnly = Boolean(c.hostOnly) || !String(c.domain || '').startsWith('.');
      const domain = normalizeDomain(c.domain);
      const secure = c.secure ? 'TRUE' : 'FALSE';
      const expires = c.session ? '0' : String(Math.floor(Number(c.expirationDate) || 0));
      lines.push([
        hostOnly ? domain : '.' + domain,
        hostOnly ? 'FALSE' : 'TRUE',
        c.path || '/',
        secure,
        expires,
        c.name,
        c.value,
      ].join('\t'));
    }
    return lines.join('\n') + '\n';
  }

  function toPythonLiteral(cookies) {
    const pairs = cookies.map(c => `    ("${normalizeDomain(c.domain)}", "${c.name}", "${String(c.value).replace(/"/g, '\\"')}"),`);
    return [
      '# 贴进 google_one_daichong.py 的自定义 session 里即可',
      '#   from curl_cffi import requests as cffi_requests',
      '#   s = cffi_requests.Session(impersonate="chrome"); _install(s, COOKIES)',
      'COOKIES = [',
      ...pairs,
      ']',
      '',
      'def _install(sess, cookies):',
      '    """去掉 chunk 分片后整体灌进 session（不走 domain 校验）"""',
      '    for domain, name, value in cookies:',
      '        sess.cookies.set(name, value, domain=domain, path="/")',
      '    return sess',
      '',
      'SAPISID = next(v for d, n, v in COOKIES if n == "SAPISID")',
      '',
      'def sapisidhash(sapisid, origin="https://play.google.com"):',
      '    import hashlib, time',
      '    ts = int(time.time())',
      '    return "SAPISIDHASH %d_%s" % (ts, hashlib.sha1(f"{ts} {sapisid} {origin}".encode()).hexdigest())',
      '',
    ].join('\n');
  }

  function summarize(cookies, creds) {
    const hasSapisid = Boolean(creds.SAPISID || creds['__Secure-1PAPISID'] || creds['__Secure-3PAPISID']);

    // 关键 cookie 逐项点名：这些缺任何一个，Python 侧都会掉进登录页。
    // 实测 play.google.com 少 SID+HSID 就只返回登录页（1.24MB 的 signin 页面）。
    const nameSet = new Set(cookies.map(c => c.name));
    const criticalPresent = CRITICAL_COOKIE_NAMES.filter(n => nameSet.has(n));
    const criticalMissing = CRITICAL_COOKIE_NAMES.filter(n => !nameSet.has(n));
    const missingStrongFields = STRONG_SESSION_NAMES.filter(name => !creds[name]);
    const hasStrong = missingStrongFields.length === 0;
    const hasShadowSession = Boolean(creds['__Secure-1PSID'] || creds['__Secure-3PSID']);
    const buckets = classify(cookies);

    // 哪些域需要拿到「登录态证据」——按域里有没有登录相关 cookie 判断，
    // 不能只看「域里有没有 cookie」：OTZ / COMPASS / PLAY_ACTIVE_ACCOUNT 这类
    // 遥测与指针 cookie 在未登录状态下也会存在，会把死会话误判成活的。
    const SITE_EVIDENCE = {
      gemini: name => /^(?:__Secure-1PSID|__Secure-3PSID|SID|COMPASS)$/.test(name),
      play: name => /^(?:__Secure-OSID|OSID|SID|__Secure-1PSID)$/.test(name),
      one: name => /^(?:__Secure-OSID|OSID|SID|__Secure-1PSID)$/.test(name),
      accounts: name => /^(?:LSID|SID|__Host-.*PLSID|ACCOUNT_CHOOSER)$/.test(name),
    };
    const siteNames = { gemini: [], play: [], one: [], accounts: [] };
    for (const c of cookies) {
      const d = String(c.domain || '').replace(/^\./, '').toLowerCase();
      if (d.startsWith('gemini.google.com')) siteNames.gemini.push(c.name);
      else if (d.startsWith('play.google.com')) siteNames.play.push(c.name);
      else if (d.startsWith('one.google.com')) siteNames.one.push(c.name);
      else if (d.startsWith('accounts.google.com')) siteNames.accounts.push(c.name);
    }
    const siteReady = {
      gemini: siteNames.gemini.some(SITE_EVIDENCE.gemini),
      play: siteNames.play.some(SITE_EVIDENCE.play),
      one: siteNames.one.some(SITE_EVIDENCE.one),
      accounts: siteNames.accounts.some(SITE_EVIDENCE.accounts),
    };

    // 缺什么就逐条说清楚，别笼统写 "SID+HSID+SSID"
    const missing = [];
    if (!hasSapisid) missing.push('SAPISID 或 __Secure-1PAPISID（缺了算不出 SAPISIDHASH）');
    for (const name of missingStrongFields) missing.push(name);
    if (!hasStrong && !hasShadowSession) missing.push('没有任何可用会话载体（SID / __Secure-*PSID）');
    if (!siteReady.play) missing.push('play.google.com 登录态');
    if (!siteReady.accounts) missing.push('accounts.google.com 登录态');
    if (!siteReady.gemini) missing.push('gemini.google.com 登录态');

    // 哪些点位需要浏览器去补齐（用来触发自动打开）
    const missingSites = [];
    if (!siteReady.gemini) missingSites.push('gemini');
    if (!siteReady.play) missingSites.push('play');
    if (!siteReady.one) missingSites.push('one');
    if (!siteReady.accounts || !hasStrong) missingSites.push('accounts');

    let verdict = 'invalid';
    if (hasSapisid) verdict = hasStrong ? 'ok' : (hasShadowSession ? 'degraded' : 'invalid');

    return {
      total: cookies.length,
      buckets,
      siteNames,
      siteReady,
      hasSapisid,
      hasStrong,
      hasShadowSession,
      missingStrongFields,
      criticalPresent,
      criticalMissing,
      canCancel: hasSapisid && siteReady.play && (hasStrong || hasShadowSession),
      missing,
      missingSites: [...new Set(missingSites)],
      complete: missing.length === 0,
      verdict,
      chunked: cookies.filter(c => /^__Secure-.*session-token\.\d+$/.test(c.name)).length,
    };
  }


  async function capture(options = {}) {
    const cookies = await collectAll();
    const creds = pickCredentials(cookies);
    const summary = summarize(cookies, creds);

    if (!cookies.length) {
      throw new Error('当前扩展上下文未读到 Google Cookie。请检查扩展的 Google 网站访问权限，并确认插件与已登录页面位于同一浏览器配置文件；无痕窗口需单独允许扩展运行。');
    }

    const payload = {
      provider: 'google',
      capturedAt: new Date().toISOString(),
      purpose: 'google_one_subscription_cancel',
      summary,
      credentials: creds,
      cookieHeader: toCookieHeader(cookies),
      cookiesTxt: toNetscape(cookies),
      cookies: cookies.map(c => ({
        domain: c.domain,
        name: c.name,
        value: c.value,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
        hostOnly: c.hostOnly,
        session: c.session,
        expirationDate: c.expirationDate || null,
      })),
      python: toPythonLiteral(cookies),
      roles: DOMAIN_COOKIES,
    };

    await chrome.storage.local.set({
      [LAST_EXPORT_KEY]: {
        capturedAt: payload.capturedAt,
        summary,
        script: options.script || 'google_one_daichong.py',
      },
    });
    return payload;
  }

  async function getLastExport() {
    const stored = await chrome.storage.local.get(LAST_EXPORT_KEY);
    return stored[LAST_EXPORT_KEY] || null;
  }

  // ---------------------------------------------------------------
  // 自动补全：缺 cookie 就打开对应站点，让浏览器自己把会话种上
  // ---------------------------------------------------------------

  function siteByKey(key) {
    return SITE_TARGETS.find(site => site.key === key) || null;
  }

  async function openSites(keys) {
    // 只开 autoOpen 的站点：像 accounts 这种「本来就没有会话」的域，打开只是把人送去登录页，
    // 还会连带把后续探测推到限流区。
    const list = (keys || [])
      .map(siteByKey)
      .filter(site => site && site.autoOpen !== false);
    const opened = [];
    for (const site of list) {
      // 双重保险：表里就算写错，也不允许把内部端点当页面打开
      const reason = rejectOpenReason(site.url, { allowLoginPage: site.allowLoginPage === true });
      if (reason) {
        opened.push({ key: site.key, url: site.url, error: reason });
        continue;
      }
      try {
        // 复用已开着的标签，避免每次点都新开一堆
        const existing = await chrome.tabs.query({ url: `${new URL(site.url).origin}/*` });
        if (existing && existing.length) {
          const tab = existing[0];
          await chrome.tabs.update(tab.id, { url: site.url, active: true });
          opened.push({ key: site.key, url: site.url, tabId: tab.id, reused: true });
        } else {
          const tab = await chrome.tabs.create({ url: site.url, active: opened.length === 0 });
          opened.push({ key: site.key, url: site.url, tabId: tab.id, reused: false });
        }
      } catch (e) {
        opened.push({ key: site.key, url: site.url, error: e.message });
      }
    }
    if (opened.length) {
      await chrome.storage.local.set({
        googlePendingSites: {
          openedAt: new Date().toISOString(),
          sites: opened.map(o => o.key),
        },
      });
    }
    return opened;
  }

  /**
   * 逐个站点检查「到底登没登」：
   *   拿页面 HTML → 有没有 SNlM0e（应用页标志）
   *   → 有没有登录页标记（假登录态）
   *   → GAIA 是不是空
   * 返回每个站点的状态，供 popup 显示「哪个站点还需要登录」。
   */
  // ── 标签页探测：在真实页面上下文里判断登录态 ──────────────────────────
  //
  // 为什么不用 background fetch：
  //   service worker 里的 fetch 用的是 chrome.cookies 视角的 cookie，和标签页里
  //   用户刚刚登出来的会话不保证同步；而且 redirect:'follow' 会把整条跳转链吃掉，
  //   最终只看得到最后一页，无法区分「真未登录」和「跳到登录页但已带会话」。
  //   用户明明在页面里登好了，扩展却报未登录，就是这么来的。
  //   改成：复用/打开标签页 → 等加载完成 → 用 chrome.scripting 在页面上下文里读状态。

  /**
   * 找一个「属于该站点」的标签页 —— 包括两种情况：
   *   ① 标签页就停在目标域
   *   ② 标签页被 302 到 accounts.google.com/v3/signin?...continue=<目标域>
   *      （用户点进去后 Google 把标签页换成了登录页，这是最常见的真实情形）
   * 只按 host 匹配会漏掉第 ② 种，于是误判「没有标签页」→ 退回 fetch → 又报未登录。
   */
  function tabBelongsToSite(tab, site) {
    let parsed;
    try {
      parsed = new URL(tab.url || '');
    } catch {
      return false;
    }
    if (parsed.hostname === site.host) return true;
    // accounts 域名下：看 continue / followup 指向哪里
    if (/accounts\.google\.com$/.test(parsed.hostname)) {
      const params = parsed.searchParams;
      const targets = [params.get('continue'), params.get('followup'), params.get('service')]
        .filter(Boolean)
        .map(v => {
          try { return decodeURIComponent(v); } catch { return v; }
        });
      return targets.some(v => {
        try {
          return new URL(v).hostname === site.host;
        } catch {
          return v.includes(site.host);
        }
      });
    }
    return false;
  }

  function findTabForSite(site) {
    return new Promise(resolve => {
      if (!chrome.tabs || !chrome.tabs.query) return resolve(null);
      chrome.tabs.query({}, tabs => {
        const err = chrome.runtime.lastError;
        if (err) return resolve(null);
        const hit = (tabs || []).find(tab => tabBelongsToSite(tab, site));
        resolve(hit || null);
      });
    });
  }

  function runInPage(tabId) {
    return new Promise(resolve => {
      if (!chrome.scripting || !chrome.scripting.executeScript) return resolve(null);
      chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({
          href: location.href,
          title: document.title,
          // 应用页标志 / 登录页标志
          hasAt: /SNlM0e\\?"\s*:/.test(document.documentElement.innerHTML),
          hasGaia: /"S06Grb\\?"\s*:\s*\\?"(\d{6,25})/.test(document.documentElement.innerHTML),
          signinUi: /AccountsSignInUi|Im6cmf":"\/v3\/signin|ServiceLogin/.test(location.href)
            || /Sign in - Google Accounts/i.test(document.title),
          bodyLen: document.body ? document.body.innerText.length : 0,
        }),
      }, results => {
        const err = chrome.runtime.lastError;
        if (err) return resolve({ error: err.message });
        const first = results && results[0];
        resolve(first && first.result ? first.result : null);
      });
    });
  }

  /**
   * 用标签页判断某个站点是否已登录。
   * 三种结果：
   *   ok=true            页面本身就是应用页，且没有登录 UI
   *   reason='signin'    确实停在登录页（需要人工登录）
   *   reason='redirect'  仍被 302 到 accounts（会话没建立）
   */
  async function probeByTab(site) {
    const tab = await findTabForSite(site);
    if (!tab) return { opened: false, result: null };

    // 标签页已经在目标站上，直接读它当前状态（这就是用户眼里的事实）
    const state = await runInPage(tab.id);
    if (!state || state.error) {
      return { opened: true, result: { key: site.key, ok: false, tabId: tab.id,
        hint: `读取标签页失败：${state && state.error ? state.error : '无结果'}` } };
    }

    const onTargetHost = (() => {
      try { return new URL(state.href).hostname === site.host; } catch { return false; }
    })();
    const signin = state.signinUi || !onTargetHost;

    const item = {
      key: site.key,
      url: site.url,
      why: site.why,
      tabId: tab.id,
      finalUrl: state.href,
      title: state.title,
      via: 'tab',
      hasToken: Boolean(state.hasAt),
      gaia: state.hasGaia ? 'present' : '',
      loginPage: signin ? 'tab-signin' : '',
      ok: false,
    };
    if (site.key === 'accounts') {
      item.ok = !signin;
      item.hint = item.ok ? '已登录' : '停在登录页，请在该标签完成登录';
    } else {
      item.ok = !signin && state.hasAt;
      item.hint = item.ok
        ? '已登录'
        : (signin ? '停在登录页（该标签页尚未完成登录）' : '页面已打开但不是应用页，可能需要刷新');
    }
    return { opened: true, result: item };
  }

  /**
   * 探测站点登录态。
   *
   * 顺序：先看标签页（真实上下文最准）→ 标签页不存在才退回 background fetch。
   * 这样「用户明明登好了」不会再被误报。
   */
  async function probeSites(keys, options = {}) {
    const list = (keys && keys.length ? keys : SITE_TARGETS.map(s => s.key))
      .map(siteByKey)
      .filter(site => site && !site.skipProbe);
    const results = [];

    for (const site of list) {
      // ① 缓存：只有「用户没主动刷新」时才用
      const cached = probeCache.get(site.key);
      if (!options.force && cached && Date.now() - cached.at < PROBE_CACHE_MS) {
        results.push({ ...cached.result, cached: true });
        continue;
      }

      // ② 标签页优先
      let item = null;
      try {
        const byTab = await probeByTab(site);
        if (byTab.opened && byTab.result) item = byTab.result;
      } catch (e) {
        item = null;
      }

      // ③ 没有标签页 → 退回 fetch（保守判定：只在明确看到应用页标志时才判 ok）
      if (!item) {
        if (!options.force) {
          const gap = Date.now() - lastProbeAt;
          if (gap < PROBE_MIN_GAP_MS) {
            await new Promise(resolve => setTimeout(resolve, PROBE_MIN_GAP_MS - gap));
          }
          lastProbeAt = Date.now();
        }
        item = { key: site.key, url: site.url, why: site.why, via: 'fetch', ok: false };
        try {
          const r = await fetch(site.url, { credentials: 'include', redirect: 'follow' });
          const html = await r.text();
          item.status = r.status;
          item.finalUrl = r.url;
          item.hasToken = /SNlM0e\\?"\s*:/.test(html);
          item.loginPage = detectLoginPage(html) || '';

          if (r.status === 429) {
            item.ratelimited = true;
            item.hint = '请求过于频繁（Google 限流 429），等 1~2 分钟再点';
          } else if (r.status === 401 || r.status === 403) {
            item.hint = `会话无效（HTTP ${r.status}），需要重新登录`;
          } else if (r.status >= 500) {
            item.hint = `Google 服务端临时故障（HTTP ${r.status}），稍后重试`;
          } else if (r.status >= 400) {
            item.hint = `站点返回 HTTP ${r.status}`;
          } else if (site.key === 'accounts') {
            item.ok = site.probe.test(html) && !item.loginPage;
            item.hint = item.ok ? '已登录' : '未登录（该域无会话）';
          } else {
            item.ok = item.hasToken && !item.loginPage;
            item.hint = item.ok ? '已登录（后台探测）'
              : (item.loginPage ? '后台探测返回登录页 —— 打开该站点确认后再试' : '页面没有会话标志');
          }
        } catch (e) {
          item.error = e.message;
          item.hint = `探测失败：${e.message}`;
        }
      }

      // 429 / 网络错误不写缓存，避免把暂时性失败固化
      if (!item.ratelimited && !item.error) {
        probeCache.set(site.key, { at: Date.now(), result: { ...item } });
      }
      results.push(item);
    }
    return results;
  }

  /** 清掉探测缓存（用户登录完主动重试时用） */
  function resetProbeCache() {
    probeCache.clear();
    lastProbeAt = 0;
  }

  /**
   * 补全后再抓一次：先 openSites（如果还没开），等用户登录后由 popup 调 capture({_retried:true})。
   * 这里提供「一步到位」：探测 → 缺就开 → 返回状态。
   */
  async function ensureComplete() {
    const cookies = await collectAll();
    const creds = pickCredentials(cookies);
    const summary = cookies.length ? summarize(cookies, creds) : summarize([], {});
    const need = summary.missingSites;
    if (!need.length) {
      return { complete: true, summary, opened: [], sites: [] };
    }
    const opened = await openSites(need);
    // 只探测真正能自动补的站点（accounts 只提示不探，省一次无意义的跳转）
    const probeKeys = need.filter(key => (siteByKey(key) || {}).autoOpen !== false);
    const sites = await probeSites(probeKeys);
    return { complete: false, summary, opened, sites };
  }

  // ---------------------------------------------------------------
  // 2) 注入
  // ---------------------------------------------------------------

  function parseCookieInput(input) {
    const text = String(input || '').trim();
    if (!text) throw new Error('请粘贴 cookies.txt / Cookie 字符串 / 导出的 JSON');

    // (a) 本插件导出的 JSON
    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        const data = JSON.parse(text);
        const list = Array.isArray(data) ? data : data.cookies;
        if (Array.isArray(list) && list.length) {
          return list
            .filter(c => c && c.name && typeof c.value === 'string')
            .map(c => ({
              domain: c.domain || '.google.com',
              name: String(c.name).trim(),
              value: c.value,
              path: c.path || '/',
              secure: c.secure !== false,
              httpOnly: Boolean(c.httpOnly),
              sameSite: toChromeSameSite(c.sameSite),
              session: Boolean(c.session),
              expirationDate: c.expirationDate || null,
              hostOnly: c.hostOnly === undefined ? !String(c.domain || '').startsWith('.') : Boolean(c.hostOnly),
            }));
        }
        // 只给了 credentials 字典
        if (data.credentials && typeof data.credentials === 'object') {
          return Object.entries(data.credentials)
            .filter(([, v]) => typeof v === 'string' && v)
            .map(([name, value]) => ({
              domain: '.google.com', name, value, path: '/', secure: true,
              httpOnly: true, sameSite: 'lax', session: false, expirationDate: null, hostOnly: false,
            }));
        }
      } catch (e) {
        if (text.startsWith('[')) throw new Error('JSON 解析失败: ' + e.message);
      }
    }

    // (b) Netscape cookies.txt
    if (/\t/.test(text) && text.split('\n').some(l => l.split('\t').length >= 7)) {
      const out = [];
      for (const raw of text.split('\n')) {
        const line = raw.replace(/\r$/, '');
        if (!line.trim() || line.startsWith('#')) continue;
        const p = line.split('\t');
        if (p.length < 7) continue;
        const [, , path, secure, expires, name, value] = p;
        if (!name) continue;
        out.push({
          domain: (p[0].startsWith('.') ? '' : '.') + p[0].replace(/^\./, ''),
          name,
          value,
          path: path || '/',
          secure: secure === 'TRUE',
          httpOnly: name.startsWith('__Secure') || name.startsWith('__Host') || name === 'SID',
          sameSite: 'lax',
          session: String(expires) === '0',
          expirationDate: String(expires) === '0' ? null : Number(expires),
          hostOnly: p[1] !== 'TRUE',
        });
      }
      if (out.length) return out;
    }

    // (c) header 串 / 单行 key=value
    const out = [];
    for (const part of text.replace(/\n/g, ';').split(/;\s*/)) {
      const i = part.indexOf('=');
      if (i <= 0) continue;
      const name = part.slice(0, i).trim();
      const value = part.slice(i + 1).trim();
      if (!name || !value || /\s/.test(name)) continue;
      out.push({
        domain: '.google.com',
        name,
        value,
        path: '/',
        secure: true,
        httpOnly: name.startsWith('__Secure') || name.startsWith('__Host') || /^(SID|HSID|SSID|SAPISID|APISID)$/.test(name),
        sameSite: 'lax',
        session: false,
        expirationDate: null,
        hostOnly: false,
      });
    }
    if (!out.length) throw new Error('没解析出任何 Cookie — 检查一下格式');
    return out;
  }

  async function snapshotGoogleCookies() {
    const all = await collectAll();
    return all.map(c => ({
      domain: c.domain,
      name: c.name,
      value: c.value,
      path: c.path,
      secure: Boolean(c.secure),
      httpOnly: Boolean(c.httpOnly),
      sameSite: c.sameSite || 'lax',
      hostOnly: Boolean(c.hostOnly),
      session: Boolean(c.session),
      expirationDate: c.expirationDate || null,
    }));
  }

  function looksLikeGoogleSessionCookie(cookie) {
    return isGoogleDomain(cookie.domain);
  }

  // 登录态相关的名字：注入前清理这些，避免旧账号 hash 残留
  function isSessionCookieName(name) {
    if (FLOW_MAIN_NAMES.has(name)) return true;
    if (/^__(Secure|Host)-(?:\d)?(?:P|3P)?(?:SID|PSID|LSID|PSIDTS|PSIDCC)(?:TS|CC)?$/i.test(name)) return true;
    if (/^[A-Za-z]*IDS?TS?$/.test(name) && /^(SID|OLSID|OSID|ACCOUNT_CHOOSER)$/.test(name)) return true;
    if (/session-token/.test(name)) return true;
    return false;
  }

  async function installCookies(cookies, options = {}) {
    const backup = await snapshotGoogleCookies();
    const written = [];
    const overwritten = [];
    const errors = [];

    if (options.clearFirst !== false) {
      const existing = await collectAll();
      const targets = existing.filter(c => looksLikeGoogleSessionCookie(c) && isSessionCookieName(c.name));
      for (const c of targets) {
        try {
          await cookiesRemove({ url: `https://${normalizeDomain(c.domain)}${c.path || '/'}`, name: c.name });
        } catch (e) {
          errors.push(`清理 ${c.name}: ${e.message}`);
        }
      }
    }

    for (const cookie of cookies) {
      try {
        const before = await cookiesGet({
          url: `https://${normalizeDomain(cookie.domain).replace(/^\./, '')}${cookie.path || '/'}`,
          name: cookie.name,
        }).catch(() => null);
        if (before) overwritten.push(before.name);
        await cookiesSet(buildSetDetails(cookie));
        written.push(cookie.name);
      } catch (e) {
        errors.push(`${cookie.name}: ${e.message}`);
      }
    }

    await chrome.storage.local.set({
      [BACKUP_KEY]: {
        savedAt: new Date().toISOString(),
        cookies: backup,
        written: written.length,
      },
    });

    // 验证：确认写入成功。用 getAll({domain}) 回读，能同时覆盖 domain cookie 和 host-only 两种写法
    const sapisid = await (async () => {
      const all = await cookiesGetAll({ domain: 'google.com' }).catch(() => []);
      for (const name of ['SAPISID', '__Secure-1PAPISID', '__Secure-3PAPISID']) {
        const hit = all.find(c => c.name === name && c.value);
        if (hit) return hit.value;
      }
      return '';
    })();

    return {
      ok: written.length > 0,
      written: [...new Set(written)],
      overwritten: [...new Set(overwritten)],
      errors,
      backupCount: backup.length,
      hasSapisid: Boolean(sapisid),
    };
  }

  async function getBackupInfo() {
    const stored = await chrome.storage.local.get(BACKUP_KEY);
    const backup = stored[BACKUP_KEY];
    if (!backup) return { exists: false };
    return {
      exists: true,
      savedAt: backup.savedAt,
      count: (backup.cookies || []).length,
      written: backup.written || 0,
    };
  }

  async function restoreBackup() {
    const stored = await chrome.storage.local.get(BACKUP_KEY);
    const backup = stored[BACKUP_KEY];
    if (!backup || !Array.isArray(backup.cookies) || !backup.cookies.length) {
      throw new Error('没有可回滚的备份');
    }
    // 先清掉当前 Google 会话，再把备份写回
    const existing = await collectAll();
    for (const c of existing.filter(looksLikeGoogleSessionCookie)) {
      await cookiesRemove({ url: `https://${normalizeDomain(c.domain)}${c.path || '/'}`, name: c.name })
        .catch(() => null);
    }
    let n = 0;
    for (const c of backup.cookies) {
      try { await cookiesSet(buildSetDetails(c)); n += 1; } catch (_) { /* ignore */ }
    }
    return { ok: n > 0, restored: n, savedAt: backup.savedAt };
  }

  async function clearBackup() {
    await chrome.storage.local.remove(BACKUP_KEY);
    return { ok: true };
  }

  // ---------------------------------------------------------------
  // 3) 实时态（给 popup 显示「现在登的是谁」）
  // ---------------------------------------------------------------

  async function probe() {
    const out = { signal: '', hasSapisid: false, hasStrong: false, domains: [] };
    try {
      const r = await fetch('https://one.google.com/u/0/ai', { credentials: 'include', redirect: 'follow' });
      const text = await r.text();
      out.status = r.status;
      out.signal = (text.match(/"SNlM0e\\?"\s*:\s*\\?"([^"\\]+)/) || [])[1] || '';
      out.gaia = (text.match(/"S06Grb\\?"\s*:\s*\\?"(\d{6,25})/) || [])[1] || '';
      out.email = (text.match(/"([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})"/) || [])[1] || '';
      out.loggedIn = Boolean(out.signal) && !/accounts\.google\.com\/v3\/signin/.test(r.url);
      out.finalUrl = r.url;
    } catch (e) {
      out.error = e.message;
    }
    const cookies = await collectAll();
    const creds = pickCredentials(cookies);
    const nameSet = new Set(cookies.map(c => c.name));
    out.criticalPresent = CRITICAL_COOKIE_NAMES.filter(n => nameSet.has(n));
    out.criticalMissing = CRITICAL_COOKIE_NAMES.filter(n => !nameSet.has(n));
    out.hasSapisid = Boolean(creds.SAPISID || creds['__Secure-1PAPISID'] || creds['__Secure-3PAPISID']);
    out.hasStrong = Boolean(creds.SID && creds.HSID && creds.SSID);
    out.domains = [...new Set(cookies.map(c => normalizeDomain(c.domain)))].sort();
    return out;
  }

  return {
    capture,
    getLastExport,
    openSites,
    probeSites,
    resetProbeCache,
    ensureComplete,
    parseCookieInput,
    installCookies,
    getBackupInfo,
    restoreBackup,
    clearBackup,
    probe,
    snapshotGoogleCookies,
    // 导出给测试用
    _internals: {
      toNetscape, toCookieHeader, toPythonLiteral, pickCredentials, classify, summarize, buildSetDetails,
      DOMAIN_COOKIES, AUTH_CORE_NAMES, FLOW_MAIN_NAMES, CRITICAL_COOKIE_NAMES,
      __collectAllForTest: collectAll,
      SITE_TARGETS, NON_NAVIGABLE_PATTERNS, rejectOpenReason, siteByKey,
    },
  };
})();

if (typeof globalThis !== 'undefined') globalThis.GoogleCreds = GoogleCreds;
// CommonJS 导出仅供 tests/creds-google.test.js 使用（扩展环境里 module 不存在，不会走到）
if (typeof module !== 'undefined' && module.exports) module.exports = GoogleCreds;
