import {readFile,unlink,writeFile,rename} from 'node:fs/promises';
import {createHash,timingSafeEqual,randomBytes,randomUUID} from 'node:crypto';
import path from 'node:path';
const hash=value=>createHash('sha256').update(value).digest();
export class PairingWindow{
  attempts=0;generation='';busy=false;
  constructor(file){this.file=file;}
  resultFile(id){if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))throw Object.assign(Error('Association invalide.'),{status:400});return path.join(path.dirname(this.file),'pairing-result-'+id+'.json');}
  async result(value){const file=this.resultFile(value.id),temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,file);}
  async consume(code){
    const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
    if(this.busy)fail(409,'Association déjà en cours');
    this.busy=true;
    try{
      let window;try{window=JSON.parse(await readFile(this.file,'utf8'));}catch{fail(403,'Ouvre l’association sur le relais.');}
      if(window.hash!==this.generation){this.generation=window.hash;this.attempts=0;}
      if(Date.now()>window.expiresAt)fail(410,'Code expiré.');
      if(this.attempts>=5)fail(429,'Trop de tentatives. Régénère le code sur le relais.');
      this.attempts++;
      if(typeof code!=='string'||!/^\d{6}$/.test(code)||typeof window.hash!=='string'||!timingSafeEqual(hash(code),Buffer.from(window.hash,'hex')))fail(403,'Code incorrect.');
      await unlink(this.file);
      const id=typeof window.id==='string'?window.id:randomUUID(),nonce=randomBytes(32).toString('base64url');
      await this.result({id,status:'accepted',nonceHash:hash(nonce).toString('hex'),expiresAt:Date.now()+120000});
      return {id,nonce};
    }finally{this.busy=false;}
  }
  async confirm(id,nonce){
    let result;try{result=JSON.parse(await readFile(this.resultFile(id),'utf8'));}catch{throw Object.assign(Error('Association à recommencer.'),{status:404});}
    if(result.id!==id||!['accepted','confirmed'].includes(result.status)||Date.now()>result.expiresAt||typeof nonce!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(nonce)||typeof result.nonceHash!=='string'||!/^[a-f0-9]{64}$/.test(result.nonceHash)||!timingSafeEqual(hash(nonce),Buffer.from(result.nonceHash,'hex')))throw Object.assign(Error('Confirmation d’association invalide ou expirée.'),{status:403});
    if(result.status!=='confirmed')await this.result({...result,status:'confirmed',confirmedAt:Date.now()});
  }
}
