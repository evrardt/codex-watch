import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Store } from '../store.mjs';
import { AudioService, audioCost, speechBounds, generateSpeech } from '../audio.mjs';
import { PHONON_CATALOG } from '../phonon.mjs';

const usage = {input_tokens:100,output_tokens:110,output_token_details:{audio_tokens:100}};
async function setup(t, options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(),'codexwatch-audio-'));
  const store = new Store(path.join(dir,'state.json')); await store.load();
  let calls = 0;
  const audio = new AudioService({store,directory:path.join(dir,'audio'),key:()=> 'test-key',
    generate:async()=> { calls++; return {audio:Buffer.alloc(100),usage}; },...options});
  t.after(async()=>{await store.queue; assert.ok(path.basename(dir).startsWith('codexwatch-audio-')); await rm(dir,{recursive:true,force:true});});
  return {audio,store,dir,calls:()=>calls};
}
const enabled = {mode:'openai',voice:'marin',monthlyLimitCents:500};

test('automatic playback preference is validated, saved and shared with audio settings',async t=>{
  const {audio,store}=await setup(t);
  assert.equal(audio.status().autoReadDictation,true);
  await audio.setAutoReadDictation(false);await audio.configure(enabled);
  assert.equal(audio.status().autoReadDictation,false);assert.equal(store.data.audio.settings.autoReadDictation,false);
  await assert.rejects(audio.setAutoReadDictation('false'),/réponses dictées/);
  await audio.setAutoReadDictation(true);assert.equal(audio.status().autoReadDictation,true);
});

test('reading speed is saved separately for each provider and validated',async t=>{
  const {audio,store}=await setup(t);
  assert.deepEqual(audio.status().speechSpeeds,{watch:1,openai:1,phonon:1});
  await audio.setSpeechSpeed('phonon',1.30);await audio.setSpeechSpeed('openai',.85);
  await audio.configure(enabled);
  assert.deepEqual(audio.status().speechSpeeds,{watch:1,openai:.85,phonon:1.3});
  assert.deepEqual(store.data.audio.settings.speechSpeeds,{phonon:1.3,openai:.85});
  await audio.setSpeechSpeed('watch',.75);await audio.setSpeechSpeed('watch',1.5);
  await assert.rejects(audio.setSpeechSpeed('phonon',9),/vitesse/);
  await assert.rejects(audio.setSpeechSpeed('phonon',1.33),/vitesse/);
  await assert.rejects(audio.setSpeechSpeed('live',1),/vitesse/);
});

test('reader is opt-in; zero allowance and absent credentials never call OpenAI',async t=>{
  const {audio,calls} = await setup(t);
  assert.equal((await audio.speak('Bonjour')).reason,'WATCH_SELECTED');
  await audio.configure({...enabled,monthlyLimitCents:0});
  assert.equal((await audio.speak('Bonjour')).reason,'BUDGET_REACHED');
  await audio.configure(enabled); audio.key = ()=>'';
  assert.equal((await audio.speak('Bonjour')).reason,'API_UNAVAILABLE');
  assert.equal(calls(),0);
});

test('Phonon reads locally with no API key or allowance and caches without charging',async t=>{
  let localCalls=0;
  const phonon={ready:()=>true,speak:async()=>{localCalls++;return Buffer.from('local-wav');}};
  const {audio,calls}=await setup(t,{phonon,key:()=>''});
  await audio.configure({mode:'phonon',voice:'marin',monthlyLimitCents:0});
  assert.equal(audio.status().phononReady,true);
  const first=await audio.speak('Bonjour local');
  assert.equal(Buffer.from(first.audio,'base64').toString(),'local-wav');
  assert.equal((await audio.speak('Bonjour local')).cached,true);
  assert.equal(localCalls,1); assert.equal(calls(),0); assert.equal(audio.status().usedUsd,0);
});

test('unavailable or failing Phonon falls back to the watch without calling a paid provider',async t=>{
  const phonon={ready:()=>false,speak:async()=>{throw Error('unavailable');}};
  const {audio,calls}=await setup(t,{phonon});
  await audio.configure({mode:'phonon',voice:'marin',monthlyLimitCents:0});
  assert.equal((await audio.speak('Bonjour')).reason,'PHONON_UNAVAILABLE');
  phonon.ready=()=>true;
  assert.equal((await audio.speak('Bonjour')).reason,'PHONON_UNAVAILABLE');
  assert.equal(calls(),0); assert.equal(audio.status().usedUsd,0);
});

