import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeChatgpt} from '../chatgpt.mjs';

function setup(handler) {
  const calls = [];
  const client = {tool:async (name,args,requestId) => {calls.push({name,args,requestId}); return handler(name,args);}};
  return {chatgpt:new NativeChatgpt(client),calls};
}
const project = {projectId:'g-project',projectKind:'chatgpt',label:'Mon projet'};
const chat = id => ({id,kind:'chatgpt',projectId:project.projectId,title:id,status:'idle'});
test('rate-limited history uses verified metadata and backs off across chats without blocking a same-chat reply',async()=>{
 const {chatgpt,calls}=setup((name,args)=>{if(name==='list_threads')return{threads:[chat('one'),chat('two')]};if(name==='read_thread')throw Error('ChatGPT conversation history was rate limited');return{ok:true};});
 await chatgpt.list();const first=await chatgpt.read('one');assert.equal(first.historyStale,true);assert.equal(first.id,'one');await chatgpt.read('two');assert.equal(calls.filter(c=>c.name==='read_thread').length,1);
 await chatgpt.send({id:'one',text:'Test',requestId:'known'});assert.equal(calls.at(-1).args.threadId,'one');assert.equal(calls.at(-1).name,'send_message_to_thread');
 await assert.rejects(chatgpt.read('unknown'),e=>e.code==='CHATGPT_RATE_LIMITED');
});
test('idle watched chats are not continuously re-read in the background',async()=>{
 const {chatgpt,calls}=setup(()=>({threads:[{...chat('one'),updatedAt:1}]}));assert.deepEqual(await chatgpt.pollCandidates([]),[]);assert.equal(calls.length,0);assert.deepEqual(await chatgpt.pollCandidates(['one']),[]);chatgpt.listCache.clear();assert.deepEqual(await chatgpt.pollCandidates(['one']),[]);assert.equal(calls.length,1);
});

test('a successful concurrent read does not clear an active rate-limit cooldown',async()=>{
 let finish;const {chatgpt}=setup(()=>new Promise(resolve=>{finish=resolve;}));
 const read=chatgpt.read('one');await Promise.resolve();chatgpt.rateFailures=2;chatgpt.cooldownUntil=Date.now()+60000;finish({thread:chat('one'),turns:[]});await read;
 assert.equal(chatgpt.rateFailures,2);assert.ok(chatgpt.cooldownUntil>Date.now());
});

test('history-list throttling does not block reading a known chat, and reading does not clear list throttling',async()=>{
 const {chatgpt,calls}=setup((name)=>name==='read_thread'?{thread:chat('one'),turns:[]}:{});
 chatgpt.limited('list');const value=await chatgpt.read('one');assert.equal(value.id,'one');assert.equal(calls.length,1);assert.ok(chatgpt.cooldownUntil>Date.now());
 chatgpt.limited('read');await assert.rejects(chatgpt.read('two'),e=>e.status===429);assert.equal(calls.length,1);
});

test('a fresh creation lookup keeps a usable cached list if ChatGPT rate-limits it',async()=>{
 let fail=false;const {chatgpt}=setup(()=>{if(fail)throw Object.assign(Error('Too many requests'),{status:429});return{threads:[chat('existing')]};});
 const first=await chatgpt.list({limit:30});assert.equal(first.data[0].id,'existing');
 fail=true;const fallback=await chatgpt.list({limit:30,fresh:true});assert.equal(fallback.historyStale,true);assert.equal(fallback.data[0].id,'existing');
 assert.ok(chatgpt.cooldownUntil>Date.now());
});

