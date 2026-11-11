import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PhononReader, PHONON_CATALOG, readingLanguage } from '../phonon.mjs';
import {cudaEnvironment} from '../phonon-cuda-env.mjs';

test('CUDA environment discovers rustup and the toolkit without changing the parent environment',()=>{
 const home=path.resolve('fixture-home'),cuda=path.resolve('fixture-cuda'),cargo=path.join(home,'.cargo','bin');
 const available=new Set([cargo,path.join(cuda,'bin','nvcc'),path.join(cuda,'bin'),path.join(cuda,'lib64')]);
 const source={PATH:'original-path',CUDA_HOME:cuda,LD_LIBRARY_PATH:'original-libs'};
 const env=cudaEnvironment(source,{home,exists:p=>available.has(p)});
 assert.equal(env.CUDA_PATH,cuda);assert.ok(env.PATH.includes(cargo));assert.ok(env.PATH.includes('original-path'));
 assert.ok(env.LD_LIBRARY_PATH.includes(path.join(cuda,'lib64')));assert.ok(env.LD_LIBRARY_PATH.includes('original-libs'));
 assert.equal(source.CUDA_PATH,undefined);assert.equal(source.PATH,'original-path');
});

test('language detection stays local and falls back for short text',()=>{
  const english='This application lets you choose a voice and listen to your conversations on your watch without sending the text to a remote service.';
  const french='Bonjour, voici une réponse française qui vous explique comment fonctionne le relais installé sur votre ordinateur.';
  assert.equal(readingLanguage(english,'fr'),'en');
  assert.equal(readingLanguage(french,'en'),'fr');
  assert.equal(readingLanguage('OK','fr'),'fr');
});

test('Linux CUDA uses non-quantized weights and falls back to CPU on failure',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'codexwatch-phonon-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const folder=path.join(dir,'phonon'),model=path.join(folder,'model-multilingual'),voices=path.join(folder,'voices');
  await mkdir(model,{recursive:true});await mkdir(voices,{recursive:true});
  for(const f of ['config.json','tokenizer.json','model.q8.gguf','model.safetensors'])await writeFile(path.join(model,f),'fixture');
  await writeFile(path.join(voices,PHONON_CATALOG.default+'.safetensors'),'fixture');
  await writeFile(path.join(dir,'phonon-compute.json'),JSON.stringify({device:'gpu'}));
  const wav=Buffer.alloc(48);wav.write('RIFF');wav.write('WAVE',8);const calls=[];let failGpu=false;
  const reader=new PhononReader(dir,async(exe,args)=>{calls.push({exe,args});if(exe.endsWith('ptts-cuda')&&failGpu)throw Error('no CUDA');await writeFile(args[args.indexOf('--output')+1],wav);},{platform:'linux',workerAvailable:()=>false});
  await writeFile(reader.executable,'fixture');await writeFile(path.join(folder,'ptts-cuda'),'fixture');
  await reader.speak('Bonjour');assert.equal(reader.lastStatus.actual,'cuda');assert.ok(calls[0].args.includes('cuda'));assert.equal(calls[0].args.includes('--quant'),false);
  failGpu=true;await reader.speak('Encore');assert.equal(reader.lastStatus.actual,'cpu');assert.match(reader.lastStatus.reason,/repli CPU/);assert.ok(calls.at(-1).args.includes('q8'));
});

test('local reader invokes the trusted executable without a shell and removes temporary audio', async t => {
  const dir=await mkdtemp(path.join(tmpdir(),'codexwatch-phonon-'));
  t.after(()=>{
    assert.equal(path.dirname(path.resolve(dir)),path.resolve(tmpdir()));
    assert.ok(path.basename(dir).startsWith('codexwatch-phonon-'));
    return rm(dir,{recursive:true,force:true});
  });
  const model=path.join(dir,'phonon','model-multilingual'); await mkdir(model,{recursive:true});
  for(const f of ['config.json','tokenizer.json','model.q8.gguf','default-voice.safetensors']) await writeFile(path.join(model,f),'fixture');
  await mkdir(path.join(dir,'phonon','voices'));
  await writeFile(path.join(dir,'phonon','voices',PHONON_CATALOG.default+'.safetensors'),'fixture');
  const text='--version & texte qui ne doit pas être une commande';
  let args, options;
  const reader=new PhononReader(dir,async(_exe,a,o)=>{
    args=a; options=o;
    const wav=Buffer.alloc(48); wav.write('RIFF'); wav.write('WAVE',8);
    await writeFile(a[a.indexOf('--output')+1],wav);
  });
  await writeFile(reader.executable,'fixture');
  assert.equal(reader.ready(),true);
  const audio=await reader.speak(text);
  assert.equal(audio.toString('ascii',0,4),'RIFF');
  assert.deepEqual(args.slice(-2),['--',text]);
  assert.equal(args[args.indexOf('--lang')+1],'fr');
  assert.equal(options.shell,undefined);
  assert.equal((await readdir(path.join(dir,'phonon'))).some(n=>n.startsWith('speech-')),false);
});

