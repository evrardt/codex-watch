import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';

export class CodexRpcError extends Error {
  constructor(method, error) { super(error.message || 'Erreur Codex'); this.name = 'CodexRpcError'; this.method = method; this.code = error.code; }
}

export function publicRpcError(error) {
  return ('Codex : ' + error.message).replace(/\bsk-[A-Za-z0-9_-]+/g, '[masqué]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [masqué]').slice(0, 800);
}

export function codexCommand(env = process.env) {
  if (env.CODEX_EXECUTABLE) return [env.CODEX_EXECUTABLE, ['app-server']];
  // Invoke the npm launcher through Node: no shell and no .ps1 execution policy dependency.
  const launcher = path.join(env.APPDATA || '', 'npm/node_modules/@openai/codex/bin/codex.js');
  return process.platform === 'win32' && existsSync(launcher)
    ? [process.execPath, [launcher, 'app-server']]
    : ['codex', ['app-server']];
}

export class CodexRpc extends EventEmitter {
  pending = new Map(); sequence = 0; ready = false;
  async start() {
    const [command, args] = codexCommand();
    this.child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const fail = () => {
      this.ready = false;
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Codex indisponible. Redémarrer le relais.')); }
      this.pending.clear();
      this.emit('offline');
    };
    this.child.on('error', fail);
    this.child.on('exit', fail);
    this.child.stdin.on('error', () => {});
    // Do not mirror tool output, environment, or conversation text into server logs.
    this.child.stderr.on('data', () => {});
    createInterface({ input: this.child.stdout }).on('line', line => {
      let m; try { m = JSON.parse(line); } catch { return; }
      const p = this.pending.get(m.id);
      if (p && !m.method) {
        this.pending.delete(m.id); clearTimeout(p.timer);
        m.error ? p.reject(new CodexRpcError(p.method, m.error)) : p.resolve(m.result);
      } else if (m.method) this.emit('message', m);
    });
    await this.call('initialize', { clientInfo: { name: 'codex_watch', title: 'Codex Watch', version: '0.1.0' } });
    this.write({ method: 'initialized', params: {} });
    this.ready = true;
  }
  write(message) { this.child?.stdin.write(JSON.stringify(message) + '\n'); }
  call(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Délai Codex dépassé')); }, 30000);
      this.pending.set(id, { resolve, reject, timer, method });
      this.write({ id, method, params });
    });
  }
  stop() { this.child?.stdin.end(); this.child?.kill(); }
}
