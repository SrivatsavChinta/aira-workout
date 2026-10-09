// Development runner for `npm run dev`: one TypeScript watcher, one server process, browser refresh.
// Server and shared source changes restart the server; browser code and index.html reload the page;
// styles.css is swapped in place; .env changes restart the server. `npm start` does not use this file.
import { spawn } from 'node:child_process';
import { readdirSync, statSync, watch } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const tscBin = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const log = message => console.log(`[dev] ${message}`);
let server, compiledOnce = false, stopping = false, queue = Promise.resolve();
const outputs = new Map();

function startServer() {
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'dist/server/main.js'], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'], env: { ...process.env, DEV_RELOAD: 'true' } });
  server = child;
  child.on('exit', (code, signal) => {
    if (server !== child) return;
    server = undefined;
    if (!stopping) log(`Server stopped (${signal ?? `exit ${code}`}). It starts again after the next change.`);
  });
}
function stopServer() {
  const child = server;
  server = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
}
/** Restarts are queued so an old server always exits before a new one binds the port. */
function restartServer(reason) {
  queue = queue.then(async () => {
    if (stopping) return;
    log(`${reason}: restarting the server. Open pages reload when it is back.`);
    await stopServer();
    if (!stopping) startServer();
  });
}
function notify(event) { if (server?.connected) server.send(event); }

const assetTimers = new Map();
function copyAsset(file, event) {
  clearTimeout(assetTimers.get(file));
  assetTimers.set(file, setTimeout(async () => {
    try { await copyFile(`src/web/${file}`, `dist/web/${file}`); } catch { return; }
    log(`${file} changed: ${event === 'css' ? 'updating the stylesheet' : 'reloading the page'}.`);
    notify(event);
  }, 50));
}

/** Which compiled outputs tsc rewrote since the last check: 'server' for dist/server or dist/shared, 'web' for dist/web. */
function changedOutputs() {
  const changed = new Set();
  for (const dir of ['server', 'shared', 'web']) {
    let files = [];
    try { files = readdirSync(`dist/${dir}`, { recursive: true }).map(String).filter(file => file.endsWith('.js')); } catch { continue; }
    for (const file of files) {
      const path = `dist/${dir}/${file}`;
      let mtime = 0;
      try { mtime = statSync(path).mtimeMs; } catch { continue; }
      if (outputs.get(path) !== mtime) { outputs.set(path, mtime); changed.add(dir === 'web' ? 'web' : 'server'); }
    }
  }
  return changed;
}

function compiled() {
  const changed = changedOutputs();
  if (!compiledOnce) { compiledOnce = true; startServer(); return; }
  if (changed.has('server')) restartServer('Server code changed');
  else if (changed.has('web')) { log('Browser code changed: reloading the page.'); notify('reload'); }
}

await mkdir('dist/web', { recursive: true });
await Promise.all(['index.html', 'styles.css'].map(file => copyFile(`src/web/${file}`, `dist/web/${file}`)));

// TypeScript changes are handled after tsc finishes each compile (see compiled()); only the copied assets are watched here.
watch('src/web', (_type, filename) => {
  if (filename === 'styles.css') copyAsset('styles.css', 'css');
  else if (filename === 'index.html') copyAsset('index.html', 'reload');
});
watch('.', (_type, filename) => { if (filename === '.env' && compiledOnce) restartServer('.env changed'); });

changedOutputs();
const tsc = spawn(process.execPath, [tscBin, '--watch', '--preserveWatchOutput'], { stdio: ['ignore', 'pipe', 'inherit'] });
let buffered = '';
tsc.stdout.on('data', chunk => {
  process.stdout.write(chunk);
  buffered += chunk;
  const lines = buffered.split('\n'); buffered = lines.pop() ?? '';
  for (const line of lines) if (/Watching for file changes/.test(line)) compiled();
});
tsc.on('exit', () => { if (!stopping) { log('TypeScript watcher stopped.'); void shutdown(1); } });

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  tsc.kill();
  await queue;
  await stopServer();
  process.exit(code);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
log('Watching src/ and .env. Press Ctrl+C to stop.');
