import {mergeTurns} from './transcript.mjs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import {nativeModels} from './management.mjs';
import {DesktopQuestionReader} from './desktop-question.mjs';

const ALLOWED_TOOLS = new Set(['list_projects', 'list_threads', 'read_thread', 'create_thread', 'send_message_to_thread']);
const OPTIONAL_TOOLS=new Set(['navigate_to_codex_page']);
export class DesktopError extends Error { constructor(message) { super(message); this.name = 'DesktopError'; } }
const normalizedPath = value => path.resolve(value || '.').replace(/[\\/]+$/, '').toLocaleLowerCase();
const parseResult = result => {
  const value = result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || '';
  if (result.isError) throw new DesktopError(value.slice(0, 800) || 'Action refusée par Codex sur le PC');
  try { return JSON.parse(value); } catch { return { message: value }; }
};

/** Uses the bundled MCP interface; this process owns no Codex thread writer. */
export class DesktopClient extends EventEmitter {
  ready = false; pending = new Map(); sequence = 0; connecting = null;
  constructor(runtime) { super(); this.runtime = runtime; }
  async start() {
    if(this.disposed)throw new Error('Relais arrêté.');
    if (this.ready) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.connect().finally(() => { this.connecting = null; });
    return this.connecting;
  }
  resolvePipe() {
    // Only the local, same-user app-tools channel is eligible. Ambiguity fails closed.
    const names = readdirSync('\\\\.\\pipe\\').filter(name => /^codex-app-tools-[a-f0-9-]{36}$/i.test(name));
    const saved = this.runtime.appToolsPipe;
    if (saved && names.includes(saved.split('\\').at(-1))) return saved;
    if (names.length !== 1) throw new Error('Ouvrir une seule instance de Codex sur ce PC pour connecter la montre.');
    return '\\\\.\\pipe\\' + names[0];
  }
  resolveServer() {
    if (existsSync(this.runtime.appToolsServer)) return this.runtime.appToolsServer;
    const root = path.dirname(path.dirname(this.runtime.appToolsServer));
    const candidates = readdirSync(root).sort((a,b) => b.localeCompare(a, undefined, { numeric: true }))
      .map(version => path.join(root, version, 'server.mjs')).filter(existsSync);
    if (!candidates.length) throw new Error('Module Codex App Tools introuvable.');
    return candidates[0];
  }
  async connect() {
    if (!this.runtime.originThreadId) throw new Error('Contexte de connexion au PC absent.');
    const childEnv = { ...process.env, ...(process.versions.electron?{ELECTRON_RUN_AS_NODE:'1'}:{}), CODEX_APP_TOOLS_PIPE_PATH: this.resolvePipe(), CODEX_APP_TOOLS_DEFERRED: '1' };
    delete childEnv.OPENAI_API_KEY;
    const child = spawn(process.execPath, [this.resolveServer()], { windowsHide: true,
      env: childEnv, stdio: ['pipe','pipe','pipe'] });
    this.child = child;
    const offline = () => {
      if (this.child !== child) return;
      this.ready = false;
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Connexion à l’application PC interrompue. Vérifier la réception avant de renvoyer.')); }
      this.pending.clear(); this.emit('offline');
    };
    child.on('error', offline); child.on('exit', offline); child.stdin.on('error', () => {}); child.stderr.on('data', () => {});
    createInterface({ input: child.stdout }).on('line', line => {
      let message; try { message = JSON.parse(line); } catch { return; }
      if (message.method && message.id !== undefined) {
        this.write(message.method === 'ping' ? { jsonrpc:'2.0', id:message.id, result:{} } :
          { jsonrpc:'2.0', id:message.id, error:{ code:-32601, message:'Interaction MCP non prise en charge' } });
        return;
      }
      const p = this.pending.get(message.id);
      if (!p) return;
      this.pending.delete(message.id); clearTimeout(p.timer);
      message.error ? p.reject(new DesktopError(message.error.message)) : p.resolve(message.result);
    });
    try {
      await this.request('initialize', { protocolVersion:'2025-06-18', capabilities:{}, clientInfo:{ name:'codex-watch', version:'0.2.0' } });
      this.write({ jsonrpc:'2.0', method:'notifications/initialized' });
      const catalog = await this.request('tools/list', {});
      this.catalog=catalog.tools;
      for (const tool of ALLOWED_TOOLS) if (!catalog.tools.some(t => t.name === tool)) throw new Error('Version de Codex App Tools incompatible : ' + tool);
      // Confirm the pipe reaches a live desktop, not merely a started MCP child.
      this.projects = await this.tool('list_projects', {}, null, true);
      this.ready = true;
    } catch (error) { child.kill(); throw error; }
  }
  write(message) { this.child?.stdin.write(JSON.stringify(message) + '\n'); }
  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Réception par le PC non confirmée. Vérifier la conversation avant de renvoyer.')); }, 30000);
      this.pending.set(id, { resolve, reject, timer }); this.write({ jsonrpc:'2.0', id, method, params });
    });
  }
  async tool(name, args, requestId, initializing = false) {
    if (!ALLOWED_TOOLS.has(name)&&!OPTIONAL_TOOLS.has(name)) throw new Error('Action non autorisée par le relais');
    if (!this.ready && !initializing) await this.start();
    const metadata = { 'openai/threadId': this.runtime.originThreadId };
    if (requestId) metadata['openai/toolCallId'] = 'watch-' + requestId;
    try { return parseResult(await this.request('tools/call', { name, arguments: args, _meta: metadata })); }
    catch (error) {
      if(name==='read_thread' && error instanceof DesktopError && /^No Codex thread found for threadId:/i.test(error.message))
        throw Object.assign(new DesktopError('Conversation introuvable sur ce PC. Reviens à la liste ou choisis le serveur correspondant.'),{status:404,code:'THREAD_NOT_FOUND'});
      if(error.status===429||/too many requests|rate.?limit|\b429\b/i.test(error.message))throw Object.assign(new DesktopError('ChatGPT limite temporairement ses requêtes. Codex reste disponible.'),{status:429,code:'CHATGPT_RATE_LIMITED'});
      // A live forwarder is not proof the desktop is still running. Reconnect only;
      // never replay a submission whose acknowledgement may have been lost.
      if (['list_projects', 'list_threads'].includes(name)) this.stop();
      throw error;
    }
  }
  async refreshCatalog(){
    if(this.catalogAt&&Date.now()-this.catalogAt<60000)return this.catalog;
    if(this.refreshingCatalog)return this.refreshingCatalog;
    this.refreshingCatalog=(async()=>{await this.start();const catalog=await this.request('tools/list',{});this.catalog=catalog.tools;this.catalogAt=Date.now();return this.catalog;})().finally(()=>{this.refreshingCatalog=null;});
    return this.refreshingCatalog;
  }
  stop() { this.ready = false; this.child?.stdin.end(); this.child?.kill(); }
  dispose(){this.disposed=true;this.stop();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Relais arrêté.'));}this.pending.clear();}
}

