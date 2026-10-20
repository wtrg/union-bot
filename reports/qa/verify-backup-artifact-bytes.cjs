// Independent read-only check that a directory bundle contains the bytes it lists.
// Accepts array and object manifests; does not depend on one filename layout.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const bundle = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.statSync(bundle).isDirectory()) throw new Error('Supply the exported QA bundle directory');
const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'manifest.json'), 'utf8'));
const entries = Array.isArray(manifest) ? manifest : manifest.artifacts;
if (!Array.isArray(entries) || entries.length > 1000) throw new Error('Invalid/oversized artifact list');
const files = [];
let byteBudget = 64 * 1024 * 1024;
function scan(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (files.length > 1000) throw new Error('QA file-count limit exceeded');
    const full = path.join(dir, item.name);
    if (item.isSymbolicLink()) throw new Error('QA verifier does not follow bundle symlinks');
    if (item.isDirectory()) scan(full);
    else if (item.isFile()) {
      const size = fs.statSync(full).size;
      byteBudget -= size;
      if (byteBudget < 0) throw new Error('QA byte-budget limit exceeded');
      files.push({ relativePath: path.relative(bundle, full), bytes: size, sha256: crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex') });
    }
  }
}
scan(bundle);
const results = entries.map(entry => {
  const digest = String(entry.sha256 || '').toLowerCase();
  const expectedBytes = entry.byteSize ?? entry.sizeBytes;
  const match = files.find(file => file.sha256 === digest && (expectedBytes === undefined || file.bytes === expectedBytes));
  return { sha256: digest, expectedBytes, containedFile: match?.relativePath ?? null, pass: /^[a-f0-9]{64}$/.test(digest) && Boolean(match) };
});
console.log(JSON.stringify({ timestamp: new Date().toISOString(), bundle, scope: 'Export artifact byte/hash containment only; does not prove import persistence', results, pass: results.every(r => r.pass) }, null, 2));
process.exitCode = results.every(r => r.pass) ? 0 : 1;
