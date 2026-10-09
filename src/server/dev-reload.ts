import type { ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';

export type DevReloadEvent = 'reload' | 'css';

/** Development-only browser refresh channel (Server-Sent Events). Created only when `npm run dev` sets DEV_RELOAD=true. */
export class DevReload {
  readonly instance = randomBytes(8).toString('hex');
  private clients = new Set<ServerResponse>();
  connect(res: ServerResponse, headers: Record<string, string>) {
    res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
    // The page reloads when this stream drops (server restart) and the server answers again.
    res.write(`retry: 300\nevent: hello\ndata: ${this.instance}\n\n`);
    this.clients.add(res);
    res.once('close', () => this.clients.delete(res));
  }
  send(event: DevReloadEvent) { for (const res of this.clients) res.write(`event: ${event}\ndata: ${Date.now()}\n\n`); }
  get connected() { return this.clients.size; }
}
