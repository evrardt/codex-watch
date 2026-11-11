import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Service, authenticate, messagesFromThread } from '../service.mjs';
import { createHttpServer } from '../server.mjs';
import { Store } from '../store.mjs';
import { CodexRpcError } from '../rpc.mjs';

const root = path.resolve('.');
const token = 'a'.repeat(43);
const idempotency = '12345678-1234-1234-1234-123456789abc';
class Rpc extends EventEmitter {
  ready = true; calls = []; writes = [];
  thread = { id: 'thread-1', cwd: root, name: 'Test', status: { type: 'idle' }, turns: [] };
  async call(method, params) {
    this.calls.push({ method, params });
    if (method === 'thread/list') return { data: [this.thread], nextCursor: 'next-page' };
    if (['thread/start', 'thread/read', 'thread/resume'].includes(method)) return { thread: structuredClone(this.thread) };
    if (method === 'turn/start') return { turn: { id: 'turn-1' } };
    return {};
  }
  write(m) { this.writes.push(m); }
  stop() {}
}
async function setup(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'codexwatch-test-'));
  const store = new Store(path.join(dir, 'state.json')); await store.load();
  const rpc = new Rpc();
  const service = new Service({ rpc, store, config: { projects: [{ id: 'project', name: 'Test', path: root }], chatModel: 'test-only' }, push: { enabled: false, send: async () => {} } });
  await service.initialize();
  t.after(async () => { service.close(); await store.queue; assert.ok(path.basename(dir).startsWith('codexwatch-test-')); await rm(dir, { recursive: true, force: true }); });
  return { service, store, rpc, dir };
}
const url = p => new URL('http://localhost' + p);
test('failed Codex turns expose a safe, actionable error rather than an empty conversation',async t=>{
 const {service,rpc}=await setup(t);
 rpc.thread.status={type:'systemError'};
 rpc.thread.turns=[{id:'failed-turn',status:'failed',error:{message:'Your workspace is out of credits. Add credits to continue.',codexErrorInfo:'usage_limit_exceeded'},items:[]}];
 let detail=await service.route('GET',url('/v1/threads/thread-1'));
 assert.match(detail.error,/Crédits Codex épuisés/);
 rpc.thread.turns[0].error={message:'internal secret sk-private-example'};
 detail=await service.route('GET',url('/v1/threads/thread-1'));
 assert.match(detail.error,/échoué/);assert.doesNotMatch(detail.error,/sk-private/);
 rpc.thread.status={type:'active'};rpc.thread.turns.push({id:'next',status:'inProgress',items:[]});
 detail=await service.route('GET',url('/v1/threads/thread-1'));assert.equal(detail.error,'');
});
test('health reports whether the audio key is loaded without exposing its value',async t=>{
 const {service}=await setup(t);service.audio.key=()=> 'sk-test-secret';const health=await service.route('GET',url('/v1/health'));
 assert.equal(health.audioKeyReady,true);assert.ok(!JSON.stringify(health).includes('sk-test-secret'));service.audio.key=()=>'';assert.equal((await service.route('GET',url('/v1/health'))).audioKeyReady,false);
});
test('standalone plan chat is separate, opens immediately and returns the saved answer',async t=>{
 const {service,store}=await setup(t);service.planChat={available:async()=>true,answer:async messages=>'Bonjour '+messages.at(-1).text};
 assert.equal((await service.route('GET',url('/v1/health'))).chatgptMode,'plan');
 assert.deepEqual((await service.route('GET',url('/v1/projects?kind=chatgpt'))).data,[]);
 const created=await service.route('POST',url('/v1/threads'),{kind:'chatgpt',text:'toi'},idempotency);
 assert.equal(created.kind,'chatgpt');assert.ok(created.id);
 for(let i=0;i<50&&store.data.chats[0].status==='active';i++)await new Promise(r=>setTimeout(r,10));
 const chat=await service.route('GET',url('/v1/threads/'+created.id+'?kind=chatgpt'));
 assert.equal(chat.messages.at(-1).text,'Bonjour toi');assert.equal(chat.status,'idle');
 assert.equal((await service.route('GET',url('/v1/threads?kind=chatgpt'))).data.length,1);
 assert.equal((await service.route('GET',url('/v1/threads?kind=chat'))).data.length,0);
 assert.equal((await service.route('GET',url('/v1/recents'))).data.some(x=>x.id===created.id&&x.kind==='chatgpt'),true);
});
test('a successful retry clears a prior Chat error while preserving the conversation',async t=>{
 const {service,store}=await setup(t);let fail=true;service.planChat={available:async()=>true,answer:async()=>{if(fail)throw Error('Crédits épuisés');return 'OK';}};
 const created=await service.route('POST',url('/v1/threads'),{kind:'chatgpt',text:'Bonjour'},idempotency);
 for(let i=0;i<50&&store.data.chats[0].status==='active';i++)await new Promise(r=>setTimeout(r,10));
 assert.equal((await service.route('GET',url('/v1/threads/'+created.id+'?kind=chatgpt'))).status,'failed');
 fail=false;await service.route('POST',url('/v1/threads/'+created.id+'/messages?kind=chatgpt'),{text:'Encore'},'retry-request-id-123456789');
 for(let i=0;i<50&&store.data.chats[0].status==='active';i++)await new Promise(r=>setTimeout(r,10));
 const detail=await service.route('GET',url('/v1/threads/'+created.id+'?kind=chatgpt'));assert.equal(detail.error,'');assert.equal(detail.messages.at(-1).text,'OK');
});
test('API chat is standalone only, creates once before the answer and preserves the PC route',async t=>{
 const {service,store,rpc,dir}=await setup(t);service.config.apiChat=true;await service.initialize();
 let finish;service.apiChat.available=async()=>true;service.apiChat.answer=()=>new Promise(resolve=>{finish=resolve;});
 assert.equal((await service.route('GET',url('/v1/health'))).chatgptMode,'api');
 const created=await service.route('POST',url('/v1/threads'),{kind:'chatgpt',text:'Bonjour'},idempotency);
 const duplicate=await service.route('POST',url('/v1/threads'),{kind:'chatgpt',text:'Bonjour'},idempotency);
 assert.equal(created.id,duplicate.id);assert.equal(store.data.chats.length,1);assert.equal(store.data.chats[0].status,'active');
 finish('Salut');for(let i=0;i<50&&store.data.chats[0].status==='active';i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(store.data.chats[0].messages.at(-1).text,'Salut');
 rpc.sharedDesktop=true;service.config.chatgptDesktop=true;rpc.client={};await service.initialize();
 assert.equal(service.apiChat,null);assert.ok(service.nativeChatgpt);assert.equal((await service.route('GET',url('/v1/health'))).chatgptMode,'desktop');
});
test('VPS audio uses its API key only after explicit opt-in',async t=>{
 const {service,dir}=await setup(t);service.config.apiChat=true;await writeFile(path.join(dir,'openai-api-key.txt'),'sk-fake-test-key');await service.initialize();
 assert.equal(service.audio.status().ready,false);service.audio.state.settings.vpsKeyEnabled=true;assert.equal(service.audio.status().ready,true);
 service.audio.state.settings.vpsKeyEnabled=false;assert.equal(service.audio.status().ready,false);
});
test('an unavailable authorized project does not prevent the relay or accessible projects from starting',async t=>{
 const {service,dir}=await setup(t);service.config.projects.push({id:'missing',name:'Absent',path:path.join(dir,'not-present')});
 await service.initialize();assert.equal(service.projects.length,1);assert.equal(service.projects[0].id,'project');
 assert.equal((await service.route('GET',url('/v1/health'))).unavailableProjects,1);
 assert.throws(()=>service.project('missing'),/non autorisé/);assert.equal(service.config.projects.length,2);
});
test('desktop inference overrides remain in the same chat and invalid choices never submit',async t=>{
 const {service,rpc}=await setup(t);rpc.sharedDesktop=true;rpc.models=[{id:'host-model',efforts:['high']}];const sends=[];rpc.send=async p=>{sends.push(p);return{id:p.id,mode:'forwarded'};};
 await service.route('POST',url('/v1/threads/thread-1/messages'),{text:'Instruction',model:'host-model',thinking:'high'},idempotency);
 assert.equal(sends.length,1);assert.equal(sends[0].id,'thread-1');assert.equal(sends[0].model,'host-model');assert.equal(sends[0].thinking,'high');
 await assert.rejects(service.route('POST',url('/v1/threads/thread-1/messages'),{text:'Instruction',model:'host-model',thinking:'ultra'},'different-request-id-12345'));assert.equal(sends.length,1);
});
test('interactive answers use protocol question ids and cannot approve command requests',async t=>{
 const {service,rpc,store}=await setup(t);await service.onRpc({id:500,method:'item/tool/requestUserInput',params:{threadId:'thread-1',questions:[{id:'choice',question:'Quel choix ?',options:[{label:'Un'}]}]}});
 assert.equal(store.data.events.at(-1).target,'requests');
 const pending=(await service.route('GET',url('/v1/approvals'))).data[0];assert.equal(pending.type,'questions');assert.throws(()=>service.decide(pending.key,'accept'));assert.throws(()=>service.answerRequest(pending.key,{}));service.answerRequest(pending.key,{choice:'Une réponse libre'});assert.deepEqual(rpc.writes.at(-1),{id:500,result:{answers:{choice:{answers:['Une réponse libre']}}}});assert.throws(()=>service.answerRequest(pending.key,{choice:'Un'}));
});

test('visible PC questions are delivered once and an uncertain answer is never retried',async t=>{
 const {service,rpc,store}=await setup(t);rpc.sharedDesktop=true;
 let question={threadId:'thread-1',identity:'1:2:3',title:'Test',question:'Continuer ?',position:'1 of 2',options:['Oui','Non']};
 rpc.recentThreads=async()=>[{id:'thread-1'}];rpc.readDesktopQuestion=async()=>question;
 let attempts=0;rpc.answerDesktopQuestion=async()=>{attempts++;throw Error('Envoi non confirmé. Vérifie sur le PC avant de recommencer.');};
 await service.refreshDesktopQuestion();let result=await service.route('GET',url('/v1/approvals'));assert.equal(result.data.length,1);assert.equal(result.data[0].source,'desktop-ui');assert.equal(result.data[0].questions[0].question,'Continuer ?');
 assert.equal(JSON.stringify(result).includes('1:2:3'),false);const key=result.data[0].key;
 assert.equal(store.data.events.at(-1).target,'requests');
 await assert.rejects(service.route('POST',url('/v1/approvals/'+key+'/answers'),{answers:{'desktop-question':'Oui'}}),/non confirmé/);
 assert.equal(attempts,1);service.desktopQuestionCheckedAt=0;result=await service.route('GET',url('/v1/approvals'));assert.equal(result.data.length,0);assert.equal(attempts,1);
 const original=question;question=null;service.desktopQuestionCheckedAt=0;await service.refreshDesktopQuestion();question=original;service.desktopQuestionCheckedAt=0;await service.refreshDesktopQuestion();result=await service.route('GET',url('/v1/approvals'));assert.equal(result.data.length,0);
 question={...question,question:'Autre question ?',position:'2 of 2'};service.desktopQuestionCheckedAt=0;await service.refreshDesktopQuestion();result=await service.route('GET',url('/v1/approvals'));assert.equal(result.data.length,1);
 assert.equal(store.data.events.filter(e=>e.type==='attention').length,2);
});

test('pending desktop question reads do not block the watch',async t=>{
 const {service,rpc}=await setup(t);rpc.sharedDesktop=true;rpc.recentThreads=async()=>[];
 let release;rpc.readDesktopQuestion=()=>new Promise(resolve=>{release=resolve;});
 const result=await Promise.race([service.route('GET',url('/v1/approvals')),new Promise((_,reject)=>setTimeout(()=>reject(Error('watch blocked')),250))]);
 assert.deepEqual(result.data,[]);await new Promise(resolve=>setImmediate(resolve));release(null);await service.desktopQuestionRefresh;
});

test('a form closed after selection is confirmed only by a new matching structured reply',async t=>{
 const {service,rpc}=await setup(t);rpc.sharedDesktop=true;
 const q={threadId:'thread-1',identity:'1:2:3',title:'Test',question:'Quelle option ?',position:'',options:['Oui']};
 rpc.recentThreads=async()=>[{id:'thread-1'}];rpc.readDesktopQuestion=async()=>q;
 const wrap=(id,question,answer)=>({id,type:'userMessage',content:[{type:'text',text:'<send_user_message_question_reply>'+JSON.stringify([{question,answer}])+'</send_user_message_question_reply>'}]});
 rpc.thread.turns=[{id:'turn',items:[wrap('old','Quelle option ?','Oui')]}];let sends=0;
 rpc.answerDesktopQuestion=async()=>{sends++;rpc.thread.turns[0].items.push(wrap('new','Quelle option ?','Oui'));throw Object.assign(Error('Envoi non confirmé.'),{code:'DESKTOP_FORM_CLOSED_AFTER_INPUT'});};
 await service.refreshDesktopQuestion();const pending=(await service.route('GET',url('/v1/approvals'))).data[0];
 assert.deepEqual(await service.route('POST',url('/v1/approvals/'+pending.key+'/answers'),{answers:{'desktop-question':'Oui'}}),{ok:true});assert.equal(sends,1);
});

test('desktop answer acknowledges before verifying and never submits twice',async t=>{
 const {service,rpc}=await setup(t);rpc.sharedDesktop=true;
 const q={threadId:'thread-1',identity:'1:2:3',title:'Test',question:'Quelle option ?',position:'',options:['Oui']};
 rpc.recentThreads=async()=>[{id:'thread-1'}];rpc.readDesktopQuestion=async()=>q;rpc.thread.turns=[{id:'turn',items:[]}];
 let sends=0;rpc.answerDesktopQuestion=async()=>{sends++;rpc.thread.turns[0].items.push({id:'new',type:'userMessage',content:[{type:'text',text:'<send_user_message_question_reply>'+JSON.stringify([{question:q.question,answer:'Oui'}])+'</send_user_message_question_reply>'}]});throw Object.assign(Error('Envoi non confirmé.'),{code:'DESKTOP_FORM_CLOSED_AFTER_INPUT'});};
 await service.refreshDesktopQuestion();const key=(await service.route('GET',url('/v1/approvals'))).data[0].key;
 const body={answers:{'desktop-question':'Oui'},asyncConfirm:true};
 assert.deepEqual(await service.route('POST',url('/v1/approvals/'+key+'/answers'),body),{pending:true});
 assert.deepEqual(await service.route('POST',url('/v1/approvals/'+key+'/answers'),body),{pending:true});
 for(let i=0;i<100&&service.desktopAnswerResults.get(key).state==='pending';i++)await new Promise(r=>setTimeout(r,10));
 assert.deepEqual(await service.route('GET',url('/v1/approvals/'+key+'/result')),{state:'confirmed'});assert.equal(sends,1);
});

test('a disappeared form is never confirmed by a previous or unrelated reply',async t=>{
 const {service,rpc}=await setup(t);rpc.sharedDesktop=true;
 const q={threadId:'thread-1',identity:'1:2:3',title:'Test',question:'Quelle option ?',position:'',options:['Oui']};
 rpc.recentThreads=async()=>[{id:'thread-1'}];rpc.readDesktopQuestion=async()=>q;
 const wrap=(id,question,answer)=>({id,type:'userMessage',content:[{type:'text',text:'<send_user_message_question_reply>'+JSON.stringify([{question,answer}])+'</send_user_message_question_reply>'}]});
 rpc.thread.turns=[{id:'turn',items:[wrap('old','Quelle option ?','Oui')]}];let sends=0;
 rpc.answerDesktopQuestion=async()=>{sends++;rpc.thread.turns[0].items.push(wrap('new','Une autre question ?','Oui'));throw Object.assign(Error('Envoi non confirmé.'),{code:'DESKTOP_FORM_CLOSED_AFTER_INPUT'});};
 await service.refreshDesktopQuestion();const pending=(await service.route('GET',url('/v1/approvals'))).data[0];
 await assert.rejects(service.route('POST',url('/v1/approvals/'+pending.key+'/answers'),{answers:{'desktop-question':'Oui'}}),/non confirmé/);assert.equal(sends,1);
});

test('authentication rejects absent, partial, and malformed tokens', () => {
  assert.equal(authenticate('Bearer ' + token, token), true);
  for (const h of [undefined, '', token, 'Bearer x', 'bearer ' + token, 'Bearer ' + token + 'x']) assert.equal(authenticate(h, token), false);
});

test('unchanged authenticated chat snapshots use a bodyless conditional response', async t => {
  const {service,rpc}=await setup(t);
  const server=createHttpServer(service,token).listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const endpoint=`http://127.0.0.1:${server.address().port}/v1/threads/thread-1?kind=codex`;
  const headers={Authorization:'Bearer '+token};
  const first=await fetch(endpoint,{headers});assert.equal(first.status,200);const tag=first.headers.get('etag');assert.ok(tag);await first.json();
  const same=await fetch(endpoint,{headers:{...headers,'If-None-Match':tag}});assert.equal(same.status,304);assert.equal(await same.text(),'');
  assert.equal((await fetch(endpoint,{headers:{'If-None-Match':tag}})).status,401);
  rpc.thread.turns=[{id:'new',status:'completed',items:[{id:'answer',type:'agentMessage',text:'Nouvelle réponse',phase:'final_answer'}]}];
  const changed=await fetch(endpoint,{headers:{...headers,'If-None-Match':tag}});assert.equal(changed.status,200);assert.notEqual(changed.headers.get('etag'),tag);assert.equal((await changed.json()).messages.at(-1).text,'Nouvelle réponse');
});

test('recents combine source summaries without messages and survive an unavailable source', async t => {
  const {service,store,rpc} = await setup(t);
  rpc.sharedDesktop = true; rpc.thread.updatedAt = 1;
  service.nativeChatgpt = {projects:async()=>[{id:'g',name:'Projet ChatGPT'}],list:async()=>({data:[{id:'native',title:'Échange natif',projectId:'g',updatedAt:'2026-11-07T22:00:00Z',status:'idle'}]})};
  store.data.chats.push({id:'api',title:'Assistant',status:'idle',updatedAt:2,messages:[{text:'Never expose content in a recent card'}]});
  const result = await service.route('GET',url('/v1/recents'));
  assert.deepEqual(result.data.map(t=>t.id),['native','api','thread-1']);
  assert.equal(result.data[0].projectName,'Projet ChatGPT');
  assert.equal(JSON.stringify(result).includes('Never expose'),false);
  service.nativeChatgpt.list = async()=>{throw Error('offline');};
  const partial = await service.route('GET',url('/v1/recents'));
  assert.deepEqual(partial.unavailable,['chatgpt']);
  assert.deepEqual(partial.data.map(t=>t.id),['api','thread-1']);
});
test('HTTP rejects browser origins, unauthenticated requests, invalid JSON, and oversized payloads', async t => {
  const { service } = await setup(t);
  const server = createHttpServer(service, token).listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => server.close()); const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/v1/projects')).status, 401);
  const headers = { Authorization: 'Bearer ' + token };
  assert.equal((await fetch(base + '/v1/projects', { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(base + '/v1/projects', { headers })).status, 200);
  assert.equal((await fetch(base + '/v1/threads', { method: 'POST', headers, body: '{oops' })).status, 400);
  assert.equal((await fetch(base + '/v1/threads', { method: 'POST', headers, body: 'x'.repeat(33000) })).status, 413);
});

test('direct stream authenticates, establishes a baseline, delivers and replays only missing events', async t => {
  const { service } = await setup(t);
  const old = await service.emit('completed', 'old-thread');
  const server = createHttpServer(service, token).listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const endpoint = `http://127.0.0.1:${server.address().port}/v1/events/stream`;
  assert.equal((await fetch(endpoint)).status, 401);
  const controller = new AbortController();
  const response = await fetch(endpoint, {headers:{Authorization:'Bearer '+token},signal:controller.signal});
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const initial = decoder.decode((await reader.read()).value);
  assert.match(initial, /event: checkpoint/); assert.ok(initial.includes(old.id)); assert.ok(!initial.includes('old-thread'));
  const next = await service.emit('failed', 'new-thread');
  const delivered = decoder.decode((await reader.read()).value);
  assert.ok(delivered.includes(next.id)); assert.ok(delivered.includes('new-thread')); controller.abort();
  const replayController = new AbortController();
  const replay = await fetch(endpoint, {headers:{Authorization:'Bearer '+token,'Last-Event-ID':old.id},signal:replayController.signal});
  const replayed = decoder.decode((await replay.body.getReader().read()).value);
  assert.ok(replayed.includes(next.id)); assert.ok(!replayed.includes('old-thread')); replayController.abort();
});

test('desktop failure is noticed even when turn completion does not update thread metadata', async t => {
  const { service, rpc, store } = await setup(t);
  rpc.thread.updatedAt = 1; rpc.thread.turns = [{id:'active',status:'inProgress',items:[]}];
  await service.pollProjects();
  rpc.thread.turns[0].status = 'failed';
  await service.pollProjects(); await service.pollProjects();
  assert.deepEqual(store.data.events.map(e => e.type), ['failed']);
});

test('a watched thread already read during project monitoring is not read twice',async t=>{
  const {service,rpc,store}=await setup(t);store.data.watched=['thread-1'];
  rpc.thread.updatedAt=1;rpc.thread.turns=[{id:'turn',status:'inProgress',items:[]}];rpc.calls=[];
  await service.pollProjects();assert.equal(rpc.calls.filter(c=>c.method==='thread/read').length,1);
  rpc.calls=[];rpc.thread.turns[0].status='completed';await service.pollProjects();
  assert.equal(rpc.calls.filter(c=>c.method==='thread/read').length,1);assert.equal(store.data.events.at(-1)?.type,'completed');
});

test('completion details reach the durable event and outbox only for permitted projects', async t => {
  const {service,rpc,store} = await setup(t);
  rpc.thread.turns = [{id:'current',status:'inProgress',items:[]}];
  await service.pollProjects();
  store.data.devices = [{token:'watch',profile:'pc'}];
  service.push = {enabled:true,send:async () => {throw new Error('offline');}};
  rpc.thread.turns[0].status = 'completed';
  rpc.thread.turns[0].items = [{type:'agentMessage',phase:'final_answer',text:'Correction installée.'}];
  await service.pollProjects();
  while (service.pushBusy) await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.data.events[0].title, 'Test');
  assert.equal(store.data.events[0].preview, 'Correction installée.');
  assert.equal(store.data.pushJobs[0].event.preview, 'Correction installée.');
  rpc.thread.cwd = path.parse(root).root;
  const forbidden = await service.emit('completed', 'forbidden');
  assert.equal(forbidden.title, undefined); assert.equal(forbidden.preview, undefined);
  while (service.pushBusy) await new Promise(resolve => setImmediate(resolve));
});

test('failed FCM sends remain durable, retry successfully and prune revoked registration tokens', async t => {
  const {service,store,dir} = await setup(t);
  store.data.devices = [{token:'watch-token',profile:'pc'}];
  service.push = {enabled:true,send:async () => {throw new Error('Temporary network failure');}};
  await service.emit('completed','thread-1');
  while (service.pushBusy) await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.data.pushJobs.length,1);
  assert.ok(store.data.pushJobs[0].nextAt > Date.now());
  assert.equal(JSON.parse(await readFile(path.join(dir,'state.json'),'utf8')).pushJobs.length,1);
  store.data.pushJobs[0].nextAt = 0; service.push.send = async () => ({delivered:true});
  await service.flushPush(); assert.equal(store.data.pushJobs.length,0);
  service.push.send = async () => ({invalid:true});
  await service.emit('failed','thread-1');
  while (service.pushBusy) await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.data.devices.length,0); assert.equal(store.data.pushJobs.length,0);
});
test('only explicitly allowed projects can be listed or read', async t => {
  const { service, rpc } = await setup(t);
  await assert.rejects(service.route('GET', url('/v1/threads?project=secret')), /Projet non autorisé/);
  const result = await service.route('GET', url('/v1/threads?project=project&cursor=page-2'));
  assert.equal(result.nextCursor, 'next-page'); assert.equal(rpc.calls.at(-1).params.cursor, 'page-2');
  rpc.thread.cwd = path.parse(root).root;
  await assert.rejects(service.route('GET', url('/v1/threads/thread-1')), /hors des projets/);
  assert.equal(rpc.calls.some(c => c.method === 'thread/resume'), false);
});
test('duplicate network delivery starts exactly one Codex turn', async t => {
  const { service, rpc } = await setup(t);
  const body = { project: 'project', text: 'Test task' };
  const a = await service.route('POST', url('/v1/threads'), body, idempotency);
  const b = await service.route('POST', url('/v1/threads'), body, idempotency);
  assert.deepEqual(a, b);
  assert.equal(rpc.calls.filter(c => c.method === 'turn/start').length, 1);
  const start = rpc.calls.find(c => c.method === 'thread/start');
  assert.equal(start.params.sandbox, 'workspace-write'); assert.equal(start.params.approvalPolicy, 'on-request');
  await assert.rejects(service.route('POST', url('/v1/threads'), { ...body, text: 'different' }, idempotency), /déjà utilisé/);
});
test('desktop writer lock is reported without making a copy or starting another turn', async t => {
  const { service, rpc } = await setup(t);
  const original = rpc.call.bind(rpc);
  rpc.call = async (method, params) => {
    if (method === 'thread/resume') throw new CodexRpcError(method, { code: -32600, message: 'thread thread-1 already has an active writer' });
    return original(method, params);
  };
  await assert.rejects(service.route('POST', url('/v1/threads/thread-1/messages'), { text: 'Hello' }, idempotency), e => e.code === 'THREAD_IN_USE');
  assert.equal(rpc.calls.some(c => ['thread/fork', 'thread/start', 'turn/start'].includes(c.method)), false);
});
test('an active turn in the connected engine receives the instruction in the same thread', async t => {
  const { service, rpc } = await setup(t);
  service.loaded.add('thread-1'); service.activeTurns.set('thread-1', 'active');
  rpc.thread.status = { type: 'active' }; rpc.thread.turns = [{ id: 'active', status: 'inProgress', items: [] }];
  const result = await service.route('POST', url('/v1/threads/thread-1/messages'), { text: 'Focus on the requested fix' }, idempotency);
  assert.equal(result.id, 'thread-1'); assert.equal(result.mode, 'steered');
  const steer = rpc.calls.find(c => c.method === 'turn/steer');
  assert.equal(steer.params.expectedTurnId, 'active');
  assert.equal(rpc.calls.some(c => ['thread/fork', 'thread/start', 'turn/start'].includes(c.method)), false);
});

