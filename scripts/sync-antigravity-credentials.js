'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const input = process.argv[2];
if (!input) {
  console.error('Usage: npm run setup:antigravity -- <Antigravity-Manager directory or oauth.rs path>');
  process.exit(1);
}

const sourcePath = fs.statSync(input).isDirectory()
  ? path.join(input, 'src-tauri', 'src', 'modules', 'oauth.rs')
  : path.resolve(input);
if (!fs.existsSync(sourcePath)) {
  console.error(`OAuth source file not found: ${sourcePath}`);
  process.exit(1);
}

const source = fs.readFileSync(sourcePath, 'utf8');
const match = source.match(/const CLIENT_SECRET:\s*&str\s*=\s*"([^"]+)"/);
if (!match?.[1]) {
  console.error('Built-in CLIENT_SECRET was not found in oauth.rs');
  process.exit(1);
}

const targetPath = path.join(root, 'config', 'antigravity-credentials.local.json');
fs.mkdirSync(path.dirname(targetPath), { recursive: true });
fs.writeFileSync(targetPath, `${JSON.stringify({ clientSecret: match[1] })}\n`, { mode: 0o600 });
console.log('Antigravity credentials synchronized to the local ignored credential file.');
