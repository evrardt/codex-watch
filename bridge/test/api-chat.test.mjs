import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {ApiChat} from '../api-chat.mjs';

async function fixture(t,fetcher){
 const dir=await mkdtemp(path.join(tmpdir(),'api-chat-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'key');await writeFile(file,'sk-example-test-key');return new ApiChat(file,{fetcher});
}
test('submits independent context through Responses and returns the text',async t=>{
 let sent;const chat=await fixture(t,async(url,options)=>{sent={url,payload:JSON.parse(options.body)};return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Bonjour !'}]}]})};});
 assert.equal(await chat.answer([{role:'user',text:'Salut'},{role:'assistant',text:'Avant'},{role:'user',text:'Encore'}]),'Bonjour !');
 assert.equal(sent.url,'https://api.openai.com/v1/responses');assert.equal(sent.payload.model,'gpt-6.1-terra');assert.equal(sent.payload.store,false);assert.equal(sent.payload.input.length,3);
 assert.ok(!JSON.stringify(sent.payload).includes('sk-example'));
});
test('handles missing keys, quota errors and incomplete responses without disclosing secrets',async t=>{
 const chat=await fixture(t,async()=>({ok:false,status:429}));await assert.rejects(chat.answer([{role:'user',text:'Salut'}]),/crédits/);
 chat.fetcher=async()=>({ok:false,status:429,json:async()=>({error:{code:'credit_balance_exhausted',message:'sk-do-not-disclose'}})});await assert.rejects(chat.answer([{role:'user',text:'Salut'}]),e=>/Crédits API épuisés/.test(e.message)&&!e.message.includes('sk-'));
 chat.fetcher=async()=>({ok:true,json:async()=>({status:'incomplete',output:[]})});await assert.rejects(chat.answer([{role:'user',text:'Salut'}]),/incomplète/);
 await rm(chat.file);assert.equal(await chat.available(),false);await assert.rejects(chat.answer([]),/Configure la clé/);
});
test('records reported token usage with the model used for that response',async t=>{
 const chat=await fixture(t,async()=>({ok:true,json:async()=>({status:'completed',usage:{input_tokens:31,output_tokens:9},output:[{type:'message',content:[{type:'output_text',text:'OK'}]}]})}));let observed;
 chat.onUsage=async(model,usage)=>{observed={model,usage};};await chat.answer([{role:'user',text:'Bonjour'}]);assert.deepEqual(observed,{model:'gpt-6.1-terra',usage:{input_tokens:31,output_tokens:9}});
});
test('marks ambiguous failures as unpriced instead of silently reporting complete usage',async t=>{
 const chat=await fixture(t,async()=>{throw Error('network');});const entries=[];chat.onUsage=async(model,usage)=>entries.push({model,usage});
 await assert.rejects(chat.answer([{role:'user',text:'Bonjour'}]),/network/);
 chat.fetcher=async()=>({ok:false,status:503});await assert.rejects(chat.answer([{role:'user',text:'Bonjour'}]),/503/);
 chat.fetcher=async()=>({ok:true,json:async()=>{throw Error('bad response');}});await assert.rejects(chat.answer([{role:'user',text:'Bonjour'}]),/bad response/);
 chat.fetcher=async()=>({ok:false,status:429});await assert.rejects(chat.answer([{role:'user',text:'Bonjour'}]),/crédits/);
 assert.equal(entries.length,3);assert.ok(entries.every(e=>e.model==='gpt-6.1-terra'&&e.usage===null));
});
