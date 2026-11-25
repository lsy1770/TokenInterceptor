'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

if (manifest.version !== pkg.version) {
  throw new Error(`Version mismatch: manifest.json (${manifest.version}) !== package.json (${pkg.version})`);
}

const version = manifest.version;
const distDir = path.join(root, 'dist');
const includeEntries = [
  'manifest.json',
  'LICENSE',
  'assets',
  'src',
  'ui',
];

// Standard IEEE 802.3 CRC32 lookup table for ZIP entries.
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c >>> 0;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    c = crcTable[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getUTCFullYear());
  const dosTime = ((date.getUTCHours() & 0x1f) << 11)
    | ((date.getUTCMinutes() & 0x3f) << 5)
    | ((date.getUTCSeconds() >> 1) & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9)
    | (((date.getUTCMonth() + 1) & 0x0f) << 5)
    | (date.getUTCDate() & 0x1f);
  return { dosTime, dosDate };
}

function collectFiles(entry) {
  const fullPath = path.join(root, entry);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing required package entry: ${entry}`);
  }
  const stat = fs.statSync(fullPath);
  if (stat.isFile()) {
    return [entry.replace(/\\/g, '/')];
  }
  const files = [];
  for (const child of fs.readdirSync(fullPath).sort()) {
    if (child.startsWith('.') || child.endsWith('.local.json')) continue;
    files.push(...collectFiles(path.join(entry, child)));
  }
  return files;
}

function buildZip(relativeFiles) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  // Deterministic UTC timestamp for reproducible builds
  const { dosTime, dosDate } = dosDateTime(new Date());

  for (const relPath of relativeFiles) {
    const data = fs.readFileSync(path.join(root, relPath));
    const nameBuf = Buffer.from(relPath, 'utf8');
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = compressed.length < data.length;
    const payload = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);
    const flags = 0x0800; // UTF-8 filename

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4); // Unix + version 2.0
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(relativeFiles.length, 8);
  eocd.writeUInt16LE(relativeFiles.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

const files = includeEntries.flatMap(collectFiles).sort();
if (!files.includes('manifest.json')) {
  throw new Error('Packaged ZIP must contain manifest.json at root');
}

fs.mkdirSync(distDir, { recursive: true });
const zipBuffer = buildZip(files);
const versionedZip = path.join(distDir, `token-interceptor-v${version}.zip`);
const latestZip = path.join(distDir, 'token-interceptor.zip');

fs.writeFileSync(versionedZip, zipBuffer);
fs.writeFileSync(latestZip, zipBuffer);

console.log(`packaged ${files.length} files (${zipBuffer.length} bytes):`);
console.log(`  - ${path.relative(root, versionedZip)}`);
console.log(`  - ${path.relative(root, latestZip)}`);
