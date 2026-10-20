// Real legacy SQLite upgrade/cross-mode check; no provider/model calls.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { runSchemaMigrations } = require('../../apps/desktop/src/schema-definition.cjs');
const { StorageServiceClient } = require('../../apps/desktop/src/storage-service.cjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'union-bot-root-legacy-'));
let client;
const results = [];
const guard = setTimeout(() => { client?.close(); process.exit(2); }, 20000);
(async () => {
  try {
    for (const forceWorker of [false, true]) {
      const mode = forceWorker ? 'worker' : 'native';
      const filename = path.join(temp, mode + '.db');
      const db = new DatabaseSync(filename);
      runSchemaMigrations(db);
      const columns = db.prepare('PRAGMA table_info(projects)').all();
      if (columns.some(c => c.name === 'workspace_root')) throw new Error('Fixture is not legacy: workspace_root already exists');
      const now = new Date().toISOString();
      db.prepare('INSERT INTO projects(id,name,description,created_at,updated_at,archived) VALUES(?,?,?,?,?,?)').run('old_project', 'Dự án cũ', 'Keep this record', now, now, 0);
      db.prepare('INSERT INTO rooms(id,name,project_id,created_at,updated_at) VALUES(?,?,?,?,?)').run('old_room', 'Phòng cũ', 'old_project', now, now);
      db.close();
      client = new StorageServiceClient(filename, { forceWorker, nodeExecPath: process.execPath });
      await client.ready;
      const workspace = path.join(temp, 'Dự án mới ' + mode);
      await client.createProject('new_project', 'New project', 'QA only', workspace);
      await client.closeAsync();
      client = new StorageServiceClient(filename, { forceWorker: !forceWorker, nodeExecPath: process.execPath });
      await client.ready;
      const projects = await client.getProjects();
      const rooms = await client.getRooms('old_project');
      const oldProject = projects.find(p => p.id === 'old_project');
      const newProject = projects.find(p => p.id === 'new_project');
      const pass = oldProject?.name === 'Dự án cũ' && oldProject?.description === 'Keep this record'
        && rooms.some(r => r.id === 'old_room') && (newProject?.workspaceRoot || newProject?.workspace_root) === workspace;
      results.push({ upgradeMode: mode, reopenMode: forceWorker ? 'native' : 'worker', oldName: oldProject?.name, oldRoomPreserved: rooms.some(r => r.id === 'old_room'), newRootPreserved: (newProject?.workspaceRoot || newProject?.workspace_root) === workspace, pass });
      await client.closeAsync(); client = null;
    }
  } finally { if (client) await client.closeAsync(); clearTimeout(guard); }
  const report = { timestamp: new Date().toISOString(), scope: 'Legacy project table upgrade and cross-mode reopen; not full backup or all migration paths', tempDirectoryRetained: temp, results };
  fs.writeFileSync(path.join(temp, 'evidence.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = results.every(r => r.pass) ? 0 : 1;
})().catch(error => { console.error(error.message); process.exitCode = 2; });
