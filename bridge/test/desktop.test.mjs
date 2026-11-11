import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DesktopRpc, DesktopError } from '../desktop.mjs';

function setup(handler) {
  const client = new EventEmitter();
  client.ready = true;
  client.calls = [];
  client.projects = { projects:[{ projectKind:'local', hostId:'local', path:process.cwd(), projectId:'native-project' }] };
  client.tool = async (name, args, requestId) => { client.calls.push({ name, args, requestId }); return handler(name, args); };
  const rpc = new DesktopRpc(client);
  return { client, rpc, project:{ id:'watch-project', path:process.cwd() } };
}
const thread = id => ({ id, kind:'codex', hostId:'local', projectId:'native-project', title:id, cwd:process.cwd() });

test('all-project listing keeps the local ACL and separates its pagination from a project filter', async () => {
  const {rpc,project} = setup(() => ({threads:[thread('a'),{...thread('secret'),projectId:'other',cwd:'elsewhere'},
    {...thread('cloud'),hostId:'remote'},thread('b')],nextCursor:null}));
  await rpc.configureProjects([project]);
  const first = await rpc.list({cwd:null,limit:1});
  const second = await rpc.list({cwd:null,limit:1,cursor:first.nextCursor});
  assert.deepEqual([first.data[0].id,second.data[0].id],['a','b']);
  assert.equal(first.data[0].projectId,project.id);
  await assert.rejects(rpc.list({cwd:project.path,cursor:first.nextCursor}),/Pagination invalide/);
});

test('desktop project pagination preserves remaining matches within a native page', async () => {
  const { rpc, project } = setup((_name, args) => args.cursor ? { threads:[thread('c')], nextCursor:null } :
    { threads:[thread('a'), { ...thread('secret'), projectId:'other', cwd:'elsewhere' }, thread('b')], nextCursor:'page-2' });
  await rpc.configureProjects([project]);
  const first = await rpc.list({ cwd:project.path, limit:1 });
  const second = await rpc.list({ cwd:project.path, limit:1, cursor:first.nextCursor });
  const third = await rpc.list({ cwd:project.path, limit:1, cursor:second.nextCursor });
  assert.deepEqual([first, second, third].map(p => p.data[0].id), ['a','b','c']);
  assert.equal(third.nextCursor, null);
  await assert.rejects(rpc.list({ cwd:project.path, cursor:first.nextCursor, searchTerm:'changed' }), /Pagination invalide/);
});

test('a visible desktop question is associated only with one authorized active title',async()=>{
 let mode='unique';
 const {rpc,project}=setup((_name,args)=>mode==='duplicate'&&args.cursor?{threads:[{...thread('two'),title:'Projet',projectId:'other',cwd:'elsewhere'}],nextCursor:null}:
  {threads:[{...thread('one'),title:'Projet',status:mode==='idle'?'idle':'active'}],nextCursor:mode==='duplicate'?'page-2':null});
 rpc.questionReader={read:async()=>({identity:'123:456:1.2',title:'Projet',question:'Choix ?',position:'',options:['Oui','Non']})};
 await rpc.configureProjects([project]);const candidates=await rpc.recentThreads();
 assert.equal((await rpc.readDesktopQuestion(candidates)).threadId,'one');
 mode='duplicate';assert.equal(await rpc.readDesktopQuestion(candidates),null);
 mode='idle';assert.equal(await rpc.readDesktopQuestion(candidates),null);
});

test('a question is hidden if catalog pagination cannot be completed',async()=>{
 const {rpc,project}=setup((_name,args)=>({threads:args.cursor?[]:[{...thread('one'),title:'Projet',status:'active'}],nextCursor:'repeated'}));
 rpc.questionReader={read:async()=>({identity:'1',title:'Projet',question:'Choix ?',position:'',options:[]})};
 await rpc.configureProjects([project]);const candidates=await rpc.recentThreads();
 assert.equal(await rpc.readDesktopQuestion(candidates),null);
});

