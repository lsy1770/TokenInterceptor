'use strict';

const assert = require('node:assert/strict');
const GoogleCreds = require('../src/oauth/creds-google.js');

const { toNetscape, toCookieHeader, toPythonLiteral, pickCredentials, classify, summarize, buildSetDetails } =
  GoogleCreds._internals;

function cookie(over = {}) {
  return {
    domain: '.google.com',
    name: 'SAPISID',
    value: 'abc123',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'no_restriction',
    hostOnly: false,
    session: false,
    expirationDate: 1893456000,
    ...over,
  };
}

const sample = [
  cookie({ domain: '.google.com', name: 'SID', value: 'sid-value' }),
  cookie({ domain: '.google.com', name: 'HSID', value: 'hsid-value' }),
  cookie({ domain: '.google.com', name: 'SSID', value: 'ssid-value' }),
  cookie({ domain: '.google.com', name: 'SAPISID', value: 'sapisid-value' }),
  cookie({ domain: 'play.google.com', name: 'PLAY_ACTIVITY_TOKEN', value: 'p1', hostOnly: true }),
  cookie({ domain: 'accounts.google.com', name: '__Host-GAPS', value: 'g1', hostOnly: true }),
  cookie({ domain: '.google.com', name: '__Secure-1PSIDTS', value: 'ts1', sameSite: 'lax' }),
  cookie({ domain: 'one.google.com', name: 'OSID', value: 'o1', hostOnly: true }),
];

// ---- pickCredentials：只认 google.com 一级的强会话 ----
const creds = pickCredentials(sample);
assert.equal(creds.SID, 'sid-value');
assert.equal(creds.SAPISID, 'sapisid-value');
assert.equal(creds['__Secure-1PSIDTS'], 'ts1');
assert.equal(creds.PLAY_ACTIVITY_TOKEN, undefined, 'play 域 cookie 不应进凭据字典');

// ---- classify：按域分组 ----
const buckets = classify(sample);
assert.ok(buckets.google.includes('SAPISID'));
assert.ok(buckets.play.includes('PLAY_ACTIVITY_TOKEN'));
assert.ok(buckets.accounts.includes('__Host-GAPS'));
assert.ok(buckets.one.includes('OSID'));

// ---- summarize：能不能取消订阅 ----
const good = summarize(sample, creds);
assert.equal(good.hasSapisid, true);
assert.equal(good.hasStrong, true);
assert.equal(good.hasShadowSession, false);
assert.equal(good.verdict, 'ok');
// canCancel 现在要求 play 域有「登录态证据」，sample 里 play 只有 PLAY_ACTIVITY_TOKEN（不是会话）
assert.equal(good.siteReady.play, false, 'PLAY_ACTIVITY_TOKEN 不算 play 登录态');
assert.equal(good.canCancel, false);
assert.equal(good.complete, false);

const fullSites = summarize(
  sample.concat([
    cookie({ domain: 'play.google.com', name: '__Secure-OSID', value: 'o', hostOnly: true }),
    cookie({ domain: 'gemini.google.com', name: 'COMPASS', value: 'c', hostOnly: true }),
    cookie({ domain: 'one.google.com', name: '__Secure-OSID', value: 'o', hostOnly: true }),
    cookie({ domain: 'accounts.google.com', name: 'LSID', value: 'l', hostOnly: true }),
  ]),
  creds
);
assert.equal(fullSites.siteReady.play, true);
assert.equal(fullSites.canCancel, true);
assert.deepEqual(fullSites.missingSites, []);
assert.equal(fullSites.complete, true);

