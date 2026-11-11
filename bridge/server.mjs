import http from 'node:http';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { CodexRpc, CodexRpcError, publicRpcError } from './rpc.mjs';
import { Store } from './store.mjs';
import { Service, authenticate, HttpError } from './service.mjs';
import { DesktopClient, DesktopRpc, DesktopError } from './desktop.mjs';
import { openEventStream } from './events.mjs';
import { Push } from './push.mjs';
import { appendFileSync } from 'node:fs';
import { attachLive } from './live.mjs';
import {PairingWindow} from './pairing.mjs';
import {VpsAdmin} from './vps-admin.mjs';
import {WatchAuth} from './watch-auth.mjs';
import {Bonjour} from 'bonjour-service';

export function createHttpServer(service, token, pairing=null, admin=null, watchAuth=null) {
  const sockets=new Map();
  const track=(principal,socket,response=null)=>{if(!principal||principal.legacy)return;let set=sockets.get(principal.id);if(!set){set=new Set();sockets.set(principal.id,set);}set.add(socket);const remove=()=>{socket.off('close',remove);response?.off('finish',remove);set.delete(socket);if(!set.size)sockets.delete(principal.id);};if(response)response.once('finish',remove);socket.once('close',remove);};
  watchAuth?.on('revoked',id=>{for(const socket of sockets.get(id)||[])socket.destroy();sockets.delete(id);});
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if(admin && await admin.handle(req,res))return;
      if (req.headers.origin) throw new HttpError(403, 'Accès navigateur interdit');
      if(req.method==='POST'&&req.url==='/v1/pair'&&pairing){
        let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>256)throw new HttpError(413,'Demande trop volumineuse');}
        let body;try{body=JSON.parse(text);}catch{throw new HttpError(400,'Code invalide');}
        const receipt=await pairing.consume(body?.code);const issued=watchAuth?await watchAuth.issue(receipt.id,body?.device):token;res.end(JSON.stringify({token:issued,receipt}));return;
      }
      const principal=watchAuth?watchAuth.identify(req.headers.authorization):(authenticate(req.headers.authorization,token)?{id:'legacy',legacy:true,active:true}:null);
      if(!principal)throw new HttpError(401,'Association requise');track(principal,req.socket,res);
      const url = new URL(req.url, 'http://localhost');
      if(!principal.active&&url.pathname!=='/v1/health'&&url.pathname!=='/v1/pair/confirm')throw new HttpError(403,'Confirme d’abord l’association.');
      if (req.method === 'GET' && url.pathname === '/v1/events/stream') { openEventStream(req, res, service); return; }
      if (req.method === 'GET' && req.url === '/healthz') { res.end('{"ok":true}'); return; }
      let text = '';
      for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 32768) throw new HttpError(413, 'Demande trop volumineuse'); }
      let body; try { body = text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, 'JSON invalide'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Objet JSON requis');
      if(req.method==='POST'&&url.pathname==='/v1/pair/confirm'&&pairing){if(watchAuth&&!principal.legacy&&principal.id!==body.id)throw new HttpError(403,'Association invalide.');await pairing.confirm(body.id,body.nonce);if(watchAuth&&!principal.legacy)await watchAuth.activate(body.id,principal);res.end(JSON.stringify({ok:true}));return;}
      const result = await service.route(req.method, url, body, req.headers['idempotency-key'],principal);
      const payload=JSON.stringify(result);
      if(req.method==='GET' && /^\/v1\/threads\/[^/]+$/.test(url.pathname) && !url.searchParams.has('cursor')) {
        const tag='"'+createHash('sha256').update(payload).digest('base64url')+'"';
        res.setHeader('ETag',tag);
        if(req.headers['if-none-match']===tag){res.statusCode=304;return res.end();}
      }
      res.end(payload);
    } catch (e) {
      res.statusCode = e.status || 502;
      res.end(JSON.stringify({ error: e.status ? e.message : e instanceof CodexRpcError || e instanceof DesktopError ? publicRpcError(e) : 'Le relais n’a pas pu terminer la demande. Vérifier la conversation avant de réessayer.',
        ...(e.code&&typeof e.code==='string'?{code:e.code}: {}) }));
    }
  });
  if(watchAuth)server.on('upgrade',(req,socket)=>{const principal=watchAuth.identify(req.headers.authorization);if(principal?.active)track(principal,socket);});
  attachLive(server,service,header=>watchAuth?!!watchAuth.identify(header)?.active:authenticate(header,token));
  return server;
}

