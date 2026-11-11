import test from 'node:test';import assert from 'node:assert/strict';
import {nativeModels,validateInference,PluginManager} from '../management.mjs';
import {PairingWindow} from '../pairing.mjs';
import {mkdtemp,mkdir,writeFile,readFile,rm}from'node:fs/promises';import{tmpdir}from'node:os';import path from'node:path';import{createHash,randomUUID}from'node:crypto';
test('host model capabilities drive validation; unsupported efforts never pass through',()=>{
 const catalog=[{name:'send_message_to_thread',inputSchema:{properties:{model:{description:'Available models: gpt-test-sol (A model.; supported reasoning efforts: low, medium), gpt-test-luna (Fast.; supported reasoning efforts: low)'}}}}];
 const models=nativeModels(catalog);assert.equal(models.length,2);assert.deepEqual(validateInference({model:'gpt-test-sol',thinking:'medium'},models),{model:'gpt-test-sol',thinking:'medium'});assert.throws(()=>validateInference({model:'gpt-test-luna',thinking:'ultra'},models));assert.deepEqual(validateInference({},models),{});
});
test('a slow remote marketplace does not hide local plugins, and a selected plugin becomes an explicit prompt',async()=>{
 const manager=new PluginManager({run:async args=>{if(!args.includes('--marketplace'))throw Error('timeout');return{installed:[{pluginId:'local@market',name:'Local',installed:true,enabled:true}]};}});
 manager.cachedInventory=async()=>[{id:'local@market',name:'Local',marketplace:'market',cached:true},{id:'remote@slow',name:'Remote',marketplace:'slow',cached:true}];
 const list=await manager.list();assert.equal(list.installed.length,2);assert.ok(list.notice);const decorated=await manager.decorate('Ma question',['local@market']);assert.match(decorated,/Plugins demandés.*Local/);assert.ok(decorated.includes('[@Local](plugin://local@market)'));assert.ok(decorated.includes('Applique leurs consignes'));await assert.rejects(manager.decorate('Texte',['unknown@host']));
});
test('plugin management strips local paths and executes only catalogued explicit actions',async()=>{
 const commands=[],edits=[];const manager=new PluginManager({run:async args=>{commands.push(args);return {installed:[{pluginId:'test@catalog',name:'Test',installed:true,enabled:true,source:{path:'private'}}],available:[]};},configure:async(...args)=>edits.push(args)});
 assert.equal(JSON.stringify(await manager.list()).includes('private'),false);await manager.change('test@catalog','disable');assert.deepEqual(edits,[['test@catalog',false]]);await assert.rejects(manager.change('test@catalog;evil','remove'));await assert.rejects(manager.change('unknown@catalog','remove'));assert.equal(commands.some(c=>c[0]==='remove'),false);
});
test('cached workflow plugins and app-only entries remain distinguishable',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'watch-plugin-types-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 for(const [name,manifest] of [['workflow',{name:'workflow',skills:'./skills',apps:'./.app.json'}],['app',{name:'app',apps:'./.app.json'}]]){
  const folder=path.join(dir,'plugins','cache','market',name,'1.0','.codex-plugin');await mkdir(folder,{recursive:true});await writeFile(path.join(folder,'plugin.json'),JSON.stringify(manifest));
 }
 const rows=await new PluginManager({home:()=>dir}).cachedInventory();assert.equal(rows.find(r=>r.name==='workflow').kind,'workflow');assert.equal(rows.find(r=>r.name==='app').kind,'app');
});
test('pairing code expires, rate limits guessing, and can be consumed once only',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'watch-pair-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,'window.json');const hash=code=>createHash('sha256').update(code).digest('hex');
 await writeFile(file,JSON.stringify({hash:hash('123456'),expiresAt:Date.now()+10000}));const window=new PairingWindow(file);await assert.rejects(window.consume('000000'));await window.consume('123456');await assert.rejects(window.consume('123456'));
 await writeFile(file,JSON.stringify({hash:hash('234567'),expiresAt:Date.now()-1}));await assert.rejects(window.consume('234567'),e=>e.status===410);
 await writeFile(file,JSON.stringify({hash:hash('345678'),expiresAt:Date.now()+10000}));for(let i=0;i<5;i++)await assert.rejects(window.consume('000000'));await assert.rejects(window.consume('345678'),e=>e.status===429);
});
test('pairing confirms only after the watch returns its private receipt, and stays one-use',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'watch-pair-confirm-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,'window.json'),id=randomUUID(),window=new PairingWindow(file);
 await writeFile(file,JSON.stringify({id,hash:createHash('sha256').update('123456').digest('hex'),expiresAt:Date.now()+10000}));
 const receipt=await window.consume('123456');assert.equal(receipt.id,id);assert.equal(receipt.nonce.length,43);
 let saved=JSON.parse(await readFile(window.resultFile(id),'utf8'));assert.equal(saved.status,'accepted');assert.ok(!JSON.stringify(saved).includes(receipt.nonce));
 await assert.rejects(window.confirm(id,'a'.repeat(43)),e=>e.status===403);await window.confirm(id,receipt.nonce);
 saved=JSON.parse(await readFile(window.resultFile(id),'utf8'));assert.equal(saved.status,'confirmed');assert.ok(!JSON.stringify(saved).includes(receipt.nonce));
 await window.confirm(id,receipt.nonce);await assert.rejects(window.consume('123456'));
});
