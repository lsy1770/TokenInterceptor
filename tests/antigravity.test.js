'use strict';

const assert = require('node:assert/strict');
const oauth = require('../src/oauth/antigravity.js');

const url = new URL(oauth.buildAuthorizeURL('state-value'));
assert.equal(url.origin + url.pathname, oauth.AUTHORIZE_URL);
assert.equal(url.searchParams.get('client_id'), oauth.CLIENT_ID);
assert.equal(url.searchParams.get('redirect_uri'), oauth.REDIRECT_URI);
assert.equal(url.searchParams.get('access_type'), 'offline');
assert.equal(url.searchParams.get('prompt'), 'consent');
assert.equal(url.searchParams.get('include_granted_scopes'), 'true');
assert.equal(url.searchParams.get('state'), 'state-value');
assert.equal(url.searchParams.has('code_challenge'), false);
assert.deepEqual(url.searchParams.get('scope').split(' '), oauth.SCOPES);

assert.deepEqual(
  oauth.extractAuthorizationCode(
    'http://localhost:1456/oauth-callback?code=auth-code&state=state-value',
    'state-value'
  ),
  { code: 'auth-code', state: 'state-value' }
);
assert.deepEqual(oauth.extractAuthorizationCode('4/raw-code', 'state-value'), { code: '4/raw-code', state: '' });
assert.throws(
  () => oauth.extractAuthorizationCode(
    'http://localhost:1456/oauth-callback?code=auth-code&state=wrong-state',
    'state-value'
  ),
  /state/
);
assert.equal(
  oauth.extractAuthorizationCode('https://example.com/?code=auth-code&state=state-value', 'state-value'),
  null
);

const token = oauth.parseTokenResponse(JSON.stringify({
  access_token: 'access-value',
  refresh_token: 'refresh-value',
  expires_in: 3600,
  scope: oauth.SCOPES.join(' '),
  token_type: 'Bearer'
}));
assert.equal(token.access_token, 'access-value');
assert.equal(token.refresh_token, 'refresh-value');
assert.equal(token.expires_in, 3600);
assert.equal(oauth.parseTokenResponse('{"refresh_token":"missing-access"}'), null);

console.log('antigravity oauth tests passed');
