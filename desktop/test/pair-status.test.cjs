'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {confirmedPairing}=require('../pair-status.cjs');
test('shows an association only after confirmation with the current relay token',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'watch-pair-status-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 assert.equal(await confirmedPairing(dir),false);await fs.writeFile(path.join(dir,'pairing-token.txt'),'test-token');
 const file=path.join(dir,'pairing-result-12345678-1234-1234-1234-123456789abc.json');
 await fs.writeFile(file,JSON.stringify({status:'accepted',confirmedAt:Date.now()}));assert.equal(await confirmedPairing(dir),false);
 await fs.writeFile(file,JSON.stringify({status:'confirmed',confirmedAt:Date.now()-10000}));assert.equal(await confirmedPairing(dir),false);
 await fs.writeFile(file,JSON.stringify({status:'confirmed',confirmedAt:Date.now()}));assert.equal(await confirmedPairing(dir),true);
 await fs.writeFile(path.join(dir,'watch-auth.json'),JSON.stringify({records:[{id:'12345678-1234-1234-1234-123456789abc',status:'revoked'}]}));assert.equal(await confirmedPairing(dir),false);
});
