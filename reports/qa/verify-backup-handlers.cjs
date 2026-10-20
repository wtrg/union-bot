// Executes the actual production callback expressions, extracted by TypeScript AST.
// Real SQLite/CAS, isolated temporary data, no Electron process/model/network.
// Sender authorization is stubbed true: this is NOT an origin/IPC/UI test.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
const ts = require('typescript');
const { StorageServiceClient } = require('../../apps/desktop/src/storage-service.cjs');
const { ArtifactStore } = require('../../packages/artifact-store/src/artifact-store.cjs');
const sourcePath = path.resolve(__dirname, '../../apps/desktop/src/main.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const ast = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const callbacks = {};
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'ipcMain.handle'
    && ts.isStringLiteral(node.arguments[0]) && node.arguments.length === 2) {
    callbacks[node.arguments[0].text] = node.arguments[1].getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'union-bot-real-backup-'));
const clients = [];
const results = [];
const guard = setTimeout(() => { clients.forEach(c => c.close()); process.exit(2); }, 20000);
async function storageAt(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const storage = new StorageServiceClient(path.join(dir, 'qa.db'));
  clients.push(storage); await storage.ready;
  await storage.ensureRoom('qa_source', 'QA source');
  await storage.ensureRoom('qa_target', 'QA target');
  return storage;
}
function handler(name, storage, artifactStore, profile) {
  if (!callbacks[name]) throw new Error('Missing production callback: ' + name);
  return vm.runInNewContext('(' + callbacks[name] + ')', {
    fs, path, crypto, console, storage, artifactStore,
    checkSenderAuthorized: () => true,
    app: { getPath: () => profile },
    orchestrator: null, mainWindow: null,
  }, { timeout: 1000 });
}
function filesWithin(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const full = path.join(dir, item.name);
    if (item.isSymbolicLink()) throw new Error('QA fixture unexpectedly contains a symlink');
    return item.isDirectory() ? filesWithin(full) : [full];
  });
}
(async () => {
  try {
    for (const duplicates of [false, true]) {
      const name = duplicates ? 'same-name-different-sha' : 'long-message-single-file';
      const scenario = path.join(temp, name);
      const originDir = path.join(scenario, 'origin');
      const targetDir = path.join(scenario, 'target');
      const origin = await storageAt(originDir);
      const target = await storageAt(targetDir);
      const originCas = new ArtifactStore(path.join(originDir, 'cas'));
      const targetCas = new ArtifactStore(path.join(targetDir, 'cas'));
      const expectedDigests = [];
      const longText = 'Nội dung QA dài. '.repeat(100) + 'QA_END_MARKER_021';
      for (let i = 0; i < (duplicates ? 2 : 1); i++) {
        const stored = originCas.storeBytes(Buffer.from('Fixture distinct bytes ' + i), 'same.txt', { mimeType: 'text/plain' });
        expectedDigests.push(stored.sha256);
        await origin.insertEnvelope({ id: 'qa_env_' + i, traceId: 'qa_trace_' + i,
          timestamp: Date.now() + i, roomId: 'qa_source',
          sender: { kind: 'user', id: 'qa_user', name: 'QA User', role: 'USER' },
          recipient: { kind: 'room', id: 'qa_source' }, fidelity: 'L2_STANDALONE_ARTIFACT',
          parts: [{ kind: 'text', text: longText }, { kind: 'artifact', filename: 'same.txt', sha256: stored.sha256, sizeBytes: 24, mimeType: 'text/plain' }] });
      }
      const exported = await handler('union-bot:export-transcript-bundle', origin, originCas, originDir)({}, { roomId: 'qa_source' });
      const imported = exported.success
        ? await handler('union-bot:import-transcript-bundle', target, targetCas, targetDir)({}, { bundleDir: exported.bundleDir, targetRoomId: 'qa_target' })
        : { success: false, error: 'Export failed' };
      const restored = await target.getRoomEnvelopes('qa_target', 100);
      const restoredParts = restored.flatMap(env => env.parts || []);
      const artifactParts = restoredParts.filter(p => p.kind === 'artifact' || p.kind === 'attachment');
      const checks = {
        exportSuccess: exported.success === true, importSuccess: imported.success === true,
        tailMarkerRestored: restoredParts.some(p => typeof p.text === 'string' && p.text.includes('QA_END_MARKER_021')),
        structuredArtifactsRestored: expectedDigests.every(sha => artifactParts.some(p => p.sha256 === sha)),
        bytesInFreshDestinationCas: expectedDigests.every(sha => {
          try { const info = targetCas.inspectArtifact(sha); return Boolean(info && info.storedPath && fs.existsSync(info.storedPath)); } catch { return false; }
        }),
      };
      let malformedHistory;
      const invalidArtifactCases = [];
      if (!duplicates && exported.success) {
        const corruptDir = path.join(scenario, 'malformed-history-bundle');
        fs.cpSync(exported.bundleDir, corruptDir, { recursive: true });
        const validHistory = await origin.getRoomEnvelopes('qa_source', 100);
        fs.writeFileSync(path.join(corruptDir, 'envelopes.json'), JSON.stringify([...validHistory, { id: 'qa_invalid_envelope' }]));
        const badTargetDir = path.join(scenario, 'reject-destination');
        const badTarget = await storageAt(badTargetDir);
        const badCas = new ArtifactStore(path.join(badTargetDir, 'cas'));
        const response = await handler('union-bot:import-transcript-bundle', badTarget, badCas, badTargetDir)({}, { bundleDir: corruptDir, targetRoomId: 'qa_target' });
        const persisted = await badTarget.getRoomEnvelopes('qa_target', 100);
        const casChanged = expectedDigests.some(sha => { try { return Boolean(badCas.inspectArtifact(sha)); } catch { return false; } });
        checks.malformedHistoryAtomicReject = response.success === false && persisted.length === 0 && !casChanged;
        malformedHistory = { response, persistedMessageCount: persisted.length, destinationCasChanged: casChanged };
      }
      if (duplicates && exported.success) {
        const lastDigest = expectedDigests.at(-1);
        for (const variant of ['missing-last-file', 'wrong-last-hash', 'wrong-last-size']) {
          const badBundle = path.join(scenario, variant);
          fs.mkdirSync(badBundle);
          for (const sourceFile of filesWithin(exported.bundleDir)) {
            const bytes = fs.readFileSync(sourceFile);
            const matchesLast = crypto.createHash('sha256').update(bytes).digest('hex') === lastDigest;
            if (variant === 'missing-last-file' && matchesLast) continue;
            const destinationFile = path.join(badBundle, path.relative(exported.bundleDir, sourceFile));
            fs.mkdirSync(path.dirname(destinationFile), { recursive: true });
            fs.writeFileSync(destinationFile, variant === 'wrong-last-hash' && matchesLast ? Buffer.alloc(bytes.length, 88) : bytes);
          }
          if (variant === 'wrong-last-size') {
            const manifestFile = path.join(badBundle, 'manifest.json');
            const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
            const entries = Array.isArray(manifest) ? manifest : manifest.artifacts;
            const entry = entries.find(e => e.sha256 === lastDigest);
            entry.byteSize = Number(entry.byteSize ?? entry.sizeBytes) + 1;
            fs.writeFileSync(manifestFile, JSON.stringify(manifest));
          }
          const rejectDir = path.join(scenario, variant + '-target');
          const rejectStorage = await storageAt(rejectDir);
          const rejectCas = new ArtifactStore(path.join(rejectDir, 'cas'));
          const response = await handler('union-bot:import-transcript-bundle', rejectStorage, rejectCas, rejectDir)({}, { bundleDir: badBundle, targetRoomId: 'qa_target' });
          const persisted = await rejectStorage.getRoomEnvelopes('qa_target', 100);
          const casChanged = expectedDigests.some(sha => { try { return Boolean(rejectCas.inspectArtifact(sha)); } catch { return false; } });
          invalidArtifactCases.push({ variant, success: response.success, error: response.error, code: response.code,
            persistedMessageCount: persisted.length, destinationCasChanged: casChanged,
            pass: response.success === false && persisted.length === 0 && !casChanged });
        }
        checks.invalidArtifactsAtomicReject = invalidArtifactCases.every(c => c.pass);
      }
      results.push({ name, exported, imported, restoredMessageCount: restored.length, malformedHistory, invalidArtifactCases, checks, pass: Object.values(checks).every(Boolean) });
    }
  } finally { for (const client of clients) await client.closeAsync(); clearTimeout(guard); }
  const report = { timestamp: new Date().toISOString(), sourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
    scope: 'Actual production handler logic + real SQLite/CAS; authorization stubbed; no Electron IPC/UI/native-model claim', tempDirectoryRetained: temp, results };
  fs.writeFileSync(path.join(temp, 'evidence.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ timestamp: report.timestamp, sourceSha256: report.sourceSha256, scope: report.scope,
    evidencePath: path.join(temp, 'evidence.json'), results: results.map(r => ({ name: r.name, importError: r.imported.error,
      malformedHistory: r.malformedHistory, invalidArtifactCases: r.invalidArtifactCases, checks: r.checks, pass: r.pass })) }, null, 2));
  process.exitCode = results.every(r => r.pass) ? 0 : 1;
})().catch(error => { console.error('HARNESS_ERROR: ' + error.stack); process.exitCode = 2; });