test('older history stays chronological and survives recent-page refreshes without duplicates', async () => {
  let refresh = false;
  const turn = id => ({ id, items:[], status:id === 'new' && !refresh ? 'inProgress' : 'completed' });
  const { rpc } = setup((_name, args) => ({ thread:thread('chat'), turns:args.cursor ? [turn('older')] : [turn('new'), turn('previous')],
    page:{ nextCursor:args.cursor ? null : 'older-page' } }));
  const read = cursor => rpc.read({ threadId:'chat', cursor });
  assert.deepEqual((await read()).thread.turns.map(t => t.id), ['previous','new']);
  assert.deepEqual((await read('older-page')).thread.turns.map(t => t.id), ['older','previous','new']);
  refresh = true;
  const result = (await read()).thread;
  assert.deepEqual(result.turns.map(t => t.id), ['older','previous','new']);
  assert.equal(result.turns.at(-1).status, 'completed');
  assert.equal(result.historyCursor, null);
});

test('oversized PC conversations fall back to smaller pages without repeating failed reads', async () => {
  const {rpc,client}=setup((_name,args)=>{
    if(args.turnLimit>3)throw new DesktopError('Tool response exceeds the size limit. Request fewer turns or omit outputs.');
    return {thread:thread('chat'),turns:[{id:args.cursor?'older':'new',items:[],status:'completed'}],page:{nextCursor:args.cursor?null:'older-cursor'}};
  });
  const first=await rpc.read({threadId:'chat'});assert.equal(first.historyCursor,undefined);assert.equal(first.thread.historyCursor,'older-cursor');
  assert.deepEqual(client.calls.map(c=>c.args.turnLimit),[10,3]);
  await rpc.read({threadId:'chat'});await rpc.read({threadId:'chat',cursor:'older-cursor'});
  assert.deepEqual(client.calls.map(c=>c.args.turnLimit),[10,3,3,3]);
  assert.deepEqual(rpc.histories.get('chat').turns.map(t=>t.id),['older','new']);
});

test('ordinary read errors are not retried as oversized history',async()=>{
  const {rpc,client}=setup(()=>{throw new DesktopError('Connexion interrompue');});
  await assert.rejects(rpc.read({threadId:'chat'}),/interrompue/);assert.equal(client.calls.length,1);
});

test('desktop send forwards the human instruction to the same thread without spawning or copying', async () => {
  const { rpc, client } = setup(() => ({ status:'sent' }));
  const result = await rpc.send({ id:'existing', text:'User instruction', requestId:'human-request' });
  assert.equal(result.id, 'existing');
  assert.deepEqual(client.calls, [{ name:'send_message_to_thread', args:{ threadId:'existing', hostId:'local', prompt:'User instruction' }, requestId:'human-request' }]);
  await assert.rejects(rpc.call('thread/resume', { threadId:'existing' }), /distinct/);
  await assert.rejects(rpc.call('thread/fork', { threadId:'existing' }), /distinct/);
});

test('new desktop task uses the saved project and preserves pending worktree acknowledgement', async () => {
  const { rpc, client, project } = setup(() => ({ clientThreadId:'setup-id' }));
  await rpc.configureProjects([project]);
  const result = await rpc.send({ project, text:'New task', requestId:'request' });
  assert.equal(result.pending, true); assert.equal(result.id, undefined);
  assert.deepEqual(client.calls[0].args.target, { type:'project', projectId:'native-project', environment:{type:'local'} });
  assert.equal(client.calls[0].args.model, undefined);
});


test('a ChatGPT rate limit does not disconnect the healthy Codex transport',async()=>{
 const {DesktopClient}=await import('../desktop.mjs');const c=new DesktopClient({});c.ready=true;let stopped=false;c.stop=()=>{stopped=true;};c.request=async()=>({isError:true,content:[{type:'text',text:'{"detail":"Too many requests"}'}]});
 await assert.rejects(c.tool('list_threads',{source:'chatgpt'}),e=>e.status===429&&e.code==='CHATGPT_RATE_LIMITED');assert.equal(stopped,false);assert.equal(c.ready,true);
});

test('a missing PC chat is reported as a missing conversation, not a broken relay',async()=>{
 const {DesktopClient}=await import('../desktop.mjs');const c=new DesktopClient({});c.ready=true;
 c.request=async()=>({isError:true,content:[{type:'text',text:'No Codex thread found for threadId: example. Hosts without a readable match: local'}]});
 await assert.rejects(c.tool('read_thread',{threadId:'example'}),e=>e.status===404&&e.code==='THREAD_NOT_FOUND'&&!e.message.includes('example'));
 await assert.rejects(c.tool('send_message_to_thread',{threadId:'example'}),e=>!e.status);
});
