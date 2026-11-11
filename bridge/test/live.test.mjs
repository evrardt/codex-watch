import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {LiveCall,voiceRoute,transcriptFor,attachLive,splitDeltaPcm} from '../live.mjs';
import {AudioService} from '../audio.mjs';
import {createHttpServer} from '../server.mjs';
import WebSocket from 'ws';
import {once} from 'node:events';
import {inflateSync} from 'node:zlib';
import {randomBytes} from 'node:crypto';
import http from 'node:http';

class Socket extends EventEmitter {
  readyState=1;bufferedAmount=0;sent=[];
  send(text){this.sent.push(JSON.parse(text));}
  close(){this.readyState=3;this.emit('close');}
}
class Provider extends Socket {
  static instances=[];
  constructor(url){super();this.url=url;Provider.instances.push(this);queueMicrotask(()=>this.emit('open'));}
  send(text){super.send(text);const e=JSON.parse(text);
    if(e.type==='session.start')queueMicrotask(()=>this.emit('message',Buffer.from('{"type":"session.started","session":{"id":"test-session"}}')));
    if(e.type==='session.close')queueMicrotask(()=>this.emit('message',Buffer.from('{"type":"session.closed","usage":{"seconds":2}}')));
  }
  terminate(){this.readyState=3;}
}
async function fixture(t,start={kind:'codex',bindings:{codex:'c',chatgpt:'g'}}) {
  const socket=new Socket(),writes=[],settled=[];
  const chats={codex:{id:'c',title:'Code',status:'idle',messages:[{id:'answer',role:'assistant',text:'État initial.'}]},chatgpt:{id:'g',title:'Projet',status:'idle',messages:[]}};
  const service={audio:{key:()=> 'test-key',status:()=>({usedUsd:0}),reserveLive:async()=>({seconds:300,settle:async(...v)=>settled.push(v)})},
    plugins:{decorate:async(text,ids=[])=>{if(ids.some(id=>id!=='plugin@market'))throw Error('Plugin unavailable');return ids.length?`${text}\nPLUGIN:${ids.join(',')}`:text;}},
    project:id=>{if(id!=='p')throw Error('Forbidden project');return{id,name:'Projet local'};},
    nativeChatgpt:{projects:async()=>[{id:'gp',name:'Projet ChatGPT'}]},
    route:async(method,url,body,key)=>{
      const kind=url.searchParams.get('kind')||body?.kind,chat=chats[kind];
      if(method==='POST'&&url.pathname==='/v1/threads'){writes.push({url,body,key});return{id:chat.id,kind};}
      if(!chat||!url.pathname.includes('/'+chat.id))throw Error('Forbidden context');
      if(method==='POST'){writes.push({url,body,key});return{id:chat.id,kind};}
      return chat;
    }};
  const call=new LiveCall({socket,service,WebSocketImpl:Provider});
  t.after(()=>call.finish(2));
  await call.command(Buffer.from(JSON.stringify({type:'start',voice:'marin',...start})));
  await new Promise(r=>setTimeout(r,1));
  return{call,socket,service,writes,chats,settled,provider:call.api};
}

