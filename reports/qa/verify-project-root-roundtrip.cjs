// Independent local storage regression. Creates only unique temporary QA data;
// never launches models, modifies user profiles, or removes files.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { StorageServiceClient } = require('../../apps/desktop/src/storage-service.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'union-bot-root-roundtrip-'));
const observations = [];
let client;
const guard = setTimeout(() => {
  if (client) client.close();
  console.error('QA_TIMEOUT_20000MS');
  process.exit(2);
}, 20000);
(async () => {
  try {
    for (const forceWorker of [false, true]) {
      const mode = forceWorker ? 'worker' : 'native';
      const filename = path.join(root, `${mode}.db`);
      const workspace = path.join(root, `Dự án có dấu ${mode}`);
      fs.mkdirSync(workspace);
      client = new StorageServiceClient(filename, { forceWorker, nodeExecPath: process.execPath });
      const ready = await client.ready;
      if (!forceWorker && !client.isNative) throw new Error('Native SQLite unavailable; native mode cannot be claimed');
      const created = await client.createProject('qa_project', 'Dự án kiểm tra', 'QA only', workspace);
      const initial = (await client.getProjects()).find(p => p.id === 'qa_project');
      await client.closeAsync();
      client = new StorageServiceClient(filename, { forceWorker, nodeExecPath: process.execPath });
      await client.ready;
      const reopened = (await client.getProjects()).find(p => p.id === 'qa_project');
      const getRoot = p => p?.workspaceRoot || p?.workspace_root;
      observations.push({ mode, ready: ready.mode, createdRoot: getRoot(created) ?? null,
        initialRoot: getRoot(initial) ?? null, reopenedRoot: getRoot(reopened) ?? null,
        expectedRoot: workspace, pass: [created, initial, reopened].every(p => getRoot(p) === workspace) });
      await client.closeAsync();
      client = null;
    }
  } finally {
    if (client) await client.closeAsync();
    clearTimeout(guard);
  }
  const result = { timestamp: new Date().toISOString(), scope: 'Storage root create/list/reopen, native and worker; not UI/native-model UAT', tempDirectoryRetained: root, observations };
  fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = observations.length === 2 && observations.every(o => o.pass) ? 0 : 1;
})().catch(error => { console.error(error.message); process.exitCode = 2; });