test('a successful fresh list resets an expired rate-limit backoff',async()=>{
 const {chatgpt}=setup(()=>({threads:[chat('existing')]}));chatgpt.rateFailures=3;chatgpt.cooldownUntil=Date.now()-1;
 await chatgpt.list({fresh:true});assert.equal(chatgpt.rateFailures,0);assert.equal(chatgpt.cooldownUntil,0);
});
test('a missing title returns after three source pages and resumes from the next cursor', async () => {
  const {chatgpt,calls} = setup((_name,args) => ({threads:[chat('not-a-match')],nextCursor:String(Number(args.cursor||0)+1)}));
  const first=await chatgpt.list({q:'absent'});
  assert.equal(first.data.length,0);assert.equal(calls.length,3);
  assert.equal(JSON.parse(Buffer.from(first.nextCursor,'base64url')).cursor,'3');
  await chatgpt.list({q:'absent',cursor:first.nextCursor});
  assert.equal(calls[3].args.cursor,'3');assert.equal(calls.length,6);
});
test('native ChatGPT pagination filters source and project, preserving every match', async () => {
  const {chatgpt,calls} = setup(name => name === 'list_projects' ? {projects:[project,{projectId:'local',projectKind:'local'}]} :
    {threads:[chat('a'),{...chat('private'),kind:'codex'},chat('b')],nextCursor:null});
  assert.deepEqual(await chatgpt.projects(),[{id:project.projectId,name:project.label}]);
  const a = await chatgpt.list({project:project.projectId,limit:1});
  const b = await chatgpt.list({project:project.projectId,limit:1,cursor:a.nextCursor});
  assert.equal(a.data[0].id,'a'); assert.equal(b.data[0].id,'b'); assert.equal(b.nextCursor,null);
  assert.ok(calls.filter(c => c.name === 'list_threads').every(c => c.args.source === 'chatgpt' && !('hostId' in c.args)));
  await assert.rejects(chatgpt.list({project:'local'}),/inaccessible/);
  await assert.rejects(chatgpt.list({cursor:a.nextCursor,q:'changed'}),/Pagination/);
});
test('native ChatGPT reads chronological text through the desktop, rejecting Codex IDs', async () => {
  const {chatgpt,calls} = setup((_name,args) => ({thread:{...chat('a'),kind:args.threadId === 'wrong' ? 'codex' : 'chatgpt'},
    turns:args.cursor ? [{id:'old',items:[]}] : [{id:'new',status:'inProgress',items:[]}],page:{nextCursor:args.cursor ? null : 'older'}}));
  assert.equal((await chatgpt.read('a')).status.type,'active');
  assert.deepEqual((await chatgpt.read('a','older')).turns.map(t => t.id),['old','new']);
  assert.deepEqual((await chatgpt.read('a')).turns.map(t => t.id),['old','new']);
  assert.ok(calls.every(c => !('hostId' in c.args) && c.args.includeOutputs === false));
  await assert.rejects(chatgpt.read('wrong'),/ne provient pas de ChatGPT/);
});
test('native followups stay in the same ChatGPT chat; new Work requests use the selected project', async () => {
  const {chatgpt,calls} = setup((name,args) => name === 'list_projects' ? {projects:[project]} : name === 'read_thread' ?
    {thread:chat(args.threadId),turns:[]} : name === 'create_thread' ? {clientThreadId:'pending'} : {ok:true});
  assert.deepEqual(await chatgpt.send({id:'same',text:'Suite',requestId:'once'}),{id:'same',kind:'chatgpt',mode:'forwarded'});
  assert.deepEqual(calls.at(-1),{name:'send_message_to_thread',args:{threadId:'same',prompt:'Suite'},requestId:'once'});
  assert.equal(calls.some(c => c.name === 'create_thread'),false);
  const result = await chatgpt.send({project:project.projectId,text:'Nouvelle demande',requestId:'new'});
  assert.equal(result.pending,true); assert.equal(result.id,undefined);
  assert.deepEqual(calls.at(-1).args.target,{type:'chatgptWorkCloud',projectId:project.projectId});
});

test('adjacent reads share a validated snapshot; a native submission invalidates it',async()=>{
  const {chatgpt,calls}=setup((name,args)=>name==='read_thread'?{thread:chat(args.threadId),turns:[],page:{}}:{ok:true});
  await chatgpt.read('same');await chatgpt.read('same');
  assert.equal(calls.filter(c=>c.name==='read_thread').length,1);
  await chatgpt.send({id:'same',text:'Une consigne',requestId:'once'});await chatgpt.read('same');
  assert.equal(calls.filter(c=>c.name==='read_thread').length,2);
});


test('Live and recently submitted chats bypass the idle ten-second cache while sharing concurrent reads',async()=>{
 const {chatgpt,calls}=setup((name,args)=>name==='read_thread'?{thread:chat(args.threadId),turns:[],page:{}}:{ok:true});
 await chatgpt.read('same');chatgpt.snapshots.get('same').at=Date.now()-2500;
 await chatgpt.read('same');assert.equal(calls.filter(c=>c.name==='read_thread').length,1);
 await Promise.all([chatgpt.read('same',null,{live:true}),chatgpt.read('same',null,{live:true})]);
 assert.equal(calls.filter(c=>c.name==='read_thread').length,2);
 await chatgpt.send({id:'same',text:'Suite',requestId:'one'});await chatgpt.read('same');
 chatgpt.snapshots.get('same').at=Date.now()-2500;await chatgpt.read('same');
 assert.equal(calls.filter(c=>c.name==='read_thread').length,4);
});


test('refreshing a native page orders turns by their timestamps even when cached insertion order differs',async()=>{
 let reads=0;const {chatgpt}=setup(()=>({thread:chat('same'),turns:++reads===1?[{id:'new',startedAt:30,items:[]},{id:'old',startedAt:10,items:[]}]:[{id:'new',startedAt:30,items:[]},{id:'middle',startedAt:20,items:[]},{id:'old',startedAt:10,items:[]}],page:{}}));
 await chatgpt.read('same');chatgpt.snapshots.get('same').at=0;
 assert.deepEqual((await chatgpt.read('same')).turns.map(t=>t.id),['old','middle','new']);
});


test('listing rate limits share the history cooldown and concurrent listings are coalesced',async()=>{
 const {chatgpt,calls}=setup(()=>{throw Object.assign(Error('Too many requests'),{status:429});});
 await assert.rejects(chatgpt.list(),e=>e.status===429);await assert.rejects(chatgpt.list({q:'other'}),e=>e.status===429);await assert.rejects(chatgpt.projects(),e=>e.status===429);assert.equal(calls.length,1);
});
