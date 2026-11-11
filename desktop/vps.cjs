'use strict';
const {spawn}=require('node:child_process');
const {randomInt,randomUUID,createHash}=require('node:crypto');
const path=require('node:path');

// This fixed program receives data on stdin, never as shell code. The server
// only exposes an existing private relay; it cannot change Funnel or services.
const remoteProgram=String.raw`
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {execFileSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
const base=path.join(process.env.HOME,'.local/share/codex-watch-vps'),data=path.join(base,'data');
function read(name){return JSON.parse(fs.readFileSync(path.join(data,name),'utf8'));}
function active(){try{return execFileSync('systemctl',['--user','is-active','codex-watch-vps.service'],{encoding:'utf8',timeout:5000}).trim()==='active';}catch{return false;}}
async function health(){try{const token=fs.readFileSync(path.join(data,'pairing-token.txt'),'utf8').trim();return await new Promise(resolve=>{const r=http.get('http://127.0.0.1:18787/v1/health',{headers:{Authorization:'Bearer '+token},timeout:4000},res=>{let b='';res.on('data',c=>{b+=c;if(b.length>65536)r.destroy();});res.on('end',()=>{try{resolve(res.statusCode===200?JSON.parse(b):null);}catch{resolve(null);}})});r.on('timeout',()=>r.destroy());r.on('error',()=>resolve(null));});}catch{return null;}}
async function main(input){
 if(input.action==='apiKeySave'){
  if(typeof input.key!=='string'||!/^sk-[A-Za-z0-9_-]{10,500}$/.test(input.key))throw Error('Clé invalide');
  const h=await health();if(h?.chatgptMode!=='api')throw Error('Chat API indisponible');
  const dest=path.join(data,'openai-api-key.txt'),tmp=dest+'.'+randomUUID()+'.tmp';
  try{fs.writeFileSync(tmp,input.key,{mode:0o600,flag:'wx'});fs.renameSync(tmp,dest);}catch(e){try{fs.unlinkSync(tmp);}catch{}throw e;}
  return {ok:true};
 }
 if(input.action==='siwcHost'){
  const file=path.join(data,'siwc-host.json');let host;
  try{host=JSON.parse(fs.readFileSync(file,'utf8')).host_id;}catch(e){if(e.code!=='ENOENT')throw e;host='urn:uuid:'+randomUUID();fs.writeFileSync(file,JSON.stringify({host_id:host}),{mode:0o600,flag:'wx'});}
  if(!/^urn:uuid:[a-f0-9-]{36}$/i.test(host))throw Error('Identifiant serveur invalide');
  let saved=null;try{saved=read('siwc-credentials.json');}catch(e){if(e.code!=='ENOENT')throw e;}
  return {hostId:host,clientId:saved?.client_id||'',subject:saved?.subject||'',connected:!!saved};
 }
 if(input.action==='siwcSave'){
  const c=input.credentials,host=read('siwc-host.json').host_id;
  if(!c||c.host_id!==host||!/^oaiapp_[A-Za-z0-9_-]+$/.test(c.client_id)||typeof c.subject!=='string'||!c.subject||
   !['access_token','refresh_token','id_token'].every(k=>typeof c[k]==='string'&&c[k].length>10&&c[k].length<16000)||
   !String(c.scope||'').split(/\s+/).includes('chatgpt.tokens.use.direct')||!Number.isFinite(c.expires_at))throw Error('Connexion invalide');
  const dest=path.join(data,'siwc-credentials.json');let old;try{old=JSON.parse(fs.readFileSync(dest,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(old&&(old.client_id!==c.client_id||old.subject!==c.subject))throw Error('Compte différent');
  const tmp=dest+'.'+randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(c),{mode:0o600,flag:'wx'});fs.renameSync(tmp,dest);return {ok:true,email:c.email||''};
 }
 if(input.action==='status'){
  const config=read('config.json'),h=await health();let login=false;
  try{execFileSync(path.join(base,'runtime/node_modules/.bin/codex'),['login','status'],{env:{...process.env,CODEX_HOME:path.join(data,'codex-home')},stdio:'ignore',timeout:7000});login=true;}catch{}
  return {service:active(),codex:!!h?.codex,login,apiChat:!!h?.chatgpt&&h?.chatgptMode==='api',apiSupported:h?.chatgptMode==='api',projects:(config.projects||[]).map(p=>({id:p.id,name:p.name,path:p.path}))};
 }
 if(input.action==='pair'){
  if(!active()||!(await health()))throw Error('Le relais VPS est indisponible.');
  if(!/^[a-f0-9-]{36}$/i.test(input.id)||!/^[a-f0-9]{64}$/.test(input.hash)||!Number.isSafeInteger(input.expiresAt)||input.expiresAt<Date.now()||input.expiresAt>Date.now()+125000)throw Error('Association invalide.');
  const dest=path.join(data,'pairing-window.json'),tmp=dest+'.'+randomUUID()+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify({id:input.id,hash:input.hash,expiresAt:input.expiresAt}),{mode:0o600,flag:'wx'});fs.renameSync(tmp,dest);return {ok:true};
 }
 if(input.action==='pairStatus'){
  if(!/^[a-f0-9-]{36}$/i.test(input.id))throw Error('Association invalide.');
  try{const result=read('pairing-result-'+input.id+'.json');return {status:result.status==='confirmed'?'confirmed':Date.now()>result.expiresAt?'unconfirmed':'accepted'};}catch{}
  try{const current=read('pairing-window.json');if(current.id===input.id)return {status:Date.now()>current.expiresAt?'expired':'waiting'};}catch{}
  return {status:'pending'};
 }
 throw Error('Action inconnue.');
}
let text='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>{text+=c;if(text.length>65536)process.exit(2)});process.stdin.on('end',()=>{Promise.resolve().then(()=>main(JSON.parse(text))).then(value=>console.log(JSON.stringify({ok:true,value}))).catch(()=>console.log(JSON.stringify({ok:false,error:'Le relais VPS ne répond pas ou sa configuration est indisponible.'})));});
`;
const encodedProgram=Buffer.from(remoteProgram).toString('base64');