// 关键回归：域里有 cookie 不等于「该域登录了」。
// 用户真实情况 —— play 只有 OSID/OTZ/PLAY_ACTIVE_ACCOUNT 这类非会话 cookie，
// 旧逻辑会误判为就绪；新逻辑必须判出 play 未就绪。
const deadSession = summarize([
  cookie({ name: 'SAPISID', value: 's' }),
  cookie({ name: '__Secure-1PSID', value: 'p' }),
  cookie({ domain: 'play.google.com', name: 'OTZ', value: 'x', hostOnly: true }),
  cookie({ domain: 'play.google.com', name: 'PLAY_ACTIVE_ACCOUNT', value: 'y', hostOnly: true }),
  cookie({ domain: 'gemini.google.com', name: 'COMPASS', value: 'c', hostOnly: true }),
], creds);
assert.equal(deadSession.siteReady.play, false, 'OTZ/PLAY_ACTIVE_ACCOUNT 不能证明 play 已登录');
assert.ok(deadSession.missingSites.includes('play'), 'play 未就绪必须进 missingSites');
assert.equal(deadSession.canCancel, false);

const noPlay = summarize(sample.filter(c => c.domain !== 'play.google.com'), creds);
assert.equal(noPlay.canCancel, false);
assert.ok(noPlay.missing.some(m => /play\.google\.com/.test(m)));
assert.ok(noPlay.missingSites.includes('play'));

// 缺字段要逐项报，不许含糊成 "SID+HSID+SSID"
const noHsidCreds = pickCredentials(sample.filter(c => c.name !== 'HSID'));
const noHsid = summarize(sample.filter(c => c.name !== 'HSID'), noHsidCreds);
assert.equal(noHsid.hasStrong, false);
assert.deepEqual(noHsid.missingStrongFields, ['HSID']);
assert.ok(noHsid.missing.includes('HSID'), '必须点名 HSID');
assert.ok(!noHsid.missing.includes('SID+HSID+SSID'), '不许再用笼统写法');
assert.equal(noHsid.verdict, 'invalid', '既无强会话也无影子会话 → invalid');

// 只有影子会话（真实账号常见）：degraded，但 canCancel 仍可为真
const shadowCookies = [
  cookie({ name: 'SAPISID', value: 's' }),
  cookie({ name: '__Secure-1PSID', value: 'p1' }),
  cookie({ domain: 'play.google.com', name: '__Secure-OSID', value: 'o', hostOnly: true }),
];
const shadowed = summarize(shadowCookies, pickCredentials(shadowCookies));
assert.equal(shadowed.hasStrong, false);
assert.equal(shadowed.hasShadowSession, true);
assert.equal(shadowed.verdict, 'degraded');
assert.equal(shadowed.canCancel, true, '有影子会话 + play 登录态即可取消');
assert.deepEqual(shadowed.missingStrongFields, ['SID', 'HSID', 'SSID']);

// 没有 SAPISID 直接 invalid
const noSapisid = summarize([], pickCredentials([cookie({ name: 'SID', value: 'x' })]));
assert.equal(noSapisid.verdict, 'invalid');
assert.equal(noSapisid.canCancel, false);

// 没有 SAPISID 但只有 __Secure-3PAPISID 也算有签名材料
const secureOnly = pickCredentials([cookie({ name: '__Secure-3PAPISID', value: 'v' })]);
assert.equal(summarize([], secureOnly).hasSapisid, true);

// ---- toNetscape：列数 / 域前缀 / 会话 vs 持久 ----
const txt = toNetscape(sample);
const lines = txt.trim().split('\n');
assert.ok(lines[0].startsWith('# Netscape HTTP Cookie File'), '首行必须是 Netscape 头');
assert.ok(lines[1].startsWith('#'), '导出说明行');
assert.ok(lines[2].startsWith('# exported_at:'), '导出时间行');
const body = lines.filter(l => l.trim() && !l.startsWith('#'));
assert.equal(body.length, sample.length);
const first = body[0].split('\t');
assert.equal(first.length, 7);
assert.equal(first[0], '.google.com', 'domain cookie 带前导点');
assert.equal(first[1], 'TRUE');
assert.equal(first[3], 'TRUE', 'secure 列');
assert.equal(first[4], '1893456000');
assert.equal(first[5], 'SID');

const hostOnlyLine = body.find(l => l.includes('PLAY_ACTIVITY_TOKEN')).split('\t');
assert.equal(hostOnlyLine[0], 'play.google.com', 'host-only 不带前导点');
assert.equal(hostOnlyLine[1], 'FALSE');

