import { test, describe } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArtifactStore } from '../src/artifact-store.ts';

import * as os from 'node:os';

describe('ArtifactStore Content-Addressable Storage & Fidelity Verification', () => {
  let testStoreDir: string;
  let store: ArtifactStore;

  test('Setup dynamic temporary CAS store directory', () => {
    testStoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'union-bot-cas-test-'));
    store = new ArtifactStore(testStoreDir);
    assert.ok(fs.existsSync(testStoreDir));
  });

  test('Stores and retrieves arbitrary binary data with verified SHA256 hash', () => {
    // 1. Prepare sample binary file content (e.g. mock PDF / document)
    const originalContent = Buffer.from('%PDF-1.4 Mock PDF Content For Union Bot Handoff Verification\nTest Bytes 123456');
    const expectedSha256 = ArtifactStore.hashBuffer(originalContent);

    // 2. Store with provenance and fidelity
    const metadata = store.storeBytes(
      originalContent,
      'application/pdf',
      'original_bytes',
      {
        sourceActor: 'antigravity',
        provider: 'local',
        captureMethod: 'filesystem',
        timestamp: new Date().toISOString()
      },
      'specification_v1.pdf'
    );

    assert.strictEqual(metadata.sha256, expectedSha256);
    assert.strictEqual(metadata.byteSize, originalContent.length);
    assert.strictEqual(metadata.fidelity, 'original_bytes');
    assert.strictEqual(metadata.transferState, 'local_verified');
    assert.ok(store.hasArtifact(expectedSha256));

    // 3. Roundtrip read and byte-for-byte comparison
    const retrievedBytes = store.readBytes(expectedSha256);
    assert.strictEqual(retrievedBytes.length, originalContent.length);
    assert.deepStrictEqual(retrievedBytes, originalContent);
  });

  test('Preserves image binary data (PNG) without loss or corruption', () => {
    // 1. Prepare 1x1 transparent PNG header + idat bytes
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
      0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
      0x42, 0x60, 0x82
    ]);

    const expectedHash = ArtifactStore.hashBuffer(pngHeader);
    const meta = store.storeBytes(
      pngHeader,
      'image/png',
      'original_bytes',
      {
        sourceActor: 'chatgpt_web',
        provider: 'openai',
        captureMethod: 'user_manual',
        timestamp: new Date().toISOString()
      },
      'diagram_export.png'
    );

    assert.strictEqual(meta.sha256, expectedHash);
    const readPng = store.readBytes(expectedHash);
    assert.deepStrictEqual(readPng, pngHeader);
  });

  test('Fails retrieval with clear error if SHA256 does not exist', () => {
    const bogusHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    assert.throws(() => {
      store.readBytes(bogusHash);
    }, /not found in store/);
  });

  test('Rejects path traversal attempts in readBytes', () => {
    const maliciousPaths = [
      '../../etc/passwd',
      '..\\..\\windows\\win.ini',
      '../test',
      'a/../../../secret.txt',
      '0123456789abcdef/../../etc/passwd'
    ];

    for (const badHash of maliciousPaths) {
      assert.throws(() => {
        store.readBytes(badHash);
      }, /Invalid SHA256 digest format/);
    }
  });

  test('Rejects invalid non-hex characters in readBytes', () => {
    const invalidHashes = [
      '',
      'not-a-hash',
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeg', // 'g' is not hex
      '0123456789abcdef' // too short
    ];

    for (const badHash of invalidHashes) {
      assert.throws(() => {
        store.readBytes(badHash);
      }, /Invalid SHA256 digest format/);
    }
  });

  test('hasArtifact gracefully returns false for invalid hash or path traversal', () => {
    assert.strictEqual(store.hasArtifact('../../etc/passwd'), false);
    assert.strictEqual(store.hasArtifact('not-a-hash'), false);
    assert.strictEqual(store.hasArtifact(''), false);
  });

  test('Cleans up temporary directory after tests complete', () => {
    if (testStoreDir && fs.existsSync(testStoreDir)) {
      fs.rmSync(testStoreDir, { recursive: true, force: true });
    }
    assert.strictEqual(fs.existsSync(testStoreDir), false);
  });
});