test('voice routing changes only on explicit destinations and preserves the instruction',()=>{
  assert.deepEqual(voiceRoute('Passe à ChatGPT.','codex'),{kind:'chatgpt',switchOnly:true,text:'Passe à ChatGPT.'});
  assert.deepEqual(voiceRoute('Codex, corrige le bouton.','chatgpt'),{kind:'codex',switchOnly:false,text:'corrige le bouton.'});
  assert.equal(voiceRoute('Compare Codex et ChatGPT.','chatgpt').kind,'chatgpt');
  assert.equal(voiceRoute('ChatGPT, explique la différence.','codex').text,'explique la différence.');
});
test('microphone activity is counted without changing or storing its audio',async t=>{
 const {call,provider}=await fixture(t);
 await call.command(Buffer.from(JSON.stringify({type:'activity'})));
 assert.equal(call.diagnostics.inputVoiceSignals,1);
 assert.equal(provider.sent.some(e=>e.type==='activity'),false);
});
test('Bluetooth output compression is negotiated, lossless and can switch on reconnect',async t=>{
 const {call,socket}=await fixture(t,{kind:'codex',bindings:{codex:'c',chatgpt:'g'},outputEncodings:['deflate-pcm16'],outputEncoding:'deflate-pcm16'});
 const pcm=Buffer.alloc(9600);for(let i=0;i<pcm.length;i+=2)pcm.writeInt16LE((i%400)-200,i);
 call.event({type:'session.output_audio.delta',delta:pcm.toString('base64')});
 let audio=socket.sent.filter(e=>e.type==='audio').at(-1);
 assert.equal(audio.encoding,'deflate-pcm16');assert.equal(audio.pcmBytes,pcm.length);
 assert.deepEqual(inflateSync(Buffer.from(audio.audio,'base64')),pcm);
 assert.ok(Buffer.from(audio.audio,'base64').length<pcm.length);
 await call.command(Buffer.from(JSON.stringify({type:'output_encoding',encoding:'pcm16'})));
 call.event({type:'session.output_audio.delta',delta:pcm.toString('base64')});
 audio=socket.sent.filter(e=>e.type==='audio').at(-1);
 assert.equal(audio.encoding,undefined);assert.deepEqual(Buffer.from(audio.audio,'base64'),pcm);
 await call.command(Buffer.from(JSON.stringify({type:'output_encoding',encoding:'deflate-pcm16'})));
 const noise=randomBytes(4096);call.event({type:'session.output_audio.delta',delta:noise.toString('base64')});
 audio=socket.sent.filter(e=>e.type==='audio').at(-1);
 assert.equal(audio.encoding,undefined);assert.deepEqual(Buffer.from(audio.audio,'base64'),noise);
});
test('older watches continue receiving uncompressed PCM',async t=>{
 const {call,socket}=await fixture(t);const pcm=Buffer.alloc(4000);
 await call.command(Buffer.from(JSON.stringify({type:'output_encoding',encoding:'deflate-pcm16'})));
 call.event({type:'session.output_audio.delta',delta:pcm.toString('base64')});
 const audio=socket.sent.filter(e=>e.type==='audio').at(-1);
 assert.equal(audio.encoding,undefined);assert.deepEqual(Buffer.from(audio.audio,'base64'),pcm);
});
test('delta compression is lossless and enabled only for compatible watches',async t=>{
 const {call,socket}=await fixture(t,{kind:'codex',bindings:{codex:'c',chatgpt:'g'},outputEncodings:['deflate-pcm16','delta-deflate-pcm16'],outputEncoding:'deflate-pcm16'});
 await call.command(Buffer.from(JSON.stringify({type:'output_encoding',encoding:'delta-deflate-pcm16'})));
 const pcm=Buffer.alloc(9600);for(let i=0;i<pcm.length/2;i++)pcm.writeUInt16LE((i*13)&65535,i*2);
 call.event({type:'session.output_audio.delta',delta:pcm.toString('base64')});
 const audio=socket.sent.filter(e=>e.type==='audio').at(-1);
 assert.equal(audio.encoding,'delta-deflate-pcm16');assert.deepEqual(inflateSync(Buffer.from(audio.audio,'base64')),splitDeltaPcm(pcm));
 const split=inflateSync(Buffer.from(audio.audio,'base64')),result=Buffer.alloc(pcm.length),count=pcm.length/2;let previous=0;
 for(let i=0;i<count;i++){previous=(previous+split[i]+(split[count+i]<<8))&65535;result.writeUInt16LE(previous,i*2);}
 assert.deepEqual(result,pcm);
});
test('Opus is negotiated for supported watches and discarded on interruption',async t=>{
 const {call,socket}=await fixture(t,{kind:'codex',bindings:{codex:'c',chatgpt:'g'},outputEncodings:['deflate-pcm16','delta-deflate-pcm16','opus-24k'],outputEncoding:'deflate-pcm16'});
 await call.command(Buffer.from(JSON.stringify({type:'output_encoding',encoding:'opus-24k'})));
 call.event({type:'session.output_audio.delta',delta:Buffer.alloc(400).toString('base64')});
 assert.equal(socket.sent.filter(e=>e.type==='audio').length,0);
 call.blockSpeech();assert.equal(call.opus,null);call.allowSpeech();
 call.event({type:'session.output_audio.delta',delta:Buffer.alloc(960).toString('base64')});
 const audio=socket.sent.filter(e=>e.type==='audio').at(-1);assert.equal(audio.encoding,'opus-24k');assert.equal(audio.audioRevision,1);assert.equal(call.diagnostics.opusPackets,1);
 await call.command(Buffer.from(JSON.stringify({type:'output_encoding',encoding:'pcm16'})));
 call.event({type:'session.output_audio.delta',delta:Buffer.alloc(960).toString('base64')});
 assert.equal(socket.sent.filter(e=>e.type==='audio').at(-1).encoding,undefined);
});
test('a dropped watch link resumes the same Live session without resubmitting tasks',async t=>{
 const {call,socket,provider,writes}=await fixture(t);
 const token=call.resumeToken,providerCount=Provider.instances.length;
 socket.close();assert.equal(call.closing,false);assert.equal(call.socket,null);
 assert.equal(provider.sent.at(-1).type,'session.input_audio.mute');
 call.send({type:'transcript',role:'assistant',text:'Réponse conservée'});
 const replacement=new Socket();assert.equal(call.resumeSocket(replacement),true);
 assert.equal(call.resumeToken,token);assert.equal(Provider.instances.length,providerCount);assert.equal(writes.length,0);
 assert.equal(replacement.sent[0].type,'resumed');assert.equal(replacement.sent[1].text,'Réponse conservée');
 assert.equal(provider.sent.at(-1).type,'session.input_audio.unmute');
 socket.emit('message',Buffer.from('{"type":"audio","audio":"AAAA"}'));
 assert.equal(writes.length,0);
});
test('a muted Live remains muted after transport reconnection',async t=>{
 const {call,socket,provider}=await fixture(t);await call.command(Buffer.from('{"type":"mute","muted":true}'));
 socket.close();const before=provider.sent.length;assert.equal(call.resumeSocket(new Socket()),true);
 assert.equal(provider.sent.length,before);
});
test('authenticated WebSocket handover preserves one provider session and reservation',async t=>{
 let reservations=0;
 const service={alerts:new EventEmitter(),audio:{key:()=> 'test-key',status:()=>({usedUsd:0}),reserveLive:async()=>{reservations++;return {seconds:60,settle:async()=>{}};}},
   nativeChatgpt:{projects:async()=>[]},route:async()=>({id:'c',title:'Test',status:'idle',messages:[]})};
 const server=http.createServer();attachLive(server,service,header=>header==='Bearer test-token',{WebSocketImpl:Provider});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>{service.alerts.emit('close');server.close();});
 const url=`ws://127.0.0.1:${server.address().port}/v1/live`,headers={Authorization:'Bearer test-token'};
 function message(socket,type){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Missing '+type)),3000);const handler=raw=>{const v=JSON.parse(raw);if(v.type===type){clearTimeout(timer);socket.off('message',handler);resolve(v);}};socket.on('message',handler);});}
 const first=new WebSocket(url,{headers});await once(first,'open');const ready=message(first,'ready');first.send(JSON.stringify({type:'start',kind:'codex',voice:'marin',bindings:{codex:'c'}}));const initial=await ready;
 assert.match(initial.resumeToken,/^[a-f0-9-]{36}$/);const providerCount=Provider.instances.length;
 async function denied(target,requestHeaders,expected){await new Promise((resolve,reject)=>{const s=new WebSocket(target,{headers:requestHeaders});s.on('error',()=>{});s.on('unexpected-response',(_req,response)=>{try{assert.equal(response.statusCode,expected);response.resume();s.terminate();resolve();}catch(e){reject(e);}});s.on('open',()=>{s.close();reject(Error('Unexpected resume'));});});}
 await denied(url+'?resume='+initial.resumeToken,{},401);
 await denied(url+'?resume=incorrect',headers,409);
 first.terminate();
 const second=new WebSocket(url+'?resume='+initial.resumeToken,{headers});const resumed=message(second,'resumed');await once(second,'open');await resumed;
 assert.equal(reservations,1);assert.equal(Provider.instances.length,providerCount);
 const pong=message(second,'pong');second.send('{"type":"ping"}');await pong;
 const closed=message(second,'closed');second.send('{"type":"close"}');await closed;
});
test('transcription and a watch end hint never dispatch or nudge the voice model',async t=>{
 const {call,writes,provider}=await fixture(t);const count=provider.sent.length;
 call.event({type:'session.input_transcript.delta',delta:'Test de liaison vocale.',start_ms:0,end_ms:500});call.lastInput=Date.now()-3000;
 await call.command(Buffer.from('{"type":"utterance_end"}'));await new Promise(r=>setTimeout(r,1750));await call.upstreamQueue;
 assert.equal(writes.length,0);assert.equal(provider.sent.length,count);
});
test('transcript selection ignores already submitted, future and missing fragments',()=>{
  const f=[{start_ms:10,end_ms:20,delta:'ancienne '},{start_ms:30,end_ms:40,delta:'nouvelle '},{start_ms:41,end_ms:60,delta:'consigne'},{start_ms:9000,end_ms:9500,delta:'autre'}];
  assert.equal(transcriptFor(f,20,65),'nouvelle consigne');assert.equal(transcriptFor(f,10000,11000),'');
});
test('Live frontend selects client delegation without tools or a second backend model',async t=>{
  const{call,provider}=await fixture(t);assert.equal(call.ready,true);
  const session=provider.sent.find(e=>e.type==='session.start').session;
  assert.equal(session.model,'gpt-live-1');assert.equal(session.delegation.type,'client');assert.equal(session.store,false);
  assert.equal(session.audio.format.rate,24000);assert.equal(session.delegation.responses,undefined);
});
test('delegated instructions use the selected existing chat exactly once and never create a chat',async t=>{
  const{call,writes}=await fixture(t);
  call.fragments=[{start_ms:0,end_ms:400,delta:'Codex, corrige ce bouton.'}];call.lastInput=Date.now()-2000;
  await call.delegate({delegation:{id:'a'},offset_ms:500});
  assert.equal(writes.length,1);assert.equal(writes[0].url.pathname,'/v1/threads/c/messages');assert.equal(writes[0].body.text,'corrige ce bouton.');
  await call.delegate({delegation:{id:'b'},offset_ms:500});assert.equal(writes.length,1);
  assert.match(writes[0].key,/^[a-f0-9-]{36}$/);
});
test('explicit ChatGPT requests route to the native ChatGPT chat and status questions are read-only',async t=>{
  const{call,writes}=await fixture(t);
  call.fragments=[{start_ms:0,end_ms:400,delta:'ChatGPT, explique cette idée.'}];call.lastInput=Date.now()-2000;
  await call.delegate({delegation:{id:'a'},offset_ms:500});assert.equal(writes[0].url.pathname,'/v1/threads/g/messages');
  call.fragments.push({start_ms:600,end_ms:900,delta:'Codex, où en est la tâche ?'});call.lastInput=Date.now()-2000;
  await call.delegate({delegation:{id:'b'},offset_ms:1000});assert.equal(writes.length,1);assert.equal(call.target,'codex');
});
test('unavailable context switching preserves the prior destination and does not submit work',async t=>{
  const{call,service,writes,socket}=await fixture(t);const read=service.route;
  service.route=(m,u,b,k)=>u.searchParams.get('kind')==='chatgpt'?Promise.reject(Error('Rate limited')):read(m,u,b,k);
  assert.equal(await call.select('chatgpt'),false);assert.equal(call.target,'codex');assert.equal(writes.length,0);
  assert.ok(socket.sent.some(e=>e.type==='notice'));
});

