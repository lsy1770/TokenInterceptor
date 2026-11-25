'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function existing(relativePath) {
  const absolutePath = path.resolve(root, relativePath);
  assert(absolutePath.startsWith(`${root}${path.sep}`), `Path escapes project root: ${relativePath}`);
  assert(fs.existsSync(absolutePath), `Manifest references missing file: ${relativePath}`);
}

function validateMarkdownLinks(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  const targets = [...source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(match => match[1]);

  for (const target of targets) {
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    const fileTarget = target.split('#', 1)[0];
    const resolvedTarget = path.resolve(path.dirname(absolutePath), fileTarget);
    assert(resolvedTarget.startsWith(`${root}${path.sep}`),
      `Markdown link escapes project root in ${relativePath}: ${target}`);
    assert(fs.existsSync(resolvedTarget), `Broken Markdown link in ${relativePath}: ${target}`);
  }
}

const referencedFiles = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
  ...(manifest.content_scripts || []).flatMap(entry => entry.js || [])
].filter(Boolean);
for (const file of new Set(referencedFiles)) existing(file);

assert(manifest.manifest_version === 3, 'Only Manifest V3 is supported');
assert(manifest.name === 'openai/claude Token Interceptor', 'Unexpected extension name');
assert(manifest.host_permissions?.includes('*://*.google.com/*'),
  'Google Cookie capture needs HTTP and HTTPS host access to include non-Secure SID/HSID/APISID cookies');

const javascriptFiles = [
  'src/background.js',
  'src/content.js',
  'src/injected.js',
  'src/callback.js',
  'src/oauth/claude-flow.js',
  'src/oauth/claude-token-parser.js',
  'src/oauth/antigravity.js',
  'src/oauth/grok-sso.js',
  'src/oauth/grok-oauth.js',
  'src/oauth/claude-session.js',
  'src/oauth/creds-google.js',
  'ui/popup.js'
];
for (const file of javascriptFiles) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  new vm.Script(source, { filename: file });
}

for (const file of ['README.md', 'README_EN.md', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/ARCHITECTURE.md', 'docs/PRIVACY.md']) {
  validateMarkdownLinks(file);
}

const popupHTML = fs.readFileSync(path.join(root, 'ui/popup.html'), 'utf8');
const popupJS = fs.readFileSync(path.join(root, 'ui/popup.js'), 'utf8');
const popupIDs = [...popupJS.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]);
const missingIDs = [...new Set(popupIDs)].filter(id => !popupHTML.includes(`id="${id}"`));
assert(missingIDs.length === 0, `Popup references missing IDs: ${missingIDs.join(', ')}`);

console.log(`extension validation passed (${new Set(referencedFiles).size} manifest files, ${new Set(popupIDs).size} popup IDs)`);
