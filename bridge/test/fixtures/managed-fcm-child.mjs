import {setTimeout as delay} from 'node:timers/promises';
// Exercise startup even if imports take longer than the parent's spawn call.
await delay(100);
const {receiveManagedFcm}=await import('../../managed-fcm.mjs');
const value=await receiveManagedFcm();
process.send({type:'result',ok:value==='test-value'});