test('new project contexts do not create a chat at call startup; first instruction creates once and later instructions continue it',async t=>{
  const{call,writes}=await fixture(t,{kind:'codex',bindings:{codex:{mode:'new',project:'p'},chatgpt:{mode:'new',project:'gp'}}});
  assert.equal(call.ready,true);assert.equal(writes.length,0);assert.equal(call.bindings.codex.id,undefined);
  call.fragments=[{start_ms:0,end_ms:400,delta:'Corrige le bouton.'}];call.lastInput=Date.now()-2000;
  await call.delegate({delegation:{id:'a'},offset_ms:500});
  assert.equal(writes.length,1);assert.equal(writes[0].url.pathname,'/v1/threads');assert.equal(writes[0].body.project,'p');assert.equal(call.bindings.codex.id,'c');
  call.fragments.push({start_ms:600,end_ms:900,delta:'Ajoute une animation.'});call.lastInput=Date.now()-2000;
  await call.delegate({delegation:{id:'b'},offset_ms:1000});
  assert.equal(writes.length,2);assert.equal(writes[1].url.pathname,'/v1/threads/c/messages');
});

test('new ChatGPT requests use the selected ChatGPT project and never reuse a recent chat',async t=>{
  const{call,writes}=await fixture(t,{kind:'chatgpt',bindings:{chatgpt:{mode:'new',project:'gp'}}});
  call.fragments=[{start_ms:0,end_ms:400,delta:'Explique ce projet.'}];call.lastInput=Date.now()-2000;
  await call.delegate({delegation:{id:'a'},offset_ms:500});
  assert.equal(writes[0].url.pathname,'/v1/threads');assert.equal(writes[0].body.kind,'chatgpt');assert.equal(writes[0].body.project,'gp');
});

test('Live plugins reach the same new and existing Codex chat and are not sent to ChatGPT',async t=>{
  const{call,writes,provider}=await fixture(t,{kind:'codex',plugins:['plugin@market'],bindings:{codex:{mode:'new',project:'p'},chatgpt:'g'}});
  assert.match(provider.sent.find(e=>e.type==='session.start').session.instructions,/plugin@market/);
  assert.match(provider.sent.find(e=>e.type==='session.start').session.instructions,/Délègue chaque demande ou affirmation de fond/);
  call.fragments=[{start_ms:0,end_ms:400,delta:'Corrige le bouton.'}];call.lastInput=Date.now()-2000;
  await call.delegate({delegation:{id:'a'},offset_ms:500});
  assert.equal(writes.length,1);assert.equal(writes[0].url.pathname,'/v1/threads');assert.match(writes[0].body.text,/PLUGIN:plugin@market/);
  assert.ok(provider.sent.some(e=>e.type==='session.commentary.append'&&e.content.includes('Attends son résultat')));
  call.fragments.push({start_ms:600,end_ms:900,delta:'Ajoute une animation.'});call.lastInput=Date.now()-2000;
  await call.delegate({delegation:{id:'b'},offset_ms:1000});
  assert.equal(writes.length,2);assert.equal(writes[1].url.pathname,'/v1/threads/c/messages');assert.match(writes[1].body.text,/PLUGIN:plugin@market/);
  call.fragments.push({start_ms:1100,end_ms:1400,delta:'ChatGPT, explique ce choix.'});call.lastInput=Date.now()-2000;
  await call.delegate({delegation:{id:'c'},offset_ms:1500});
  assert.equal(writes.length,3);assert.equal(writes[2].body.kind,'chatgpt');assert.doesNotMatch(writes[2].body.text,/PLUGIN:/);
});

test('invalid or unavailable Live plugins are rejected before an audio reservation',async t=>{
  for(const plugins of [['missing@market'],['invalid/id'],Array(6).fill('plugin@market')]){
    const{call,socket,provider}=await fixture(t,{kind:'codex',bindings:{codex:'c'},plugins});
    assert.equal(call.ready,false);assert.equal(provider,undefined);assert.equal(call.reservation,undefined);
    assert.ok(socket.sent.some(e=>e.type==='error'&&e.message.includes('plugin')));
  }
});

test('plugin Live suppresses an improvised answer until Codex accepts the delegated request',async t=>{
  const{call,socket,provider,writes}=await fixture(t,{kind:'codex',plugins:['plugin@market'],bindings:{codex:'c'}});
  const send=provider.send.bind(provider);provider.send=text=>{send(text);const event=JSON.parse(text);if(event.type==='session.instructions.append'&&event.content.startsWith('Arrête toute réponse précédente'))queueMicrotask(()=>call.event({type:'session.instructions.appended',client_event_id:event.event_id}));};
  call.event({type:'session.input_transcript.delta',event_id:'plugin-input',delta:'Une affirmation à vérifier.',start_ms:0,end_ms:500});
  assert.equal(call.pluginGate,true);assert.equal(call.speechAllowed,false);assert.ok(socket.sent.some(e=>e.type==='clear_audio'));
  call.event({type:'session.output_audio.delta',delta:Buffer.alloc(960).toString('base64')});
  call.event({type:'session.output_transcript.delta',delta:'Réponse improvisée',start_ms:600,end_ms:900});
  assert.equal(socket.sent.some(e=>e.type==='audio'),false);assert.equal(socket.sent.some(e=>e.type==='transcript'&&e.role==='assistant'),false);
  call.lastInput=Date.now()-2000;call.event({type:'session.delegation.created',delegation:{id:'plugin-gate',target:'client'},offset_ms:600});await call.upstreamQueue;
  assert.equal(writes.length,1);assert.equal(call.pluginGate,false);assert.equal(call.speechAllowed,true);
  assert.ok(provider.sent.some(e=>e.type==='session.commentary.append'&&e.content.includes('Attends son résultat')));
  call.event({type:'session.output_audio.delta',delta:Buffer.alloc(960).toString('base64')});assert.ok(socket.sent.some(e=>e.type==='audio'));
});