test('GPU worker is retained across requests and released on configuration change',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'codexwatch-phonon-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(tmpdir()));return rm(dir,{recursive:true,force:true});});
  const model=path.join(dir,'phonon','model-multilingual'),voices=path.join(dir,'phonon','voices');
  await mkdir(model,{recursive:true});await mkdir(voices,{recursive:true});
  for(const f of ['config.json','tokenizer.json','model.q8.gguf'])await writeFile(path.join(model,f),'fixture');
  await writeFile(path.join(voices,PHONON_CATALOG.default+'.safetensors'),'fixture');
  await writeFile(path.join(dir,'phonon-compute.json'),JSON.stringify({device:'gpu',keepLoaded:true}));
  const wav=Buffer.alloc(48);wav.write('RIFF');wav.write('WAVE',8);let starts=0,closed=0,calls=0;
  const reader=new PhononReader(dir,undefined,{workerAvailable:()=>true,workerFactory:()=>{starts++;return {speak:async()=>{calls++;return {audio:wav.toString('base64'),device:'webgpu'};},close:()=>{closed++;}};}});
  await writeFile(reader.executable,'fixture');
  assert.equal((await reader.speak('Bonjour')).toString('ascii',0,4),'RIFF');
  await reader.speak('Encore');assert.equal(starts,1);assert.equal(calls,2);assert.equal(closed,0);
  reader.configurationChanged();assert.equal(closed,1);await reader.statusQueue;
});

test('unavailable GPU falls back to native CPU and reports the fallback',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'codexwatch-phonon-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(tmpdir()));return rm(dir,{recursive:true,force:true});});
  const model=path.join(dir,'phonon','model-multilingual'),voices=path.join(dir,'phonon','voices');
  await mkdir(model,{recursive:true});await mkdir(voices,{recursive:true});
  for(const f of ['config.json','tokenizer.json','model.q8.gguf'])await writeFile(path.join(model,f),'fixture');
  await writeFile(path.join(voices,PHONON_CATALOG.default+'.safetensors'),'fixture');
  await writeFile(path.join(dir,'phonon-compute.json'),JSON.stringify({device:'gpu',keepLoaded:true}));
  const wav=Buffer.alloc(48);wav.write('RIFF');wav.write('WAVE',8);let native=0;
  const reader=new PhononReader(dir,async(_exe,args)=>{native++;await writeFile(args[args.indexOf('--output')+1],wav);},{workerAvailable:()=>true,workerFactory:()=>({speak:async()=>{throw Error('No GPU');},close:()=>{}})});
  await writeFile(reader.executable,'fixture');await reader.speak('Bonjour');
  assert.equal(native,1);assert.equal(reader.lastStatus.actual,'cpu');assert.match(reader.lastStatus.reason,/repli CPU/);
});

test('startup preload reuses the resident worker and waits before reading',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'codexwatch-phonon-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(tmpdir()));return rm(dir,{recursive:true,force:true});});
  const model=path.join(dir,'phonon','model-multilingual'),voices=path.join(dir,'phonon','voices');
  await mkdir(model,{recursive:true});await mkdir(voices,{recursive:true});
  for(const f of ['config.json','tokenizer.json','model.q8.gguf'])await writeFile(path.join(model,f),'fixture');
  await writeFile(path.join(voices,PHONON_CATALOG.default+'.safetensors'),'fixture');
  await writeFile(path.join(dir,'phonon-compute.json'),JSON.stringify({device:'gpu',keepLoaded:true,preload:true}));
  const wav=Buffer.alloc(48);wav.write('RIFF');wav.write('WAVE',8);let starts=0,calls=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const reader=new PhononReader(dir,undefined,{workerAvailable:()=>true,workerFactory:()=>{starts++;return {speak:async()=>{calls++;if(calls===1)await gate;return {audio:wav.toString('base64'),device:'webgpu'};},close:()=>{}};}});
  await writeFile(reader.executable,'fixture');
  const warm=reader.preload();
  const speech=reader.speak('Texte demandé');
  release();await warm;await speech;
  assert.equal(starts,1);assert.equal(calls,2);assert.equal(reader.lastStatus.resident,true);
  reader.close();await reader.statusQueue;
});
