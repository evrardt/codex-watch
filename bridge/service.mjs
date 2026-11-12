import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { CodexRpcError } from './rpc.mjs';
import { EventEmitter } from 'node:events';
import { alertContent } from './alert-content.mjs';
const LOOKUP_TIMEOUT=Symbol('lookup timeout');
async function boundedLookup(promise,timeoutMs){
  let timer;
  try{return await Promise.race([promise,new Promise(resolve=>{timer=setTimeout(()=>resolve(LOOKUP_TIMEOUT),Math.max(0,timeoutMs));})]);}
  finally{clearTimeout(timer);}
}
import { NativeChatgpt } from './chatgpt.mjs';
import { messagesFromThread, messagesWithSubmissions, questionReplyIds } from './transcript.mjs';
import { AudioService } from './audio.mjs';
import { PlanChat } from './siwc.mjs';
import { ApiChat } from './api-chat.mjs';
import {recordChatUsage} from './chat-usage.mjs';
import {PluginManager,validateInference} from './management.mjs';
import{liveHistory}from'./live-history.mjs';
import{matchesPendingThread,recentPendingCandidate}from'./pending-thread.mjs';
export { messagesFromThread } from './transcript.mjs';

export class HttpError extends Error { constructor(status, message, code = null) { super(message); this.status = status; this.code = code; } }
const activeWriterError = e => e instanceof CodexRpcError && /already has an active writer/i.test(e.message);
const requireValue = (condition, message) => { if (!condition) throw new HttpError(400, message); };
export function authenticate(header, token) {
  const hash = x => createHash('sha256').update(x || '').digest();
  return !!token && timingSafeEqual(hash(header), hash('Bearer ' + token));
}
export function summary(thread) {
  return { id: thread.id, kind: 'codex', title: thread.name || thread.preview?.slice(0, 90) || 'Conversation Codex',
    cwd: thread.cwd, projectId:thread.projectId, projectName:thread.projectName,
    status: thread.status?.type || 'notLoaded', updatedAt: thread.updatedAt };
}

// Never forward provider error text: it may contain paths, credentials or request details.
export function codexTurnError(thread) {
  const turn=thread.turns?.at(-1);
  if(turn?.status!=='failed' && thread.status?.type!=='systemError')return '';
  const failure=JSON.stringify(turn?.error || {}).toLowerCase();
  if(failure.includes('workspace is out of credits') || failure.includes('insufficient_quota'))
    return 'Crédits Codex épuisés. Vérifie les crédits de ton espace de travail.';
  if(failure.includes('usage_limit_exceeded') || failure.includes('usagelimitexceeded') || failure.includes('usage limit') || failure.includes('rate_limit'))
    return 'Limite Codex atteinte. Vérifie ton utilisation et réessaie plus tard.';
  return 'La réponse Codex a échoué. Vérifie la connexion et les crédits sur le relais.';
}

