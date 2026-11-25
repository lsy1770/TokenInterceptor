'use strict';

// Optional real-browser regression: set PLAYWRIGHT_CORE_PATH and CHROMIUM_EXECUTABLE_PATH.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');

(async () => {
  const root = path.resolve(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'google-cookie-permissions-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    channel: process.env.CHROMIUM_EXECUTABLE_PATH ? undefined : 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).hostname;
    await worker.evaluate(async () => {
      globalThis.fetch = async () => { throw new Error('Offline regression test'); };
      await chrome.storage.local.set({ selectedPlatform: 'google' });
    });

    // Match Google's real attributes: SID/HSID/APISID are not Secure, unlike SAPISID/SSID.
    await context.addCookies([
      { name: 'SID', value: 'test-sid', domain: '.google.com', path: '/', secure: false, httpOnly: true, sameSite: 'Lax' },
      { name: 'HSID', value: 'test-hsid', domain: '.google.com', path: '/', secure: false, httpOnly: true, sameSite: 'Lax' },
      { name: 'APISID', value: 'test-apisid', domain: '.google.com', path: '/', secure: false, sameSite: 'Lax' },
      { name: 'SAPISID', value: 'test-sapisid', domain: '.google.com', path: '/', secure: true },
      { name: 'SSID', value: 'test-ssid', domain: '.google.com', path: '/', secure: true, httpOnly: true },
      { name: '__Secure-1PSID', value: 'test-shadow', domain: '.google.com', path: '/', secure: true, httpOnly: true },
      { name: 'LSID', value: 'test-path', domain: 'accounts.google.com', path: '/restricted', secure: true, httpOnly: true },
      { name: '__Host-GAPS', value: 'test-host', url: 'https://accounts.google.com/', secure: true, httpOnly: true },
    ]);

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(`chrome-extension://${extensionId}/ui/popup.html`);
    await page.waitForFunction(() => document.body.dataset.platform === 'google');
    await page.waitForFunction(() => document.getElementById('googleAccount').textContent !== '-');
    await page.click('#googleCapture');
    await page.waitForFunction(() => document.getElementById('googleCredsJSON').value.length > 0);
    const result = JSON.parse(await page.inputValue('#googleCredsJSON'));
    const browserCookies = await context.cookies();
    const missing = browserCookies.filter(c => !result.cookies.some(exported =>
      exported.name === c.name && exported.domain === c.domain && exported.path === c.path));
    console.log(JSON.stringify({
      browser: context.browser().version(), stored: browserCookies.length,
      exported: result.cookies.length, missing: missing.map(c => c.name),
    }));
    assert.deepEqual(missing.map(c => c.name), [], 'The extension must read non-Secure cookies too');
    assert.equal(result.cookies.length, 8);
    for (const name of ['SID', 'HSID', 'APISID']) {
      assert.equal(result.cookies.find(c => c.name === name).secure, false);
      assert.ok((await page.inputValue('#googleCookiesTxt')).includes(`${name}\ttest-`));
    }
    assert.equal(result.summary.hasStrong, true);
    assert.equal(result.summary.verdict, 'ok');
    assert.ok(result.cookies.some(c => c.name === '__Host-GAPS' && c.hostOnly));
    assert.ok(result.cookies.some(c => c.name === 'LSID' && c.path === '/restricted'));
    assert.deepEqual(pageErrors, []);
    console.log('google cookie permissions browser regression passed');
  } finally {
    await context.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