const sessionLine = toNetscape([cookie({ session: true, expirationDate: null })]).trim().split('\n').pop().split('\t');
assert.equal(sessionLine[4], '0', '会话 cookie 过期列写 0');

// 值里带分号/等号不应被破坏（Netscape 用 TAB 分隔）
const messy = toNetscape([cookie({ name: 'X', value: 'a=b;c=d' })]).trim().split('\n').pop().split('\t');
assert.equal(messy[6], 'a=b;c=d');

// ---- toCookieHeader ----
const header = toCookieHeader(sample);
assert.ok(header.startsWith('SID=sid-value; HSID=hsid-value'));
assert.ok(header.includes('SAPISID=sapisid-value'));
assert.ok(!header.includes('PLAY_ACTIVITY_TOKEN'), '非 google.com 域不进 header');

// ---- toPythonLiteral：能否被 Python 直接执行 ----
const py = toPythonLiteral(sample);
assert.ok(py.includes('COOKIES = ['));
assert.ok(py.includes('("google.com", "SAPISID", "sapisid-value")'));
assert.ok(py.includes('def sapisidhash'));
assert.ok(py.includes('SAPISIDHASH %d_%s'));

// ---- buildSetDetails：Chrome cookies.set 参数约束 ----
const samesiteNone = buildSetDetails(cookie({ secure: false, sameSite: 'no_restriction' }));
assert.equal(samesiteNone.secure, true, 'SameSite=None 必须强制 Secure');
assert.equal(samesiteNone.sameSite, 'no_restriction');
assert.equal(samesiteNone.domain, '.google.com');

const hostOnly = buildSetDetails(cookie({ domain: 'play.google.com', hostOnly: true }));
assert.equal(hostOnly.domain, undefined, 'host-only 不下 domain 字段');
assert.equal(hostOnly.url, 'https://play.google.com/');

const expired = buildSetDetails(cookie({ expirationDate: 1 }));
assert.ok(expired.expirationDate > Date.now() / 1000, '过期时间被抬到未来');

const sessionCookie = buildSetDetails(cookie({ session: true, expirationDate: null }));
assert.equal(sessionCookie.expirationDate, undefined, '会话 cookie 不写 expirationDate');

// ---- parseCookieInput：三种输入格式 ----
const fromJson = GoogleCreds.parseCookieInput(JSON.stringify({ cookies: [cookie({ name: 'SID' })] }));
assert.equal(fromJson.length, 1);
assert.equal(fromJson[0].name, 'SID');

const fromCredsOnly = GoogleCreds.parseCookieInput(JSON.stringify({ credentials: { SID: 'x', SAPISID: 'y' } }));
assert.equal(fromCredsOnly.length, 2);
// 只给裸值时必须按 domain cookie 注入，否则子域读不到
assert.equal(fromCredsOnly[0].domain, '.google.com');
assert.equal(fromCredsOnly[0].hostOnly, false);
const fromTxt = GoogleCreds.parseCookieInput([
  '# Netscape HTTP Cookie File',
  '.google.com\tTRUE\t/\tTRUE\t1893456000\tSAPISID\tzzz',
  'play.google.com\tFALSE\t/\tTRUE\t0\tPLAY_X\tvvv',
].join('\n'));
assert.equal(fromTxt.length, 2);
assert.equal(fromTxt[0].domain, 'google.com', 'Netscape 解析保留原始域（前导点由 hostOnly 标记控制）');
assert.equal(fromTxt[0].hostOnly, false);
assert.equal(fromTxt[0].name, 'SAPISID');
assert.equal(fromTxt[1].hostOnly, true);
assert.equal(fromTxt[1].session, true);
assert.equal(fromTxt[1].expirationDate, null);

const fromHeader = GoogleCreds.parseCookieInput('SID=abc; HSID=def; SAPISID=ghi');
assert.equal(fromHeader.length, 3);
assert.ok(fromHeader.every(c => c.domain === '.google.com'));
assert.equal(fromHeader.find(c => c.name === 'SID').httpOnly, true, 'SID 默认 httpOnly');

