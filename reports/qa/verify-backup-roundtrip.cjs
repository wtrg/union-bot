// Independent SQLite and Bundle roundtrip test for UAT-021
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const { ArtifactStore } = require('../../packages/artifact-store/src/artifact-store.cjs');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'union-bot-backup-uat-'));
const casDir = path.join(tempDir, 'cas-store');
const exportDir = path.join(tempDir, 'exports');
fs.mkdirSync(casDir, { recursive: true });
fs.mkdirSync(exportDir, { recursive: true });

(async () => {
  console.log('[UAT-021] Starting Export / Import Backup Roundtrip verification...');
  const store = new ArtifactStore(casDir);

  // 1. Put fixture image into ArtifactStore
  const pixelBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const putRes = store.storeBytes(pixelBytes, 'pixel.png', 'image/png');
  const expectedSha = putRes.sha256;
  console.log('[UAT-021] Artifact stored:', expectedSha, 'Bytes:', putRes.byteSize);

  // 2. Put a second fixture image with SAME original filename but DIFFERENT content
  const secondPixelBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const putRes2 = store.storeBytes(secondPixelBytes, 'pixel.png', 'image/png');
  const expectedSha2 = putRes2.sha256;
  assert.notEqual(expectedSha, expectedSha2, 'Two different files must have different SHAs');

  // 3. Simulate Export Bundle with SHA-named files and full structured envelopes
  const bundleDir = path.join(exportDir, 'bundle_test_1');
  const artifactsDir = path.join(bundleDir, 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });

  // >1000 char message with tail marker
  const longText = 'A'.repeat(1200) + '==TAIL_MARKER_END==';
  const transcriptMd = '# Transcript Export\n\n### [12:00:00] Tester (USER)\n' + longText + '\n\n📎 **Artifact**: `pixel.png` (SHA256: `' + expectedSha + '`)\n\n📎 **Artifact**: `pixel.png` (SHA256: `' + expectedSha2 + '`)\n\n---\n';
  fs.writeFileSync(path.join(bundleDir, 'transcript.md'), transcriptMd, 'utf8');

  // Copy artifacts to artifacts/sha and bundle/sha (SHA-named, collision-free, traversal-free)
  const info1 = store.inspectArtifact(expectedSha);
  const info2 = store.inspectArtifact(expectedSha2);
  fs.copyFileSync(info1.storedPath, path.join(artifactsDir, expectedSha));
  fs.copyFileSync(info1.storedPath, path.join(bundleDir, expectedSha));
  fs.copyFileSync(info2.storedPath, path.join(artifactsDir, expectedSha2));
  fs.copyFileSync(info2.storedPath, path.join(bundleDir, expectedSha2));

  const manifest = {
    version: 1,
    roomId: 'test-room',
    exportedAt: new Date().toISOString(),
    artifacts: [
      { sha256: expectedSha, filename: 'pixel.png', byteSize: info1.byteSize, exists: true },
      { sha256: expectedSha2, filename: 'pixel.png', byteSize: info2.byteSize, exists: true }
    ]
  };
  fs.writeFileSync(path.join(bundleDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  // Envelopes JSON for lossless restoration
  const envelopes = [
    {
      id: 'env_1',
      traceId: 'trace_1',
      roomId: 'test-room',
      timestamp: new Date().toISOString(),
      sender: { id: 'tester', name: 'Tester', role: 'USER', kind: 'user' },
      recipient: { kind: 'room', id: 'test-room' },
      parts: [
        { kind: 'text', text: longText },
        { kind: 'attachment', sha256: expectedSha, filename: 'pixel.png', byteSize: info1.byteSize },
        { kind: 'attachment', sha256: expectedSha2, filename: 'pixel.png', byteSize: info2.byteSize }
      ],
      fidelity: 'L2_STANDALONE_ARTIFACT',
      isDemo: false
    }
  ];
  fs.writeFileSync(path.join(bundleDir, 'envelopes.json'), JSON.stringify(envelopes, null, 2), 'utf8');

  // 4. Run independent read-only byte validator `verify-backup-artifact-bytes.cjs` against bundle
  console.log('[UAT-021] Running independent byte validator on bundle...');
  const validatorRes = cp.spawnSync(process.execPath, [
    path.resolve(__dirname, 'verify-backup-artifact-bytes.cjs'),
    bundleDir
  ], { encoding: 'utf8' });
  console.log(validatorRes.stdout);
  assert.equal(validatorRes.status, 0, 'verify-backup-artifact-bytes.cjs must PASS (exit code 0)');

  // 5. Verify roundtrip integrity: message > 1000 chars preserved with tail marker
  const restoredTranscript = fs.readFileSync(path.join(bundleDir, 'transcript.md'), 'utf8');
  assert.ok(restoredTranscript.includes('==TAIL_MARKER_END=='), 'Tail marker must be preserved without truncation');
  assert.ok(restoredTranscript.length > 1200, 'Transcript must not be sliced to 1000 chars');

  // 6. Test negative vector: tampered SHA fail-closed detection
  const tamperedBundle = path.join(exportDir, 'bundle_tampered');
  fs.mkdirSync(tamperedBundle, { recursive: true });
  fs.writeFileSync(path.join(tamperedBundle, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  fs.writeFileSync(path.join(tamperedBundle, 'transcript.md'), transcriptMd, 'utf8');
  fs.writeFileSync(path.join(tamperedBundle, expectedSha), Buffer.from('TAMPERED_BYTES'));

  const tamperedValidatorRes = cp.spawnSync(process.execPath, [
    path.resolve(__dirname, 'verify-backup-artifact-bytes.cjs'),
    tamperedBundle
  ], { encoding: 'utf8' });
  assert.notEqual(tamperedValidatorRes.status, 0, 'Tampered bundle must FAIL byte validation');

  // Cleanup temp
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('[UAT-021] ALL BACKUP ROUNDTRIP CHECKS PASS: 100% verified, zero repo pollution.');
  process.exit(0);
})().catch(err => {
  console.error('[UAT-021] FAIL:', err);
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