async function main() {
  const base = path.dirname(fileURLToPath(import.meta.url));
  // The Windows task launches Node directly so stopping the task stops the relay itself.
  // Machine-specific paths stay outside version control.
  let runtime = {};
  try {
    runtime = JSON.parse((await readFile(path.join(path.resolve(process.env.WATCH_DATA_DIR||path.join(base,'../.local')), 'runtime.json'), 'utf8')).replace(/^\uFEFF/, ''));
    if (runtime.codexExecutable) process.env.CODEX_EXECUTABLE ||= runtime.codexExecutable;
    if (runtime.codexHome) process.env.CODEX_HOME ||= runtime.codexHome;
    if (runtime.fcmCredentials) process.env.GOOGLE_APPLICATION_CREDENTIALS = runtime.fcmCredentials;
    if (runtime.assistantEnv&&!process.env.WATCH_GUI_KEY_MANAGED) process.loadEnvFile(runtime.assistantEnv);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const demo = process.argv.includes('--demo');
  const configPath = path.resolve(process.env.WATCH_CONFIG || path.join(base, 'config.json'));
  let config;
  try { config = JSON.parse(await readFile(configPath, 'utf8')); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    if (!demo) throw new Error('Configuration du relais absente. Aucun moteur Codex ne sera démarré.');
    config = JSON.parse(await readFile(path.join(base, 'config.example.json'), 'utf8'));
  }
  if (!['desktop', 'standalone'].includes(config.codexBackend)) throw new Error('Choisir explicitement codexBackend : desktop ou standalone.');
  if (!['127.0.0.1', '::1', 'localhost'].includes(config.host)) throw new Error('Le relais doit écouter sur localhost. Utiliser un proxy HTTPS pour la montre.');
  config.projects = config.projects.map(p => ({ ...p, path: path.resolve(path.dirname(configPath), p.path) }));
  const local = path.resolve(process.env.WATCH_DATA_DIR||path.join(base,'../.local')); await mkdir(local, { recursive: true });
  const pidPath = path.join(local, demo ? 'demo-bridge.pid' : 'bridge.pid');
  try {
    const oldPid = Number((await readFile(pidPath, 'utf8')).trim());
    if (Number.isInteger(oldPid) && oldPid > 0) {
      let running = true; try { process.kill(oldPid, 0); } catch (e) { if (e.code === 'ESRCH') running = false; }
      if (running) throw new Error('Un relais utilise déjà ce dossier.');
    }
    await unlink(pidPath);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await writeFile(pidPath, String(process.pid), { flag: 'wx' });
  // Synchronous removal is required because exit handlers cannot await promises.
  const { unlinkSync } = await import('node:fs');
  process.once('exit', () => { try { unlinkSync(pidPath); } catch { } });
  const tokenPath = path.join(local, demo ? 'demo-pairing-token.txt' : 'pairing-token.txt');
  let token = process.env.WATCH_TOKEN;
  if (!token) { try { token = (await readFile(tokenPath, 'utf8')).trim(); } catch (e) { if (e.code !== 'ENOENT') throw e; token = randomBytes(32).toString('base64url'); await writeFile(tokenPath, token, { mode: 0o600 }); } }
  if (token.length < 32) throw new Error('WATCH_TOKEN doit contenir au moins 32 caractères');
  const store = new Store(path.join(local, demo ? 'demo-state.json' : 'state.json')); await store.load();
  const desktopMode = !demo && config.codexBackend === 'desktop';
  const rpc = demo ? new EventEmitter() : desktopMode ? new DesktopRpc(new DesktopClient(runtime)) : new CodexRpc();
  if (demo) {
    rpc.ready = true; rpc.stop = () => {}; rpc.write = () => {};
    rpc.call = async method => {
      if (method === 'thread/list') return { data: [{ id: 'demo-thread', name: 'Exemple — tâche terminée', cwd: config.projects[0].path, status: { type: 'idle' }, updatedAt: Date.now() / 1000 }] };
      if (method === 'thread/read') return { thread: { id: 'demo-thread', name: 'Exemple — tâche terminée', cwd: config.projects[0].path, status: { type: 'idle' }, turns: [{ id: 'demo-turn', status: 'completed', items: [{ id: 'demo-item', type: 'agentMessage', text: 'Mode démonstration. Aucune tâche réelle n’a été envoyée.' }] }] } };
      throw new HttpError(409, 'Démonstration : envoi désactivé');
    };
  } else if (desktopMode) { await rpc.start().catch(() => {}); }
  else { await rpc.start(); }
  const service = new Service({ rpc, store, config, push:demo ? null : new Push(config.firebase), demo }); await service.initialize();
  const watchAuth=new WatchAuth(path.join(local,'watch-auth.json'),token);await watchAuth.load();
  const admin=config.vpsAdmin===true&&!desktopMode&&config.publicUrl?new VpsAdmin({service,data:local,origin:config.publicUrl,watchAuth}):null;
  const server = createHttpServer(service, token, new PairingWindow(path.join(local,'pairing-window.json')),admin,watchAuth);
  let discovery;
  if(config.publicUrl&&config.discovery!==false){
    try{const url=new URL(config.publicUrl);if(url.protocol==='https:'){discovery=new Bonjour();discovery.publish({name:'Codex Watch Relay',type:'codexwatch',port:config.port,txt:{url:url.origin}});}}
    catch{ /* Discovery is optional; the HTTPS address remains usable manually. */ }
  }
  server.requestTimeout = 40000;
  server.listen(config.port, config.host, () => { console.log(`Codex Watch ${demo ? 'DÉMONSTRATION ' : ''}sur http://${config.host}:${config.port}`); console.log(`Jeton d’association conservé dans ${tokenPath}`); });
  let polling = false;
  const pollNow = async () => {
    if (polling) return;
    polling = true;
    try {
      await service.pollProjects();
      if (service.lastError === 'Suivi des tâches à vérifier') service.lastError = '';
    } catch { service.lastError = 'Suivi des tâches à vérifier'; }
    finally { polling = false; void service.flushPush().catch(() => { service.lastError = 'Envoi des notifications à réessayer'; }); }
  };
  const poll = setInterval(pollNow, 20000);
  void pollNow();
  // Native question forms are interactive and need faster detection than the
  // background project history poll. The service coalesces overlapping reads.
  const questions = desktopMode ? setInterval(() => void service.refreshDesktopQuestion(), 5000) : null;
  questions?.unref();
  const reconnect = desktopMode ? setInterval(async () => {
    if (rpc.ready) return;
    try { await rpc.start(); await rpc.configureProjects(service.projects); if (service.lastError === 'Codex PC indisponible. Ouvre l’application sur le PC.') service.lastError = ''; }
    catch { service.lastError = 'Codex PC indisponible. Ouvre l’application sur le PC.'; }
  }, 5000) : null;
  const stop = () => { clearInterval(poll); if (questions) clearInterval(questions); if (reconnect) clearInterval(reconnect); discovery?.destroy(); service.close(); server.close(); };
  process.on('message',message=>{
    if(message?.type==='stop'){stop();if(process.connected)process.disconnect();}
    else if(message?.type==='phonon-config-changed'){
      service.audio.phonon.configurationChanged();
      void (async()=>{if(service.audio.phonon.preloadPromise)await service.audio.phonon.preloadPromise;await service.audio.phonon.preload(service.audio.state.settings.phononVoice);})().catch(()=>{});
    }
    else if(message?.type==='phonon-test' && typeof message.id==='string'){
      void service.audio.phonon.speak('Bonjour, ceci est un test local de la voix Phonon.')
        .then(()=>{if(process.connected)process.send({type:'phonon-test-result',id:message.id,ok:true});})
        .catch(()=>{if(process.connected)process.send({type:'phonon-test-result',id:message.id,ok:false});});
    }
    else if(message?.type==='watches-control'&&typeof message.id==='string'){
      void (async()=>{
        if(message.action==='list')return {data:watchAuth.list()};
        if(message.action==='revoke'&&typeof message.watchId==='string'){
          await watchAuth.revoke(message.watchId);
          service.store.data.devices=service.store.data.devices.filter(d=>d.watchId!==message.watchId);
          service.store.data.pushJobs=service.store.data.pushJobs.filter(j=>j.device?.watchId!==message.watchId);
          await service.store.save();return {ok:true};
        }
        throw Error('Action inconnue.');
      })().then(value=>{if(process.connected)process.send({type:'watches-control-result',id:message.id,ok:true,value});}).catch(()=>{if(process.connected)process.send({type:'watches-control-result',id:message.id,ok:false});});
    }
  });
  process.once('disconnect',stop);
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const recordFailure = (stage, error) => {
    try { appendFileSync(path.join(process.env.WATCH_DATA_DIR||fileURLToPath(new URL('../.local',import.meta.url)),'bridge.stderr.log'), `${new Date().toISOString()} ${stage}: ${publicRpcError(error)}\n`); } catch { }
  };
  // Observe fatal errors without swallowing them: Windows can restart a failed task.
  process.on('uncaughtExceptionMonitor', error => recordFailure('fatal', error));
  main().catch(error => { recordFailure('startup', error); console.error(error.message); process.exitCode = 1; });
}
