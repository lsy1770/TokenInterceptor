'use strict';

const assert = require('node:assert/strict');
const claude = require('../src/oauth/claude-session.js');

const SESSION_KEY = 'sk-ant-sid01-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// isLikelyClaudeSessionKey
assert.equal(claude.isLikelyClaudeSessionKey(SESSION_KEY), true);
assert.equal(claude.isLikelyClaudeSessionKey('sk-ant-sid01-short'), false);
assert.equal(claude.isLikelyClaudeSessionKey('sk-ant-api03-not-a-session-key-123456789'), true);
assert.equal(claude.isLikelyClaudeSessionKey('not-a-key'), false);
assert.equal(claude.isLikelyClaudeSessionKey(''), false);

// parseCookieHeader
assert.deepEqual(
  claude.parseCookieHeader(`sessionKey=${SESSION_KEY}; lastActiveOrg=org-123; routingHint=hint`),
  { sessionKey: SESSION_KEY, lastActiveOrg: 'org-123', routingHint: 'hint' }
);
assert.deepEqual(claude.parseCookieHeader(`Cookie: sessionKey=${SESSION_KEY}`), { sessionKey: SESSION_KEY });

// parseClaudeSessionImport — raw sessionKey
assert.deepEqual(claude.parseClaudeSessionImport(SESSION_KEY), {
  sessionKey: SESSION_KEY,
  lastActiveOrg: '',
  anthropicDeviceId: '',
  routingHint: ''
});

// parseClaudeSessionImport — cookie header
assert.deepEqual(
  claude.parseClaudeSessionImport(
    `sessionKey=${SESSION_KEY}; lastActiveOrg=org-123; anthropic-device-id=device-123; routingHint=hint`
  ),
  {
    sessionKey: SESSION_KEY,
    lastActiveOrg: 'org-123',
    anthropicDeviceId: 'device-123',
    routingHint: 'hint'
  }
);

// parseClaudeSessionImport — JSON
assert.deepEqual(
  claude.parseClaudeSessionImport(JSON.stringify({
    sessionKey: SESSION_KEY,
    lastActiveOrg: 'org-123',
    anthropicDeviceId: 'device-123',
    routingHint: 'hint'
  })),
  {
    sessionKey: SESSION_KEY,
    lastActiveOrg: 'org-123',
    anthropicDeviceId: 'device-123',
    routingHint: 'hint'
  }
);

// invalid input
assert.throws(() => claude.parseClaudeSessionImport(''), /请粘贴/);
assert.throws(() => claude.parseClaudeSessionImport('random text'), /未找到有效的 Claude sessionKey/);
assert.throws(
  () => claude.parseClaudeSessionImport('sessionKey=not-a-valid-key'),
  /不是有效的 Claude sessionKey/
);

console.log('claude-session tests passed');
