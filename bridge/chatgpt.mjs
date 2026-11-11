import {mergeTurns} from './transcript.mjs';
import {completeRecentCandidates} from './pending-thread.mjs';
// Reuse the signed-in desktop's ChatGPT interface. No browser cookie or second agent.
export class NativeChatgpt {
  histories = new Map();
  snapshots = new Map();
  following=new Map();metadata=new Map();pendingReads=new Map();pollMetadata=new Map();cooldownUntil=0;rateFailures=0;
  constructor(client,{store=null}={}) { this.client = client;this.store=store;for(const[id,row]of Object.entries(store?.data.chatgptSnapshots||{})){this.snapshots.set(id,row);this.metadata.set(id,row.value);} }
  isLimited(e){return e.status===429||/rate.?limit|too many requests|429/i.test(e.message);}
  limited(source='other'){if(!(source==='list'&&this.cooldownUntil>Date.now()&&this.limitSource!=='list'))this.limitSource=source;this.cooldownUntil=Date.now()+Math.min(300000,60000*2**this.rateFailures++);}
  limitError(){return Object.assign(Error('ChatGPT limite temporairement ses requêtes. Réessaie dans une minute.'),{status:429,code:'CHATGPT_RATE_LIMITED'});}
  async projects() {
    if(this.projectCache&&Date.now()-this.projectCache.at<120000)return this.projectCache.data;
    if(Date.now()<this.cooldownUntil){if(this.projectCache)return this.projectCache.data;throw this.limitError();}
    if(this.pendingProjects)return this.pendingProjects;
    this.pendingProjects=this.client.tool('list_projects',{}).then(result=>{const data=(result.projects||[]).filter(p=>p.projectKind==='chatgpt').map(p=>({id:p.projectId,name:p.label}));this.projectCache={at:Date.now(),data};return data;}).catch(e=>{if(!this.isLimited(e))throw e;this.limited();if(this.projectCache)return this.projectCache.data;throw this.limitError();}).finally(()=>{this.pendingProjects=null;});return this.pendingProjects;
  }
  async validateProject(id) {
    if (id && !(await this.projects()).some(p => p.id === id)) throw new Error('Projet ChatGPT inaccessible');
  }
  async list(options={}){
    const key=JSON.stringify([options.project||'',options.cursor||null,options.q||'',options.limit||30]);
    this.listCache||=new Map();this.pendingLists||=new Map();const old=this.listCache.get(key);
    if(!options.fresh&&old&&Date.now()-old.at<20000)return old.value;
    const fallback=()=>{if(old)return {...old.value,historyStale:true};throw this.limitError();};
    if(Date.now()<this.cooldownUntil)return fallback();
    if(this.pendingLists.has(key))return this.pendingLists.get(key);
    const pending=this.listPage(options).then(value=>{if(Date.now()>=this.cooldownUntil){this.rateFailures=0;this.cooldownUntil=0;}this.listCache.delete(key);this.listCache.set(key,{at:Date.now(),value});for(const k of [...this.listCache.keys()].slice(0,-20))this.listCache.delete(k);return value;}).catch(e=>{if(!this.isLimited(e))throw e;this.limited('list');return fallback();}).finally(()=>this.pendingLists.delete(key));this.pendingLists.set(key,pending);return pending;
  }
  async recentCreationCandidates(project,submittedAt){
    if(this.recentCreationUntil>Date.now())return null;
    if(!this.recentCreationCache||Date.now()-this.recentCreationCache.at>5000){
      if(!this.pendingRecentCreation)this.pendingRecentCreation=this.client.tool('list_threads',{mode:'recent',limit:50}).then(value=>{this.recentCreationCache={at:Date.now(),value};return value;}).catch(e=>{if(!this.isLimited(e))throw e;this.recentCreationUntil=Date.now()+60000;if(Date.now()>=this.cooldownUntil)this.limited('other');return null;}).finally(()=>{this.pendingRecentCreation=null;});
      if(!await this.pendingRecentCreation)return null;
    }
    return completeRecentCandidates(this.recentCreationCache.value,'chatgpt',project,submittedAt);
  }
  async listPage({project = '', cursor = null, q = '', limit = 30} = {}) {
    await this.validateProject(project);
    let pageCursor = null, skip = 0;
    if (cursor) {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      if (decoded.kind !== 'chatgpt' || decoded.project !== project || decoded.q !== q) throw new Error('Pagination ChatGPT invalide');
      pageCursor = decoded.cursor; skip = decoded.skip;
    }
    const data = []; let next = null;
    for (let page = 0; page < 3; page++) {
      const result = await this.client.tool('list_threads', {mode:'history',source:'chatgpt',limit:50,...(pageCursor ? {cursor:pageCursor} : {})});
      const matching = (result.threads || []).filter(t => t.kind === 'chatgpt' && (!project || t.projectId === project) &&
        (!q || t.title?.toLocaleLowerCase().includes(q.toLocaleLowerCase())));
      for(const t of result.threads||[])if(t.kind==='chatgpt')this.metadata.set(t.id,t);
      const remaining = matching.slice(skip), take = Math.min(limit - data.length, remaining.length);
      data.push(...remaining.slice(0, take).map(t => ({...t,kind:'chatgpt',status:t.status?.type || t.status || 'idle'})));
      if (take < remaining.length) { next = {cursor:pageCursor,skip:skip + take}; break; }
      pageCursor = result.nextCursor; skip = 0;
      if (!pageCursor) break;
      if (data.length === limit || page === 2) { next = {cursor:pageCursor,skip:0}; break; }
    }
    return {data,nextCursor:next ? Buffer.from(JSON.stringify({...next,kind:'chatgpt',project,q})).toString('base64url') : null};
  }
  async read(id, cursor = null, {live=false}={}) {
    const key=id+':'+(cursor||'');
    const recent=this.snapshots.get(id);
    if(!cursor&&recent&&Date.now()-recent.at<(live||this.following.get(id)>Date.now()?1800:10000))return recent.value;
    const fallback=()=>{
      const value=this.snapshots.get(id)?.value,metadata=this.metadata.get(id);
      if(!cursor&&(value||metadata))return {...(value||{...metadata,name:metadata.title,turns:[],status:{type:metadata.status?.type||metadata.status||'idle'}}),historyStale:true,notice:'Lecture de l’historique temporairement limitée par ChatGPT. Les messages déjà reçus restent visibles. Réessaie plus tard.'};
      throw Object.assign(Error('ChatGPT limite temporairement la lecture de cet historique. Réessaie dans une minute.'),{status:429,code:'CHATGPT_RATE_LIMITED'});
    };
    if(Date.now()<this.cooldownUntil&&this.limitSource!=='list')return fallback();
    if(this.pendingReads.has(key))return this.pendingReads.get(key);
    const request=this.fetchHistory(id,cursor).then(value=>{if(Date.now()>=this.cooldownUntil){this.rateFailures=0;this.cooldownUntil=0;}return value;}).catch(e=>{
      if(!this.isLimited(e))throw e;
      this.limited('read');return fallback();
    }).finally(()=>this.pendingReads.delete(key));
    this.pendingReads.set(key,request);return request;
  }
  async fetchHistory(id,cursor=null){
    const recent=this.snapshots.get(id);
    const result = await this.client.tool('read_thread', {threadId:id,turnLimit:10,includeOutputs:false,maxOutputCharsPerItem:20000,...(cursor ? {cursor} : {})});
    if (result.thread?.kind !== 'chatgpt') throw new Error('Cette conversation ne provient pas de ChatGPT');
    const incoming = [...(result.turns || [])].reverse(), cached = this.histories.get(id);
    const turns = mergeTurns(cursor ? incoming : cached?.turns || [],cursor ? cached?.turns || [] : incoming);
    const historyCursor = !cached || cursor ? result.page?.nextCursor : cached.cursor;
    this.histories.set(id, {turns,cursor:historyCursor || null});
    const status = turns.at(-1)?.status === 'inProgress' ? 'active' : result.thread.status?.type || result.thread.status || 'idle';
    const value={...result.thread,name:result.thread.title,status:{type:status},turns,historyCursor:historyCursor || null};
    this.snapshots.set(id,{at:Date.now(),value});
    this.metadata.set(id,value);
    if(this.store){
      const safe={...value,turns:value.turns.slice(-10).map(t=>({...t,items:(t.items||[]).filter(i=>['userMessage','agentMessage'].includes(i.type))}))};
      const data=this.store.data.chatgptSnapshots||={};delete data[id];data[id]={at:Date.now(),value:safe};for(const key of Object.keys(data).slice(0,-10))delete data[key];await this.store.save();
    }
    return value;
  }
  async pollCandidates(ids){
    if(!ids.length)return [];
    if(Date.now()<this.cooldownUntil)return [];
    const now=Date.now(),active=ids.some(id=>(this.following.get(id)||0)>now)||this.lastPollActive;
    if(now-(this.lastPollAt||0)<(active?20000:120000))return [];
    this.lastPollAt=now;
    const list=await this.list({limit:50}),result=[];if(list.historyStale)return [];
    for(const t of list.data)if(ids.includes(t.id)){
      const meta=JSON.stringify([t.updatedAt,t.status]),previous=this.pollMetadata.get(t.id);this.pollMetadata.set(t.id,meta);
      if(['active','inProgress'].includes(t.status)||previous!==undefined&&previous!==meta)result.push(t.id);
    }
    this.lastPollActive=list.data.some(t=>ids.includes(t.id)&&['active','inProgress'].includes(t.status));return result;
  }
  async send({id,project,text,requestId}) {
    if (id) {
      if(!this.metadata.has(id))await this.read(id);
      await this.client.tool('send_message_to_thread',{threadId:id,prompt:text},requestId);
      const old=this.snapshots.get(id);if(old)old.at=0;this.following.delete(id);this.following.set(id,Date.now()+120000);for(const key of [...this.following.keys()].slice(0,-30))this.following.delete(key);
      return {id,kind:'chatgpt',mode:'forwarded'};
    }
    await this.validateProject(project);
    const result = await this.client.tool('create_thread',{prompt:text,target:{type:'chatgptWorkCloud',...(project ? {projectId:project} : {})}},requestId);
    const threadId = result.threadId || result.thread?.id;
    if (threadId) return {id:threadId,kind:'chatgpt',mode:'created'};
    if (result.clientThreadId) return {kind:'chatgpt',mode:'preparing',pending:true,clientThreadId:result.clientThreadId};
    throw new Error('Création ChatGPT non confirmée. Vérifier la conversation avant de renvoyer.');
  }
}
