import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {fork} from 'node:child_process';
import {receiveManagedFcm} from '../managed-fcm.mjs';

test('managed Firebase credentials arrive only through the private parent channel',async()=>{
  const channel=new EventEmitter();channel.connected=true;let ready=false;channel.send=message=>{assert.equal(message.type,'firebase-credentials-ready');ready=true;};
  const pending=receiveManagedFcm(channel);
  assert.equal(ready,true);
  channel.emit('message',{type:'unrelated',credentials:'wrong'});
  channel.emit('message',{type:'firebase-credentials',credentials:'private-test-value'});
  assert.equal(await pending,'private-test-value');
  assert.equal(channel.listenerCount('message'),0);assert.equal(channel.listenerCount('disconnect'),0);
});
test('missing or disconnected private channel disables managed credentials',async()=>{
  assert.equal(await receiveManagedFcm({connected:false}),null);
  const channel=new EventEmitter();channel.connected=true;const pending=receiveManagedFcm(channel);
  channel.emit('disconnect');assert.equal(await pending,null);assert.equal(channel.listenerCount('message'),0);
});
test('the spawned relay requests credentials after its listener is ready',async()=>{
  const child=fork(new URL('./fixtures/managed-fcm-child.mjs',import.meta.url),[],{stdio:['ignore','ignore','ignore','ipc']});
  const received=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(Error('Child timed out'));},4000);
    child.on('error',reject);child.on('message',m=>{if(m.type==='firebase-credentials-ready')child.send({type:'firebase-credentials',credentials:'test-value'});if(m.type==='result'){clearTimeout(timer);resolve(m.ok);child.disconnect();}});
    child.on('exit',code=>{if(code)reject(Error('Child exited early'));});
  });
  assert.equal(received,true);
});