export class Service {
  alerts = new EventEmitter();
  approvals = new Map(); desktopPending = new Map(); loaded = new Set(); busy = new Set(); activeTurns = new Map(); observed = new Map(); monitorReady = false;
  desktopQuestion=null; desktopQuestionSuppressed=''; desktopQuestionSuppressionUncertain=false; desktopQuestionRefresh=null; desktopQuestionBusy=false; desktopQuestionCheckedAt=0;
  desktopAnswerResults = new Map();
  operationsInFlight = new Map();
  pendingLookups = new Map(); pendingLookupAt = new Map();
  constructor({ rpc, store, config, push, fetcher = fetch, demo = false }) {
    Object.assign(this, { rpc, store, config, push, fetcher, demo });
    rpc.on('message', m => this.onRpc(m).catch(() => { this.lastError = 'Événement Codex non enregistré'; }));
    rpc.on('offline', () => { for (const a of this.approvals.values()) clearTimeout(a.timer); this.approvals.clear(); this.desktopPending.clear(); this.desktopQuestion=null;this.loaded.clear(); this.activeTurns.clear(); });
  }
  async initialize() {
    this.plugins = new PluginManager({cacheFile:path.join(path.dirname(this.store.file),'plugins-cache.json')});
    this.audio = new AudioService({store:this.store,directory:path.join(path.dirname(this.store.file),'audio-cache')});
    await this.audio.phonon.saveStatus({resident:false,reason:'En attente d’une lecture.'});
    void this.audio.phonon.preload(this.audio.state.settings.phononVoice).catch(()=>{});
    this.nativeChatgpt = this.config.chatgptDesktop === true && this.rpc.sharedDesktop ? new NativeChatgpt(this.rpc.client,{store:this.store}) : null;
    this.apiChat = this.config.apiChat === true && !this.rpc.sharedDesktop ? new ApiChat(path.join(path.dirname(this.store.file),'openai-api-key.txt'),{fetcher:this.fetcher,model:this.config.apiChatModel||'gpt-6.1-terra',onUsage:async(model,usage)=>{recordChatUsage(this.store,model,usage);await this.store.save();}}) : null;
    if(this.apiChat)this.audio.key=()=>{if(!this.audio.state.settings.vpsKeyEnabled)return '';try{const k=readFileSync(this.apiChat.file,'utf8').trim();return /^sk-[A-Za-z0-9_-]{10,500}$/.test(k)?k:'';}catch{return '';}};
    this.planChat = this.apiChat || (this.config.siwcChat === true && !this.rpc.sharedDesktop ? new PlanChat(path.join(path.dirname(this.store.file),'siwc-credentials.json'),{fetcher:this.fetcher}) : null);
    const checked = await Promise.all(this.config.projects.map(async p => {
      try { const folder=await realpath(p.path);if(!(await stat(folder)).isDirectory())return null;return { ...p, path: folder }; }
      catch (e) { if (['ENOENT','ENOTDIR','EACCES','EPERM'].includes(e.code)) return null; throw e; }
    }));
    this.projects = checked.filter(Boolean);
    this.unavailableProjectCount = checked.length - this.projects.length;
    if (this.rpc.ready && this.rpc.configureProjects) await this.rpc.configureProjects(this.projects);
  }
  project(id) {
    const p = this.projects.find(x => x.id === id);
    if (!p) throw new HttpError(404, 'Projet non autorisé');
    return p;
  }
  async permitted(thread) {
    if (this.rpc.sharedDesktop && thread.desktopProjectId && this.projects.some(p => p.desktopProjectId === thread.desktopProjectId)) return thread;
    let cwd; try { cwd = await realpath(thread.cwd); } catch { throw new HttpError(403, 'Dossier du projet inaccessible'); }
    if (!this.projects.some(p => p.path === cwd)) throw new HttpError(403, 'Conversation hors des projets autorisés');
    return thread;
  }
  async read(id, cursor = null) {
    const { thread } = await this.rpc.call('thread/read', { threadId: id, includeTurns: true, ...(cursor ? { cursor } : {}) });
    return this.permitted(thread);
  }
  async observeDesktopAttention(thread) {
    if(!this.rpc.sharedDesktop)return;
    const flags=thread.status?.type==='active'&&Array.isArray(thread.status.activeFlags)?thread.status.activeFlags:[];
    const kind=flags.includes('waitingOnApproval')?'approval':flags.includes('waitingOnUserInput')?'attention':'';
    const previous=this.desktopPending.get(thread.id);
    if(!kind){this.desktopPending.delete(thread.id);return;}
    this.desktopPending.set(thread.id,{threadId:thread.id,type:kind,title:thread.name||'Conversation Codex',seenAt:Date.now()});
    if(previous?.type!==kind)await this.emit(kind,thread.id,'codex',thread);
  }
  async refreshDesktopQuestion(candidates=null){
    if(!this.rpc.sharedDesktop || !this.rpc.readDesktopQuestion || !this.rpc.ready || this.desktopQuestionBusy)return;
    if(this.desktopQuestionRefresh)return this.desktopQuestionRefresh;
    if(!candidates && Date.now()-this.desktopQuestionCheckedAt<1000)return;
    const task=(async()=>{
      try{
        const threads=candidates||await this.rpc.recentThreads(),question=await this.rpc.readDesktopQuestion(threads);
        this.desktopQuestionCheckedAt=Date.now();
        if(!question){this.desktopQuestion=null;if(!this.desktopQuestionSuppressionUncertain)this.desktopQuestionSuppressed='';return;}
        const signature=createHash('sha256').update(JSON.stringify(question)).digest('hex');
        if(this.desktopQuestionSuppressed && this.desktopQuestionSuppressed!==signature){this.desktopQuestionSuppressed='';this.desktopQuestionSuppressionUncertain=false;}
        if(this.desktopQuestionSuppressed===signature)return;
        if(this.desktopQuestion?.signature===signature)return;
        const previous=this.desktopQuestion;
        this.desktopQuestion={key:randomUUID(),signature,question};
        if(!previous || previous.signature!==signature)await this.emit('attention',question.threadId,'codex',null,{target:'requests'});
      }catch{this.desktopQuestion=null;this.desktopQuestionCheckedAt=Date.now();}
    })();
    this.desktopQuestionRefresh=task;try{await task;}finally{if(this.desktopQuestionRefresh===task)this.desktopQuestionRefresh=null;}
  }
  async answerDesktopQuestion(id,answers,cancel){
    const pending=this.desktopQuestion;
    if(!pending||pending.key!==id)throw new HttpError(410,'Question expirée. Vérifie sur le PC.');
    if(cancel)throw new HttpError(400,'Pour ignorer la question, utilise le PC.');
    const answer=answers?.['desktop-question'];
    requireValue(typeof answer==='string'&&answer.trim().length>0&&answer.length<=4000,'Saisis une réponse.');
    if(this.desktopQuestionBusy)throw new HttpError(409,'Envoi déjà en cours.');
    this.desktopQuestionBusy=true;
    // Capture matching reply IDs before interaction, bounded so a slow history
    // cannot block the user's answer indefinitely.
    const baseline=await boundedLookup(this.read(pending.question.threadId),2500)
      .then(thread=>thread===LOOKUP_TIMEOUT?null:questionReplyIds(thread,pending.question.question,answer))
      .catch(()=>null);
    let confirmed=false;
    try{await this.rpc.answerDesktopQuestion(pending.question,answer.trim());confirmed=true;return {ok:true};}
    catch(e){
      if(e.code==='DESKTOP_FORM_CLOSED_AFTER_INPUT'){
        const previous=baseline;
        if(previous)for(let attempt=0;attempt<20;attempt++){
          try{
            const thread=await boundedLookup(this.read(pending.question.threadId),2500);
            if(thread!==LOOKUP_TIMEOUT&&[...questionReplyIds(thread,pending.question.question,answer)].some(id=>!previous.has(id))){confirmed=true;return {ok:true};}
          }catch{ /* Failure to verify is never treated as a successful submission. */ }
          if(attempt<19)await new Promise(resolve=>setTimeout(resolve,500));
        }
      }
      throw new HttpError(409,e.message||'Envoi non confirmé. Vérifie sur le PC avant de recommencer.');
    }
    finally{this.desktopQuestionSuppressed=pending.signature;this.desktopQuestionSuppressionUncertain=!confirmed;if(this.desktopQuestion?.key===id)this.desktopQuestion=null;this.desktopQuestionBusy=false;this.desktopQuestionCheckedAt=0;}
  }
  startDesktopAnswer(id, answers, cancel) {
    const existing=this.desktopAnswerResults.get(id);
    if(existing)return {pending:true};
    if(!this.desktopQuestion || this.desktopQuestion.key!==id)throw new HttpError(410,'Question expirée. Vérifie sur le PC.');
    if(this.desktopQuestionBusy)throw new HttpError(409,'Envoi déjà en cours.');
    const result={state:'pending'};
    this.desktopAnswerResults.set(id,result);
    // Respond before trying to observe the user message: the desktop may not
    // expose that message to read_thread until the HTTP submission has returned.
    setTimeout(()=>void this.answerDesktopQuestion(id,answers,cancel).then(()=>{result.state='confirmed';}).catch(()=>{result.state='uncertain';}).finally(()=>{
      const timer=setTimeout(()=>this.desktopAnswerResults.delete(id),120000);timer.unref?.();
    }),25);
    return {pending:true};
  }
  async emit(type, threadId, kind = 'codex', thread = null, extra = {}) {
    let content = {};
    if (threadId) try {
      const source = thread || (kind === 'chat' || (kind === 'chatgpt' && this.planChat) ? this.store.data.chats.find(c => c.id === threadId) : kind === 'chatgpt' ? await this.nativeChatgpt?.read(threadId) : await this.read(threadId));
      if (source) {
        if (kind === 'codex') await this.permitted(source);
        content = alertContent(source, type, kind);
      }
    } catch { /* A missing title must not prevent a status alert. */ }
    const event = { id: randomUUID(), type, threadId, kind, at: Date.now(), ...content, ...(extra.target==='requests'?{target:'requests',preview:type==='approval'?'Une validation attend ta réponse dans la conversation.':'Une question attend ta réponse dans la conversation.'}:{}) };
    this.store.data.events.push(event);
    this.store.data.events = this.store.data.events.slice(-500);
    if (this.push?.enabled) for (const device of this.store.data.devices) this.store.data.pushJobs.push({ event, device, nextAt:0, attempts:0 });
    await this.store.save();
    this.alerts.emit('event', event);
    void this.flushPush().catch(() => { this.lastError = 'Envoi des notifications à réessayer'; });
    return event;
  }
  async flushPush() {
    if (!this.push?.enabled || this.pushBusy) return;
    this.pushBusy = true;
    try {
      for (const job of [...this.store.data.pushJobs]) {
        if (Date.now() - job.event.at > 86400000) { this.store.data.pushJobs = this.store.data.pushJobs.filter(j => j !== job); continue; }
        if (job.nextAt > Date.now()) continue;
        try {
          const result = await this.push.send(job.device, job.event);
          if (result?.invalid) {
            this.store.data.devices = this.store.data.devices.filter(d => d.token !== job.device.token);
            this.store.data.pushJobs = this.store.data.pushJobs.filter(j => j.device.token !== job.device.token);
          } else this.store.data.pushJobs = this.store.data.pushJobs.filter(j => j !== job);
        } catch {
          job.attempts++; job.nextAt = Date.now() + Math.min(900000, 20000 * 2 ** Math.min(job.attempts - 1, 6));
          this.lastError = 'Envoi des notifications à réessayer';
        }
      }
      await this.store.save();
      if (!this.store.data.pushJobs.length && this.lastError === 'Envoi des notifications à réessayer') this.lastError = '';
    } finally { this.pushBusy = false; }
  }
  async onRpc(m) {
    const p = m.params || {};
    if (m.id !== undefined) {
      if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(m.method)) {
        const key = randomUUID();
        const timer = setTimeout(() => this.decide(key, 'decline'), 600000);
        this.approvals.set(key, { key, rpcId: m.id, method: m.method, threadId: p.threadId,
          title: p.command || (p.reason || 'Modification de fichiers'), cwd: p.cwd || '', timer });
        await this.emit('approval', p.threadId, 'codex', null, {target:'requests'});
      } else if(['item/tool/requestUserInput','tool/requestUserInput'].includes(m.method)) {
        const key=randomUUID();
        const questions=Array.isArray(p.questions)?p.questions.slice(0,3):[];
        if(!questions.length){this.rpc.write({id:m.id,result:{answers:{}}});return;}
        const timer=setTimeout(()=>this.answerRequest(key,{},true),600000);
        this.approvals.set(key,{key,rpcId:m.id,method:m.method,threadId:p.threadId,type:'questions',title:'Réponse demandée',questions,timer});
        await this.emit('attention',p.threadId,'codex',null,{target:'requests'});
      } else {
        // Unknown interactive tool/input requests cannot be silently approved by a small client.
        this.rpc.write({ id: m.id, error: { code: -32601, message: 'Interaction non prise en charge par Codex Watch. Utiliser un client complet.' } });
        await this.emit('attention', p.threadId || '');
      }
    } else if(m.method==='serverRequest/resolved'){
      for(const[key,a]of this.approvals)if(a.rpcId===p.requestId){clearTimeout(a.timer);this.approvals.delete(key);}
    } else if (m.method === 'turn/started') {
      this.activeTurns.set(p.threadId, p.turn.id);
    } else if (m.method === 'turn/completed') {
      if (this.activeTurns.get(p.threadId) === p.turn.id) this.activeTurns.delete(p.threadId);
      await this.emit(p.turn.status === 'completed' ? 'completed' : p.turn.status === 'interrupted' ? 'interrupted' : 'failed', p.threadId);
    }
  }
  decide(key, decision) {
    const a = this.approvals.get(key);
    if (!a) throw new HttpError(410, 'Demande expirée');
    requireValue(a.type!=='questions','Cette demande attend une réponse.');
    clearTimeout(a.timer); this.approvals.delete(key);
    this.rpc.write({ id: a.rpcId, result: { decision } });
    return { ok: true };
  }
  answerRequest(key,answers,cancel=false){
    const a=this.approvals.get(key);if(!a)throw new HttpError(410,'Demande expirée');
    requireValue(a.type==='questions','Cette demande attend une décision.');
    const result={};
    if(!cancel)for(const q of a.questions){const value=answers?.[q.id];requireValue(typeof value==='string'&&value.trim().length>0&&value.length<=4000,'Réponds à chaque question.');result[q.id]={answers:[value.trim()]};}
    clearTimeout(a.timer);this.approvals.delete(key);this.rpc.write({id:a.rpcId,result:{answers:result}});return {ok:true};
  }
  async operation(key, fingerprint, action, metadata = {}) {
    requireValue(typeof key === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(key), 'Identifiant de demande requis');
    const existing = this.store.data.operations[key];
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new HttpError(409, 'Identifiant déjà utilisé pour une autre demande');
      if (existing.state === 'done') return existing.result;
      // A retry from the same running relay can share its original result. After a
      // restart or an unknown failure, never submit the operation a second time.
      if (existing.state === 'pending' && this.operationsInFlight.has(key)) return this.operationsInFlight.get(key);
      if (existing.state !== 'rejected') throw new HttpError(409, 'Demande déjà reçue. Vérifier la conversation avant de renvoyer.', 'SUBMISSION_UNCERTAIN');
    }
    const op = { ...metadata, state: 'pending', fingerprint, at: Date.now() };
    this.store.data.operations[key] = op;
    const running=(async()=>{
      await this.store.save();
      try { op.result = await action(); op.state = 'done'; await this.store.save(); return op.result; }
      catch (e) { op.state = e instanceof HttpError && e.status >= 400 && e.status < 500 ? 'rejected' : 'unknown'; await this.store.save(); throw e; }
    })();
    this.operationsInFlight.set(key,running);
    try{return await running;}finally{if(this.operationsInFlight.get(key)===running)this.operationsInFlight.delete(key);}
  }
  async pendingOperation(key) {
    requireValue(typeof key==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(key),'Identifiant de demande invalide');
    const op=this.store.data.operations[key];
    if(!op)throw new HttpError(404,'Demande inconnue sur ce relais');
    let input;try{input=JSON.parse(op.fingerprint);}catch{return {state:'unknown'};}
    const kind=input.kind||'codex';
    const waiting=()=>{
      const until=kind==='chatgpt'?this.nativeChatgpt?.cooldownUntil||0:0;
      return until>Date.now()?{state:'pending',kind,reason:'rate_limited',retryAfterSeconds:Math.ceil((until-Date.now())/1000)}:{state:'pending',kind};
    };
    if(op.result?.id)return {state:'ready',id:op.result.id,kind};
    if(op.state==='rejected')return {state:'rejected',kind};
    if(op.state==='unknown')return {state:'unknown',kind};
    if(op.state!=='done'||!op.result?.pending)return waiting();
    if(input.id||!['codex','chatgpt'].includes(kind))return {state:'unknown',kind};
    const collision=Object.entries(this.store.data.operations).some(([otherKey,other])=>{
      if(otherKey===key||!other.result?.pending||Math.abs(other.at-op.at)>120000)return false;
      try{const value=JSON.parse(other.fingerprint);return !value.id&&(value.kind||'codex')===kind&&(value.project||'')===(input.project||'')&&value.text===input.text;}catch{return false;}
    });
    if(collision)return {state:'ambiguous',kind};
    if(this.pendingLookups.has(key))return this.pendingLookups.get(key);
    const previous=this.pendingLookupAt.get(key)||{at:0,attempts:0};
    // Only while a creation is pending: keep detection responsive without
    // turning every watch or background poll into another desktop request.
    if(Date.now()-previous.at<Math.min(10000,2500*2**Math.min(previous.attempts,2)))return waiting();
    this.pendingLookupAt.set(key,{at:Date.now(),attempts:previous.attempts+1});
    if(this.pendingLookupAt.size>200)this.pendingLookupAt.delete(this.pendingLookupAt.keys().next().value);
    const lookup=(async()=>{
      try {
        const deadline=Date.now()+8000;
        const budget=ms=>Math.max(0,Math.min(ms,deadline-Date.now()));
        let candidates,hasMore=false;
        if(kind==='codex'){
          const project=this.project(input.project);
          const listing=await this.rpc.list({cwd:project.path,limit:30});candidates=listing.data;hasMore=!!listing.nextCursor;
        }else{
          if(!this.nativeChatgpt)return waiting();
          candidates=this.nativeChatgpt.recentCreationCandidates?await boundedLookup(this.nativeChatgpt.recentCreationCandidates(input.project||'',op.at),budget(1500)):null;
          if(candidates===LOOKUP_TIMEOUT)candidates=null;
          if(!candidates){
            if((this.nativeChatgpt.cooldownUntil||0)>Date.now())return waiting();
            const listing=await boundedLookup(this.nativeChatgpt.list({project:input.project||'',limit:30,fresh:true}),budget(3000));
            if(listing===LOOKUP_TIMEOUT)return waiting();
            if(listing.historyStale)return waiting();
            candidates=listing.data;hasMore=!!listing.nextCursor;
            candidates=candidates.filter(t=>(t.projectId||'')===(input.project||''));
          }
        }
        if(hasMore&&candidates.length&&recentPendingCandidate(candidates.at(-1),op.at))return {state:'ambiguous',kind};
        candidates=candidates.filter(t=>t.id&&recentPendingCandidate(t,op.at));
        if(candidates.length>8)return {state:'ambiguous',kind};
        const found=[];
        for(const candidate of candidates){
          if(kind==='chatgpt'&&deadline<=Date.now())return waiting();
          const request=kind==='codex'?this.read(candidate.id):this.nativeChatgpt.read(candidate.id,null,{live:true});
          const thread=kind==='codex'?await request:await boundedLookup(request,budget(3000));
          if(thread===LOOKUP_TIMEOUT)return waiting();
          if(thread.historyStale)return waiting();
          if(matchesPendingThread(thread,input.text,op.at)&&!found.includes(candidate.id))found.push(candidate.id);
          if(found.length>1)return {state:'ambiguous',kind};
        }
        if(!found.length)return waiting();
        op.result={...op.result,id:found[0],pending:false,mode:'created'};await this.store.save();
        return {state:'ready',id:found[0],kind};
      }catch{return waiting();}
    })().finally(()=>this.pendingLookups.delete(key));
    this.pendingLookups.set(key,lookup);return lookup;
  }
  async pollPendingCreations() {
    // A watch may sleep before it has identified the new chat. Resolve only
    // already-accepted operations; this never submits or creates a thread.
    const cutoff=Date.now()-24*60*60*1000;
    const pending=Object.entries(this.store.data.operations)
      .filter(([key,op])=>/^[a-zA-Z0-9-]{16,80}$/.test(key)&&op.state==='done'&&op.result?.pending&&op.at>=cutoff)
      .sort((a,b)=>b[1].at-a[1].at).slice(0,3);
    for(const [key] of pending)try{await this.pendingOperation(key);}catch{/* Retry on a later poll. */}
  }
  async route(method, url, body = {}, key, principal = null) {
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const [v, resource, id, action] = segments;
    if (v !== 'v1') throw new HttpError(404, 'Route inconnue');
    if(resource==='operations'&&id&&method==='GET'&&!action)return this.pendingOperation(id);
    if(resource==='live'&&id==='history'&&method==='GET'){
      const kind=url.searchParams.get('kind'),threadId=url.searchParams.get('threadId');requireValue(['codex','chatgpt'].includes(kind)&&!!threadId,'Chat requis');
      if(kind==='codex')await this.read(threadId);else if(this.planChat){if(!this.store.data.chats.some(c=>c.id===threadId&&c.kind==='chatgpt'))throw new HttpError(404,'Conversation introuvable');}else if(!this.nativeChatgpt)throw new HttpError(503,'ChatGPT indisponible');
      return {data:liveHistory(this.store,kind,threadId)};
    }
    if(resource==='models'&&method==='GET'){
      if(this.rpc.sharedDesktop)return {data:this.rpc.refreshModels?await this.rpc.refreshModels():this.rpc.models||[],source:'desktop',chatgptWritable:false};
      const result=await this.rpc.call('model/list',{limit:100});
      return {data:(result.data||[]).map(m=>({id:m.model||m.id,name:m.displayName||m.model||m.id,efforts:(m.supportedReasoningEfforts||[]).map(e=>e.reasoningEffort)})),source:'standalone',chatgptWritable:false};
    }
    if(resource==='plugins'){
      if(this.demo)throw new HttpError(409,'Gestion des plugins désactivée dans l’aperçu.');
      try{
        if(method==='GET'){
          const list=await this.plugins.list(url.searchParams.get('available')==='1');
          const query=(url.searchParams.get('q')||'').toLocaleLowerCase().slice(0,100),offset=Math.max(0,Number(url.searchParams.get('offset'))||0);
          const matches=list.available.filter(p=>!query||`${p.name} ${p.marketplace}`.toLocaleLowerCase().includes(query));
          return {...list,available:matches.slice(offset,offset+30),total:matches.length,nextOffset:offset+30<matches.length?offset+30:null};
        }
        if(method==='POST'&&id)return await this.plugins.change(id,body.action);
      }catch(e){if(e.status)throw new HttpError(e.status,e.message,e.code||'PLUGINS_UNAVAILABLE');throw new HttpError(503,'Catalogue de plugins temporairement indisponible. Les autres fonctions du relais restent accessibles.','PLUGINS_UNAVAILABLE');}
    }
    if (method === 'GET' && resource === 'live' && id === 'options') {
      if(!this.rpc.ready&&this.rpc.start)await this.rpc.start().catch(()=>{});
      const recent=this.lastRecents||{data:[],unavailable:[]};
      const chatProjects=this.nativeChatgpt?await this.nativeChatgpt.projects().catch(()=>[]):[];
      const budget=this.audio.status(),reason=this.demo?'DEMO':!this.audio.key()?'API_KEY_MISSING':!this.rpc.ready?'DESKTOP_UNAVAILABLE':budget.liveMaxSeconds<15?'BUDGET_REACHED':null;
      return {ready:!reason, reason, pluginSelection:true, pricePerMinuteUsd:.05, maxSeconds:budget.liveMaxSeconds??300,
        voices:['marin','cedar','coral','brise','sillage'], budget,
        projects:{codex:this.projects.map(p=>({id:p.id,name:p.name})),chatgpt:(this.nativeChatgpt||await this.planChat?.available())?[{id:'',name:'Sans projet'},...chatProjects]:[]},
        contexts:recent.data.filter(c=>['codex','chatgpt'].includes(c.kind)),unavailable:recent.unavailable};
    }
    if (resource === 'audio') {
      try {
        if (id === 'settings' && method === 'GET') return this.audio.status();
        if (id === 'settings' && method === 'PUT') return await this.audio.configure(body);
        if (id === 'mode' && method === 'PUT') return await this.audio.setMode(body.mode);
        if (id === 'auto-read-dictation' && method === 'PUT') return await this.audio.setAutoReadDictation(body.enabled);
        if (id === 'speed' && method === 'PUT') return await this.audio.setSpeechSpeed(body.mode,body.speed);
        if (id === 'openai-voice' && method === 'PUT') return await this.audio.setOpenaiVoice(body.voice);
        if (id === 'budget' && method === 'PUT') return await this.audio.setBudget(body.monthlyLimitCents);
        if (id === 'phonon-voice' && method === 'PUT') return await this.audio.setPhononVoice(body.voice);
        if (id === 'speech' && method === 'POST') {
          if (this.demo) return this.audio.fallback('DEMO','Aperçu : voix de la montre.');
          return await this.audio.speak(body.text);
        }
      } catch (e) { if (e.audioCode?.startsWith('INVALID_')) throw new HttpError(400,e.message,e.audioCode); throw e; }
      throw new HttpError(404, 'Route audio inconnue');
    }
    if (this.demo && method !== 'GET' && resource === 'threads') throw new HttpError(409, 'Démonstration : aucun envoi réel autorisé');
    if (method === 'GET' && resource === 'health') return { demo: this.demo, codex: this.rpc.ready,
      chat: !!(process.env.OPENAI_API_KEY && this.config.chatModel), chatgpt:!!(this.nativeChatgpt && this.rpc.ready) || !!(await this.planChat?.available()), chatgptMode:this.apiChat?'api':this.planChat?'plan':'desktop', audioKeyReady:!!this.audio.key(), codexAllProjects:!!this.rpc.sharedDesktop, push: !!this.push?.enabled,
      firebase: this.config.firebase, notifications:this.push?.enabled ? 'fcm' : 'direct', notice: this.lastError || '', unavailableProjects:this.unavailableProjectCount, chatHistory: 'app-only' };
    if (method === 'GET' && resource === 'recents') return this.recents();
    if (method === 'GET' && resource === 'projects') {
      if (url.searchParams.get('kind') === 'chatgpt') {
        if(this.planChat)return {data:[]};
        if (!this.nativeChatgpt) throw new HttpError(503, 'ChatGPT doit être connecté sur le PC');
        return {data:await this.nativeChatgpt.projects()};
      }
      return { data: this.projects.map(p => ({ id: p.id, name: p.name })) };
    }
    if (method === 'GET' && resource === 'events') return { data: this.store.data.events.filter(e => e.at >= Number(url.searchParams.get('since') || 0)) };
    if (method === 'POST' && resource === 'notifications' && id === 'test') {
      if (body.threadId) { requireValue(typeof body.threadId === 'string', 'Chat invalide'); await this.read(body.threadId); }
      return this.emit('test', body.threadId || '');
    }
    if (resource === 'devices' && method === 'POST') {
      requireValue(typeof body.token === 'string' && body.token.length > 20 && body.token.length < 4096, 'Jeton FCM invalide');
      requireValue(['pc', 'server'].includes(body.profile), 'Profil de montre requis');
      const prior=this.store.data.devices.find(d=>d.token===body.token&&d.profile===body.profile);
      if(prior){if(principal&&!principal.legacy)prior.watchId=principal.id;}
      else this.store.data.devices.push({ token: body.token, profile: body.profile,...(principal&&!principal.legacy?{watchId:principal.id}:{}) });
      this.store.data.devices = this.store.data.devices.slice(-10); await this.store.save(); return { ok: true };
    }
    if (resource === 'devices' && method === 'DELETE') {
      this.store.data.devices = this.store.data.devices.filter(d => d.token !== body.token || d.profile !== body.profile); await this.store.save(); return { ok: true };
    }
    if (resource === 'approvals' && method === 'GET' && !id) {
      // Reading the Windows accessibility tree can take several seconds.
      // Return the last verified snapshot immediately and refresh in background.
      void this.refreshDesktopQuestion();const q=this.desktopQuestion;
      const ui=q?{key:q.key,threadId:q.question.threadId,type:'questions',source:'desktop-ui',position:q.question.position,questions:[{id:'desktop-question',question:q.question.question,options:q.question.options.map(label=>({label}))}]}:null;
      return { desktop:!!this.rpc.sharedDesktop,canRespond:!this.rpc.sharedDesktop||!!ui,desktopPendingSupported:true,desktopPending:[...this.desktopPending.values()].filter(p=>Date.now()-p.seenAt<60000&&p.threadId!==q?.question.threadId),data:[...this.approvals.values()].map(({key,title,cwd,threadId,type,questions})=>({key,title,cwd,threadId,type:type||'approval',questions})).concat(ui?[ui]:[]) };
    }
    if (resource === 'approvals' && method === 'GET' && action === 'result') {
      const result=this.desktopAnswerResults.get(id);
      if(!result)throw new HttpError(404,'Confirmation indisponible. Vérifie la conversation avant de renvoyer.');
      return {state:result.state};
    }
    if (resource === 'approvals' && method === 'POST') {if(action==='answers'){
      if(body.asyncConfirm===true && (this.desktopQuestion?.key===id || this.desktopAnswerResults.has(id)))return this.startDesktopAnswer(id,body.answers,body.cancel===true);
      if(this.desktopQuestion?.key===id)return await this.answerDesktopQuestion(id,body.answers,body.cancel===true);return this.answerRequest(id,body.answers,body.cancel===true);
    }requireValue(['accept', 'decline'].includes(body.decision), 'Décision invalide'); return this.decide(id, body.decision); }
    const kind = url.searchParams.get('kind') || body.kind || 'codex';
    if (kind === 'chatgpt' && this.planChat) return this.chatRoute(method, resource, id, action, body, key, url,'chatgpt');
    if (kind === 'chatgpt') return this.chatgptRoute(method, resource, id, action, body, key, url);
    if (kind === 'chat') return this.chatRoute(method, resource, id, action, body, key, url);
    if (resource !== 'threads') throw new HttpError(404, 'Route inconnue');
    if(method==='POST'&&id&&action==='open'){
      await this.read(id);if(!this.rpc.sharedDesktop)throw new HttpError(409,'Ouverture disponible pour Codex PC.');
      await this.rpc.client.tool('navigate_to_codex_page',{threadId:id});return {ok:true};
    }
    if (method === 'GET' && !id) {
      const projectId = url.searchParams.get('project');
      const project = projectId ? this.project(projectId) : null;
      if (!project && !this.rpc.sharedDesktop) throw new HttpError(400,'Choisir un projet sur ce relais');
      const result = await this.rpc.call('thread/list', { cwd: project?.path || null, limit: 30,
        sortKey: 'updated_at', cursor: url.searchParams.get('cursor') || null, searchTerm: url.searchParams.get('q') || null,
        modelProviders: [], sourceKinds: ['cli', 'vscode', 'appServer', 'exec', 'unknown'] });
      return { data: result.data.map(summary), nextCursor: result.nextCursor };
    }
    if (method === 'GET' && id) {
      const thread = await this.read(id, url.searchParams.get('cursor'));
      if (!this.store.data.watched.includes(id)) { this.store.data.watched.push(id); this.store.data.watched = this.store.data.watched.slice(-30); await this.store.save(); }
      return { ...summary(thread), error:codexTurnError(thread), notice:thread.historyNotice||'', messages: messagesWithSubmissions(thread, 'codex', this.store.data.operations),
        historyCursor:thread.historyCursor || null, canInterrupt:!this.rpc.sharedDesktop && this.loaded.has(id),
        activeTurnId: this.activeTurns.get(id) || (thread.turns.at(-1)?.status === 'inProgress' ? thread.turns.at(-1).id : null) };
    }
    if (method === 'POST' && (!id || action === 'messages')) {
      let inference={};
      if(body.model||body.thinking){
        const models=this.rpc.sharedDesktop?this.rpc.models||[]:(await this.route('GET',new URL('http://localhost/v1/models'))).data;
        const choice=validateInference(body,models);
        inference=this.rpc.sharedDesktop?choice:{model:choice.model,...(choice.thinking?{effort:choice.thinking}:{})};
      }
      const text = await this.plugins.decorate(body.text?.trim(),body.plugins);
      requireValue(typeof text === 'string' && text.length > 0 && text.length <= 12000, 'Message vide ou trop long');
      if (id && this.busy.has(id)) throw new HttpError(409, 'Un envoi est en cours');
      if (id) this.busy.add(id);
      try {
        if (this.rpc.sharedDesktop) {
          const snapshot = id ? await this.read(id) : null;
          const project = id ? null : this.project(body.project);
          return await this.operation(key, JSON.stringify({ id, text, kind, project:body.project,...inference }), () =>
            this.rpc.send({ id, project, text, requestId:key,...inference }), {anchorMessageId:snapshot ? messagesFromThread(snapshot).at(-1)?.id : undefined});
        }
        return await this.operation(key, JSON.stringify({ id, text, kind, project: body.project,...inference }), async () => {
          let threadId = id;
          let mode = 'started';
          if (!id) {
            const project = this.project(body.project);
            const result = await this.rpc.call('thread/start', { cwd: project.path, approvalPolicy: 'on-request', sandbox: 'workspace-write', experimentalRawEvents: false, persistExtendedHistory: true });
            threadId = result.thread.id; this.loaded.add(threadId);
          } else {
            let thread = await this.read(id);
            if (!this.loaded.has(id)) {
              try {
                const resumed = await this.rpc.call('thread/resume', { threadId: id, approvalPolicy: 'on-request', sandbox: 'workspace-write', excludeTurns: true });
                thread = { ...thread, status: resumed.thread.status };
              } catch (e) {
                if (activeWriterError(e)) throw new HttpError(409, 'Cette conversation est détenue par Codex sur le PC. La connexion au même moteur est nécessaire pour y transmettre une consigne.', 'THREAD_IN_USE');
                throw e;
              }
              this.loaded.add(id);
            }
            const latest = thread.turns.at(-1);
            const activeTurnId = this.activeTurns.get(id) || (thread.status?.type === 'active' && latest?.status === 'inProgress' ? latest.id : null);
            if (activeTurnId) {
              const result = await this.rpc.call('turn/steer', { threadId: id, expectedTurnId: activeTurnId, input: [{ type: 'text', text }] });
              return { id, kind: 'codex', turnId: result.turnId, mode: 'steered' };
            }
            if (thread.status?.type === 'active') throw new HttpError(409, 'Le tour Codex démarre. Réessaie dans quelques secondes.', 'TURN_STARTING');
          }
          const result = await this.rpc.call('turn/start', { threadId, input: [{ type: 'text', text }],...inference });
          this.activeTurns.set(threadId, result.turn.id);
          return { id: threadId, kind: 'codex', turnId: result.turn.id, mode };
        });
      } finally { if (id) this.busy.delete(id); }
    }
    if (method === 'POST' && action === 'interrupt') {
      await this.read(id);
      requireValue(this.loaded.has(id), 'Seules les tâches lancées depuis ce relais peuvent être arrêtées ici');
      await this.rpc.call('turn/interrupt', { threadId: id, turnId: body.turnId }); return { ok: true };
    }
    throw new HttpError(404, 'Route inconnue');
  }
  async recents() {
    const jobs = [
      {kind:'codex',run:async () => {
        if (this.rpc.sharedDesktop) return (await this.rpc.call('thread/list',{cwd:null,limit:6,sortKey:'updated_at',modelProviders:[],sourceKinds:['cli','vscode','appServer','exec','unknown']})).data.map(summary);
        const lists = await Promise.all(this.projects.map(async p => {
          const result = await this.rpc.call('thread/list',{cwd:p.path,limit:3,sortKey:'updated_at'});
          const allowed = await Promise.all(result.data.map(async t => { try { await this.permitted(t); return {...summary(t),projectId:p.id,projectName:p.name}; } catch { return null; } }));
          return allowed.filter(Boolean);
        }));
        return lists.flat();
      }},
      ...(this.nativeChatgpt ? [{kind:'chatgpt',run:async () => {
        const [list,projects] = await Promise.all([this.nativeChatgpt.list({limit:6}),this.nativeChatgpt.projects()]);
        return list.data.map(t => ({id:t.id,kind:'chatgpt',title:t.title,status:t.status,updatedAt:t.updatedAt,projectId:t.projectId || '',projectName:projects.find(p=>p.id===t.projectId)?.name || ''}));
      }}] : [])
    ];
    const results = await Promise.allSettled(jobs.map(j=>j.run()));
    const data = results.flatMap(r=>r.status==='fulfilled'?r.value:[]);
    data.push(...this.store.data.chats.map(({id,title,status,updatedAt,kind})=>({id,title,status,updatedAt,kind:kind||'chat',projectId:'',projectName:''})));
    const time = v => typeof v==='number' ? v * (v < 1e12 ? 1000 : 1) : Date.parse(v) || 0;
    data.sort((a,b)=>time(b.updatedAt)-time(a.updatedAt));
    return this.lastRecents={data:data.slice(0,8),unavailable:jobs.filter((_,i)=>results[i].status==='rejected').map(j=>j.kind)};
  }
  async chatgptRoute(method, resource, id, action, body, key, url) {
    if (!this.nativeChatgpt) throw new HttpError(503, 'ChatGPT doit être connecté sur le PC');
    if (resource !== 'threads') throw new HttpError(404, 'Route inconnue');
    if (method === 'GET' && !id) return this.nativeChatgpt.list({project:url.searchParams.get('project') || '',q:url.searchParams.get('q') || '',cursor:url.searchParams.get('cursor')});
    if (method === 'GET' && id) {
      const thread = await this.nativeChatgpt.read(id,url.searchParams.get('cursor'),{live:url.searchParams.get('fresh')==='live'});
      if (!this.store.data.watchedChatgpt.includes(id)) { this.store.data.watchedChatgpt.push(id); this.store.data.watchedChatgpt = this.store.data.watchedChatgpt.slice(-30); await this.store.save(); }
      return {...summary(thread),kind:'chatgpt',messages:messagesWithSubmissions(thread,'chatgpt',this.store.data.operations),historyCursor:thread.historyCursor,historyStale:!!thread.historyStale,notice:thread.notice||'',canInterrupt:false};
    }
    if (method === 'POST' && (!id || action === 'messages')) {
      requireValue(typeof body.text === 'string' && body.text.trim().length > 0 && body.text.length <= 12000,'Message invalide');
      const text=await this.plugins.decorate(body.text.trim(),body.plugins);
      return this.operation(key,JSON.stringify({id,text,kind:'chatgpt',project:body.project}),() =>
        this.nativeChatgpt.send({id,project:body.project,text,requestId:key}));
    }
    throw new HttpError(404,'Route inconnue');
  }
  async chatRoute(method, resource, id, action, body, key, url, chatKind='chat') {
    if (resource !== 'threads') throw new HttpError(404, 'Route inconnue');
    if (method === 'GET' && !id) {
      const q = (url.searchParams.get('q') || '').toLocaleLowerCase();
      const start = Math.max(0, Number.parseInt(url.searchParams.get('cursor') || '0', 10) || 0);
      const list = this.store.data.chats.filter(c => (c.kind||'chat')===chatKind && c.title.toLocaleLowerCase().includes(q)).sort((a, b) => b.updatedAt - a.updatedAt);
      return { data: list.slice(start, start + 30).map(({ messages, ...c }) => c), nextCursor: start + 30 < list.length ? String(start + 30) : null };
    }
    let chat = this.store.data.chats.find(c => c.id === id && (c.kind||'chat')===chatKind);
    if (id && !chat) throw new HttpError(404, 'Conversation introuvable');
    if (method === 'GET') return chat.status==='failed' ? chat : {...chat,error:''};
    if (method === 'POST' && (!id || action === 'messages')) {
      if (chatKind==='chatgpt' ? !(await this.planChat.available()) : (!process.env.OPENAI_API_KEY || !this.config.chatModel)) throw new HttpError(503, chatKind==='chatgpt'?(this.apiChat?'Configure la clé API du Chat sur le serveur.':'Connecte ChatGPT depuis le relais PC.'):'Assistant à configurer sur le relais (clé API et modèle)');
      if(chatKind==='chatgpt'&&Array.isArray(body.plugins)&&body.plugins.length)throw new HttpError(400,'Les plugins ChatGPT ne sont pas disponibles dans ce chat.');
      requireValue(typeof body.text === 'string' && body.text.trim().length > 0 && body.text.length <= 12000, 'Message invalide');
      if (chat?.status === 'active') throw new HttpError(409, 'Réponse en cours');
      return this.operation(key, JSON.stringify({ id, text: body.text, kind: chatKind }), async () => {
        if (!chat) { chat = { id: randomUUID(), kind: chatKind, title: body.text.slice(0, 70), status: 'idle', messages: [] }; this.store.data.chats.push(chat); }
        chat.messages.push({ id: randomUUID(), role: 'user', text: body.text.trim() });
        chat.status = 'active'; delete chat.error; chat.updatedAt = Date.now() / 1000; await this.store.save();
        // Acceptance is immediate: a lost watch connection does not abort inference or replay it.
        this.answer(chat).catch(() => {});
        return { id: chat.id, kind: chatKind };
      });
    }
    throw new HttpError(404, 'Route inconnue');
  }
  async answer(chat) {
    try {
      if(chat.kind==='chatgpt'&&this.planChat){
        const text=await this.planChat.answer(chat.messages);chat.messages.push({id:randomUUID(),role:'assistant',text});chat.status='idle';chat.updatedAt=Date.now()/1000;
        await this.emit('completed',chat.id,'chatgpt');await this.store.save();return;
      }
      const response = await this.fetcher('https://api.openai.com/v1/responses', { method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.config.chatModel, store: false, max_output_tokens:2048,
          ...(this.config.chatReasoningEffort ? {reasoning:{effort:this.config.chatReasoningEffort}} : {}),
          instructions: 'Réponds dans la langue de la personne, de manière concise et utile. Les réponses sont lues sur une montre. Tu es un assistant personnel accessible via l’API OpenAI.',
          input: chat.messages.filter(m => ['user', 'assistant'].includes(m.role)).map(m => ({ role: m.role, content: m.text })) }), signal: AbortSignal.timeout(180000) });
      if (!response.ok) throw new Error('Réponse OpenAI indisponible (HTTP ' + response.status + ')');
      const result = await response.json();
      const text = (result.output || []).filter(i => i.type === 'message').flatMap(i => i.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('\n');
      if (!text) throw new Error('Aucune réponse textuelle reçue');
      chat.messages.push({ id: randomUUID(), role: 'assistant', text }); chat.status = 'idle';
      await this.emit('completed', chat.id, 'chat');
    } catch (e) {
      chat.status = 'failed'; chat.error = e.message; await this.emit('failed', chat.id, chat.kind||'chat');
    }
    await this.store.save();
  }
  async pollWatched(alreadyRead = new Set()) {
    // External desktop turns are inspected without resuming them or attaching a second agent.
    for (const id of this.store.data.watched) {
      if (alreadyRead.has(id)) continue;
      if (this.loaded.has(id)) continue;
      try {
        const thread = await this.read(id), turn = thread.turns.at(-1);await this.observeDesktopAttention(thread);
        if (!turn) continue;
        const fingerprint = turn.id + ':' + turn.status, previous = this.observed.get(id);
        this.observed.set(id, fingerprint);
        if (previous && previous !== fingerprint && ['completed','failed','interrupted'].includes(turn.status)) await this.emit(turn.status, id, 'codex', thread);
      } catch { /* Deleted, inaccessible or newer-format desktop threads are skipped. */ }
    }
  }
  async pollProjects() {
    // Monitor recent tasks in every authorized project, including tasks never opened on the watch.
    // A first baseline avoids notifying about all historic completions when the relay starts.
    const candidates = this.rpc.recentThreads ? await this.rpc.recentThreads() : [];
    void this.refreshDesktopQuestion(candidates);
    for (const p of this.rpc.recentThreads ? [] : this.projects) {
      const result = await this.rpc.call('thread/list', { cwd: p.path, limit: 30, sortKey: 'updated_at', modelProviders: [],
        sourceKinds: ['cli', 'vscode', 'appServer', 'exec', 'unknown'] });
      candidates.push(...result.data);
    }
    const alreadyRead=new Set();
    for (const t of candidates) {
      if (this.loaded.has(t.id)) continue;
      const metadata = `${t.updatedAt}:${t.status?.type}`;
      const previous = this.observed.get('meta:' + t.id);
        if (previous === metadata && !this.observed.get(t.id)?.endsWith(':inProgress')) continue;
      try {
        const thread = await this.read(t.id), turn = thread.turns.at(-1);alreadyRead.add(t.id);await this.observeDesktopAttention(thread);
        if (!turn) continue;
        const fingerprint = turn.id + ':' + turn.status, previousTurn = this.observed.get(t.id);
        this.observed.set(t.id, fingerprint); this.observed.set('meta:' + t.id, metadata);
        if (this.monitorReady && fingerprint !== previousTurn && ['completed','failed','interrupted'].includes(turn.status)) await this.emit(turn.status, t.id, 'codex', thread);
      } catch { /* A newer desktop thread format may require an updated CLI. */ }
    }
    this.monitorReady = true;
    await this.pollWatched(alreadyRead);
    await this.pollPendingCreations();
    if (this.nativeChatgpt) for (const id of this.nativeChatgpt.pollCandidates?await this.nativeChatgpt.pollCandidates(this.store.data.watchedChatgpt):this.store.data.watchedChatgpt) try {
      const thread = await this.nativeChatgpt.read(id), turn = thread.turns.at(-1);
      if(thread.historyStale)continue;
      if (!turn) continue;
      const key = 'chatgpt:' + id, fingerprint = turn.id + ':' + turn.status, previous = this.observed.get(key);
      this.observed.set(key,fingerprint);
      if (previous && previous !== fingerprint && ['completed','failed','interrupted'].includes(turn.status)) await this.emit(turn.status,id,'chatgpt',thread);
    } catch { /* An inaccessible ChatGPT chat is not resumed or copied. */ }
  }
  close() { this.audio?.phonon?.close(); this.alerts.emit('close'); for (const a of this.approvals.values()) { clearTimeout(a.timer); this.rpc.write({ id: a.rpcId, result: a.type==='questions'?{answers:{}}:{ decision: 'decline' } }); } this.rpc.stop(); }
}
