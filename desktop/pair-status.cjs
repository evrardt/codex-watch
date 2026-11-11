'use strict';
const fs=require('node:fs/promises');const path=require('node:path');
// A receipt proves an association was confirmed, not that the watch is online.
async function confirmedPairing(directory){
 try{
  const token=await fs.stat(path.join(directory,'pairing-token.txt'));
  let registry=[];try{const parsed=JSON.parse(await fs.readFile(path.join(directory,'watch-auth.json'),'utf8'));if(Array.isArray(parsed.records))registry=parsed.records;}catch{}
  const files=(await fs.readdir(directory)).filter(n=>/^pairing-result-[a-f0-9-]{36}\.json$/i.test(n));
  for(const name of files){try{const receipt=JSON.parse(await fs.readFile(path.join(directory,name),'utf8'));const id=name.slice('pairing-result-'.length,-'.json'.length);const entry=registry.find(r=>r.id===id);if(receipt.status==='confirmed'&&(!entry||entry.status==='active')&&Number.isFinite(receipt.confirmedAt)&&receipt.confirmedAt>=token.mtimeMs-2000)return true;}catch{}}
  return false;
 }catch{return false;}
}
module.exports={confirmedPairing};
