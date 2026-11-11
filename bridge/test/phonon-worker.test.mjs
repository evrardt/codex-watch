import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PhononWorker } from '../phonon-worker.mjs';

test('resident worker starts once, returns audio and is stopped explicitly',async()=>{
  let starts=0,child;
  class FakeChild extends EventEmitter {
    connected=true;sent=[];
    send(message,callback){this.sent.push(message);callback?.();if(message.type==='synth')queueMicrotask(()=>this.emit('message',{type:'result',id:message.id,ok:true,audio:'UklGRg==',device:'webgpu'}));}
    kill(){this.connected=false;this.emit('exit',0);}
  }
  const worker=new PhononWorker({dataDir:'test-data',spawnProcess:()=>{starts++;child=new FakeChild();queueMicrotask(()=>child.emit('message',{type:'ready'}));return child;}});
  const input={text:'Bonjour',voice:'FXxJ9mANRq6BCTX5',language:'fr',device:'webgpu'};
  assert.equal((await worker.speak(input)).device,'webgpu');
  assert.equal((await worker.speak(input)).device,'webgpu');
  assert.equal(starts,1);assert.equal(child.sent.filter(v=>v.type==='synth').length,2);
  worker.close();assert.equal(child.sent.at(-1).type,'stop');child.kill();
});

test('failed worker reports failure and is closed',async()=>{
  let child;
  class FakeChild extends EventEmitter {
    connected=true;stopped=false;
    send(m,cb){cb?.();if(m.type==='stop')this.stopped=true;}
    kill(){this.connected=false;this.emit('exit',1);}
  }
  const worker=new PhononWorker({dataDir:'test-data',spawnProcess:()=>{child=new FakeChild();queueMicrotask(()=>child.emit('message',{type:'failed'}));return child;}});
  await assert.rejects(worker.speak({text:'x',voice:'v',language:'fr',device:'webgpu'}));
  assert.equal(child.stopped,true);child.kill();
});
