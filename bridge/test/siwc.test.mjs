import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';import {PlanChat} from '../siwc.mjs';
async function setup(t,fetcher){const dir=await mkdtemp(path.join(tmpdir(),'siwc-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,'credentials');await writeFile(file,JSON.stringify({host_id:'host',client_id:'client',access_token:'token',refresh_token:'refresh',scope:'chatgpt.tokens.use.direct',expires_at:Date.now()+3600000}));return new PlanChat(file,{fetcher});}
const json=x=>({ok:true,json:async()=>x});
test('streams a complete answer with permitted plan parameters and model discovery',async t=>{
 let payload;const client=await setup(t,async(url,options)=>url.endsWith('/models')?json({models:[{visibility:'list',slug:'model'}]}):(payload=JSON.parse(options.body),{ok:true,body:ReadableStream.from(['data: {"type":"response.output_text.delta","delta":"Bon', 'jour"}\n\ndata: {"type":"response.completed"}\n\n'].map(x=>Buffer.from(x)))}));
 assert.equal(await client.answer([{role:'user',text:'Salut'}]),'Bonjour');assert.equal(payload.store,false);assert.equal(payload.stream,true);assert.equal(payload.model,'model');assert.equal(payload.max_output_tokens,undefined);
});
test('does not accept a partial stream without response.completed',async t=>{
 const client=await setup(t,async url=>url.endsWith('/models')?json({models:[{visibility:'list',slug:'model'}]}):{ok:true,body:ReadableStream.from([Buffer.from('data: {"type":"response.output_text.delta","delta":"Partial"}\n\n')])});
 await assert.rejects(client.answer([{role:'user',text:'Salut'}]),/interrompue/);
});
