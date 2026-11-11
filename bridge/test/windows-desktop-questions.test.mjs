import { spawn } from 'node:child_process';
import { readFile, writeFile, rm, mkdtemp, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const binary = path.join(root, 'desktop/node_modules/electron/dist/electron.exe');
const fixture = path.join(root, 'bridge/test/fixtures/desktop-question.cjs');
async function scenario(answer, draft = '', variant = '') {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codexwatch-uia-test-'));
  const out = path.join(dir, 'sent.txt'), script = path.join(dir, 'question.ps1');
  const app = spawn(binary, [fixture, out, draft, variant], { windowsHide: true, stdio: 'ignore' });
  function run(action, payload) {
    return new Promise((resolve, reject) => {
      const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', action], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = ''; const timer = setTimeout(() => { p.kill(); reject(Error('UIA timed out')); }, 45000);
      p.stdout.on('data', chunk => output += chunk); p.on('error', reject);
      p.on('close', () => { clearTimeout(timer); try { resolve(JSON.parse(output.trim())); } catch { reject(Error('Invalid UIA result')); } });
      p.stdin.end(payload ? JSON.stringify(payload) : '');
    });
  }
  try {
    const source = await readFile(path.join(root, 'bridge/desktop-question.ps1'), 'utf8'), needle = '$allowedPids=@(Get-TrustedPids)';
    if (!source.includes(needle)) throw Error('UIA trusted-process selector changed');
    await writeFile(script, source.replace(needle, `$allowedPids=@(${app.pid})`));
    let question;
    for (let i = 0; i < 20; i++) { await new Promise(resolve => setTimeout(resolve, 1000)); question = await run('read'); if (question.available) break; }
    if (!question?.available || question.question !== 'Quel choix ?' || question.options.length !== (variant === 'other-radio' ? 3 : 2)) throw Error('Fixture question not detected');
    if ((await run('answer', { ...question, question: 'Ancienne question', answer })).submitted) throw Error('Stale question accepted');
    const result = await run('answer', { ...question, answer });
    if (variant === 'auto-submit') {
      if (!result.submitted || await readFile(out, 'utf8') !== answer) throw Error('Automatic selection did not confirm the exact submitted option');
    } else if (draft || variant === 'wrong-radio') {
      if (result.submitted) throw Error('Unsafe answer submitted');
      try { await access(out); throw Error('Unsafe answer reached fixture'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    } else {
      if (!result.submitted || await readFile(out, 'utf8') !== answer) throw Error('Answer not confirmed');
    }
  } finally {
    app.kill();
    if (path.dirname(path.resolve(dir)) === path.resolve(os.tmpdir()) && path.basename(dir).startsWith('codexwatch-uia-test-')) await rm(dir, { recursive: true, force: true });
  }
}

test('Windows question forms preserve text, other options, stale state and PC drafts', { skip: process.platform !== 'win32' || !existsSync(binary) || process.env.CODEX_WATCH_UIA_TESTS !== '1', timeout: 240000 }, async () => {
  await scenario('Deuxième');
  await scenario('Deuxième', '', 'auto-submit');
  await scenario('Bonjour à toi');
  await scenario('Bonjour à toi', '', 'other-radio');
  await scenario('Bonjour à toi', '', 'wrong-radio');
  await scenario('Nouvelle réponse', 'Brouillon en cours');
});