test('shared desktop submission validates access and forwards exactly once even while active', async t => {
  const { service, rpc } = await setup(t);
  rpc.sharedDesktop = true;
  rpc.thread.status = { type:'active' };
  const submissions = [];
  rpc.send = async args => { submissions.push(args); return { id:args.id, kind:'codex', mode:'forwarded' }; };
  const target = url('/v1/threads/thread-1/messages'), body = { text:'Human instruction' };
  const first = await service.route('POST', target, body, idempotency);
  const duplicate = await service.route('POST', target, body, idempotency);
  assert.deepEqual(first, duplicate); assert.equal(submissions.length, 1);
  assert.equal(submissions[0].id, 'thread-1');
  assert.equal(rpc.calls.every(c => c.method === 'thread/read'), true);
  assert.equal((await service.route('GET', url('/v1/threads/thread-1'))).canInterrupt, false);
  rpc.thread.cwd = path.parse(root).root;
  await assert.rejects(service.route('POST', target, body, idempotency + '2'), /hors des projets/);
  assert.equal(submissions.length, 1);
});
test('an interrupted historical turn does not prevent a new turn after a successful idle resume', async t => {
  const { service, rpc } = await setup(t);
  rpc.thread.turns = [{ id: 'old', status: 'inProgress', items: [] }];
  await service.route('POST', url('/v1/threads/thread-1/messages'), { text: 'Continue' }, idempotency);
  assert.equal(rpc.calls.filter(c => c.method === 'turn/start').length, 1);
  assert.equal(rpc.calls.some(c => c.method === 'turn/steer'), false);
});
test('approval is explicit, once only, and never accepts unknown requests', async t => {
  const { service, rpc, store } = await setup(t);
  await service.onRpc({ id: 54, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-1', command: 'git status', cwd: root } });
  assert.equal(rpc.writes.length, 0); assert.equal(store.data.events.at(-1).type, 'approval');assert.equal(store.data.events.at(-1).target,'requests');
  const { data } = await service.route('GET', url('/v1/approvals'));
  await service.route('POST', url('/v1/approvals/' + data[0].key), { decision: 'accept' });
  assert.deepEqual(rpc.writes.at(-1), { id: 54, result: { decision: 'accept' } });
  await assert.rejects(service.route('POST', url('/v1/approvals/' + data[0].key), { decision: 'accept' }), /expirée/);
  await service.onRpc({ id: 55, method: 'unknown/approval', params: { threadId: 'thread-1' } });
  assert.ok(rpc.writes.at(-1).error);
});
test('external desktop completion monitoring never resumes threads and ignores baseline', async t => {
  const { service, rpc, store } = await setup(t);
  store.data.watched = ['thread-1']; rpc.thread.turns = [{ id: 'old', status: 'completed', items: [] }];
  await service.pollWatched(); assert.equal(store.data.events.length, 0);
  rpc.thread.turns.push({ id: 'new', status: 'completed', items: [] });
  await service.pollWatched(); await service.pollWatched();
  assert.equal(store.data.events.length, 1); assert.equal(rpc.calls.some(c => c.method === 'thread/resume'), false);
});
test('tool output and reasoning never enter the watch chat transcript', () => {
  const messages = messagesFromThread({ turns: [{ items: [{ type: 'commandExecution', aggregatedOutput: 'secret' },
    { type: 'reasoning', content: ['private'] }, { id: 'u', type: 'userMessage', content: [{ type: 'text', text: 'Hi' }] },
    { id: 'a', type: 'agentMessage', text: 'Hello', phase:'commentary' }] }] });
  assert.deepEqual(messages.map(m => m.text), ['Hi', 'Hello']);
  assert.equal(messages[1].phase, 'commentary');
});
test('store survives restart without replaying uncertain operations', async t => {
  const { store, dir } = await setup(t);
  store.data.operations.key = { state: 'pending' }; store.data.chats.push({ status: 'active' }); await store.save();
  const reloaded = new Store(path.join(dir, 'state.json')); await reloaded.load();
  assert.equal(reloaded.data.operations.key.state, 'unknown'); assert.equal(reloaded.data.chats[0].status, 'interrupted');
});

test('a pending Codex creation is resolved only from a unique exact request in its project',async t=>{
 const {service,rpc,store}=await setup(t);const at=Date.now();let reads=0;
 store.data.operations[idempotency]={state:'done',at,fingerprint:JSON.stringify({kind:'codex',project:'project',text:'Demande exacte'}),result:{kind:'codex',pending:true,clientThreadId:'setup'}};
 rpc.list=async()=>({data:[{id:'new',updatedAt:at/1000}]});
 rpc.call=async(method,params)=>{assert.equal(method,'thread/read');reads++;return{thread:{id:params.threadId,cwd:root,name:'Création',status:{type:'idle'},turns:[{startedAt:at/1000,items:[{type:'userMessage',content:[{type:'text',text:'Demande exacte'}]}]}]}};};
 const result=await service.route('GET',url('/v1/operations/'+idempotency));assert.deepEqual(result,{state:'ready',id:'new',kind:'codex'});
 assert.equal(reads,1);assert.equal(store.data.operations[idempotency].result.pending,false);
 assert.deepEqual(await service.route('GET',url('/v1/operations/'+idempotency)),result);assert.equal(reads,1);
});

test('a pending ChatGPT creation remains unresolved for ambiguous or unreadable matches',async t=>{
 const {service,store}=await setup(t);const at=Date.now();let calls=0;
 store.data.operations[idempotency]={state:'done',at,fingerprint:JSON.stringify({kind:'chatgpt',project:'p',text:'Même texte'}),result:{kind:'chatgpt',pending:true,clientThreadId:'local-chatgpt:temp'}};
 service.nativeChatgpt={list:async()=>({data:[{id:'one',projectId:'p',updatedAt:at/1000},{id:'two',projectId:'p',updatedAt:at/1000},{id:'outside',projectId:'other',updatedAt:at/1000}]}),
  read:async id=>{calls++;return{id,kind:'chatgpt',turns:[{startedAt:at/1000,items:[{type:'userMessage',content:[{type:'text',text:'Même texte'}]}]}]};}};
 assert.deepEqual(await service.pendingOperation(idempotency),{state:'ambiguous',kind:'chatgpt'});assert.equal(calls,2);assert.equal(store.data.operations[idempotency].result.pending,true);
 service.pendingLookupAt.clear();service.nativeChatgpt.list=async()=>({data:[{id:'one',projectId:'p',updatedAt:at/1000}]});service.nativeChatgpt.read=async()=>{throw Error('offline');};
 assert.deepEqual(await service.pendingOperation(idempotency),{state:'pending',kind:'chatgpt'});assert.equal(store.data.operations[idempotency].result.pending,true);
});

test('a pending ChatGPT creation opens its single matching chat without sending again',async t=>{
 const {service,store}=await setup(t);const at=Date.now();let reads=0;
 store.data.operations[idempotency]={state:'done',at,fingerprint:JSON.stringify({kind:'chatgpt',project:'',text:'Ma nouvelle question'}),result:{kind:'chatgpt',pending:true,clientThreadId:'local-chatgpt:temp'}};
 service.nativeChatgpt={list:async()=>({data:[{id:'old',updatedAt:(at-60000)/1000},{id:'new',projectId:null,updatedAt:at/1000}]}),
  read:async id=>{reads++;return{id,kind:'chatgpt',turns:[{startedAt:at/1000,items:[{type:'userMessage',content:[{type:'text',text:'Ma nouvelle question'}]}]}]};}};
 assert.deepEqual(await service.route('GET',url('/v1/operations/'+idempotency)),{state:'ready',id:'new',kind:'chatgpt'});
 assert.equal(reads,1);assert.equal(store.data.operations[idempotency].result.id,'new');
});

test('a sleeping watch does not prevent the relay resolving a confirmed existing chat',async t=>{
 const {service,store}=await setup(t);const at=Date.now();let reads=0,sends=0;
 store.data.operations[idempotency]={state:'done',at,fingerprint:JSON.stringify({kind:'chatgpt',project:'',text:'Une question'}),result:{kind:'chatgpt',pending:true}};
 service.nativeChatgpt={list:async()=>({data:[{id:'new',updatedAt:at/1000}]}),read:async()=>{reads++;return{kind:'chatgpt',turns:[{startedAt:at/1000,items:[{type:'userMessage',content:[{type:'text',text:'Une question'}]}]}]};},send:async()=>{sends++;}};
 await service.pollPendingCreations();assert.equal(store.data.operations[idempotency].result.id,'new');assert.equal(reads,1);assert.equal(sends,0);
 await service.pollPendingCreations();assert.equal(reads,1);assert.equal(sends,0);
});

test('pending creation checks stay responsive but coalesce repeated polling',async t=>{
 const {service,store}=await setup(t);const start=Date.now();let now=start,lookups=0;const original=Date.now;Date.now=()=>now;
 try{
  store.data.operations[idempotency]={state:'done',at:start,fingerprint:JSON.stringify({kind:'chatgpt',project:'',text:'Question'}),result:{kind:'chatgpt',pending:true}};
  service.nativeChatgpt={recentCreationCandidates:async()=>{lookups++;return[];}};
  await service.pendingOperation(idempotency);assert.equal(lookups,1);
  now=start+4999;await service.pendingOperation(idempotency);assert.equal(lookups,1);
  now=start+5000;await service.pendingOperation(idempotency);assert.equal(lookups,2);
  now=start+14999;await service.pendingOperation(idempotency);assert.equal(lookups,2);
  now=start+15000;await service.pendingOperation(idempotency);assert.equal(lookups,3);
 }finally{Date.now=original;}
});

test('a recent exact creation is resolved while the full history list is rate limited',async t=>{
 const {service,store}=await setup(t);const at=Date.now();let reads=0,lists=0;
 store.data.operations[idempotency]={state:'done',at,fingerprint:JSON.stringify({kind:'chatgpt',project:'',text:'test'}),result:{kind:'chatgpt',pending:true}};
 service.nativeChatgpt={cooldownUntil:at+120000,recentCreationCandidates:async()=>[{id:'new',updatedAt:at/1000}],list:async()=>{lists++;throw Error('History is limited');},read:async()=>{reads++;return{kind:'chatgpt',turns:[{startedAt:at/1000,items:[{type:'userMessage',content:[{type:'text',text:'test'}]}]}]};}};
 assert.deepEqual(await service.pendingOperation(idempotency),{state:'ready',id:'new',kind:'chatgpt'});assert.equal(reads,1);assert.equal(lists,0);
});

test('a stalled recent list falls back to history without blocking the watch',async t=>{
 const {service,store}=await setup(t);const at=Date.now();let reads=0;
 store.data.operations[idempotency]={state:'done',at,fingerprint:JSON.stringify({kind:'chatgpt',project:'',text:'Question dictée'}),result:{kind:'chatgpt',pending:true}};
 service.nativeChatgpt={recentCreationCandidates:()=>new Promise(()=>{}),list:async()=>({data:[{id:'new',projectId:null,updatedAt:at/1000}]}),read:async()=>{reads++;return{kind:'chatgpt',turns:[{startedAt:at/1000,items:[{type:'userMessage',content:[{type:'text',text:'Question dictée'}]}]}]};}};
 const result=await service.pendingOperation(idempotency);
 assert.deepEqual(result,{state:'ready',id:'new',kind:'chatgpt'});assert.equal(reads,1);
});

test('a stalled recent list and stalled history return pending rather than waiting for the desktop timeout',async t=>{
 const {service,store}=await setup(t);const at=Date.now();let lists=0;
 store.data.operations[idempotency]={state:'done',at,fingerprint:JSON.stringify({kind:'chatgpt',project:'',text:'Question'}),result:{kind:'chatgpt',pending:true}};
 service.nativeChatgpt={recentCreationCandidates:()=>new Promise(()=>{}),list:()=>{lists++;return new Promise(()=>{});}};
 const started=Date.now();const [first,second]=await Promise.all([service.pendingOperation(idempotency),service.pendingOperation(idempotency)]);
 assert.equal(first.state,'pending');assert.deepEqual(second,first);assert.equal(lists,1);assert.ok(Date.now()-started<7000);
});

test('simultaneous identical pending creations never guess which chat belongs to which request',async t=>{
 const {service,store}=await setup(t);const at=Date.now();
 const make=()=>({state:'done',at,fingerprint:JSON.stringify({kind:'chatgpt',project:'',text:'Même texte'}),result:{kind:'chatgpt',pending:true}});
 store.data.operations[idempotency]=make();store.data.operations[idempotency+'2']=make();
 assert.deepEqual(await service.pendingOperation(idempotency),{state:'ambiguous',kind:'chatgpt'});
});

test('a pending ChatGPT lookup exposes its cooldown without making extra requests',async t=>{
 const {service,store}=await setup(t);const at=Date.now();
 store.data.operations[idempotency]={state:'done',at,fingerprint:JSON.stringify({kind:'chatgpt',project:'',text:'Question'}),result:{kind:'chatgpt',pending:true}};
 service.nativeChatgpt={cooldownUntil:at+45000,list:async()=>{throw Error('Ne pas interroger pendant le délai');}};
 const result=await service.pendingOperation(idempotency);
 assert.equal(result.state,'pending');assert.equal(result.reason,'rate_limited');assert.ok(result.retryAfterSeconds>0);
});
test('Chat uses Responses history, marks API failures, and keeps credentials out of state', async t => {
  const { service, store } = await setup(t);
  const old = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'test-key-never-sent';
  t.after(() => { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old; });
  let payload;
  service.fetcher = async (_url, options) => { payload = JSON.parse(options.body); return { ok: true, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Bonjour' }] }] }) }; };
  const result = await service.route('POST', url('/v1/threads'), { kind: 'chat', text: 'Salut' }, idempotency);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(payload.store, false); assert.equal(payload.input[0].content, 'Salut');
  assert.equal(store.data.chats[0].messages[1].text, 'Bonjour');
  service.fetcher = async () => ({ ok: false, status: 429 });
  await service.route('POST', url(`/v1/threads/${result.id}/messages`), { kind: 'chat', text: 'suite' }, idempotency + '2');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(store.data.chats[0].status, 'failed'); assert.equal(store.data.events.at(-1).type, 'failed');
  assert.equal(JSON.stringify(store.data).includes('test-key-never-sent'), false);
});

test('native ChatGPT routes are opt-in and same-chat followups remain idempotent', async t => {
  const {service,store} = await setup(t);
  await assert.rejects(service.route('GET',url('/v1/threads?kind=chatgpt')),/connecté sur le PC/);
  let sends = 0;
  service.nativeChatgpt = {projects:async () => [{id:'g',name:'Projet ChatGPT'}],
    read:async id => ({id,name:'ChatGPT réel',status:{type:'idle'},turns:[{id:'turn',status:'completed',items:[{id:'a',type:'agentMessage',text:'Contexte ChatGPT'}]}]}),
    send:async ({id}) => {sends++;return {id,kind:'chatgpt',mode:'forwarded'};}};
  const projects = await service.route('GET',url('/v1/projects?kind=chatgpt')); assert.equal(projects.data[0].id,'g');
  const detail = await service.route('GET',url('/v1/threads/chatgpt-id?kind=chatgpt'));
  assert.equal(detail.kind,'chatgpt'); assert.equal(detail.messages[0].text,'Contexte ChatGPT');
  assert.deepEqual(store.data.watchedChatgpt,['chatgpt-id']);
  const body = {kind:'chatgpt',text:'Suite'};
  await service.route('POST',url('/v1/threads/chatgpt-id/messages'),body,idempotency);
  await service.route('POST',url('/v1/threads/chatgpt-id/messages'),body,idempotency);
  assert.equal(sends,1);
});
test('project monitoring discovers unopened desktop tasks without replaying old completions', async t => {
  const { service, rpc, store } = await setup(t);
  rpc.thread.updatedAt = 1; rpc.thread.turns = [{ id: 'old', status: 'completed', items: [] }];
  await service.pollProjects(); assert.equal(store.data.events.length, 0);
  rpc.thread.updatedAt = 2; rpc.thread.turns.push({ id: 'new', status: 'completed', items: [] });
  await service.pollProjects(); await service.pollProjects();
  assert.equal(store.data.events.length, 1); assert.equal(rpc.calls.some(c => c.method === 'thread/resume'), false);
});
test('desktop monitoring reports only currently pending native attention without inventing approval control',async t=>{
 const {service,rpc,store}=await setup(t);rpc.sharedDesktop=true;rpc.thread.updatedAt=1;rpc.thread.turns=[{id:'active-turn',status:'inProgress',items:[]}];rpc.thread.status={type:'active',activeFlags:[]};
 await service.pollProjects();assert.equal((await service.route('GET',url('/v1/approvals'))).desktopPending.length,0);
 rpc.thread.status.activeFlags=['waitingOnUserInput'];await service.pollProjects();await service.pollProjects();
 let pending=await service.route('GET',url('/v1/approvals'));assert.equal(pending.canRespond,false);assert.equal(pending.desktopPending.length,1);assert.equal(pending.desktopPending[0].type,'attention');assert.equal(store.data.events.filter(e=>e.type==='attention').length,1);assert.equal(rpc.writes.length,0);
 rpc.thread.status.activeFlags=[];await service.pollProjects();assert.equal((await service.route('GET',url('/v1/approvals'))).desktopPending.length,0);
 rpc.thread.status.activeFlags=['waitingOnApproval'];await service.pollProjects();pending=await service.route('GET',url('/v1/approvals'));assert.equal(pending.desktopPending[0].type,'approval');assert.equal(store.data.events.filter(e=>e.type==='approval').length,1);assert.equal(rpc.writes.length,0);
 rpc.emit('offline');assert.equal((await service.route('GET',url('/v1/approvals'))).desktopPending.length,0);
});
test('demo refuses all chat and Codex inference even if credentials exist', async t => {
  const { service, rpc } = await setup(t); service.demo = true;
  for (const kind of ['chat', 'codex']) await assert.rejects(service.route('POST', url('/v1/threads'), { kind, project: 'project', text: 'Never send' }, idempotency), /aucun envoi réel/);
  assert.equal(rpc.calls.length, 0);
});
test('push registration preserves PC/server routing and can be revoked per profile', async t => {
  const { service, store } = await setup(t);
  const registration = { token: 'test-registration-token-long-enough' };
  await service.route('POST', url('/v1/devices'), { ...registration, profile: 'pc' });
  await service.route('POST', url('/v1/devices'), { ...registration, profile: 'server' });
  assert.equal(store.data.devices.length, 2);
  await service.route('DELETE', url('/v1/devices'), { ...registration, profile: 'pc' });
  assert.deepEqual(store.data.devices.map(d => d.profile), ['server']);
  await assert.rejects(service.route('POST', url('/v1/devices'), registration), /Profil de montre/);
});


test('Live readiness is independent of a rate-limited recent-conversation catalog',async t=>{
 const {service,rpc}=await setup(t);service.audio.key=()=> 'test-only';service.recents=async()=>{rpc.ready=false;throw Error('Catalog must not be loaded');};service.nativeChatgpt={projects:async()=>{throw Object.assign(Error('Too many requests'),{status:429});}};
 const live=await service.route('GET',url('/v1/live/options'));assert.equal(live.ready,true);assert.equal(rpc.ready,true);assert.ok(live.projects.codex.length);
});

test('Live readiness distinguishes insufficient allowance from a disconnected desktop',async t=>{
 const {service,rpc}=await setup(t);service.audio.key=()=> 'test-only';
 await service.audio.configure({mode:'watch',voice:'marin',monthlyLimitCents:2});
 let live=await service.route('GET',url('/v1/live/options'));assert.equal(live.ready,false);assert.equal(live.reason,'BUDGET_REACHED');assert.equal(rpc.ready,true);
 await service.audio.configure({mode:'watch',voice:'marin',monthlyLimitCents:500});
 live=await service.route('GET',url('/v1/live/options'));assert.equal(live.ready,true);assert.equal(live.reason,null);
});