test('a simple greeting in plugin Live does not block the voice or submit a task',async t=>{
  const{call,socket,writes}=await fixture(t,{kind:'codex',plugins:['plugin@market'],bindings:{codex:'c'}});
  call.event({type:'session.input_transcript.delta',event_id:'hello',delta:'Bonjour !',start_ms:0,end_ms:300});
  assert.equal(call.pluginGate,false);call.event({type:'session.output_audio.delta',delta:Buffer.alloc(960).toString('base64')});
  assert.ok(socket.sent.some(e=>e.type==='audio'));assert.equal(writes.length,0);
});

test('if Live does not delegate a plugin request, the relay submits it once',async t=>{
  const{call,socket,provider,writes}=await fixture(t,{kind:'codex',plugins:['plugin@market'],bindings:{codex:'c'}});
  call.pluginGateDelayMs=10;call.pluginFailureDelayMs=10;
  const send=provider.send.bind(provider);provider.send=text=>{send(text);const event=JSON.parse(text);if(event.type==='session.instructions.append'&&event.content.startsWith('Arrête toute réponse précédente'))queueMicrotask(()=>call.event({type:'session.instructions.appended',client_event_id:event.event_id}));};
  call.event({type:'session.input_transcript.delta',event_id:'input',delta:'Une affirmation.',start_ms:0,end_ms:300});
  call.lastInput=Date.now()-2000;
  await new Promise(resolve=>setTimeout(resolve,80));
  await call.upstreamQueue;assert.equal(writes.length,1);assert.equal(call.pluginGate,false);assert.equal(call.speechAllowed,true);
  assert.ok(socket.sent.some(e=>e.type==='notice'&&e.message.includes('en attente')));
  assert.ok(!provider.sent.some(e=>e.type==='session.commentary.append'&&e.content.includes('n’a pas été transmise')));
  call.event({type:'session.delegation.created',delegation:{id:'late',target:'client'},offset_ms:400});await call.upstreamQueue;
  assert.equal(writes.length,1);assert.equal(call.diagnostics.duplicateDelegations,1);
  call.event({type:'session.input_transcript.delta',event_id:'next',delta:'Change aussi la couleur.',start_ms:3000,end_ms:3400});call.lastInput=Date.now()-2000;
  call.event({type:'session.delegation.created',delegation:{id:'late-after-next',target:'client'},offset_ms:400});await call.upstreamQueue;
  assert.equal(writes.length,1);assert.equal(call.diagnostics.duplicateDelegations,2);
  call.event({type:'session.delegation.created',delegation:{id:'next-task',target:'client'},offset_ms:3500});await call.upstreamQueue;
  assert.equal(writes.length,2);assert.ok(writes[1].body.text.includes('Change aussi la couleur.'));
});

test('a slow in-flight plugin delegation is not prompted a second time',async t=>{
  const{call,service,provider,writes}=await fixture(t,{kind:'codex',plugins:['plugin@market'],bindings:{codex:'c'}});
  call.pluginGateDelayMs=10;let release;const blocked=new Promise(resolve=>{release=resolve;});const route=service.route;
  service.route=async(...args)=>{if(args[0]==='POST')await blocked;return route(...args);};
  const send=provider.send.bind(provider);provider.send=text=>{send(text);const event=JSON.parse(text);if(event.type==='session.instructions.append'&&event.content.startsWith('Arrête toute réponse précédente'))queueMicrotask(()=>call.event({type:'session.instructions.appended',client_event_id:event.event_id}));};
  call.event({type:'session.input_transcript.delta',event_id:'part-a',delta:'Une affirmation',start_ms:0,end_ms:300});
  call.lastInput=Date.now()-2000;call.event({type:'session.delegation.created',delegation:{id:'slow-plugin',target:'client'},offset_ms:300});
  call.event({type:'session.input_transcript.delta',event_id:'part-b',delta:' complète.',start_ms:301,end_ms:500});call.lastInput=Date.now()-2000;
  await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(call.pendingDelegations,1);assert.ok(!provider.sent.some(e=>e.type==='session.instructions.append'&&e.content.startsWith('Transmets maintenant')));
  release();await call.upstreamQueue;assert.equal(writes.length,1);assert.equal(call.pendingDelegations,0);
});

test('interrupting a held plugin response restores listening without submitting a task',async t=>{
  const{call,provider,writes}=await fixture(t,{kind:'codex',plugins:['plugin@market'],bindings:{codex:'c'}});
  call.event({type:'session.input_transcript.delta',event_id:'input',delta:'Une affirmation.',start_ms:0,end_ms:300});assert.equal(call.pluginGate,true);
  call.interruptSpeech('button');const permit=call.stopPermit;assert.equal(call.pluginGate,false);
  call.event({type:'session.instructions.appended',client_event_id:permit});assert.equal(call.speechAllowed,true);assert.equal(writes.length,0);
  assert.ok(provider.sent.some(e=>e.type==='session.instructions.append'&&e.event_id===permit));
});

test('an uncertain fallback submission is not automatically retried',async t=>{
  const{call,service,provider,writes}=await fixture(t,{kind:'codex',plugins:['plugin@market'],bindings:{codex:'c'}});
  call.pluginGateDelayMs=10;call.pluginFailureDelayMs=10;
  const send=provider.send.bind(provider);provider.send=text=>{send(text);const event=JSON.parse(text);if(event.type==='session.instructions.append'&&event.content.startsWith('Arrête toute réponse précédente'))queueMicrotask(()=>call.event({type:'session.instructions.appended',client_event_id:event.event_id}));};
  const route=service.route;service.route=async(...args)=>{if(args[0]==='POST'){writes.push(args);throw Error('connection lost');}return route(...args);};
  call.event({type:'session.input_transcript.delta',delta:'Modifie le projet.',start_ms:0,end_ms:300});call.lastInput=Date.now()-2000;
  await new Promise(resolve=>setTimeout(resolve,80));await call.upstreamQueue;
  call.event({type:'session.delegation.created',delegation:{id:'late-uncertain',target:'client'},offset_ms:400});await call.upstreamQueue;
  assert.equal(writes.length,1);assert.ok(provider.sent.some(e=>e.content?.includes('Vérifie ce chat')));
});

