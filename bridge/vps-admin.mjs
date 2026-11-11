import {readFile,writeFile,rename,unlink,readdir,stat} from 'node:fs/promises';
import {createHash,timingSafeEqual,scryptSync,randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {makePairing,saveApiKey,privateUrl} from './vps-setup.mjs';
import {installPhononLinux,installPhononCudaLinux} from './phonon-linux-install.mjs';
import {chatUsageStatus} from './chat-usage.mjs';
import {saveFirebaseFiles} from './firebase-config.mjs';
import {Push} from './push.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const digest=s=>createHash('sha256').update(s).digest();
export class VpsAdmin {
 constructor({service,data,origin,watchAuth=null,spawnImpl=spawn,now=()=>Date.now()}){
  Object.assign(this,{service,data,origin:privateUrl(origin),watchAuth,spawnImpl,now});this.failures=[];this.login=null;this.phononInstall=null;this.firebaseImporting=false;
 }
 async authorized(req){
  let expected;try{expected=(await readFile(path.join(this.data,'admin-token.sha256'),'utf8')).trim();}catch{return false;}
  const input=req.headers.authorization||'';let value;
  if(input.startsWith('Bearer64 ')){const encoded=input.slice(9);if(!/^[A-Za-z0-9_-]{1,684}$/.test(encoded))return false;value=Buffer.from(encoded,'base64url').toString('utf8');}
  else if(input.startsWith('Bearer '))value=input.slice(7);else return false;
  if(value.length>512)return false;
  if(/^[a-f0-9]{64}$/.test(expected))return timingSafeEqual(digest(value),Buffer.from(expected,'hex'));
  const m=/^scrypt:([a-f0-9]{32}):([a-f0-9]{64})$/.exec(expected);return !!m&&timingSafeEqual(scryptSync(value,Buffer.from(m[1],'hex'),32),Buffer.from(m[2],'hex'));
 }
 async startLogin(){
  if(this.login?.running)return;
  const exe=path.join(path.dirname(this.data),'runtime/node_modules/.bin/codex');
  const job={running:true,code:'',status:'Démarrage de la connexion…'};this.login=job;
  const child=this.spawnImpl(exe,['login','--device-auth'],{env:{...process.env,CODEX_HOME:path.join(this.data,'codex-home')},stdio:['ignore','pipe','pipe']});
  let buffer='';const receive=chunk=>{buffer=(buffer+chunk.toString()).slice(-8192);const clean=buffer.replace(/\x1b\[[0-9;]*m/g,'');const m=clean.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/i);if(m){job.code=m[0];job.status='Saisis ce code sur le site OpenAI.';}};
  child.stdout.on('data',receive);child.stderr.on('data',receive);
  const timer=setTimeout(()=>{child.kill();job.running=false;job.status='Code expiré : recommence la connexion.';},10*60*1000);timer.unref();
  child.once('error',()=>{clearTimeout(timer);job.running=false;job.status='Connexion Codex impossible.';});
  child.once('close',code=>{clearTimeout(timer);job.running=false;job.code='';job.status=code===0?'Connexion Codex réussie.':'Connexion Codex non terminée.';});
 }
 async pairingStatus(id){
  if(!/^[a-f0-9-]{36}$/i.test(id))return 'unknown';
  try{const result=JSON.parse(await readFile(path.join(this.data,'pairing-result-'+id+'.json'),'utf8'));return result.status==='confirmed'?'confirmed':result.status==='accepted'&&this.now()<=result.expiresAt?'accepted':'expired';}catch{return 'waiting';}
 }
 async hasPairedWatch(legacyOnly=false){
  try{const token=await stat(path.join(this.data,'pairing-token.txt'));for(const f of await readdir(this.data)){if(!/^pairing-result-[a-f0-9-]{36}\.json$/i.test(f))continue;try{const result=JSON.parse(await readFile(path.join(this.data,f),'utf8'));const record=this.watchAuth?.records.find(r=>r.id===result.id);if(record&&record.status!=='active')continue;if(legacyOnly&&record)continue;if(result.status==='confirmed'&&result.confirmedAt>=token.mtimeMs-2000)return true;}catch{}}}catch{}return false;
 }
 async handle(req,res){
  const url=new URL(req.url,'http://localhost');if(url.pathname!=='/admin'&&!url.pathname.startsWith('/admin/'))return false;
  const send=(status,data,type='application/json; charset=utf-8')=>{res.statusCode=status;res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");res.end(type.startsWith('application/json')?JSON.stringify(data):data);};
  if(req.method==='GET'&&(url.pathname==='/admin'||url.pathname==='/admin/')){send(200,await readFile(path.join(here,'vps-admin.html'),'utf8'),'text/html; charset=utf-8');return true;}
  if(req.method==='GET'&&url.pathname==='/admin/app.js'){send(200,await readFile(path.join(here,'vps-admin.js'),'utf8'),'application/javascript; charset=utf-8');return true;}
  if(!url.pathname.startsWith('/admin/api/')){send(404,{error:'Page introuvable.'});return true;}
  if(req.method!=='GET'&&req.method!=='POST'){send(405,{error:'Méthode interdite.'});return true;}
  if(req.method==='POST'&&req.headers.origin!==this.origin){send(403,{error:'Origine interdite.'});return true;}
  if(req.method==='POST'&&url.pathname==='/admin/api/bootstrap'){
   let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096){send(413,{error:'Demande trop volumineuse.'});return true;}}
   try{
    const input=JSON.parse(body),file=path.join(this.data,'admin-bootstrap.json');
    const bootstrap=JSON.parse(await readFile(file,'utf8'));
    if(!/^[a-f0-9]{64}$/.test(bootstrap.hash)||typeof input.token!=='string'||input.token.length>128||this.now()>bootstrap.expiresAt||!timingSafeEqual(digest(input.token),Buffer.from(bootstrap.hash,'hex')))throw Error('Lien invalide ou expiré.');
    if(typeof input.password!=='string'||input.password.length<12||input.password.length>256)throw Error('Choisis un mot de passe de 12 caractères minimum.');
    const salt=randomBytes(16),hash=scryptSync(input.password,salt,32),dest=path.join(this.data,'admin-token.sha256');
    if(bootstrap.reset===true){
     // Claim the one-time SSH-created link before changing the existing password.
     const claim=file+'.'+randomUUID()+'.claimed',tmp=dest+'.'+randomUUID()+'.tmp';
     await rename(file,claim);
     try{await writeFile(tmp,'scrypt:'+salt.toString('hex')+':'+hash.toString('hex'),{mode:0o600,flag:'wx'});await rename(tmp,dest);}
     finally{await unlink(claim).catch(()=>{});await unlink(tmp).catch(()=>{});}
    }else{await writeFile(dest,'scrypt:'+salt.toString('hex')+':'+hash.toString('hex'),{mode:0o600,flag:'wx'});await unlink(file);}
    send(200,{ok:true});
   }catch(e){send(400,{error:e.code==='EEXIST'?'Administration déjà configurée.':e.message||'Configuration impossible.'});}return true;
  }
  this.failures=this.failures.filter(t=>this.now()-t<60000);
  if(this.failures.length>=15){send(429,{error:'Réessaie dans une minute.'});return true;}
  if(!await this.authorized(req)){this.failures.push(this.now());send(401,{error:'Code administrateur invalide.'});return true;}
  if(req.method==='GET'&&url.pathname==='/admin/api/status'){
   const health=await this.service.route('GET',new URL('http://localhost/v1/health'));
   const audio=this.service.audio.status();
   const credential=await readFile(path.join(this.data,'admin-token.sha256'),'utf8');
   let keySuffix='';try{const k=(await readFile(path.join(this.data,'openai-api-key.txt'),'utf8')).trim();if(/^sk-[A-Za-z0-9_-]{10,500}$/.test(k))keySuffix=k.slice(-4);}catch{}
   const reader=this.service.audio.phonon;let compute={device:'cpu'},gpuReady=false;
   if(reader?.computeSettings)compute=await reader.computeSettings();
   try{await stat(path.join(this.data,'phonon','ptts-cuda'));await stat(path.join(this.data,'phonon','model-multilingual','model.safetensors'));gpuReady=true;}catch{}
   send(200,{needsPassword:/^[a-f0-9]{64}$/.test(credential.trim()),codex:health.codex,chat:health.chatgpt,keySuffix,watchPaired:await this.hasPairedWatch(),firebase:{configured:!!this.service.config.firebase?.enabled,projectId:this.service.config.firebase?.projectId||'',loaded:!!this.service.push?.enabled},model:this.service.config.apiChatModel||'gpt-6.1-terra',chatUsage:chatUsageStatus(this.service.store),projects:this.service.projects.map(p=>p.name),phonon:{ready:audio.phononReady===true,install:this.phononInstall,gpuReady,compute,status:reader?.lastStatus||{}},audio:{enabled:!!audio.vpsKeyEnabled,monthlyLimitCents:audio.monthlyLimitCents,usedUsd:audio.usedUsd},login:this.login?{...this.login}:null});return true;
  }
  if(req.method==='GET'&&url.pathname==='/admin/api/pair-status'){send(200,{status:await this.pairingStatus(url.searchParams.get('id')||'')});return true;}
  if(req.method==='GET'&&url.pathname==='/admin/api/watches'){send(200,{data:this.watchAuth?.list()||[],legacyPresent:await this.hasPairedWatch(true)});return true;}
  if(req.method!=='POST'){send(404,{error:'Action inconnue.'});return true;}
  const maxBody=url.pathname==='/admin/api/firebase'?150000:4096;
  let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>maxBody){send(413,{error:'Demande trop volumineuse.'});return true;}}
  let input;try{input=JSON.parse(body||'{}');}catch{send(400,{error:'Demande invalide.'});return true;}
  try{
   if(url.pathname==='/admin/api/pair'){send(200,await makePairing(this.data,this.origin));return true;}
   if(url.pathname==='/admin/api/watch-revoke'){
    if(!this.watchAuth||typeof input.id!=='string')throw Error('Montre introuvable.');await this.watchAuth.revoke(input.id);
    this.service.store.data.devices=this.service.store.data.devices.filter(d=>d.watchId!==input.id);
    this.service.store.data.pushJobs=this.service.store.data.pushJobs.filter(j=>j.device?.watchId!==input.id);
    await this.service.store.save();send(200,{ok:true});return true;
   }
   if(url.pathname==='/admin/api/reveal-key'){const key=(await readFile(path.join(this.data,'openai-api-key.txt'),'utf8')).trim();if(!/^sk-[A-Za-z0-9_-]{10,500}$/.test(key))throw Error('Aucune clé enregistrée.');send(200,{key});return true;}
   if(url.pathname==='/admin/api/password'){
    if(typeof input.password!=='string'||input.password.length<12||input.password.length>256)throw Error('Choisis un mot de passe de 12 caractères minimum.');
    const salt=randomBytes(16),hash=scryptSync(input.password,salt,32),dest=path.join(this.data,'admin-token.sha256'),tmp=dest+'.'+randomUUID()+'.tmp';
    await writeFile(tmp,'scrypt:'+salt.toString('hex')+':'+hash.toString('hex'),{mode:0o600,flag:'wx'});await rename(tmp,dest);send(200,{ok:true});return true;
   }
   if(url.pathname==='/admin/api/key'){await saveApiKey(this.data,input.key);send(200,{ok:true});return true;}
   if(url.pathname==='/admin/api/firebase'){
    if(this.firebaseImporting)throw Error('Import Firebase déjà en cours.');this.firebaseImporting=true;
    try{
     const result=await saveFirebaseFiles({data:this.data,configFile:process.env.WATCH_CONFIG||path.join(this.data,'config.json'),android:input.android,service:input.service});
     this.service.config.firebase=result.firebase;this.service.push=new Push(result.firebase,{...process.env,GOOGLE_APPLICATION_CREDENTIALS:result.credentialPath});send(200,{ok:true});return true;
    }finally{this.firebaseImporting=false;}
   }
   if(url.pathname==='/admin/api/chat-model'){
    if(!['gpt-6-luna','gpt-6.1-terra','gpt-6.1-sol'].includes(input.model)||!this.service.apiChat)throw Error('Modèle indisponible.');
    const file=process.env.WATCH_CONFIG||path.join(this.data,'config.json'),config=JSON.parse(await readFile(file,'utf8')),tmp=file+'.'+randomUUID()+'.tmp';
    await writeFile(tmp,JSON.stringify({...config,apiChatModel:input.model},null,2),{mode:0o600,flag:'wx'});await rename(tmp,file);this.service.config.apiChatModel=input.model;this.service.apiChat.model=input.model;send(200,{ok:true});return true;
   }
   if(url.pathname==='/admin/api/phonon-install'){
    if(this.phononInstall?.running)throw Error('Installation déjà en cours.');
    if(typeof input.token!=='string'||!/^hf_[A-Za-z0-9]{15,}$/.test(input.token))throw Error('Jeton Hugging Face invalide.');
    if(this.service.audio.phonon.ready())throw Error('Phonon est déjà installé.');
    this.phononInstall={running:true,message:'Installation en cours…'};void installPhononLinux(this.data,input.token).then(()=>{this.phononInstall={running:false,message:'Phonon installé sur le serveur.'};}).catch(e=>{this.phononInstall={running:false,message:e.message};});send(200,{ok:true});return true;
   }
   if(url.pathname==='/admin/api/phonon-cuda-install'){
    if(this.phononInstall?.running)throw Error('Installation déjà en cours.');
    if(typeof input.token!=='string'||!/^hf_[A-Za-z0-9]{15,}$/.test(input.token))throw Error('Jeton Hugging Face invalide.');
    this.phononInstall={running:true,message:'Installation CUDA en cours. Cela peut prendre plusieurs minutes…'};
    void installPhononCudaLinux(this.data,input.token).then(()=>{this.phononInstall={running:false,message:'CUDA installé. Choisis-le dans Calcul.'};}).catch(e=>{this.phononInstall={running:false,message:e.message};});send(200,{ok:true});return true;
   }
   if(url.pathname==='/admin/api/phonon-compute'){
    if(!['cpu','gpu'].includes(input.device))throw Error('Choisis CPU ou CUDA.');
    if(input.device==='gpu')try{await stat(path.join(this.data,'phonon','ptts-cuda'));await stat(path.join(this.data,'phonon','model-multilingual','model.safetensors'));}catch{throw Error('Installe d’abord le moteur CUDA.');}
    const file=path.join(this.data,'phonon-compute.json'),tmp=file+'.'+randomUUID()+'.tmp';
    await writeFile(tmp,JSON.stringify({device:input.device,keepLoaded:false,preload:false}),{mode:0o600,flag:'wx'});await rename(tmp,file);this.service.audio.phonon?.configurationChanged();send(200,{ok:true});return true;
   }
   if(url.pathname==='/admin/api/audio'){
    if(typeof input.enabled!=='boolean'||!Number.isSafeInteger(input.monthlyLimitCents)||input.monthlyLimitCents<0||input.monthlyLimitCents>10000)throw Error('Choisis un budget entre 0 et 100 $.');
    if(input.enabled&&!await this.service.apiChat?.available())throw Error('Enregistre d’abord une clé API.');
    await this.service.audio.setBudget(input.monthlyLimitCents);this.service.audio.state.settings.vpsKeyEnabled=input.enabled;await this.service.store.save();send(200,{ok:true});return true;
   }
   if(url.pathname==='/admin/api/login'){await this.startLogin();send(200,{ok:true});return true;}
   send(404,{error:'Action inconnue.'});return true;
  }catch(e){send(400,{error:e.message||'Action impossible.'});return true;}
 }
}
