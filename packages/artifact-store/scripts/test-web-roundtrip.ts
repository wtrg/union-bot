import * as fs from 'node:fs';
import * as path from 'node:path';
import * as assert from 'node:assert';
import { ArtifactStore, type ArtifactProvenance } from '../src/artifact-store.ts';

async function main() {
  console.log('=== Union Bot Web -> CAS TypeScript Integration Test ===');
  const targetUrl = 'https://cdn.auth0.com/avatars/tr.png';
  const outDir = path.resolve('d:/WORK-TEAM/scratch/web-export');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log(`1. Fetching real web asset from: ${targetUrl}...`);
  const response = await fetch(targetUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch asset: HTTP ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const originalBuffer = Buffer.from(arrayBuffer);
  const expectedHash = ArtifactStore.hashBuffer(originalBuffer);
  console.log(`   Fetched ${originalBuffer.length} bytes, SHA256: ${expectedHash}`);

  // 2. Initialize ArtifactStore (TypeScript implementation)
  const casDir = path.resolve('d:/WORK-TEAM/scratch/cas-store');
  const store = new ArtifactStore(casDir);

  const provenance: ArtifactProvenance = {
    sourceActor: 'chatgpt_web',
    provider: 'openai',
    turnId: '6ad4b4fe-27b0-83ec-9445-1c65d6415cc2',
    captureMethod: 'user_manual',
    timestamp: new Date().toISOString()
  };

  console.log('2. Storing bytes into @union-bot/artifact-store (CAS)...');
  const metadata = store.storeBytes(
    originalBuffer,
    'image/png',
    'original_bytes',
    provenance,
    'chatgpt_session_avatar.png'
  );

  console.log(`   Stored at: ${metadata.storedPath}`);
  assert.strictEqual(metadata.sha256, expectedHash);
  assert.strictEqual(metadata.byteSize, originalBuffer.length);
  assert.strictEqual(metadata.fidelity, 'original_bytes');
  assert.strictEqual(metadata.transferState, 'local_verified');

  console.log('3. Reading back from @union-bot/artifact-store via readBytes()...');
  const retrievedBytes = store.readBytes(metadata.sha256);

  console.log('4. Performing byte-for-byte exact equality assertion...');
  assert.strictEqual(retrievedBytes.length, originalBuffer.length, 'Length mismatch!');
  assert.deepStrictEqual(retrievedBytes, originalBuffer, 'Byte buffer mismatch!');
  console.log('   MATCH VERIFIED: 100% byte-for-byte identical.');

  // 5. Write provenance record
  const provenanceRecord = {
    testRunner: 'node --experimental-strip-types (TypeScript native)',
    module: '@union-bot/artifact-store',
    targetUrl,
    sha256: metadata.sha256,
    byteSize: metadata.byteSize,
    mimeType: metadata.mimeType,
    fidelity: metadata.fidelity,
    transferState: metadata.transferState,
    storedPath: metadata.storedPath,
    provenance: metadata.provenance,
    verifiedAt: new Date().toISOString(),
    status: 'PASS'
  };

  fs.writeFileSync(
    path.join(outDir, 'roundtrip_provenance_ts.json'),
    JSON.stringify(provenanceRecord, null, 2),
    'utf-8'
  );
  console.log('   Provenance record saved to scratch/web-export/roundtrip_provenance_ts.json');
  console.log('=== TEST RESULT: PASS (100% TypeScript Verified) ===');
}

main().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