assert.throws(() => GoogleCreds.parseCookieInput(''), /请粘贴/);
assert.throws(() => GoogleCreds.parseCookieInput('not-a-cookie'), /没解析出/);

// ---- 端点表存在且覆盖取消链路 ----
assert.ok(GoogleCreds._internals.DOMAIN_COOKIES.some(d => d.domain === 'play.google.com'));
assert.ok(GoogleCreds._internals.AUTH_CORE_NAMES.includes('SAPISID'));

// ---- 站点表：只能放「能当页面打开」的地址 ----
const { SITE_TARGETS, rejectOpenReason } = GoogleCreds._internals;

assert.equal(SITE_TARGETS.length, 4);
for (const site of SITE_TARGETS) {
  // accounts 点位是登录入口，需要 allowLoginPage 才放行
  assert.equal(rejectOpenReason(site.url, { allowLoginPage: site.allowLoginPage === true }), '',
    `站点 ${site.key} 的 URL 不可导航：${site.url}`);
  assert.ok(site.url.startsWith('https://'), `${site.key} 必须是 https`);
  assert.ok(site.why, `${site.key} 缺少说明文案`);
}
// 除 accounts 外，其他点位不允许指向登录跳转（用登录页样本反证，而不是要求它们被拒）
assert.notEqual(
  rejectOpenReason('https://play.google.com/ServiceLogin?continue=https://play.google.com/store'),
  '',
  '非 accounts 点位指向 ServiceLogin 必须被拒'
);

// 曾经的 bug：把 XHR 专用的 ListAccounts 当页面打开，浏览器只会得到 400
const accountsSite = SITE_TARGETS.find(s => s.key === 'accounts');
assert.ok(accountsSite, 'accounts 点位应存在');
assert.ok(!/ListAccounts/i.test(accountsSite.url), 'accounts 不得再指向 ListAccounts 接口');
assert.ok(/myaccount\.google\.com|accounts\.google\.com\/?$/.test(accountsSite.url),
  'accounts 应指向可渲染的账号页');

// accounts 只做提示，绝不自动打开：每探一次就触发一次 ServiceLogin 跳转，连点会被打成 429
assert.equal(accountsSite.autoOpen, true, 'accounts 应作为统一登录入口自动打开');
assert.equal(accountsSite.allowLoginPage, true, 'accounts 指向登录入口，需放行');
assert.equal(accountsSite.skipProbe, true, 'accounts 本身是登录页，不应参与探测');
for (const key of ['gemini', 'play', 'one']) {
  const site = SITE_TARGETS.find(s => s.key === key);
  assert.ok(site, `${key} 点位应存在`);
  assert.equal(site.autoOpen, true, `${key} 应允许自动打开`);
  assert.ok(!site.skipProbe, `${key} 应参与探测`);
}

// 各种内部端点都要被拦下
for (const bad of [
  'https://accounts.google.com/ListAccounts?gpsia=1&source=ogb&hl=en',
  'https://play.google.com/_/PlayStoreUi/data/batchexecute',
  'https://gemini.google.com/_/BardChatUi/data/batchexecute',
  'https://accounts.google.com/v3/signin/challenge/totp',
  'https://accounts.google.com/RotateCookies',
  'https://accounts.google.com/ServiceLogin?continue=x',
]) {
  assert.notEqual(rejectOpenReason(bad), '', `应拦截：${bad}`);
}
assert.equal(rejectOpenReason('http://gemini.google.com/app'), '只允许 https');
assert.equal(rejectOpenReason('not a url'), 'URL 非法');

// ---- 探测名单必须覆盖全部可探测站点，不能由 missingSites 推导 ----
// 回归：曾经的 bug 是 probeKeys = summary.missingSites.filter(...)，
// 本地把 play/gemini 误判成就绪后它们根本不进探测名单，只探一个正常的 one 就 allOk → 放行死 cookie。
const probeable = SITE_TARGETS.filter(s => !s.skipProbe).map(s => s.key);
assert.deepEqual(probeable.sort(), ['gemini', 'one', 'play'],
  '探测必须固定覆盖 gemini/play/one 三个站点');
