const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const repo = process.cwd();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'union-bot-codex-portable-'));
fs.cpSync(path.join(repo, 'release/union-bot-portable-win-x64'), root, { recursive: true });
const manifest = fs.readFileSync(path.join(root, 'SHA256_MANIFEST.txt'), 'utf8');
let checked = 0; const mismatches = [];
for (const line of manifest.split(/\r?\n/)) {
  const match = line.trim().match(/^([a-f0-9]{64})\s+\S+\s+(.+)$/i);
  if (!match || /SHA256.*MANIFEST/.test(match[2])) continue;
  const file = path.resolve(root, match[2]);
  if (!file.startsWith(root + path.sep)) throw new Error('Manifest path escapes QA copy');
  const hash = fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
  checked++; if (hash !== match[1]) mismatches.push(match[2]);
}
const env = {...process.env, PATH: 'C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\Wbem'};
delete env.SYSTEM_NODE_PATH; delete env.NODE_PATH;
const profile = path.join(root, 'codex-profile');
const start = Date.now();
const child = cp.spawn('cmd.exe', ['/d','/c','union-bot.bat','--smoke','--headless','--test-user-data='+profile], {cwd: root, env, stdio:['ignore','pipe','pipe']});
let stdout = '', stderr = '', timedOut = false;
child.stdout.on('data', x => {stdout += x;}); child.stderr.on('data', x => {stderr += x;});
const timer = setTimeout(() => {timedOut = true; cp.spawn('taskkill',['/F','/T','/PID',String(child.pid)],{stdio:'ignore'});},45000);
child.on('close', (code,signal) => {
 clearTimeout(timer);
 const result = {timestamp:new Date().toISOString(),root,profile,checked,mismatches,elapsedMs:Date.now()-start,code,signal,timedOut,smokeOutputPass:stdout.includes('Smoke test PASS!'),databaseExists:fs.existsSync(path.join(profile,'union_bot.db')) || fs.existsSync(path.join(root,'data/union_bot.db')),t1LiveStatus:'NOT_LIVE_VERIFIED'};
 fs.writeFileSync(path.join(repo,'reports/qa/P11_CODEX_PORTABLE_CHECK_20261021.json'),JSON.stringify(result,null,2));
 fs.writeFileSync(path.join(root,'codex-smoke.log'),stdout+'\nSTDERR\n'+stderr);
 console.log(JSON.stringify(result));
 process.exit(code===0&&!timedOut&&checked>0&&mismatches.length===0&&result.smokeOutputPass&&result.databaseExists?0:1);
});
