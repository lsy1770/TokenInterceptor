'use strict';

const assert = require('node:assert/strict');
const oauth = require('../src/oauth/grok-oauth.js');

const url = new URL(oauth.buildAuthorizeURL('challenge-value', 'state-value'));
assert.equal(url.origin + url.pathname, oauth.AUTHORIZE_URL);
assert.equal(url.searchParams.get('response_type'), 'code');
assert.equal(url.searchParams.get('client_id'), oauth.CLIENT_ID);
assert.equal(url.searchParams.get('redirect_uri'), oauth.REDIRECT_URI);
assert.equal(url.searchParams.get('code_challenge'), 'challenge-value');
assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
assert.equal(url.searchParams.get('state'), 'state-value');
assert.deepEqual(url.searchParams.get('scope').split(' '), oauth.SCOPES);

// isCallbackURL
assert.equal(oauth.isCallbackURL(new URL('http://127.0.0.1:51234/callback')), true);
assert.equal(oauth.isCallbackURL(new URL('http://localhost:51234/callback')), true);
assert.equal(oauth.isCallbackURL(new URL('http://127.0.0.1:51234/callback?code=x&state=y')), true);
assert.equal(oauth.isCallbackURL(new URL('http://127.0.0.1:1456/oauth-callback')), false);
assert.equal(oauth.isCallbackURL(new URL('https://auth.x.ai/oauth2/authorize')), false);

// extractAuthorizationCode
assert.deepEqual(
  oauth.extractAuthorizationCode(
    'http://127.0.0.1:51234/callback?code=auth-code&state=state-value',
    'state-value'
  ),
  { code: 'auth-code', state: 'state-value' }
);
assert.deepEqual(oauth.extractAuthorizationCode('raw-code', 'state-value'), { code: 'raw-code', state: '' });
assert.throws(
  () => oauth.extractAuthorizationCode(
    'http://127.0.0.1:51234/callback?code=auth-code&state=wrong',
    'state-value'
  ),
  /state/
);
assert.equal(
  oauth.extractAuthorizationCode('https://example.com/callback?code=auth-code', 'state-value'),
  null
);

// parseTokenResponse
const token = oauth.parseTokenResponse(JSON.stringify({
  access_token: 'access-value',
  refresh_token: 'refresh-value',
  id_token: 'id-value',
  expires_in: 21600,
  scope: oauth.SCOPES.join(' '),
  token_type: 'Bearer'
}));
assert.equal(token.access_token, 'access-value');
assert.equal(token.refresh_token, 'refresh-value');
assert.equal(token.id_token, 'id-value');
assert.equal(token.expires_in, 21600);
assert.equal(oauth.parseTokenResponse('{"refresh_token":"missing-access"}'), null);

// decodeIDToken
const b64 = value => Buffer.from(value, 'utf8').toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
const idToken = `${b64('{"typ":"JWT","alg":"ES256"}')}.`
  + `${b64('{"email":"alice@example.com","given_name":"Alice","family_name":"Johnson"}')}.sig`;
assert.deepEqual(oauth.decodeIDToken(idToken), {
  email: 'alice@example.com',
  givenName: 'Alice',
  familyName: 'Johnson',
  name: 'Alice Johnson'
});
assert.deepEqual(oauth.decodeIDToken(''), {
  email: '', givenName: '', familyName: '', name: ''
});

console.log('grok-oauth tests passed');
