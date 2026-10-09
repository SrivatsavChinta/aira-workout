import { fileURLToPath } from 'node:url';
import { createApp, readConfig } from './app.js';
import { DevReload } from './dev-reload.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
try {
  const config = readConfig(process.env, root);
  const port = Number(process.env.PORT || 4319);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer from 1024 to 65535.');
  // Only scripts/dev.mjs sets DEV_RELOAD and the IPC channel; npm start never enables the refresh channel.
  const devReload = process.env.DEV_RELOAD === 'true' && process.send ? new DevReload() : undefined;
  if (devReload) process.on('message', message => { if (message === 'reload' || message === 'css') devReload.send(message); });
  const server = createApp(config, fetch, undefined, undefined, undefined, devReload);
  server.on('error', () => { console.error('Could not start the local server. Try another PORT.'); process.exitCode = 1; if (devReload) process.disconnect(); });
  server.listen(port, '127.0.0.1', () => console.log(`Workout canvas: http://127.0.0.1:${port} · starts in mock mode${devReload ? ' · dev reload on' : ''}`));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid local configuration.'); process.exitCode = 1;
}