test('changing the Phonon voice updates shared settings and separates audio caches',async t=>{
  const calls=[];
  const phonon={ready:()=>true,speak:async(_text,voice)=>{calls.push(voice);return Buffer.from(voice);}};
  const {audio}=await setup(t,{phonon});
  await audio.configure({mode:'phonon',voice:'marin',monthlyLimitCents:0});
  assert.equal(audio.status().phononVoice,PHONON_CATALOG.default);
  await audio.speak('Bonjour');
  const other=PHONON_CATALOG.voices.find(v=>v.id!==PHONON_CATALOG.default).id;
  await audio.setPhononVoice(other); await audio.speak('Bonjour');
  assert.deepEqual(calls,[PHONON_CATALOG.default,other]);
  await audio.configure({mode:'openai',voice:'coral',monthlyLimitCents:200});
  assert.equal(audio.status().phononVoice,other);
  await assert.rejects(audio.setPhononVoice('../../invalid'),/Choisir/);
});

test('changing output, OpenAI voice or budget preserves the other shared settings',async t=>{
  const phonon={ready:()=>true,speak:async()=>Buffer.from('audio')};
  const {audio}=await setup(t,{phonon});
  const other=PHONON_CATALOG.voices.find(v=>v.id!==PHONON_CATALOG.default).id;
  await audio.setPhononVoice(other);
  await audio.setMode('phonon'); await audio.setOpenaiVoice('coral'); await audio.setBudget(325);
  const status=audio.status();
  assert.equal(status.mode,'phonon'); assert.equal(status.voice,'coral'); assert.equal(status.monthlyLimitCents,325); assert.equal(status.phononVoice,other);
  await audio.setMode('watch'); assert.equal(audio.status().phononVoice,other);
  await assert.rejects(audio.setMode('other'),/sortie/);
  await assert.rejects(audio.setOpenaiVoice('other'),/voix/);
  await assert.rejects(audio.setBudget(-1),/plafond/);
});

test('dollar settings reject negative, fractional cents, unsupported voices and arbitrary engines',async t=>{
  const {audio} = await setup(t);
  for (const value of [{monthlyLimitCents:-1},{monthlyLimitCents:1.1},{monthlyLimitCents:10001},{voice:'aube'},{mode:'other'}])
    await assert.rejects(audio.configure({...enabled,...value}),/Choisir/);
  for (const text of ['',null,'a'.repeat(601)]) await assert.rejects(audio.speak(text),/passage/);
  assert.equal(audio.status().mode,'watch');
});

test('same text is billed once across concurrent requests and cached replay after restart/zero quota',async t=>{
  const {audio,store,dir,calls} = await setup(t); await audio.configure(enabled);
  const results = await Promise.all([audio.speak('Bonjour'),audio.speak('Bonjour')]);
  assert.equal(calls(),1); assert.equal(results[0].audio,results[1].audio);
  assert.equal(audio.status().usedUsd,audioCost(usage)/1e6);
  await audio.configure({...enabled,monthlyLimitCents:0});
  const diskStore = new Store(store.file); await diskStore.load();
  const restarted = new AudioService({store:diskStore,directory:path.join(dir,'audio'),key:()=> 'test',generate:()=>{throw Error('Must not call');}});
  assert.equal((await restarted.speak('Bonjour')).cached,true);
  assert.equal((await restarted.speak('Autre texte')).reason,'BUDGET_REACHED');
});

test('worst-case reservations are persisted before API call and serialize simultaneous spending',async t=>{
  let release; const wait = new Promise(r=>{release=r;}); let requested=0;
  const {audio,store} = await setup(t,{generate:async()=>{
    requested++; const disk = new Store(store.file); await disk.load();
    assert.ok(Object.values(disk.data.audio.months)[0].reserved > 0);
    await wait; return {audio:Buffer.alloc(100),usage};
  }});
  const reserve = speechBounds('Bonjour').reserve;
  await audio.configure({...enabled,monthlyLimitCents:Math.ceil(reserve/10000)});
  const first = audio.speak('Bonjour');
  while(!requested) await new Promise(r=>setTimeout(r,1));
  assert.equal((await audio.speak('Un second passage')).reason,'BUDGET_REACHED');
  release(); await first; assert.equal(requested,1); assert.equal(audio.status().reservedUsd,0);
});

