#!/usr/bin/env node
import {mkdir,readFile,writeFile,rename,copyFile,readdir,stat,access} from 'node:fs/promises';
import {randomInt,randomUUID,randomBytes,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_BASE=path.join(os.homedir(),'.local','share','codex-watch-vps');
export function privateUrl(value){
  let url;try{url=new URL(value);}catch{throw Error('Adresse HTTPS invalide.');}
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Utilise une adresse HTTPS sans chemin.');
  return url.origin;
}
export async function makePairing(data,url,{now=Date.now(),code=String(randomInt(100000,1000000)),id=randomUUID()}={}){
  const origin=privateUrl(url);if(!/^\d{6}$/.test(code)||!/^[a-f0-9-]{36}$/i.test(id))throw Error('Association invalide.');
  await mkdir(data,{recursive:true,mode:0o700});const dest=path.join(data,'pairing-window.json'),tmp=dest+'.'+randomUUID()+'.tmp';
  await writeFile(tmp,JSON.stringify({id,hash:createHash('sha256').update(code).digest('hex'),expiresAt:now+120000}),{mode:0o600,flag:'wx'});
  await rename(tmp,dest);return {id,code,url:origin,expiresAt:now+120000};
}
export async function saveApiKey(data,key){
  if(typeof key!=='string'||!/^sk-[A-Za-z0-9_-]{10,500}$/.test(key))throw Error('Format de clé API invalide.');
  await mkdir(data,{recursive:true,mode:0o700});const dest=path.join(data,'openai-api-key.txt'),tmp=dest+'.'+randomUUID()+'.tmp';
  await writeFile(tmp,key,{mode:0o600,flag:'wx'});await rename(tmp,dest);
}
export async function createSetupLink(data,url,{reset=false}={}){
  const origin=privateUrl(url),token=randomBytes(32).toString('base64url'),file=path.join(data,'admin-bootstrap.json');
  const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify({hash:createHash('sha256').update(token).digest('hex'),expiresAt:Date.now()+30*60*1000,...(reset?{reset:true}:{})}),{mode:0o600,flag:'wx'});await rename(tmp,file);
  return origin+'/admin#'+(reset?'reset':'setup')+'='+token;
}
function run(command,args,options={}){const p=spawnSync(command,args,{stdio:'inherit',...options});if(p.error)throw Error(command+' est introuvable ou inaccessible.');if(p.status!==0)throw Error(command+' a échoué (code '+p.status+').');}
function systemdQuote(value){if(/[\r\n\0]/.test(value))throw Error('Chemin incompatible avec systemd.');return '"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%')+'"';}
// WorkingDirectory is a single path, not a shell-style argument list: quotes
// become literal characters on systemd versions used by common VPS images.
export function systemdWorkingDirectory(value){if(!path.isAbsolute(value)||/[\r\n\0]/.test(value))throw Error('Chemin incompatible avec systemd.');return value.replaceAll('%','%%');}
async function exists(file){try{await access(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function waitForRelay(data,port){
  for(let i=0;i<40;i++){
    try{const token=(await readFile(path.join(data,'pairing-token.txt'),'utf8')).trim();const response=await fetch(`http://127.0.0.1:${port}/v1/health`,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(1000)});if(response.ok){const result=await response.json();if(typeof result.codex==='boolean')return;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw Error('Le service ne répond pas encore. Vérifie systemctl --user status codex-watch-vps.service et les journaux avant de continuer.');
}
async function install(){
  if(process.platform!=='linux')throw Error('Cette installation nécessite Linux et systemd utilisateur.');
  if(Number(process.versions.node.split('.')[0])<22)throw Error('Installe Node.js 22 ou plus récent.');
  if(process.getuid?.()===0)throw Error('Exécute l’installation avec un utilisateur ordinaire, pas root.');
  const base=DEFAULT_BASE,data=path.join(base,'data'),bridge=path.join(base,'bridge'),runtime=path.join(base,'runtime');
  const unitDir=path.join(os.homedir(),'.config/systemd/user'),unit=path.join(unitDir,'codex-watch-vps.service');
  if(await exists(base)||await exists(unit))throw Error('Installation existante détectée. Elle est conservée ; utilise les commandes de configuration existantes.');
  const check=spawnSync('systemctl',['--user','show-environment'],{stdio:'ignore'});if(check.status!==0)throw Error('La session systemd utilisateur est indisponible. Connecte-toi en SSH avec une session utilisateur complète.');
  const source=path.dirname(fileURLToPath(import.meta.url));
  await mkdir(bridge,{recursive:true,mode:0o700});await mkdir(data,{recursive:true,mode:0o700});await mkdir(path.join(data,'codex-home'),{recursive:true,mode:0o700});await mkdir(path.join(base,'projects'),{recursive:true,mode:0o700});await mkdir(runtime,{recursive:true,mode:0o700});
  for(const f of await readdir(source))if(f.endsWith('.mjs')||['vps-admin.html','vps-admin.js','vps-i18n.js','package.json','package-lock.json','phonon-voices.json','config.example.json'].includes(f))await copyFile(path.join(source,f),path.join(bridge,f));
  console.log('Installation des dépendances du relais…');run('npm',['ci','--omit=dev'],{cwd:bridge});
  console.log('Installation de Codex…');run('npm',['install','--prefix',runtime,'--no-save','--no-package-lock','@openai/codex']);
  const executable=path.join(runtime,'node_modules','.bin','codex');await stat(executable);
  const config={host:'127.0.0.1',port:18787,codexBackend:'standalone',projects:[{id:'vps',name:'VPS',path:path.join(base,'projects')}],chatgptDesktop:false,apiChat:true,apiChatModel:'gpt-6.1-terra',vpsAdmin:false,discovery:false,publicUrl:''};
  await writeFile(path.join(data,'config.json'),JSON.stringify(config,null,2),{mode:0o600,flag:'wx'});
  await mkdir(unitDir,{recursive:true,mode:0o700});
  const unitText=['[Unit]','Description=Codex Watch VPS relay','After=network-online.target','','[Service]','Type=simple',`WorkingDirectory=${systemdWorkingDirectory(bridge)}`,...Object.entries({WATCH_CONFIG:path.join(data,'config.json'),WATCH_DATA_DIR:data,CODEX_HOME:path.join(data,'codex-home'),CODEX_EXECUTABLE:executable}).map(([k,v])=>`Environment=${systemdQuote(k+'='+v)}`),`ExecStart=${systemdQuote(process.execPath.replaceAll('$','$$'))} ${systemdQuote(path.join(bridge,'server.mjs').replaceAll('$','$$'))}`,'Restart=on-failure','RestartSec=3','UMask=0077','','[Install]','WantedBy=default.target',''].join('\n');
  await writeFile(unit,unitText,{mode:0o600,flag:'wx'});run('systemctl',['--user','daemon-reload']);run('systemctl',['--user','enable','codex-watch-vps.service']);run('systemctl',['--user','start','codex-watch-vps.service']);await waitForRelay(data,config.port);
  console.log('\nRelais installé. Termine la connexion Codex, le HTTPS et l’association en suivant le guide VPS.');
}
async function secretInput(){
  if(!process.stdin.isTTY)throw Error('Ouvre une console interactive pour saisir la clé sans affichage.');
  return new Promise((resolve,reject)=>{
    let value='';const input=process.stdin;process.stdout.write('Colle la clé API (elle ne sera pas affichée), puis Entrée : ');
    const finish=(error)=>{input.off('data',onData);input.setRawMode(false);input.pause();process.stdout.write('\n');error?reject(error):resolve(value);};
    function onData(chunk){for(const c of chunk.toString('utf8')){if(c==='\u0003')return finish(Error('Saisie annulée.'));if(c==='\r'||c==='\n')return finish();if(c==='\u007f'||c==='\b')value=value.slice(0,-1);else if(c>=' '&&c<='~'&&value.length<501)value+=c;}}
    input.setRawMode(true);input.resume();input.on('data',onData);
  });
}
async function main(){
  const command=process.argv[2]||'help',base=DEFAULT_BASE,data=path.join(base,'data');
  if(command==='install')return install();
  if(command==='key'){if(!await exists(path.join(data,'config.json')))throw Error('Installe d’abord le relais.');const key=await secretInput();await saveApiKey(data,key);console.log('Clé enregistrée sur le serveur.');return;}
  if(command==='admin'){
    if(!await exists(path.join(data,'config.json')))throw Error('Installe d’abord le relais.');
    const dest=path.join(data,'admin-token.sha256');if(await exists(dest)&&process.argv[3]!=='--reset')throw Error('Code administrateur déjà créé. Utilise admin --reset pour le remplacer.');
    const secret=randomBytes(32).toString('base64url'),tmp=dest+'.'+randomUUID()+'.tmp';await writeFile(tmp,createHash('sha256').update(secret).digest('hex'),{mode:0o600,flag:'wx'});await rename(tmp,dest);
    console.log('\nCode administrateur (à conserver dans un coffre, ne l’envoie pas par message) :\n'+secret+'\n');return;
  }
  if(command==='reset-admin'){
    if(!await exists(path.join(data,'admin-token.sha256')))throw Error('Aucun mot de passe administrateur à remplacer.');
    const config=JSON.parse(await readFile(path.join(data,'config.json'),'utf8'));
    console.log('Lien privé de réinitialisation (valable 30 minutes) :\n'+await createSetupLink(data,config.publicUrl,{reset:true}));return;
  }
  if(command==='url'){
    const file=path.join(data,'config.json'),url=privateUrl(process.argv[3]);const config=JSON.parse(await readFile(file,'utf8'));
    if(config.codexBackend!=='standalone')throw Error('Ce réglage nécessite un relais autonome.');
    const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify({...config,publicUrl:url,vpsAdmin:true},null,2),{mode:0o600,flag:'wx'});await rename(tmp,file);
    if(!await exists(path.join(data,'admin-token.sha256')))console.log('\nOuvre ce lien privé dans ton navigateur pour choisir ton mot de passe (valable 30 minutes) :\n'+await createSetupLink(data,url)+'\n');
    console.log('Adresse enregistrée. Redémarre le service utilisateur pour activer l’interface.');return;
  }
  if(command==='login'){const exe=path.join(base,'runtime/node_modules/.bin/codex');run(exe,['login','--device-auth'],{env:{...process.env,CODEX_HOME:path.join(data,'codex-home')}});return;}
  if(command==='pair'){
    if(!await exists(path.join(data,'config.json')))throw Error('Installe d’abord le relais.');
    const config=JSON.parse(await readFile(path.join(data,'config.json'),'utf8'));const pairing=await makePairing(data,process.argv[3]||config.publicUrl);
    console.log(`\nAdresse du relais : ${pairing.url}\nCode : ${pairing.code}\nValable deux minutes, une seule fois.\nSur la montre : Paramètres → Connexions → Mon serveur.\n`);
    while(Date.now()<pairing.expiresAt+10000){try{const result=JSON.parse(await readFile(path.join(data,'pairing-result-'+pairing.id+'.json'),'utf8'));if(result.status==='confirmed'){console.log('Montre associée.');return;}}catch(e){if(e.code!=='ENOENT')throw e;}await new Promise(r=>setTimeout(r,1000));}
    console.log('Confirmation non reçue. Génère un nouveau code si nécessaire.');return;
  }
  console.log('Codex Watch sur VPS\n  install      Installer le relais (Linux)\n  admin        Créer le code pour le navigateur\n  reset-admin  Créer un lien privé pour remplacer le mot de passe\n  url URL      Configurer l’adresse HTTPS publique\n  login        Connecter Codex depuis la console\n  key          Enregistrer la clé API sans l’afficher\n  pair URL     Générer un code d’association pour la montre');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error('Codex Watch : '+e.message);process.exitCode=1;});