test('a Codex plugin selection does not block the ChatGPT voice context',async t=>{
  const{call,socket}=await fixture(t,{kind:'chatgpt',plugins:['plugin@market'],bindings:{codex:'c',chatgpt:'g'}});
  call.event({type:'session.input_transcript.delta',event_id:'chat',delta:'Explique cette idée.',start_ms:0,end_ms:400});
  assert.equal(call.pluginGate,false);call.event({type:'session.output_audio.delta',delta:Buffer.alloc(960).toString('base64')});
  assert.ok(socket.sent.some(e=>e.type==='audio'));
});

test('status without a first task and pending creation never generate extra chats',async t=>{
  const{call,writes,service}=await fixture(t,{kind:'codex',bindings:{codex:{mode:'new',project:'p'}}});
  call.fragments=[{start_ms:0,end_ms:400,delta:'Où en est la tâche ?'}];call.lastInput=Date.now()-2000;
  await call.delegate({delegation:{id:'a'},offset_ms:500});assert.equal(writes.length,0);
  service.route=async(method,url,body)=>{if(method==='POST'){writes.push(body);return{pending:true};}throw Error('No created chat yet');};
  call.fragments.push({start_ms:600,end_ms:900,delta:'Crée le bouton.'});call.lastInput=Date.now()-2000;
  await call.delegate({delegation:{id:'b'},offset_ms:1000});assert.equal(writes.length,1);
  call.fragments.push({start_ms:1100,end_ms:1400,delta:'Et son animation.'});call.lastInput=Date.now()-2000;
  await call.delegate({delegation:{id:'c'},offset_ms:1500});assert.equal(writes.length,1);
});

test('invalid projects are rejected before any paid Live session starts',async t=>{
  const{call,provider,socket}=await fixture(t,{kind:'codex',bindings:{codex:{mode:'new',project:'outside'}}});
  assert.equal(call.ready,false);assert.equal(provider,undefined);assert.equal(call.reservation,undefined);
  assert.ok(socket.sent.some(e=>e.type==='error'));
});
test('mute and speech interruption never cancel a PC task; hangup finalizes duration',async t=>{
  const{call,writes,provider,settled}=await fixture(t);
  await call.command(Buffer.from('{"type":"mute","muted":true}'));
  await call.command(Buffer.from('{"type":"interrupt"}'));
  assert.equal(writes.length,0);assert.ok(provider.sent.some(e=>e.type==='session.input_audio.mute'));
  await call.close();await new Promise(r=>setTimeout(r,1));assert.deepEqual(settled,[[2,false]]);
});

test('public progress updates remain available while the native task is active; only verified completion is spoken',async t=>{
  const{call,chats,socket,provider}=await fixture(t);let polls=0;
  const watch={baseline:new Map([['answer','État initial.']]),id:'delegation'};
  chats.codex.status='active';chats.codex.messages=[{id:'progress',role:'assistant',phase:'commentary',text:'Voici les projets accessibles.'}];
  call.pause=async()=>{polls++;if(polls===3){chats.codex.status='idle';chats.codex.messages=[{id:'final',role:'assistant',phase:'final',text:'Le travail est terminé.'}];}assert.ok(polls<=3);};
  await call.watch('codex','c',watch);
  assert.deepEqual(socket.sent.filter(e=>e.type==='backend').map(e=>e.status),['active','idle']);
  assert.ok(provider.sent.some(e=>e.type==='session.thinking.append'&&e.content.includes('Message intermédiaire')));
});

test('a plugin response retains its argument, tone and final question for the voice frontend',async t=>{
  const{call,chats,provider}=await fixture(t,{kind:'codex',plugins:['plugin@market'],bindings:{codex:'c'}});
  const answer='Début. '+('Fait sourcé et explication. '.repeat(75))+'MILIEU IMPORTANT. '+('Argument précis 🎯. '.repeat(75))+'Question finale ?';
  chats.codex.status='idle';chats.codex.messages=[{id:'plugin-final',role:'assistant',phase:'final_answer',text:answer}];
  call.pause=async()=>{};
  await call.watch('codex','c',{baseline:new Map(),id:'plugin-answer',userText:'Donne ta réponse.'});
  const event=provider.sent.filter(e=>e.type==='session.commentary.append').at(-1);
  const chunks=provider.sent.filter(e=>e.type==='session.thinking.append'&&e.content.startsWith('Réponse du plugin, partie '));
  assert.ok(chunks.length>1);assert.ok(chunks.every(e=>Buffer.byteLength(e.content,'utf8')<500));
  const reconstructed=chunks.map(e=>e.content.replace(/^Réponse du plugin, partie \d+\/\d+ : /,'')).join('');
  assert.equal(reconstructed,answer);assert.ok(event.content.includes('Restitue fidèlement'));
});
test('a plugin result remains available after a conversational follow-up',async t=>{
  const{call,chats,provider}=await fixture(t,{kind:'codex',plugins:['plugin@market'],bindings:{codex:'c'}});
  chats.codex.status='idle';chats.codex.messages=[{id:'final',role:'assistant',phase:'final_answer',text:'Ancien résultat du plugin.'}];
  call.pause=async()=>{};call.inputRevision=2;
  const before=provider.sent.filter(e=>e.type==='session.commentary.append').length;
  await call.watch('codex','c',{baseline:new Map(),id:'late-plugin',inputRevision:1,userText:'Ancienne demande.'});
  assert.equal(provider.sent.filter(e=>e.type==='session.commentary.append').length,before+1);
  assert.ok(provider.sent.some(e=>e.type==='session.commentary.append'&&e.content.includes('Restitue fidèlement')));
});

test('a progress request during plugin work does not block speech or discard its completed answer',async t=>{
  const{call,chats,provider,writes}=await fixture(t,{kind:'codex',plugins:['plugin@market'],bindings:{codex:'c'}});
  const watch={baseline:new Map(),id:'active-task',requestKey:'key',userText:'Vérifie cette affirmation.'};
  call.watches.set('codex:c',watch);call.pluginGateDelayMs=10;call.pluginFailureDelayMs=10;
  call.event({type:'session.input_transcript.delta',event_id:'progress',delta:'N’hésite pas à me dire quand c’est bon.',start_ms:2000,end_ms:2800});
  assert.equal(call.pluginGate,false);assert.equal(call.speechAllowed,true);
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(writes.length,0);assert.ok(!provider.sent.some(e=>e.content?.includes('n’a pas été transmise')));
  chats.codex.messages=[{id:'watch-key',role:'user',text:'Vérifie cette affirmation.'},{id:'final',role:'assistant',phase:'final_answer',text:'Résultat sourcé.'}];
  call.pause=async()=>{};await call.watch('codex','c',watch);
  assert.ok(provider.sent.some(e=>e.type==='session.commentary.append'&&e.content.includes('Restitue fidèlement')));
});

