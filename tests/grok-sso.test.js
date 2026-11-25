'use strict';

const assert = require('node:assert/strict');
const grok = require('../src/oauth/grok-sso.js');

function base64url(value) {
  return Buffer.from(value, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function makeSSO(sessionId = '1553c4b2-fcfe-40b1-ada8-ba8af3ad626b') {
  const header = base64url(JSON.stringify({ typ: 'JWT', alg: 'HS256' }));
  const payload = base64url(JSON.stringify({ session_id: sessionId }));
  return `${header}.${payload}.signature`;
}

const SSO = makeSSO();

// isLikelyGrokSSOToken
assert.equal(grok.isLikelyGrokSSOToken(SSO), true);
assert.equal(grok.isLikelyGrokSSOToken('eyJhbGciOiJIUzI1NiJ9.e30.'), false); // no session_id
assert.equal(
  grok.isLikelyGrokSSOToken('eyJhbGciOiJIUzI1NiJ9.' + base64url('{"sub":"user"}') + '.sig'),
  false
);
assert.equal(grok.isLikelyGrokSSOToken('a.b.c.d.e'), false); // 5 parts (chatgpt session)
assert.equal(grok.isLikelyGrokSSOToken('not-a-token'), false);

// parseCookieHeader
assert.deepEqual(
  grok.parseCookieHeader('sso=' + SSO + '; sso-rw=' + SSO + '; x-userid=adb6ce37'),
  { sso: SSO, 'sso-rw': SSO, 'x-userid': 'adb6ce37' }
);
assert.deepEqual(
  grok.parseCookieHeader('Cookie: sso=' + SSO),
  { sso: SSO }
);

// parseGrokSSOImport — raw JWT
assert.deepEqual(grok.parseGrokSSOImport(SSO), {
  sso: SSO, ssoRw: SSO, userId: '', email: '', xUsername: ''
});

// parseGrokSSOImport — cookie header
assert.deepEqual(
  grok.parseGrokSSOImport('sso=' + SSO + '; x-userid=adb6ce37-a0df-4f01-afeb-96603e51b6a7'),
  { sso: SSO, ssoRw: SSO, userId: 'adb6ce37-a0df-4f01-afeb-96603e51b6a7', email: '', xUsername: '' }
);

// parseGrokSSOImport — cookie header with only sso-rw falls back to it for sso
assert.deepEqual(grok.parseGrokSSOImport('sso-rw=' + SSO), {
  sso: SSO, ssoRw: SSO, userId: '', email: '', xUsername: ''
});

// parseGrokSSOImport — /api/auth/session JSON
const sessionJSON = JSON.stringify({
  status: 'authenticated',
  session: {
    userId: 'adb6ce37-a0df-4f01-afeb-96603e51b6a7',
    email: 'alice@example.com',
    xUsername: 'alice_x',
    sessionId: '1553c4b2-fcfe-40b1-ada8-ba8af3ad626b'
  }
});
assert.throws(() => grok.parseGrokSSOImport(sessionJSON), /未包含 sso Cookie 值/);

const sessionWithSSO = JSON.stringify({ session: { userId: 'u', email: 'a@b.c' }, sso: SSO });
assert.deepEqual(grok.parseGrokSSOImport(sessionWithSSO), {
  sso: SSO, ssoRw: SSO, userId: 'u', email: 'a@b.c', xUsername: ''
});

// invalid input
assert.throws(() => grok.parseGrokSSOImport(''), /请粘贴/);
assert.throws(() => grok.parseGrokSSOImport('random text'), /未找到有效的 Grok sso Cookie/);

console.log('grok-sso tests passed');
