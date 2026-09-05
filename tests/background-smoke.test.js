'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const listeners = {};
const fetchCalls = [];
const makeEvent = name => ({
  addListener(handler) { listeners[name] = handler; },
  removeListener() {}
});

function createStorageArea() {
  const data = {};
  return {
    async get(keys) {
      if (keys == null) return { ...data };
      const names = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(names.filter(name => name in data).map(name => [name, data[name]]));
    },
    async set(values) { Object.assign(data, values); },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    }
  };
}

global.importScripts = (...files) => {
  for (const file of files) require(path.join(__dirname, '..', 'src', file));
};
global.fetch = async (url, options) => {
  fetchCalls.push({ url, options });
  if (String(url).includes('/oauth2/v2/userinfo')) {
    return {
      ok: true,
      status: 200,
      async json() { return { email: 'user@example.com', name: 'Test User' }; }
    };
  }
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        access_token: 'antigravity-access',
        refresh_token: 'antigravity-refresh',
        expires_in: 3600,
        scope: 'openid',
        token_type: 'Bearer'
      });
    }
  };
};
global.chrome = {
  action: {
    setBadgeText() {},
    setBadgeBackgroundColor() {}
  },
  debugger: {
    attach(_target, _version, callback) { callback(); },
    detach(_target, callback) { callback(); },
    sendCommand(_target, _method, _params, callback) { callback({}); },
    onEvent: makeEvent('debuggerEvent'),
    onDetach: makeEvent('debuggerDetach')
  },
  notifications: { create() {} },
  runtime: {
    lastError: null,
    getURL(path) { return `chrome-extension://test/${path}`; },
    onMessage: makeEvent('message'),
    onInstalled: makeEvent('installed'),
    onStartup: makeEvent('startup')
  },
  storage: {
    local: createStorageArea(),
    session: createStorageArea()
  },
  tabs: {
    async query() { return []; },
    async create({ url }) { return { id: 1, url, status: 'complete' }; },
    onUpdated: makeEvent('tabUpdated')
  },
  webNavigation: { onBeforeNavigate: makeEvent('beforeNavigate') }
};

require('../src/background.js');

function sendMessage(message) {
  return new Promise(resolve => listeners.message(message, {}, resolve));
}

(async () => {
  const openAIState = await sendMessage({ type: 'GET_TOKENS' });
  assert.equal(openAIState.ok, true);
  assert.deepEqual(openAIState.tokens, []);

  const claudeState = await sendMessage({ type: 'CLAUDE_GET_STATE' });
  assert.equal(claudeState.ok, true);
  assert.equal(claudeState.state.captureActive, false);
  assert.equal(claudeState.state.capturedToken, null);

  const antigravityState = await sendMessage({ type: 'ANTIGRAVITY_GET_STATE' });
  assert.equal(antigravityState.ok, true);
  assert.equal(antigravityState.state.oauthPending, false);
  assert.equal(antigravityState.state.capturedToken, null);

  const generated = await sendMessage({ type: 'ANTIGRAVITY_GENERATE_AUTH' });
  assert.equal(generated.ok, true);
  assert.equal(new URL(generated.url).searchParams.get('access_type'), 'offline');
  assert.equal(new URL(generated.url).searchParams.has('code_challenge'), false);

  const exchanged = await sendMessage({
    type: 'ANTIGRAVITY_EXCHANGE',
    value: '4/test-code'
  });
  assert.equal(exchanged.ok, true);
  const tokenCall = fetchCalls.find(call => String(call.url).includes('oauth2.googleapis.com/token'));
  assert.ok(tokenCall);
  const exchangeForm = new URLSearchParams(tokenCall.options.body);
  assert.ok(exchangeForm.get('client_secret'));
  assert.equal(exchangeForm.get('client_secret'), global.AntigravityOAuth.CLIENT_SECRET);
  assert.equal(exchangeForm.get('code'), '4/test-code');
  assert.equal(exchangeForm.has('code_verifier'), false);
  assert.equal(exchangeForm.get('redirect_uri'), 'http://localhost:1456/oauth-callback');

  const completedState = await sendMessage({ type: 'ANTIGRAVITY_GET_STATE' });
  assert.equal(completedState.state.capturedToken.access_token, 'antigravity-access');
  assert.equal(completedState.state.capturedToken.refresh_token, 'antigravity-refresh');
  assert.equal(completedState.state.capturedToken.email, 'user@example.com');
  assert.equal(completedState.state.capturedToken.client_secret, undefined);

  const unknown = await sendMessage({ type: 'INVITE_GET_CONFIG' });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /Unknown/);

  console.log('background smoke tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