test('a pending replacement is resolved before an older result can be spoken',async t=>{
  const{call,chats,provider}=await fixture(t,{kind:'codex',plugins:['plugin@market'],bindings:{codex:'c'}});
  const watch={baseline:new Map(),id:'old',requestKey:'old',userText:'Première demande'};let polls=0;
  call.pendingDelegations=1;
  call.pause=async()=>{polls++;if(polls===1){chats.codex.messages=[{id:'old-answer',role:'assistant',phase:'final_answer',text:'Ancienne réponse.'}];}
    else {call.pendingDelegations=0;watch.requestKey='new';watch.id='new';chats.codex.messages=[{id:'new-answer',role:'assistant',phase:'final_answer',text:'Réponse corrigée.'}];}};
  await call.watch('codex','c',watch);
  const parts=provider.sent.filter(e=>e.type==='session.thinking.append').map(e=>e.content).join(' ');
  assert.ok(parts.includes('Réponse corrigée.'));assert.ok(!parts.includes('Ancienne réponse.'));
});

test('a finished plugin task is not spoken into another selected context',async t=>{
  const{call,chats,provider}=await fixture(t,{kind:'codex',plugins:['plugin@market'],bindings:{codex:'c',chatgpt:'g'}});
  chats.codex.messages=[{id:'final',role:'assistant',phase:'final_answer',text:'Résultat Codex.'}];call.target='chatgpt';call.pause=async()=>{};
  const before=provider.sent.filter(e=>e.type==='session.commentary.append').length;
  await call.watch('codex','c',{baseline:new Map(),id:'old',userText:'Recherche.'});
  assert.equal(provider.sent.filter(e=>e.type==='session.commentary.append').length,before);
  assert.ok(provider.sent.some(e=>e.type==='session.thinking.append'&&e.content.includes('contexte actif a changé')));
});
test('shared audio allowance reserves before Live, reconciles duration and retains unknown calls',async()=>{
  let saves=0;const store={data:{},save:async()=>{saves++;}};
  const audio=new AudioService({store,directory:'unused',key:()=> 'test'});
  await audio.configure({mode:'watch',voice:'marin',monthlyLimitCents:0});await assert.rejects(audio.reserveLive(),/Budget/);
  await audio.configure({mode:'watch',voice:'marin',monthlyLimitCents:5});
  const call=await audio.reserveLive();assert.ok(saves>=3);assert.ok(call.seconds<60);assert.ok(audio.status().reservedUsd>0);
  await assert.rejects(audio.reserveLive(),/Budget/);
  await call.settle(3);assert.equal(audio.status().usedUsd,.0025);assert.equal(audio.status().reservedUsd,0);
  await audio.configure({mode:'watch',voice:'marin',monthlyLimitCents:500});const uncertain=await audio.reserveLive();const used=audio.status().usedUsd;
  await uncertain.settle();assert.equal(audio.status().usedUsd,used);assert.equal(audio.state.jobs[uncertain.id].state,'unknown');
});

test('disconnect during a slow context read cannot open or bill a late voice session',async()=>{
  let release,reservations=0;const waiting=new Promise(r=>{release=r;});
  const service={audio:{status:()=>({}),reserveLive:async()=>{reservations++;throw Error('Must not reserve');}},route:async()=>{await waiting;return{id:'c',title:'Code',messages:[]};}};
  const socket=new Socket(),call=new LiveCall({socket,service,WebSocketImpl:Provider});
  const start=call.command(Buffer.from('{"type":"start","kind":"codex","bindings":{"codex":"c"}}'));
  await call.close();release();await start;assert.equal(reservations,0);assert.equal(call.api,undefined);
});

test('WebSocket upgrade requires bearer authentication, rejects browser origins and permits one call only',async t=>{
  const service={alerts:new EventEmitter(),audio:{status:()=>({})}};const token='a'.repeat(43);
  const server=createHttpServer(service,token).listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{service.alerts.emit('close');server.close();});
  const url=`ws://127.0.0.1:${server.address().port}/v1/live`;
  async function rejected(headers,status){await new Promise((resolve,reject)=>{const s=new WebSocket(url,{headers});s.on('error',()=>{});s.on('unexpected-response',(_req,r)=>{try{assert.equal(r.statusCode,status);r.resume();s.terminate();resolve();}catch(e){reject(e);}});s.on('open',()=>{s.close();reject(Error('Unexpected acceptance'));});});}
  await rejected({},401);await rejected({Authorization:'Bearer '+token,Origin:'https://example.com'},401);
  const one=new WebSocket(url,{headers:{Authorization:'Bearer '+token}});await once(one,'open');
  await rejected({Authorization:'Bearer '+token},409);
  const closed=once(one,'close');one.close();await closed;
});


test('native history is a reference archive and submission acknowledgments remain silent',async t=>{
 const {call,provider,writes}=await fixture(t);
 const input=provider.sent.find(e=>e.type==='session.start').session.input;
 assert.ok(input.some(m=>m.role==='user'&&m.content[0].text.includes('État initial.')));assert.ok(!input.some(m=>m.role==='assistant'));
 assert.equal(input.at(-1).role,'developer');assert.ok(input.at(-1).content[0].text.includes('pas des demandes nouvelles'));
 call.fragments=[{start_ms:0,end_ms:400,delta:'Corrige ce bouton.'}];call.lastInput=Date.now()-2000;
 await call.delegate({delegation:{id:'silent-receipt'},offset_ms:500});assert.equal(writes.length,1);
 assert.ok(provider.sent.some(e=>e.type==='session.thinking.append'&&e.content.includes('Demande transmise')));
 assert.ok(!provider.sent.some(e=>e.type==='session.commentary.append'&&e.content.includes('Demande transmise')));
});
test('an old answer before the submitted user message cannot be read as the new response',async t=>{
 const {call,chats,socket}=await fixture(t);let polls=0;
 const watch={baseline:new Map(),id:'task',requestText:'Deuxième question',requestKey:'key'};
 call.pause=async()=>{if(++polls===1)chats.codex.messages=[{id:'old',role:'assistant',text:'Réponse précédente'},{id:'watch-key',role:'user',text:'Deuxième question'}];else chats.codex.messages.push({id:'new',role:'assistant',text:'La bonne réponse',phase:'final_answer'});assert.ok(polls<=2);};
 await call.watch('codex','c',watch);
 assert.equal(polls,2);assert.equal(socket.sent.filter(e=>e.type==='backend').length,1);
 assert.equal(socket.sent.find(e=>e.type==='backend').message,'La bonne réponse');
});
test('stale cached history is not mistaken for a fresh backend response',async t=>{
 const {call,chats,socket}=await fixture(t);let pauses=0;
 chats.chatgpt.historyStale=true;chats.chatgpt.messages=[{id:'cache',role:'assistant',text:'Ancienne réponse'}];
 call.pause=async()=>{if(++pauses===3){chats.chatgpt.historyStale=false;chats.chatgpt.messages=[{id:'fresh',role:'assistant',text:'Nouvelle réponse'}];}assert.ok(pauses<=3);};
 await call.watch('chatgpt','g',{baseline:new Map(),id:'task'});
 assert.equal(socket.sent.filter(e=>e.type==='backend').length,1);
 assert.equal(socket.sent.find(e=>e.type==='backend').message,'Nouvelle réponse');
});
test('metadata-only limited history fails before starting a paid voice session',async t=>{
 const {call}=await fixture(t);await call.finish(2);
 const socket=new Socket(),service={...call.service,route:async()=>({id:'g',title:'Chat',messages:[],historyStale:true})};
 const other=new LiveCall({socket,service,WebSocketImpl:Provider});t.after(()=>other.finish(0,true));
 await other.command(Buffer.from(JSON.stringify({type:'start',kind:'chatgpt',bindings:{chatgpt:'g'}})));
 assert.equal(other.api,undefined);assert.ok(socket.sent.some(e=>e.type==='error'&&e.message.includes('contexte')));
});


