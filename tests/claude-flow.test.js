'use strict';

const assert = require('node:assert/strict');
const flow = require('../src/oauth/claude-flow.js');

const authURL = new URL(flow.buildAuthorizeURL('challenge-value', 'state-value'));
assert.equal(authURL.origin + authURL.pathname, flow.AUTHORIZE_URL);
assert.equal(authURL.searchParams.get('client_id'), flow.CLIENT_ID);
assert.equal(authURL.searchParams.get('redirect_uri'), flow.REDIRECT_URI);
assert.equal(authURL.searchParams.get('code_challenge'), 'challenge-value');
assert.equal(authURL.searchParams.get('state'), 'state-value');
assert.equal(authURL.searchParams.get('code_challenge_method'), 'S256');

assert.deepEqual(
  flow.extractAuthorizationCode('auth-code#state-value', 'state-value'),
  { code: 'auth-code', state: 'state-value' }
);
assert.deepEqual(
  flow.extractAuthorizationCode(
    'https://console.anthropic.com/oauth/code/callback?code=auth-code&state=state-value',
    'state-value'
  ),
  {
    code: 'auth-code',
    state: 'state-value',
    redirectURI: 'https://console.anthropic.com/oauth/code/callback'
  }
);
assert.throws(
  () => flow.extractAuthorizationCode('auth-code#wrong-state', 'state-value'),
  /state/
);
assert.equal(
  flow.extractAuthorizationCode(
    'https://console.anthropic.com/oauth/code/callback?error=access_denied&state=state-value',
    'state-value'
  ),
  null
);

console.log('oauth-flow tests passed');
