import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';
import {makePairing,privateUrl,saveApiKey,systemdWorkingDirectory} from '../vps-setup.mjs';import {PairingWindow} from '../pairing.mjs';
async function temp(t){const d=await mkdtemp(path.join(tmpdir(),'watch-vps-'));t.after(()=>rm(d,{recursive:true,force:true}));return d;}
test('a server-only pairing code can be confirmed exactly once by the watch protocol',async t=>{
 const d=await temp(t),now=Date.now(),pair=await makePairing(d,'https://server.example:8443',{now,code:'538920'});
 const f=path.join(d,'pairing-window.json'),stored=await readFile(f,'utf8');assert.ok(!stored.includes(pair.code));assert.equal(pair.expiresAt,now+120000);
 const window=new PairingWindow(f);const receipt=await window.consume(pair.code);assert.equal(receipt.id,pair.id);await window.confirm(receipt.id,receipt.nonce);
 assert.equal(JSON.parse(await readFile(window.resultFile(pair.id))).status,'confirmed');await assert.rejects(window.consume(pair.code));
});
test('server key is private, invalid inputs fail and URLs must be safe HTTPS origins',async t=>{
 const d=await temp(t);await assert.rejects(saveApiKey(d,'wrong'));await saveApiKey(d,'sk-fake-test-key');
 if(process.platform!=='win32')assert.equal((await stat(path.join(d,'openai-api-key.txt'))).mode&0o077,0);
 for(const url of ['http://example.com','https://user:pass@example.com','https://example.com/path','file:///etc/passwd'])assert.throws(()=>privateUrl(url));
 assert.equal(privateUrl('https://example.com:8443/'),'https://example.com:8443');
});
test('systemd working directory is an absolute path without literal surrounding quotes',()=>{
 const dir=path.resolve('directory with space','percent%');assert.equal(systemdWorkingDirectory(dir),dir.replaceAll('%','%%'));
 assert.throws(()=>systemdWorkingDirectory('relative'));assert.throws(()=>systemdWorkingDirectory(dir+'\n[Service]'));
});