test('delegated status only reads the existing chat and does not add a new request',async t=>{
 const {call,writes}=await fixture(t);call.fragments=[{start_ms:0,end_ms:500,delta:'Rappelle-moi la dernière question.'}];call.lastInput=Date.now()-2000;
 await call.delegate({delegation:{id:'status'},offset_ms:600});assert.equal(writes.length,0);
});
test('the voice model can hand a short answer to the same native chat',async t=>{
 const {call,writes}=await fixture(t);call.fragments=[{delta:'Oui.',start_ms:0,end_ms:400}];call.lastInput=Date.now()-2000;
 await call.delegate({delegation:{id:'yes'},offset_ms:500});assert.equal(writes[0].body.text,'Oui.');assert.equal(writes[0].url.pathname,'/v1/threads/c/messages');
});

test('the voice call stays open during backend work but still times out when genuinely idle',async t=>{
 const {call}=await fixture(t);call.lastActivity=Date.now()-61000;call.watches.set('codex:c',{});
 await new Promise(r=>setTimeout(r,1100));assert.equal(call.closing,false);
 call.watches.clear();await new Promise(r=>setTimeout(r,1100));assert.equal(call.closing,true);
});


test('read-only history recall can still speak immediately from the inherited context',async t=>{
 const {call,socket}=await fixture(t);call.event({type:'session.input_transcript.delta',delta:'Rappelle-moi la dernière question.',start_ms:0,end_ms:500});
 call.event({type:'session.output_audio.delta',delta:'AAAA'});assert.equal(socket.sent.at(-1).type,'audio');
});




test('a short continuation is sent only on semantic delegation, without a watch end hint',async t=>{
 const {call,writes}=await fixture(t,{kind:'chatgpt',bindings:{chatgpt:'g'}});call.event({type:'session.input_transcript.delta',delta:'Vas-y, continue.',start_ms:0,end_ms:700});
 await new Promise(r=>setTimeout(r,2300));await call.upstreamQueue;
 assert.equal(writes.length,0);
 call.event({type:'session.delegation.created',delegation:{id:'continue',target:'client'},offset_ms:800});await call.upstreamQueue;
 assert.equal(writes.length,1);assert.equal(writes[0].body.text,'Vas-y, continue.');assert.equal(writes[0].url.pathname,'/v1/threads/g/messages');
 await call.delegate({delegation:{id:'late'},offset_ms:800});assert.equal(writes.length,1);
});
test('semantic delegation waits for a complete instruction and never submits ASR fragments twice',async t=>{
 const {call,writes}=await fixture(t);call.event({type:'session.input_transcript.delta',delta:'Explique-moi ',start_ms:0,end_ms:500});await new Promise(r=>setTimeout(r,700));
 call.event({type:'session.delegation.created',delegation:{id:'explain',target:'client'},offset_ms:550});
 call.event({type:'session.input_transcript.delta',delta:'plus simplement.',start_ms:501,end_ms:1100});await new Promise(r=>setTimeout(r,700));assert.equal(writes.length,0);
 await new Promise(r=>setTimeout(r,1600));await call.upstreamQueue;assert.equal(writes.length,1);assert.equal(writes[0].body.text,'Explique-moi plus simplement.');
 call.event({type:'session.delegation.created',delegation:{id:'explain',target:'client'},offset_ms:550});await call.upstreamQueue;assert.equal(writes.length,1);assert.equal(call.diagnostics.duplicateDelegations,1);
});
test('ordinary conversation stays local while a native task continues in parallel',async t=>{
 const {call,writes,socket}=await fixture(t);const pending={id:'existing'};call.watches.set('codex:c',pending);
 call.event({type:'session.input_transcript.delta',delta:'Pourquoi me poses-tu cette question ?',start_ms:0,end_ms:700});
 call.event({type:'session.output_transcript.delta',delta:'Pour comprendre laquelle des deux options tu préfères.',start_ms:800,end_ms:1500});
 call.event({type:'session.output_audio.delta',delta:'AAAA'});await new Promise(r=>setTimeout(r,2300));await call.upstreamQueue;
 assert.equal(writes.length,0);assert.equal(call.watches.get('codex:c'),pending);assert.ok(socket.sent.some(e=>e.type==='audio'));
});

test('bot speech can overlap user input without waiting for a backend result',async t=>{
 const {call,socket,writes,provider}=await fixture(t);const before=socket.sent.length;
 call.event({type:'session.input_transcript.delta',delta:'Je réfléchis à deux possibilités…',start_ms:0,end_ms:1200});
 await call.command(Buffer.from(JSON.stringify({type:'audio',audio:Buffer.alloc(1920).toString('base64')})));
 call.event({type:'session.output_audio.delta',delta:'AAAA'});call.event({type:'session.output_transcript.delta',delta:'Quelle différence te semble importante ?',start_ms:500,end_ms:1100});
 assert.ok(socket.sent.slice(before).some(e=>e.type==='audio'));assert.ok(!socket.sent.slice(before).some(e=>e.type==='clear_audio'));assert.equal(writes.length,0);assert.ok(provider.sent.some(e=>e.type==='session.input_audio.append'));
});
test('user interruption clears queued speech, keeps listening and drops the old audio tail',async t=>{
 const {call,socket,provider,writes}=await fixture(t);await call.command(Buffer.from('{"type":"speech_started"}'));const stop=provider.sent.at(-1),before=socket.sent.length;
 call.event({type:'session.output_audio.delta',delta:'OLD'});await call.command(Buffer.from(JSON.stringify({type:'audio',audio:Buffer.alloc(1920).toString('base64')})));
 assert.ok(!socket.sent.slice(before).some(e=>e.type==='audio'));assert.ok(provider.sent.some(e=>e.type==='session.input_audio.append'));assert.equal(writes.length,0);
 call.event({type:'session.instructions.appended',client_event_id:stop.event_id});call.event({type:'session.output_audio.delta',delta:'NEW'});
 assert.deepEqual(socket.sent.slice(before).filter(e=>e.type==='audio').map(e=>e.audio),['NEW']);assert.equal(socket.sent.at(-1).audioRevision,1);
});
test('queued delegation keeps its chosen destination if the user switches during it',async t=>{
 const {call,writes}=await fixture(t);call.target='chatgpt';call.fragments=[{delta:'Corrige ce bouton.',start_ms:0,end_ms:500}];call.lastInput=Date.now()-2000;
 await call.delegate({delegation:{id:'queued'},offset_ms:600,target:'codex'});assert.equal(writes[0].url.pathname,'/v1/threads/c/messages');assert.equal(call.target,'chatgpt');
});


