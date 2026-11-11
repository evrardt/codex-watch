import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile, rename } from 'node:fs/promises';
import { francAll } from 'franc-min';
import { PhononWorker } from './phonon-worker.mjs';
import {cudaEnvironment} from './phonon-cuda-env.mjs';

const exec = promisify(execFile);
export const PHONON_CATALOG = createRequire(import.meta.url)('./phonon-voices.json');
export function readingLanguage(text, fallback) {
  // Short or ambiguous passages retain the voice's language; this is only a best-effort
  // whole-passage classification and does not promise word-by-word language switching.
  const clean=text.replace(/https?:\/\/\S+|\b\w+[_/\\]\w+\b/g,' ').trim();
  if (clean.length<60) return fallback;
  const ranked=francAll(clean,{only:['fra','eng','deu','spa','por'],minLength:60});
  const map={fra:'fr',eng:'en',deu:'de',spa:'es',por:'pt'};
  return ranked[0] && ranked[1] && ranked[1][1] < .90 ? map[ranked[0][0]] || fallback : fallback;
}
export class PhononReader {
  constructor(directory, run = exec, {workerAvailable=()=>!!process.versions.electron && process.env.ELECTRON_RUN_AS_NODE==='1',workerFactory=options=>new PhononWorker(options),platform=process.platform} = {}) {
    this.directory = path.resolve(directory, 'phonon');
    this.executable = path.join(this.directory, process.platform === 'win32' ? 'ptts.exe' : 'ptts');
    this.model = path.join(this.directory, 'model-multilingual');
    this.run = run;
    this.workerAvailable=workerAvailable;this.workerFactory=workerFactory;this.platform=platform;
    this.active = false;
    this.dataDir=path.resolve(directory);
    this.worker=null;this.workerStale=false;this.gpuFailedAt=0;this.lastStatus={resident:false};this.statusQueue=Promise.resolve();this.preloadPromise=null;
  }
  async computeSettings() {
    try {
      const value=JSON.parse(await readFile(path.join(this.dataDir,'phonon-compute.json'),'utf8'));
      return {device:['cpu','auto','gpu'].includes(value.device)?value.device:'cpu',keepLoaded:value.keepLoaded===true,preload:value.preload===true&&value.keepLoaded===true};
    } catch {return {device:'cpu',keepLoaded:false,preload:false};}
  }
  async saveStatus(status) {
    this.lastStatus={...this.lastStatus,...status,updatedAt:Date.now()};
    const snapshot=JSON.stringify(this.lastStatus);
    this.statusQueue=this.statusQueue.then(async()=>{
      const temp=path.join(this.dataDir,'.phonon-status-'+randomUUID()+'.tmp');
      try { await writeFile(temp,snapshot,{mode:0o600,flag:'wx'});await rename(temp,path.join(this.dataDir,'phonon-compute-status.json')); }
      finally {await rm(temp,{force:true});}
    }).catch(()=>{});
    await this.statusQueue;
  }
  configurationChanged() {this.workerStale=true;this.gpuFailedAt=0;if(!this.active)this.close();}
  preload(voice = PHONON_CATALOG.default) {
    if(this.preloadPromise)return this.preloadPromise;
    const task=(async()=>{
      const settings=await this.computeSettings();
      if(!settings.preload || !this.workerAvailable() || !this.ready(voice) || this.active)return;
      await this.saveStatus({resident:false,reason:'Préchargement en cours.'});
      try { await this.speak('Bonjour.',voice,true); }
      catch { await this.saveStatus({resident:false,reason:'Préchargement indisponible. Réessaie avec Tester le calcul.'}); }
    })();
    this.preloadPromise=task;
    void task.finally(()=>{if(this.preloadPromise===task)this.preloadPromise=null;}).catch(()=>{});
    return task;
  }
  close() {
    const hadWorker=!!this.worker || this.lastStatus.resident===true;
    this.worker?.close();this.worker=null;this.workerStale=false;
    if(hadWorker)void this.saveStatus({resident:false});
  }
  ready(voice = PHONON_CATALOG.default) {
    if (!PHONON_CATALOG.voices.some(v=>v.id===voice)) return false;
    return [this.executable, ...['config.json','tokenizer.json','model.q8.gguf'].map(f => path.join(this.model,f)),path.join(this.directory,'voices',voice+'.safetensors')].every(existsSync);
  }
  async ensureVoice(id) {
    const voice=PHONON_CATALOG.voices.find(v=>v.id===id);
    if (!voice) throw new Error('Invalid voice');
    const folder=path.join(this.directory,'voices'), destination=path.join(folder,id+'.safetensors');
    if (existsSync(destination)) return;
    const url=`https://huggingface.co/gradium/phonon-voices/resolve/${PHONON_CATALOG.revision}/voices/${id}.safetensors`;
    const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error('Voice download unavailable');
    const parts=[]; let length=0;
    for await (const part of response.body) { length+=part.length; if(length>256136)throw new Error('Voice too large'); parts.push(part); }
    const bytes=Buffer.concat(parts);
    if (length!==256136 || createHash('sha256').update(bytes).digest('hex')!==voice.sha256) throw new Error('Voice checksum mismatch');
    await mkdir(folder,{recursive:true});
    const tmp=path.join(folder,'.'+randomUUID()+'.tmp');
    try { await writeFile(tmp,bytes,{flag:'wx',mode:0o600}); await rename(tmp,destination); }
    finally { await rm(tmp,{force:true}); }
  }
  async speak(text, voice = PHONON_CATALOG.default, skipPreload = false) {
    if(!skipPreload && this.preloadPromise)await this.preloadPromise;
    if (!this.ready(voice) || this.active) throw new Error('Phonon unavailable');
    this.active = true;
    let temporary;
    try {
      const settings=await this.computeSettings();
      const language=readingLanguage(text,PHONON_CATALOG.voices.find(v=>v.id===voice).language);
      const electronAvailable=this.workerAvailable();
      const useWorker=electronAvailable && (settings.device!=='cpu'||settings.keepLoaded);
      if (useWorker && !(settings.device==='gpu' && Date.now()-this.gpuFailedAt<60000)) {
        try {
          if(this.workerStale)this.close();
          if(!this.worker){const worker=this.workerFactory({dataDir:this.dataDir,onExit:()=>{if(this.worker===worker)void this.saveStatus({resident:false});}});this.worker=worker;}
          const result=await this.worker.speak({text,voice,language,device:settings.device==='gpu'?'webgpu':settings.device});
          const audio=Buffer.from(result.audio,'base64');
          if(audio.length<44||audio.length>10*1024*1024||audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE')throw Error('Invalid worker audio');
          await this.saveStatus({requested:settings.device,actual:result.device,resident:settings.keepLoaded,reason:result.reason||'',threads:result.threads,vendor:result.vendor||''});
          return audio;
        } catch {
          if(settings.device==='gpu')this.gpuFailedAt=Date.now();
          this.worker?.close();this.worker=null;
          await this.saveStatus({requested:settings.device,actual:'cpu',resident:false,reason:'GPU ou moteur résident indisponible : repli CPU natif.'});
        }
      }
      await mkdir(this.directory, { recursive:true });
      temporary = await mkdtemp(path.join(this.directory, 'speech-'));
      const output = path.join(temporary, 'speech.wav');
      // The optional Linux CUDA build uses full-precision weights; the official
      // native CPU binary and q8 weights remain untouched and are the fallback.
      const cuda=path.join(this.directory,'ptts-cuda');
      const canUseCuda=this.platform==='linux' && !electronAvailable && settings.device==='gpu' &&
        existsSync(cuda) && existsSync(path.join(this.model,'model.safetensors'));
      if(canUseCuda && Date.now()-this.gpuFailedAt>=60000){
        try {
          await this.run(cuda,['--device','cuda','--model',this.model,'--voice',path.join(this.directory,'voices',voice+'.safetensors'),'--lang',language,'--output',output,'--',text],
            {env:cudaEnvironment(),windowsHide:true,timeout:60000,maxBuffer:1024*1024});
          const audio=await readFile(output);
          if(audio.length<44||audio.length>10*1024*1024||audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE')throw Error('Invalid Phonon audio');
          await this.saveStatus({requested:'gpu',actual:'cuda',resident:false,reason:'CUDA · modèle non résident.'});
          return audio;
        } catch {
          this.gpuFailedAt=Date.now();
          await this.saveStatus({requested:'gpu',actual:'cpu',resident:false,reason:'CUDA indisponible : repli CPU natif.'});
        }
      }
      // No shell. Text is a single argument; `--` prevents it being interpreted as an option.
      await this.run(this.executable, ['--model',this.model,'--voice',path.join(this.directory,'voices',voice+'.safetensors'),'--lang',language,'--quant','q8','--output',output,'--',text],
        { windowsHide:true, timeout:30000, maxBuffer:1024*1024 });
      const audio = await readFile(output);
      if (audio.length < 44 || audio.length > 10*1024*1024 || audio.toString('ascii',0,4) !== 'RIFF' || audio.toString('ascii',8,12) !== 'WAVE') throw new Error('Invalid Phonon audio');
      if(settings.device==='cpu'&&!settings.keepLoaded) await this.saveStatus({requested:'cpu',actual:'cpu',resident:false,reason:'CPU natif'});
      else if(!electronAvailable && !canUseCuda) await this.saveStatus({requested:settings.device,actual:'cpu',resident:false,reason:'Accélération indisponible sur ce relais : CPU natif.'});
      return audio;
    } finally {
      if (temporary && path.dirname(path.resolve(temporary)) === this.directory && path.basename(temporary).startsWith('speech-'))
        await rm(temporary, { recursive:true, force:true });
      this.active = false;
      const settings=await this.computeSettings();
      if(this.worker && (!settings.keepLoaded||this.workerStale))this.close();
    }
  }
}
