'use strict';

const assert = require('node:assert/strict');
const GoogleCreds = require('../src/oauth/creds-google.js');

function cookie(domain, name, value, extra = {}) {
  return {
    domain, name, value, path: '/', secure: true, httpOnly: true,
    sameSite: 'lax', hostOnly: !domain.startsWith('.'),
    session: false, expirationDate: 1893456000, ...extra,
  };
}

let store = [];
let apiError = null;
const reads = [];
const saved = {};

global.chrome = {
  runtime: { lastError: null },
  cookies: {
    getAll(details, callback) {
      reads.push(details);
      const cookies = store.filter(c => {
        const domain = c.domain.replace(/^\./, '');
        return domain === details.domain || domain.endsWith('.' + details.domain);
      });
      chrome.runtime.lastError = apiError;
      callback(cookies);
      chrome.runtime.lastError = null;
    },
  },
  storage: { local: { async set(value) { Object.assign(saved, value); } } },
  tabs: {
    query() { assert.fail('Cookie capture must not depend on open tabs'); },
    create() { assert.fail('Cookie capture must not open login pages'); },
  },
};
global.fetch = async () => assert.fail('Cookie capture must not probe sites or rotate sessions');

(async () => {
  store = [
    cookie('.google.com', 'SAPISID', 'signature'),
    cookie('.google.com', 'SID', 'session', { secure: false }),
    cookie('.google.com', 'HSID', 'http-only', { secure: false }),
    cookie('.google.com', 'APISID', 'non-secure', { secure: false, httpOnly: false }),
    cookie('.google.com', 'SSID', 'secure-session'),
    cookie('.google.com', '__Secure-1PSID', '1psid'),
    cookie('.google.com', '__Secure-3PSID', '3psid'),
    cookie('.google.com', '__Secure-1PAPISID', '1papisid'),
    cookie('.google.com', '__Secure-3PAPISID', '3papisid'),
    cookie('.google.com', 'SIDCC', 'sidcc'),
    cookie('.google.com', '__Secure-1PSIDTS', 'unchanged'),
    cookie('play.google.com', 'OSID', 'play-session'),
    cookie('accounts.google.com', '__Host-GAPS', 'host-session'),
    cookie('accounts.google.com', 'LSID', 'path-session', { path: '/restricted' }),
    cookie('myaccount.google.com', 'OTHER_PATH', 'other-path', { path: '/account' }),
    cookie('.google.com', 'SID', 'different-path', { path: '/restricted' }),
    cookie('.notgoogle.com', 'TRACKER', 'unrelated'),
  ];

  const collected = await GoogleCreds._internals.__collectAllForTest();
  assert.deepEqual(reads, [{ domain: 'google.com' }]);
  assert.equal(collected.length, 16);
  assert.ok(collected.some(c => c.name === 'HSID' && c.httpOnly));
  assert.ok(collected.some(c => c.name === '__Host-GAPS' && c.hostOnly));
  assert.ok(collected.some(c => c.name === 'LSID' && c.path === '/restricted'));
  assert.equal(collected.filter(c => c.name === 'SID').length, 2);
  assert.ok(!collected.some(c => c.name === 'TRACKER'));

  // Complete required cookies export cleanly without depending on open tabs or network probes.
  reads.length = 0;
  const result = await GoogleCreds.capture();
  assert.equal(result.exportAllowed, true);
  assert.equal(result.needsLogin, false);
  assert.equal(result.cookies.length, collected.length);
  assert.equal(result.summary.siteReady.gemini, false);
  assert.equal(result.summary.siteReady.one, true);
  assert.ok(result.cookiesTxt.includes('HSID\thttp-only'));
  assert.ok(result.cookiesTxt.includes('/restricted'));
  assert.ok(result.cookieHeader.includes('SAPISID=signature'));
  assert.equal(result.credentials['__Secure-1PSIDTS'], 'unchanged');
  for (const name of ['SID', 'HSID', 'APISID']) {
    assert.equal(result.cookies.find(c => c.name === name).secure, false);
    assert.ok(!result.summary.criticalMissing.includes(name));
  }
  assert.deepEqual(reads, [{ domain: 'google.com' }]);
  assert.equal(saved.lastGoogleCredsExport.summary.total, collected.length);
  assert.equal(saved.lastGoogleCredsExport.cookies, undefined, 'Do not persist exported secrets');

  // Incomplete credentials must be blocked from export and tell the user which cookies/domains are missing.
  const lastSuccessfulExport = saved.lastGoogleCredsExport;
  store = [cookie('.google.com', '__Secure-1PSID', 'partial-session')];
  const partial = await GoogleCreds.capture();
  assert.equal(partial.exportAllowed, false);
  assert.equal(partial.needsLogin, true);
  assert.equal(partial.cookies, undefined, 'Incomplete capture must not expose exportable cookies');
  assert.equal(partial.cookiesTxt, undefined, 'Incomplete capture must not expose cookies.txt');
  assert.equal(partial.cookieHeader, undefined, 'Incomplete capture must not expose cookieHeader');
  assert.equal(partial.summary.hasSapisid, false);
  assert.equal(partial.summary.verdict, 'invalid');
  assert.equal(partial.summary.canCancel, false);
  assert.ok(partial.missingCookies.includes('SID'));
  assert.ok(partial.missingCookies.includes('HSID'));
  assert.ok(partial.missingCookies.some(m => /play\.google\.com/.test(m)));
  assert.ok(partial.missingDomains.some(d => d.key === 'accounts' && d.url.includes('accounts.google.com')));
  assert.ok(partial.missingDomains.some(d => d.key === 'play' && d.url.includes('play.google.com')));
  assert.ok(partial.missingDomains.some(d => d.key === 'one' && d.url.includes('one.google.com')));
  assert.equal(saved.lastGoogleCredsExport, lastSuccessfulExport, 'Blocked export must not overwrite last export');

  store = [];
  await assert.rejects(GoogleCreds.capture(), /网站访问权限.*同一浏览器配置文件/);
  assert.equal(saved.lastGoogleCredsExport, lastSuccessfulExport);

  apiError = { message: 'Cookie store is unavailable' };
  await assert.rejects(GoogleCreds.capture(), /Cookie store is unavailable/);
  assert.equal(saved.lastGoogleCredsExport, lastSuccessfulExport);
  apiError = null;

  delete chrome.cookies;
  await assert.rejects(GoogleCreds.capture(), /缺少 cookies 权限/);

  console.log('creds-google session tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
