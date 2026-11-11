import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {createWatchdog}=createRequire(import.meta.url)('../../desktop/watchdog.cjs');
test('relay watchdog detects a living stalled child but tolerates transient failures',async()=>{
 let proc={id:1},ok=false,starts=0,kills=0;
 const tick=createWatchdog({allowed:()=>true,child:()=>proc,healthy:async()=>ok,start:async()=>{starts++;proc={id:2};},terminate:async p=>{assert.equal(p.id,1);kills++;proc=null;}});
 await tick();await tick();assert.equal(kills,0);
 ok={codex:false};await tick(); // A responding relay with disconnected Codex is healthy.
 ok=false;await tick();await tick();assert.equal(kills,0);await tick();assert.equal(kills,1);assert.equal(starts,0);
 await tick();assert.equal(starts,1);
});
test('relay watchdog cannot overlap probes or restart a deliberately stopped process',async()=>{
 let allowed=false,probes=0,starts=0,release;const waiting=new Promise(r=>release=r);
 const tick=createWatchdog({allowed:()=>allowed,child:()=>({}),healthy:async()=>{probes++;await waiting;return true;},start:async()=>starts++,terminate:async()=>{throw Error('Unexpected termination');}});
 await tick();assert.equal(probes,0);allowed=true;const first=tick();await tick();assert.equal(probes,1);release();await first;assert.equal(starts,0);
});