test('ambiguous paid failures retain their provision after restart and never replay the same request',async t=>{
  const {audio,store,dir} = await setup(t,{generate:async()=>{throw Error('Connection lost');}});
  await audio.configure(enabled);
  assert.equal((await audio.speak('Bonjour')).fallback,true);
  const held = audio.status().usedUsd; assert.ok(held>0);
  const disk = new Store(store.file); await disk.load();
  const restarted = new AudioService({store:disk,directory:path.join(dir,'audio'),key:()=> 'test',generate:()=>{throw Error('No retry');}});
  assert.equal(restarted.status().usedUsd,held);
  assert.equal((await restarted.speak('Bonjour')).reason,'API_UNAVAILABLE');
  assert.equal(restarted.status().usedUsd,held);
});

test('failed authentication releases its unbilled reservation; known partial usage is counted',async t=>{
  const {audio} = await setup(t,{generate:async()=>{throw Object.assign(Error('401'),{unbilled:true});}});
  await audio.configure(enabled); await audio.speak('Bonjour'); assert.equal(audio.status().usedUsd,0);
  audio.generate = async()=>{throw Object.assign(Error('Truncated'),{usage});};
  await audio.speak('Autre'); assert.equal(audio.status().usedUsd,audioCost(usage)/1e6);
});

test('monthly reset uses Paris time without deleting previous spending; voice changes miss the cache',async t=>{
  let date = new Date('2026-11-30T22:59:00Z');
  const {audio,calls} = await setup(t,{now:()=>date}); await audio.configure(enabled);
  await audio.speak('Bonjour'); assert.equal(audio.status().month,'2026-11');
  date = new Date('2026-11-30T23:01:00Z');
  assert.equal(audio.status().month,'2026-12'); assert.equal(audio.status().usedUsd,0);
  assert.equal((await audio.speak('Bonjour')).cached,true); assert.equal(calls(),1);
  await audio.configure({...enabled,voice:'coral'}); await audio.speak('Bonjour'); assert.equal(calls(),2);
  assert.ok(audio.state.months['2026-11'].spent>0);
});

test('token accounting includes output transcript and returns conservative unknown for missing usage',()=>{
  assert.equal(audioCost(usage),2084);
  assert.equal(audioCost(null),null);
  assert.equal(audioCost({...usage,input_tokens:-1}),null);
  assert.equal(audioCost({...usage,output_token_details:{audio_tokens:111}}),null);
});

test('Realtime reader configures one bounded, text-only response and returns PCM WAV',async()=>{
  let socket;
  class FakeSocket extends EventEmitter {
    sent=[];
    constructor(url,options) {super();socket=this;this.url=url;this.options=options;queueMicrotask(()=>this.emit('message',Buffer.from('{"type":"session.created"}')));}
    send(json) {
      const event = JSON.parse(json);this.sent.push(event);
      if(event.type==='session.update') queueMicrotask(()=>this.emit('message',Buffer.from('{"type":"session.updated"}')));
      else queueMicrotask(()=>{
        this.emit('message',Buffer.from(JSON.stringify({type:'response.output_audio.delta',delta:Buffer.from([1,2,3,4]).toString('base64')})));
        this.emit('message',Buffer.from(JSON.stringify({type:'response.done',response:{status:'completed',usage}})));
      });
    }
    terminate() {}
  }
  const result = await generateSpeech({text:'Bonjour',voice:'marin',maxTokens:512,apiKey:'test-only',WebSocketImpl:FakeSocket});
  assert.match(socket.url,/gpt-realtime-2.1-mini/); assert.equal(socket.sent.length,2);
  assert.equal(socket.sent[0].session.audio.input.turn_detection,null);
  assert.equal(socket.sent[1].response.max_output_tokens,512);
  assert.equal(socket.sent[1].response.conversation,'none');
  assert.equal(socket.sent[1].response.input[0].content[0].text,'Bonjour');
  assert.equal(result.audio.toString('ascii',0,4),'RIFF'); assert.equal(result.audio.readUInt32LE(24),24000);
});