assert.ok(!probeable.includes('accounts'), 'accounts 是登录入口，不应参与探测');

// ---- 域里有 cookie ≠ 该域已登录 ----
// 用户真实分布：play 只有 OSID/OTZ/PLAY_ACTIVE_ACCOUNT，gemini 只有 COMPASS，one 只有 OTZ
const realWorld = summarize([
  cookie({ name: 'SAPISID', value: 's' }),
  cookie({ name: '__Secure-1PAPISID', value: 'a' }),
  cookie({ name: '__Secure-1PSID', value: 'p' }),
  cookie({ name: 'SSID', value: 'x' }),
  cookie({ domain: 'accounts.google.com', name: '__Host-1PLSID', value: 'l', hostOnly: true }),
  cookie({ domain: 'play.google.com', name: 'OSID', value: 'o', hostOnly: true }),
  cookie({ domain: 'play.google.com', name: 'OTZ', value: 'z', hostOnly: true }),
  cookie({ domain: 'play.google.com', name: 'PLAY_ACTIVE_ACCOUNT', value: 'pa', hostOnly: true }),
  cookie({ domain: 'gemini.google.com', name: 'COMPASS', value: 'c', hostOnly: true }),
  cookie({ domain: 'one.google.com', name: 'OTZ', value: 'z2', hostOnly: true }),
], pickCredentials([
  cookie({ name: 'SAPISID', value: 's' }),
  cookie({ name: '__Secure-1PAPISID', value: 'a' }),
  cookie({ name: '__Secure-1PSID', value: 'p' }),
  cookie({ name: 'SSID', value: 'x' }),
]));

// OSID 属于会话级证据 → play 判就绪（这本身就是弱证据，靠探测兜底）
assert.equal(realWorld.siteReady.play, true);
// OTZ 不算 any 证据 → one 必须判未就绪
assert.equal(realWorld.siteReady.one, false, 'OTZ 不能证明 one 已登录');
assert.ok(realWorld.missingSites.includes('one'));

// 只给 OTZ 时 play 必须判未就绪
const otzOnly = summarize([
  cookie({ domain: 'play.google.com', name: 'OTZ', value: 'z', hostOnly: true }),
  cookie({ domain: 'play.google.com', name: 'PLAY_ACTIVE_ACCOUNT', value: 'pa', hostOnly: true }),
], {});
assert.equal(otzOnly.siteReady.play, false, 'OTZ/PLAY_ACTIVE_ACCOUNT 不能证明 play 已登录');

// ---- 关键 cookie 必须在采集名单里 ----
// 回归：SID / HSID 挂在 .google.com 上，靠域名枚举有盲区；漏了这两个，
// play.google.com 会直接返回登录页（实测差 170 字符，结果天差地别）。
const CRITICAL = GoogleCreds._internals.CRITICAL_COOKIE_NAMES;
assert.ok(Array.isArray(CRITICAL) && CRITICAL.length > 0, 'CRITICAL_COOKIE_NAMES 应存在');
for (const name of ['SID', 'HSID', 'APISID', 'SAPISID', '__Secure-1PSID']) {
  assert.ok(CRITICAL.includes(name), `关键 cookie ${name} 必须被单独兜底抓取`);
}

// 有 SID+HSID 时 verdict 必须是 ok（这是 Play 可用的前提）
const withStrong = summarize([
  cookie({ name: 'SID', value: 's' }),
  cookie({ name: 'HSID', value: 'h' }),
  cookie({ name: 'SSID', value: 'x' }),
  cookie({ name: 'SAPISID', value: 'a' }),
], pickCredentials([
  cookie({ name: 'SID', value: 's' }),
  cookie({ name: 'HSID', value: 'h' }),
  cookie({ name: 'SSID', value: 'x' }),
  cookie({ name: 'SAPISID', value: 'a' }),
]));
assert.equal(withStrong.verdict, 'ok');
assert.equal(withStrong.hasStrong, true);
assert.deepEqual(withStrong.missingStrongFields, []);

console.log('creds-google tests passed');