export class DesktopRpc extends EventEmitter {
  get models(){return nativeModels(this.client.catalog);}
  async refreshModels(){if(this.client.refreshCatalog)await this.client.refreshCatalog();return this.models;}
  sharedDesktop = true; metadata = new Map(); histories = new Map(); readProfiles = new Map(); projects = [];
  constructor(client,{questionReader=new DesktopQuestionReader()}={}) { super(); this.client = client;this.questionReader=questionReader; client.on('offline', () => this.emit('offline')); }
  get ready() { return this.client.ready; }
  async start() { await this.client.start(); }
  async configureProjects(projects) {
    const available = this.client.projects || await this.client.tool('list_projects', {});
    this.projects = projects;
    for (const p of projects) p.desktopProjectId = available.projects?.find(native => native.projectKind === 'local' &&
      native.hostId === 'local' && native.path && normalizedPath(native.path) === normalizedPath(p.path))?.projectId;
  }
  async list(params) {
    const project = params.cwd ? this.projects.find(p => normalizedPath(p.path) === normalizedPath(params.cwd)) : null;
    if (params.cwd && !project) throw new Error('Projet non autorisé');
    const projectFor = t => (project ? [project] : this.projects).find(p =>
      (p.desktopProjectId && t.projectId === p.desktopProjectId) || (t.cwd && normalizedPath(t.cwd) === normalizedPath(p.path)));
    let cursor = null, skip = 0;
    if (params.cursor) {
      const decoded = JSON.parse(Buffer.from(params.cursor, 'base64url').toString());
      if (decoded.project !== (project?.id || '') || decoded.q !== (params.searchTerm || '')) throw new Error('Pagination invalide');
      cursor = decoded.cursor; skip = decoded.skip;
    }
    const limit = Math.min(50, params.limit || 30), data = [], q = (params.searchTerm || '').toLocaleLowerCase();
    let nextCursor = null;
    for (let page = 0; page < 3; page++) {
      const result = await this.client.tool('list_threads', { mode:'history', source:'codex', hostId:'local', limit:50, ...(cursor ? { cursor } : {}) });
      for (const t of result.threads || []) this.metadata.set(t.id, t);
      const matching = (result.threads || []).filter(t => t.kind === 'codex' && t.hostId === 'local' &&
        projectFor(t) &&
        (!q || (t.title || '').toLocaleLowerCase().includes(q)));
      const remaining = matching.slice(skip), take = Math.min(limit - data.length, remaining.length);
      data.push(...remaining.slice(0, take).map(t => ({ id:t.id, name:t.title, preview:'', cwd:t.cwd || projectFor(t).path,
        projectId:projectFor(t).id, projectName:projectFor(t).name, desktopProjectId:t.projectId, updatedAt:t.updatedAt || 0,
        status:typeof t.status === 'object' ? t.status : { type:t.status || 'notLoaded' }, turns:[] })));
      if (take < remaining.length) { nextCursor = { cursor, skip:skip + take }; break; }
      cursor = result.nextCursor; skip = 0;
      if (!cursor) break;
      if (data.length === limit || page === 2) { nextCursor = { cursor, skip:0 }; break; }
    }
    return { data, nextCursor:nextCursor ? Buffer.from(JSON.stringify({ ...nextCursor, project:project?.id || '', q:params.searchTerm || '' })).toString('base64url') : null };
  }
  async read(params) {
    const profiles=[[10,20000],[3,20000],[1,20000],[1,2000],[1,200]];
    let index=this.readProfiles.get(params.threadId)||0,result;
    while(index<profiles.length){
      const [turnLimit,maxOutputCharsPerItem]=profiles[index];
      try{result=await this.client.tool('read_thread',{threadId:params.threadId,hostId:'local',turnLimit,includeOutputs:false,maxOutputCharsPerItem,...(params.cursor?{cursor:params.cursor}:{})});break;}
      catch(error){if(!(error instanceof DesktopError)||!/^Tool response exceeds the size limit\./i.test(error.message)||index===profiles.length-1)throw error;index++;}
    }
    this.readProfiles.set(params.threadId,index);
    if (result.thread?.kind !== 'codex' || result.thread.hostId !== 'local') throw new Error('Conversation hors du PC autorisé');
    const incoming = [...(result.turns || [])].reverse(), cached = this.histories.get(params.threadId);
    const turns = mergeTurns(params.cursor ? incoming : cached?.turns || [],params.cursor ? cached?.turns || [] : incoming);
    const historyCursor = !cached || params.cursor ? result.page?.nextCursor : cached.cursor;
    this.histories.set(params.threadId, { turns, cursor:historyCursor || null });
    return { thread:{ ...result.thread, name:result.thread.title, turns, historyCursor:historyCursor || null,
      historyNotice:index>=3?'Certains détails très longs peuvent être raccourcis. Consulte le PC pour le texte complet.':'',
      desktopProjectId:this.metadata.get(params.threadId)?.projectId } };
  }
  async recentThreads() {
    const result = await this.client.tool('list_threads', { mode:'history', source:'codex', hostId:'local', limit:50 });
    return (result.threads || []).filter(t => {
      this.metadata.set(t.id, t);
      return t.kind === 'codex' && t.hostId === 'local' && this.projects.some(p =>
        (p.desktopProjectId && t.projectId === p.desktopProjectId) || (t.cwd && normalizedPath(t.cwd) === normalizedPath(p.path)));
    }).map(t => ({ id:t.id, cwd:t.cwd, updatedAt:t.updatedAt, status:{type:'notLoaded'} }));
  }
  async readDesktopQuestion(candidates){
    const question=await this.questionReader.read();if(!question)return null;
    // A title is not a unique identifier. Check the whole local catalog,
    // including projects the watch cannot access, before using it to route a form.
    // If the catalog cannot be exhausted within a bounded number of pages, fail closed.
    const titles=[];let cursor=null,complete=false;const seen=new Set();
    for(let page=0;page<20;page++){
      const result=await this.client.tool('list_threads',{mode:'history',source:'codex',hostId:'local',limit:50,...(cursor?{cursor}:{})});
      for(const t of result.threads||[]){this.metadata.set(t.id,t);if(t.title===question.title)titles.push(t);}
      if(titles.length>1)return null;
      if(!result.nextCursor){complete=true;break;}
      if(seen.has(result.nextCursor))return null;
      seen.add(result.nextCursor);cursor=result.nextCursor;
    }
    if(!complete||titles.length!==1)return null;
    const matches=candidates.filter(t=>this.metadata.get(t.id)?.title===question.title);
    if(matches.length!==1||matches[0].id!==titles[0].id)return null;
    const status=this.metadata.get(matches[0].id)?.status;
    if((typeof status==='string'?status:status?.type)!=='active')return null;
    return {...question,threadId:matches[0].id};
  }
  async answerDesktopQuestion(question,answer){return this.questionReader.answer(question,answer);}
  async call(method, params) {
    if (method === 'thread/list') return this.list(params);
    if (method === 'thread/read') return this.read(params);
    throw new Error('Le relais PC ne lance ni ne reprend de moteur Codex distinct.');
  }
  async send({ id, project, text, requestId,model,thinking }) {
    const inference={...(model?{model}:{}),...(thinking?{thinking}:{})};
    if (id) {
      const result = await this.client.tool('send_message_to_thread', { threadId:id, hostId:'local', prompt:text,...inference }, requestId);
      return { id, kind:'codex', mode:'forwarded', receipt:result.status || result.state || 'received' };
    }
    if (!project.desktopProjectId) throw new Error('Ce projet doit être enregistré dans l’application Codex du PC.');
    const result = await this.client.tool('create_thread', { prompt:text,...inference,
      target:{ type:'project', projectId:project.desktopProjectId, environment:{ type:'local' } } }, requestId);
    const threadId = result.threadId || result.thread?.id;
    if (threadId) return { id:threadId, kind:'codex', mode:'created' };
    if (result.clientThreadId) return { kind:'codex', mode:'preparing', pending:true, clientThreadId:result.clientThreadId };
    throw new Error('Le PC n’a pas retourné d’identifiant de conversation. Vérifier le projet avant de renvoyer.');
  }
  write() { /* No Codex server request is handled by this interface. */ }
  stop() { if(this.client.dispose)this.client.dispose();else this.client.stop(); }
}
