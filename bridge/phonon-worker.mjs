import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/** One isolated Electron worker, reused until the relay closes or settings change. */
export class PhononWorker {
  constructor({ executable=process.execPath, dataDir, spawnProcess=spawn, extraArgs=[], onExit=()=>{} }) {
    Object.assign(this,{executable,dataDir,spawnProcess,extraArgs,onExit});
    this.child=null;this.readyPromise=null;this.pending=new Map();
  }
  async start() {
    if(this.readyPromise)return this.readyPromise;
    const env={...process.env,WATCH_DATA_DIR:this.dataDir};delete env.ELECTRON_RUN_AS_NODE;
    const child=this.spawnProcess(this.executable,[...this.extraArgs,'--phonon-worker'],{env,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
    this.child=child;
    this.readyPromise=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>finish(Error('Worker startup timeout')),15000);
      let settled=false;
      const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve();};
      child.on('error',()=>finish(Error('Worker unavailable')));
      child.on('message',message=>{
        if(message?.type==='ready')finish();
        else if(message?.type==='failed')finish(Error('Worker initialization failed'));
        else if(message?.type==='result'){
          const pending=this.pending.get(message.id);if(!pending)return;
          this.pending.delete(message.id);clearTimeout(pending.timer);
          message.ok?pending.resolve(message):pending.reject(Error('Worker synthesis failed'));
        }
      });
      child.on('exit',()=>{
        finish(Error('Worker exited'));
        for(const entry of this.pending.values()){clearTimeout(entry.timer);entry.reject(Error('Worker exited'));}this.pending.clear();
        if(this.child===child){this.child=null;this.readyPromise=null;}
        this.onExit();
      });
    });
    try { await this.readyPromise; }
    catch(e){this.close();throw e;}
  }
  async speak({text,voice,language,device}) {
    await this.start();const child=this.child,id=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);this.close();reject(Error('Worker synthesis timeout'));},30000);
      this.pending.set(id,{resolve,reject,timer});
      try{child.send({type:'synth',id,text,voice,language,device},error=>{if(error&&this.pending.has(id)){clearTimeout(timer);this.pending.delete(id);reject(Error('Worker unavailable'));}});}
      catch {clearTimeout(timer);this.pending.delete(id);reject(Error('Worker unavailable'));}
    });
  }
  close() {
    const child=this.child;this.child=null;this.readyPromise=null;
    if(!child)return;
    try { if(child.connected)child.send({type:'stop'}); else child.kill(); } catch { try{child.kill();}catch{} }
    const timer=setTimeout(()=>{try{child.kill();}catch{}},3000);timer.unref();
  }
}
