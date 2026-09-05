'use strict';

const assert = require('node:assert/strict');
const parser = require('../src/oauth/claude-token-parser.js');

assert.equal(parser.isClaudeTokenEndpoint('https://platform.claude.com/v1/oauth/token'), true);
assert.equal(parser.isClaudeTokenEndpoint('https://platform.claude.com/v1/oauth/token?request=1'), true);
assert.equal(parser.isClaudeTokenEndpoint('https://example.com/v1/oauth/token'), false);

const token = parser.parseTokenResponse(JSON.stringify({
  access_token: 'access-value',
  refresh_token: 'refresh-value',
  expires_in: 3600,
  scope: 'user:inference user:profile',
  token_type: 'Bearer'
}), 'https://platform.claude.com/v1/oauth/token');

assert.equal(token.access_token, 'access-value');
assert.equal(token.refresh_token, 'refresh-value');
assert.equal(token.expires_in, 3600);
assert.equal(token.scope, 'user:inference user:profile');
assert.equal(token.source_url, 'https://platform.claude.com/v1/oauth/token');
assert.equal(
  parser.parseTokenResponse('{"access_token":"only-access"}', 'https://platform.claude.com/v1/oauth/token'),
  null
);

console.log('token-parser tests passed');
