// Independent SQLite ownership probe; no native-model or UI execution.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { StorageServiceClient } = require('../../apps/desktop/src/storage-service.cjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'union-bot-task-scope-'));
let client;
const results = [];
const guard = setTimeout(() => { client?.close(); process.exit(2); }, 20000);
(async () => {
  try {
    for (const forceWorker of [false, true]) {
      const mode = forceWorker ? 'worker' : 'native';
      client = new StorageServiceClient(path.join(temp, mode + '.db'), { forceWorker, nodeExecPath: process.execPath });
      await client.ready;
      if (!forceWorker && !client.isNative) throw new Error('Native mode unavailable');
      for (const id of ['a', 'b']) {
        await client.createProject('project_' + id, 'Project ' + id, 'QA only', path.join(temp, 'workspace_' + id));
        await client.createRoom('room_' + id, 'Room ' + id, 'project_' + id);
        await client.createTask({ id: 'task_' + id, title: 'QA pending task ' + id, roomId: 'room_' + id, metadata: { projectId: 'project_' + id } });
      }
      const task = await client.getTask('task_a');
      const byRoom = await client.listTasks({ roomId: 'room_a', limit: 100 });
      const byProject = await client.listTasks({ projectId: 'project_a', limit: 100 });
      // Persisted room ownership wins over contradictory renderer metadata.
      await client.createTask({ id: 'task_conflict', title: 'QA conflicting metadata', roomId: 'room_b', metadata: { projectId: 'project_a' } });
      const afterConflictA = await client.listTasks({ projectId: 'project_a', limit: 100 });
      const afterConflictB = await client.listTasks({ projectId: 'project_b', limit: 100 });
      results.push({ mode, returnedRoomId: task.roomId ?? null, returnedRoomUnderscoreId: task.room_id ?? null,
        byRoom: byRoom.map(t => t.id), byProject: byProject.map(t => t.id),
        roomFilterPass: byRoom.length === 1 && byRoom[0].id === 'task_a',
        projectFilterPass: byProject.length === 1 && byProject[0].id === 'task_a',
        conflictingMetadataProjectA: afterConflictA.map(t => t.id),
        conflictingMetadataProjectB: afterConflictB.map(t => t.id),
        canonicalOwnershipPass: !afterConflictA.some(t => t.id === 'task_conflict') && afterConflictB.some(t => t.id === 'task_conflict') });
      await client.closeAsync(); client = null;
    }
  } finally { if (client) await client.closeAsync(); clearTimeout(guard); }
  const report = { timestamp: new Date().toISOString(), scope: 'Real storage task ownership/filter API; not dispatch or UI', tempDirectoryRetained: temp, results };
  fs.writeFileSync(path.join(temp, 'evidence.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = results.every(r => r.roomFilterPass && r.projectFilterPass && r.canonicalOwnershipPass) ? 0 : 1;
})().catch(error => { console.error(error.message); process.exitCode = 2; });
