'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const listeners = {};
const fetchCalls = [];
const cookieSetCalls = [];
const cookieStore = {
  'sso': { name: 'sso', value: 'grok-sso-value' },
  'sso-rw': { name: 'sso-rw', value: 'grok-sso-value' },
  'x-userid': { name: 'x-userid', value: 'user-123' },
  'sessionKey': { name: 'sessionKey', value: 'sk-ant-sid01-test' },
  'lastActiveOrg': { name: 'lastActiveOrg', value: 'org-123' },
  'anthropic-device-id': { name: 'anthropic-device-id', value: 'device-123' },
  'routingHint': { name: 'routingHint', value: 'hint-123' }
};
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
  if (String(url).includes('/api/auth/session')) {
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          user: { email: 'alice@example.com' },
          accessToken: 'chatgpt-access',
          expires: '2026-12-01T00:00:00.000Z'
        });
      }
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
  cookies: {
    getAll(_details, callback) { callback([]); },
    get(details, callback) { callback(cookieStore[details.name] || null); },
    set(details, callback) { cookieSetCalls.push(details); callback({ ...details }); },
    remove(_details, callback) { callback(true); }
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

  const b64 = value => Buffer.from(value, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const grokSSO = `${b64('{"typ":"JWT","alg":"HS256"}')}.${b64('{"session_id":"1553c4b2-fcfe-40b1-ada8-ba8af3ad626b"}')}.sig`;

  const grokImport = await sendMessage({ type: 'IMPORT_GROK_SSO', payload: grokSSO, openGrok: false });
  assert.equal(grokImport.ok, true);
  assert.equal(grokImport.email, '');
  assert.deepEqual(cookieSetCalls.map(call => call.name).sort(), ['sso', 'sso-rw']);
  assert.ok(cookieSetCalls.every(call => call.value === grokSSO));
  assert.ok(cookieSetCalls.every(call => call.url === 'https://grok.com/'));
  assert.ok(cookieSetCalls.every(call => call.secure === true));

  const grokAuth = await sendMessage({ type: 'GROK_GENERATE_AUTH' });
  assert.equal(grokAuth.ok, true);
  assert.equal(new URL(grokAuth.url).searchParams.get('client_id'), global.GrokOAuth.CLIENT_ID);
  assert.equal(new URL(grokAuth.url).searchParams.get('redirect_uri'), 'http://127.0.0.1:51234/callback');
  assert.ok(new URL(grokAuth.url).searchParams.has('code_challenge'));

  const grokExchanged = await sendMessage({ type: 'GROK_EXCHANGE', value: 'grok-auth-code' });
  assert.equal(grokExchanged.ok, true);
  const grokTokenCall = fetchCalls.find(call => String(call.url).includes('auth.x.ai/oauth2/token'));
  assert.ok(grokTokenCall);
  const grokForm = new URLSearchParams(grokTokenCall.options.body);
  assert.equal(grokForm.get('grant_type'), 'authorization_code');
  assert.equal(grokForm.get('code'), 'grok-auth-code');
  assert.equal(grokForm.get('client_id'), global.GrokOAuth.CLIENT_ID);
  assert.equal(grokForm.get('redirect_uri'), 'http://127.0.0.1:51234/callback');
  assert.ok(grokForm.get('code_verifier'));
  assert.equal(grokForm.has('client_secret'), false);

  const grokState = await sendMessage({ type: 'GROK_GET_STATE' });
  assert.equal(grokState.ok, true);
  assert.equal(grokState.state.capturedToken.access_token, 'antigravity-access');
  assert.equal(grokState.state.capturedToken.refresh_token, 'antigravity-refresh');

  const allCreds = await sendMessage({ type: 'CAPTURE_CREDENTIALS', provider: 'all' });
  assert.equal(allCreds.ok, true);
  assert.equal(allCreds.credentials.openai.accessToken, 'chatgpt-access');
  assert.equal(allCreds.credentials.openai.sessionToken, '');
  assert.equal(allCreds.credentials.claude.sessionKey, 'sk-ant-sid01-test');
  assert.equal(allCreds.credentials.claude.lastActiveOrg, 'org-123');
  assert.equal(allCreds.credentials.claude.anthropicDeviceId, 'device-123');
  assert.equal(allCreds.credentials.claude.routingHint, 'hint-123');
  assert.equal(allCreds.credentials.grok.sso, 'grok-sso-value');
  assert.equal(allCreds.credentials.grok.ssoRw, 'grok-sso-value');
  assert.equal(allCreds.credentials.grok.xUserid, 'user-123');
  assert.deepEqual(allCreds.errors, {});

  const claudeSessionKey = 'sk-ant-sid01-abcdefghijklmnopqrstuvwxyz0123456789';
  const claudeImport = await sendMessage({ type: 'IMPORT_CLAUDE_SESSION', payload: claudeSessionKey, openClaude: false });
  assert.equal(claudeImport.ok, true);
  const claudeSets = cookieSetCalls.filter(call => call.name === 'sessionKey');
  assert.equal(claudeSets.length, 2);
  assert.ok(claudeSets.every(call => call.value === claudeSessionKey));
  assert.deepEqual(claudeSets.map(call => call.url).sort(), ['https://claude.ai/', 'https://claude.com/']);

  const unknown = await sendMessage({ type: 'INVITE_GET_CONFIG' });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /Unknown/);

  console.log('background smoke tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
