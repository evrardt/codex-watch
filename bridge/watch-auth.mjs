import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {EventEmitter} from 'node:events';import path from 'node:path';
const hash=s=>createHash('sha256').update(s).digest();
export class WatchAuth extends EventEmitter{
 constructor(file,legacyToken,{now=()=>Date.now()}={}){super();Object.assign(this,{file,legacyToken,now});this.records=[];this.queue=Promise.resolve();}
 async load(){try{const data=JSON.parse(await readFile(this.file,'utf8'));if(!Array.isArray(data.records))throw Error('Registre invalide');this.records=data.records;}catch(e){if(e.code!=='ENOENT')throw e;}}
 save(){const payload=JSON.stringify({records:this.records});this.queue=this.queue.catch(()=>{}).then(async()=>{await mkdir(path.dirname(this.file),{recursive:true,mode:0o700});const tmp=this.file+'.'+randomUUID()+'.tmp';await writeFile(tmp,payload,{mode:0o600,flag:'wx'});await rename(tmp,this.file);});return this.queue;}
 identify(header){if(typeof header!=='string'||!header.startsWith('Bearer '))return null;const value=header.slice(7);if(!value||value.length>512)return null;const digest=hash(value);if(timingSafeEqual(digest,hash(this.legacyToken)))return {id:'legacy',legacy:true,active:true};for(const r of this.records){if(typeof r.hash!=='string'||!/^[a-f0-9]{64}$/.test(r.hash))continue;if(timingSafeEqual(digest,Buffer.from(r.hash,'hex'))&&r.status!=='revoked'&&(r.status==='active'||r.status==='pending'&&r.expiresAt>this.now()))return {id:r.id,legacy:false,active:r.status==='active'};}return null;}
 async issue(id,label='Montre'){
  if(!/^[a-f0-9-]{36}$/i.test(id)||this.records.some(r=>r.id===id))throw Error('Association invalide.');
  const token=randomBytes(32).toString('base64url');const record={id,label:typeof label==='string'?(label.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,60)||'Montre'):'Montre',hash:hash(token).toString('hex'),status:'pending',createdAt:this.now(),expiresAt:this.now()+120000};this.records.push(record);try{await this.save();}catch(e){this.records=this.records.filter(r=>r!==record);throw e;}return token;
 }
 async activate(id,principal){const r=this.records.find(x=>x.id===id);if(r?.status==='active'&&principal?.id===id)return;if(!r||r.status!=='pending'||r.expiresAt<=this.now()||principal?.id!==id)throw Object.assign(Error('Association expirée ou invalide.'),{status:403});const expiresAt=r.expiresAt;r.status='active';delete r.expiresAt;try{await this.save();}catch(e){r.status='pending';r.expiresAt=expiresAt;throw e;}}
 list(){return this.records.filter(r=>r.status==='active').map(({id,label,createdAt})=>({id,label,createdAt}));}
 async revoke(id){const r=this.records.find(x=>x.id===id&&x.status==='active');if(!r)throw Error('Montre introuvable.');r.status='revoked';try{await this.save();}catch(e){r.status='active';throw e;}this.emit('revoked',id);}
}