function validate(input){
 if(!input||typeof input!=='object')throw Error('Renseigne la connexion VPS.');
 const host=String(input.host||'').trim(),user=String(input.user||'').trim(),identity=String(input.identity||'').trim(),port=Number(input.port||22);
 if(host.length>253||!/^([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)$/i.test(host)||host.includes('..'))throw Error('Adresse du VPS invalide.');
 if(!/^[a-z_][a-z0-9_-]{0,31}$/i.test(user))throw Error('Utilisateur SSH invalide.');
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Port SSH invalide.');
 if(!identity||!path.isAbsolute(identity)||identity.includes('\0')||identity.length>1024)throw Error('Choisis une clé privée SSH existante.');
 let url='';if(input.url){let u;try{u=new URL(String(input.url).trim());}catch{throw Error('Adresse HTTPS invalide.');}if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Utilise une adresse HTTPS sans chemin.');url=u.origin;}
 return {host,user,identity,port,url};
}
function ssh(config,input,{spawnImpl=spawn}={}){
 const c=validate(config),payload=JSON.stringify(input);if(Buffer.byteLength(payload)>65536)throw Error('Demande trop volumineuse.');
 const remote=`node -e "eval(Buffer.from('${encodedProgram}','base64').toString())"`;
 const args=['-T','-o','BatchMode=yes','-o','ConnectTimeout=8','-o','StrictHostKeyChecking=yes','-o','IdentitiesOnly=yes','-p',String(c.port),'-i',c.identity,`${c.user}@${c.host}`,remote];
 return new Promise((resolve,reject)=>{
  let child,done=false,out='';const finish=(err,value)=>{if(done)return;done=true;clearTimeout(timer);err?reject(err):resolve(value);};
  const timer=setTimeout(()=>{child?.kill();finish(Error('La connexion SSH au VPS a expiré.'));},20000);
  try{child=spawnImpl('ssh',args,{windowsHide:true,stdio:['pipe','pipe','ignore']});}catch{finish(Error('SSH est indisponible sur ce PC.'));return;}
  child.once('error',()=>finish(Error('SSH est indisponible sur ce PC.')));
  child.stdout.on('data',chunk=>{out+=chunk.toString();if(out.length>65536){child.kill();finish(Error('Réponse du VPS trop volumineuse.'));}});
  child.once('close',code=>{if(code!==0)return finish(Error('Connexion SSH impossible. Vérifie la clé et la confiance de l’hôte.'));try{const result=JSON.parse(out);if(!result.ok)throw Error();finish(null,result.value);}catch{finish(Error('Le relais VPS ne répond pas ou sa configuration est indisponible.'));}});
  child.stdin.on('error',()=>{});child.stdin.end(payload);
 });
}
async function status(config,{fetchImpl=fetch,...options}={}){
 const c=validate(config),info=await ssh(c,{action:'status'},options);let https='not-configured';
 if(c.url){try{const r=await fetchImpl(c.url+'/healthz',{redirect:'error',signal:AbortSignal.timeout(5000)});https=r.status===401?'reachable':'unavailable';}catch{https='unavailable';}}
 return {...info,https};
}
async function pair(config,{fetchImpl=fetch,...options}={}){
 const c=validate(config);if(!c.url)throw Error('Renseigne d’abord l’adresse HTTPS du VPS.');
 let response;try{response=await fetchImpl(c.url+'/healthz',{redirect:'error',signal:AbortSignal.timeout(5000)});}catch{throw Error('Le relais VPS n’est pas encore accessible en HTTPS.');}
 if(response.status!==401)throw Error('L’adresse HTTPS ne répond pas comme un relais non associé.');
 const code=String(randomInt(100000,1000000)),id=randomUUID(),expiresAt=Date.now()+120000,hash=createHash('sha256').update(code).digest('hex');
 await ssh(c,{action:'pair',id,hash,expiresAt},options);return {code,id,expiresAt,url:c.url};
}
async function pairStatus(config,id,options){if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))throw Error('Association invalide.');return ssh(config,{action:'pairStatus',id},options);}
async function connectPlan(config,{authorize,openBrowser,...options}){
 const host=await ssh(config,{action:'siwcHost'},options);
 const credentials=await authorize({hostId:host.hostId,clientId:host.clientId,expectedSubject:host.subject,openBrowser});
 return ssh(config,{action:'siwcSave',credentials},options);
}
module.exports={validate,ssh,status,pair,pairStatus,connectPlan};
