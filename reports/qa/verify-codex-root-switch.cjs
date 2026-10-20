// Protocol-only regression with existing MockCodexTransport: NO native model call.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { CodexService } = require('../../apps/desktop/src/codex-service.cjs');
const { MockCodexTransport } = require('../../packages/agent-codex/src/agent-codex.cjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'union-bot-codex-root-switch-'));
const first = path.join(temp, 'project-a');
const second = path.join(temp, 'project-b');
fs.mkdirSync(first); fs.mkdirSync(second);
const transport = new MockCodexTransport({ deltaChunks: ['QA'], finalText: 'Protocol fixture' });
const service = new CodexService(first, null, null, null);
service.setCustomTransport(transport);
service.on('error', () => {});
const guard = setTimeout(() => { service.close(); process.exit(2); }, 5000);
(async () => {
  try {
    await service.executeTurn('Protocol probe A', { cwd: first });
    service.setWorkspaceRoot(second);
    await service.executeTurn('Protocol probe B', { cwd: second });
    const requests = transport.sentMessages.map(raw => JSON.parse(raw));
    const starts = requests.filter(r => r.method === 'thread/start').map(r => ({ cwd: r.params.cwd }));
    const turns = requests.filter(r => r.method === 'turn/start').map(r => ({ threadId: r.params.threadId }));
    const pass = starts.some(r => r.cwd === first) && starts.some(r => r.cwd === second);
    const result = { timestamp: new Date().toISOString(), scope: 'Existing mock transport records actual service/adapter RPC routing; no live/native execution proof', tempDirectoryRetained: temp, starts, turns, expectedSecondRoot: second, pass };
    fs.writeFileSync(path.join(temp, 'evidence.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = pass ? 0 : 1;
  } finally { service.close(); clearTimeout(guard); }
})().catch(error => { console.error(error.stack); process.exitCode = 2; });