test('a clarification spoken in Live accompanies its answer when work is handed to the native chat',async t=>{
 const {call,writes}=await fixture(t);call.event({type:'session.output_transcript.delta',delta:'Tu veux le premier plan ou les deux possibilités ?',start_ms:0,end_ms:900});
 call.fragments=[{delta:'Les deux.',start_ms:1100,end_ms:1500}];call.lastInput=Date.now()-2000;
 await call.delegate({delegation:{id:'clarification'},offset_ms:1600,inputStart:1100});
 assert.equal(writes[0].url.pathname,'/v1/threads/c/messages');assert.ok(writes[0].body.text.startsWith('Les deux.'));assert.ok(writes[0].body.text.includes('les deux possibilités'));
});
test('a response fetched for the preceding request is ignored when a newer instruction replaces it',async t=>{
 const {call,chats,socket}=await fixture(t);let polls=0;const watch={baseline:new Map(),id:'turn',requestKey:'old'};
 call.pause=async()=>{if(++polls>2)throw Error('Unexpected extra poll');};const read=call.read.bind(call);
 call.read=async(...args)=>{const result=await read(...args);if(polls===1){watch.requestKey='new';result.messages=[{id:'old-result',role:'assistant',text:'Résultat dépassé'}];}else result.messages=[{id:'new-result',role:'assistant',text:'Résultat corrigé'}];return result;};
 await call.watch('codex','c',watch);assert.equal(socket.sent.filter(e=>e.type==='backend').length,1);assert.equal(socket.sent.find(e=>e.type==='backend').message,'Résultat corrigé');
});

test('repeated conversational turns and interruptions do not restart the session or inject reply nudges',async t=>{
 const {call,writes,provider}=await fixture(t);let time=1200;
 for(const text of ['Moi aussi.','Comment ça va ?','Comment ça va ?','Ça va.','Non, attends.']){
  await call.command(Buffer.from('{"type":"speech_started"}'));
  const stop=provider.sent.at(-1);
  call.event({type:'session.instructions.appended',client_event_id:stop.event_id});
  call.event({type:'session.input_transcript.delta',event_id:'user-'+time,delta:text,start_ms:time,end_ms:time+400});
  call.event({type:'session.output_transcript.delta',delta:'Je suis là.',start_ms:time+600,end_ms:time+900});
  await call.command(Buffer.from('{"type":"utterance_end"}'));time+=3000;
 }
 await new Promise(r=>setTimeout(r,2300));await call.upstreamQueue;
 assert.equal(writes.length,0);assert.equal(call.diagnostics.sessionStarts,1);assert.equal(call.diagnostics.nativeSubmissions,0);
 assert.equal(provider.sent.filter(e=>e.type==='session.thinking.append').length,0);
 assert.equal(provider.sent.filter(e=>e.type==='session.commentary.append').length,1); // Opening greeting only.
 assert.equal(call.diagnostics.interruptions,5);
 assert.equal(call.diagnostics.coalescedInterruptions,0); // ASR belongs to an already handled interruption.
});

test('VAD and delayed explicit stop share one interruption control',async t=>{
 const {call,provider}=await fixture(t);await call.command(Buffer.from('{"type":"speech_started"}'));
 const stop=provider.sent.at(-1);call.event({type:'session.instructions.appended',client_event_id:stop.event_id});
 call.event({type:'session.input_transcript.delta',delta:'Non, attends, je change de question.',start_ms:2000,end_ms:2800});
 assert.equal(call.diagnostics.interruptions,1);assert.equal(provider.sent.filter(e=>e.type==='session.instructions.append').length,1);
});

test('a delayed native result remains audible after a new spoken intervention',async t=>{
 const {call,chats,provider}=await fixture(t);call.inputRevision=2;let polls=0;
 call.pause=async()=>{assert.equal(++polls,1);chats.codex.messages=[{id:'done',role:'assistant',phase:'final',text:'Ancien résultat.'}];};
 await call.watch('codex','c',{baseline:new Map(),id:'old-task',inputRevision:1});
 const result=provider.sent.find(e=>e.content?.includes('Ancien résultat'));
 assert.equal(result.type,'session.commentary.append');
});

test('delegation snapshots oral context before a slow native read',async t=>{
 const {call,service,writes}=await fixture(t);const read=service.route;
 call.event({type:'session.output_transcript.delta',delta:'Tu veux modifier le premier bouton ou le second ?',start_ms:0,end_ms:800});
 call.event({type:'session.input_transcript.delta',delta:'Le second.',start_ms:1800,end_ms:2300});call.lastInput=Date.now()-2000;
 service.route=async(...args)=>{if(args[0]==='GET'){call.event({type:'session.output_transcript.delta',delta:'Nouveau sujet sans rapport.',start_ms:2500,end_ms:3100});call.inputRevision++;}return read(...args);};
 await call.delegate({delegation:{id:'snapshot'},offset_ms:2400,inputStart:1800});
 assert.ok(writes[0].body.text.includes('le second ?'));assert.ok(!writes[0].body.text.includes('Nouveau sujet'));
 assert.ok(call.watches.get('codex:c').inputRevision<call.inputRevision);
});

test('silent provider PCM does not keep an abandoned paid session alive',async t=>{
 const {call}=await fixture(t);const inactive=Date.now()-61000;call.lastActivity=inactive;
 call.event({type:'session.output_audio.delta',delta:Buffer.alloc(1920).toString('base64')});assert.equal(call.lastActivity,inactive);
 await new Promise(r=>setTimeout(r,1100));assert.equal(call.closing,true);
});

test('a delayed delegation cannot consume a separate later instruction waiting behind it',async t=>{
 const {call,writes}=await fixture(t);call.fragments=[{delta:'Corrige le bouton.',start_ms:1000,end_ms:1800},{delta:'Change aussi son icône.',start_ms:4500,end_ms:5300}];call.lastInputEnd=5300;call.lastInput=Date.now()-2000;
 await call.delegate({delegation:{id:'first'},offset_ms:1900,inputStart:1000});
 await call.delegate({delegation:{id:'second'},offset_ms:5400,inputStart:4500});
 assert.equal(writes.length,2);assert.equal(writes[0].body.text,'Corrige le bouton.');assert.equal(writes[1].body.text,'Change aussi son icône.');
});

test('a slow context switch cannot overwrite the most recent context choice',async t=>{
 const {call}=await fixture(t);const read=call.read.bind(call);let release;
 const waiting=new Promise(r=>release=r);call.read=async(kind,id)=>{if(kind==='chatgpt')await waiting;return read(kind,id);};
 const first=call.select('chatgpt');assert.equal(await call.select('codex'),true);release();assert.equal(await first,false);assert.equal(call.target,'codex');
});
