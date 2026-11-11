'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough,Writable}=require('node:stream');
const {createHash}=require('node:crypto');
const vps=require('../vps.cjs');

const config={host:'vps.example.org',user:'alice',identity:require('node:path').resolve('test-private-key'),port:22,url:'https://vps.example.org:8443'};
function fakeSsh(reply){
 const calls=[];
 const spawnImpl=(exe,args,options)=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.kill=()=>{};let input='';
  child.stdin=new Writable({write(chunk,enc,done){input+=chunk.toString();done();},final(done){
   calls.push({exe,args,options,input:JSON.parse(input)});done();
   queueMicrotask(()=>{child.stdout.end(JSON.stringify({ok:true,value:reply}));child.emit('close',0);});
  }});return child;
 };
 return {spawnImpl,calls};
}
test('SSH configuration refuses injection and unsafe HTTPS URLs',()=>{
 for(const input of [{host:'-oProxyCommand=evil'},{host:'host;touch'},{user:'a@b'},{identity:'relative'},{port:65536},{url:'http://example.org'},{url:'https://a:b@example.org'},{url:'https://example.org/path'}])assert.throws(()=>vps.validate({...config,...input}));
 assert.equal(vps.validate(config).url,'https://vps.example.org:8443');
});
test('status sends data through stdin and requires a known SSH host',async()=>{
 const fake=fakeSsh({service:true,codex:true,login:true,projects:[]});
 const result=await vps.status(config,{...fake,fetchImpl:async()=>({status:401})});assert.equal(result.codex,true);assert.equal(result.https,'reachable');
 const c=fake.calls[0];assert.equal(c.exe,'ssh');assert.ok(c.args.includes('StrictHostKeyChecking=yes'));assert.ok(c.args.includes('BatchMode=yes'));assert.equal(c.input.action,'status');
});
test('SSH success does not imply that the VPS HTTPS route works',async()=>{
 const fake=fakeSsh({service:true,codex:true,login:true,projects:[]});
 const status=await vps.status(config,{...fake,fetchImpl:async()=>{throw Error('offline');}});
 assert.equal(status.codex,true);assert.equal(status.https,'unavailable');
});
test('pairing fails closed when HTTPS relay is unreachable',async()=>{
 const fake=fakeSsh({ok:true});
 await assert.rejects(vps.pair(config,{...fake,fetchImpl:async()=>{throw Error('offline');}}),/pas encore accessible/);assert.equal(fake.calls.length,0);
 await assert.rejects(vps.pair(config,{...fake,fetchImpl:async()=>({status:200})}),/ne répond pas/);assert.equal(fake.calls.length,0);
});
test('pairing sends only a temporary code hash to the VPS',async()=>{
 const fake=fakeSsh({ok:true});const result=await vps.pair(config,{...fake,fetchImpl:async()=>({status:401})});
 assert.match(result.code,/^\d{6}$/);assert.equal(fake.calls[0].input.hash,createHash('sha256').update(result.code).digest('hex'));assert.equal(JSON.stringify(fake.calls[0]).includes(result.code),false);
 assert.ok(result.expiresAt>Date.now());assert.ok(result.expiresAt<=Date.now()+120000);
});
