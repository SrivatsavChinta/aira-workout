import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { OllamaConfig } from './ollama.js';

export type RuntimeState = 'idle' | 'starting' | 'checking-model' | 'ready' | 'missing-model' | 'unavailable';
export type RuntimeStatus = { state: RuntimeState; message: string };
type Child = { on(event: 'error' | 'exit', listener: () => void): unknown; unref(): void };
export type RuntimeDeps = {
  fetch: typeof fetch; platform: string; env: NodeJS.ProcessEnv; exists: (path: string) => boolean;
  spawn: (binary: string, args: string[], options: { env: NodeJS.ProcessEnv; stdio: 'ignore'; shell: false; detached: false }) => Child;
  pollMs: number;
};
export const OLLAMA_BINARIES = ['/opt/homebrew/bin/ollama', '/usr/local/bin/ollama', '/Applications/Ollama.app/Contents/Resources/ollama'];
const defaults = (transport: typeof fetch): RuntimeDeps => ({ fetch: transport, platform: process.platform, env: process.env, exists: existsSync, spawn: (binary, args, options) => spawn(binary, args, options), pollMs: 250 });

/** Starts or reuses the local Ollama service only when asked; never downloads models and has no other runtime fallback. */
export class OllamaRuntime {
  status: RuntimeStatus = { state: 'idle', message: 'Select Ollama to check the local service.' };
  private pending: Promise<RuntimeStatus> | undefined;
  private child: Child | undefined;
  private readonly deps: RuntimeDeps;
  constructor(private config: OllamaConfig, deps: Partial<RuntimeDeps> & { fetch?: typeof fetch } = {}) { this.deps = { ...defaults(deps.fetch ?? fetch), ...deps }; }
  get ready() { return this.status.state === 'ready'; }

  start(): RuntimeStatus {
    if (!this.pending) {
      this.status = { state: 'starting', message: 'Starting Ollama…' };
      this.pending = this.initialize().catch((): RuntimeStatus => ({ state: 'unavailable', message: 'Ollama could not be initialized. Start it manually and select Ollama again.' }))
        .then(status => (this.status = status)).finally(() => { this.pending = undefined; });
    }
    return this.status;
  }
  /** Resolves once the current start attempt reaches a terminal state. */
  async settled(): Promise<RuntimeStatus> { return this.pending ?? this.status; }

  private async get(path: string, timeoutMs: number): Promise<Response | null> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await this.deps.fetch(`${this.config.url}${path}`, { signal: controller.signal }); } catch { return null; } finally { clearTimeout(timer); }
  }
  private async responding() { return (await this.get('/api/version', 1500))?.ok === true; }
  private binary(): string | undefined { return this.config.binary ? (this.deps.exists(this.config.binary) ? this.config.binary : undefined) : OLLAMA_BINARIES.find(path => this.deps.exists(path)); }
  private serviceEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(this.deps.env)) if (['PATH', 'HOME', 'TMPDIR', 'USER', 'LANG'].includes(key) || (key.startsWith('OLLAMA_') && !['OLLAMA_URL', 'OLLAMA_MODEL', 'OLLAMA_CLI_PATH'].includes(key))) env[key] = value;
    env.OLLAMA_HOST = new URL(this.config.url).host;
    return env;
  }

  private async initialize(): Promise<RuntimeStatus> {
    if (!(await this.responding())) {
      if (!this.child) {
        if (this.deps.platform !== 'darwin') return { state: 'unavailable', message: `Ollama is not responding at ${this.config.url}. Automatic start is only supported on macOS; start Ollama manually and select Ollama again.` };
        const binary = this.binary();
        if (!binary) return { state: 'unavailable', message: 'The Ollama executable was not found. Install Ollama from ollama.com, or set OLLAMA_CLI_PATH in .env to its absolute path, then restart the app.' };
        let child: Child;
        try { child = this.deps.spawn(binary, ['serve'], { env: this.serviceEnv(), stdio: 'ignore', shell: false, detached: false }); }
        catch { return { state: 'unavailable', message: 'Ollama could not be started. Start it manually (open the Ollama app or run `ollama serve`) and select Ollama again.' }; }
        this.child = child;
        const clear = () => { if (this.child === child) this.child = undefined; };
        child.on('error', clear); child.on('exit', clear); child.unref();
      }
      const deadline = Date.now() + this.config.startTimeoutMs;
      let up = false;
      while (!up && this.child && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, this.deps.pollMs)); up = await this.responding(); }
      if (!up) return this.child
        ? { state: 'unavailable', message: `Ollama did not become ready within ${Math.round(this.config.startTimeoutMs / 1000)} seconds. Check the Ollama app, then select Ollama again.` }
        : { state: 'unavailable', message: 'Ollama could not be started or exited early. Start it manually (open the Ollama app or run `ollama serve`) and select Ollama again.' };
    }
    this.status = { state: 'checking-model', message: `Checking model ${this.config.model}…` };
    const response = await this.get('/api/tags', 5000);
    let names: string[] = [];
    try { const data = await response?.json() as { models?: { name?: unknown; model?: unknown }[] }; names = Array.isArray(data?.models) ? data.models.flatMap(m => [m.name, m.model]).filter((n): n is string => typeof n === 'string') : []; }
    catch { names = []; }
    if (!response?.ok) return { state: 'unavailable', message: 'Ollama is running but its model list could not be read. Restart Ollama and select Ollama again.' };
    const wanted = this.config.model.includes(':') ? this.config.model : `${this.config.model}:latest`;
    if (!names.includes(wanted)) return { state: 'missing-model', message: `Model ${this.config.model} is not installed in Ollama. The app never downloads models; run \`ollama pull ${this.config.model}\` in a terminal, then select Ollama again.` };
    return { state: 'ready', message: `Ollama ready · ${this.config.model} at ${this.config.url}. Story passages are reworded locally; the app still decides screens, choices and outcomes. No cloud fallback.` };
  }
}
