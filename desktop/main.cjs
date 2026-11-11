if (process.argv.includes('--phonon-worker')) {
  require('./phonon-worker.cjs');
} else {
const {app,BrowserWindow,ipcMain,Tray,Menu,nativeImage,dialog,safeStorage,shell}=require('electron');
const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const {pathToFileURL}=require('node:url');
const {randomInt,randomUUID,createHash}=require('node:crypto');const execute=promisify(execFile);
const {createWatchdog}=require('./watchdog.cjs');
const phononSetup=require('./phonon-setup.cjs');
const {confirmedPairing}=require('./pair-status.cjs');
app.setAppUserModelId('org.codexwatch.relay');
// Retain the existing paired devices, vault and preferences across the public rename.
app.setPath('userData',path.join(app.getPath('appData'),'Codex Watch Relay'));
const smoke=process.argv.includes('--smoke-test');
const startupTest=process.argv.includes('--startup-test');
const option=name=>{const at=process.argv.indexOf(name);return at<0?null:process.argv[at+1];};
if(startupTest&&!option('--data-dir'))throw Error('Startup tests require an isolated data directory.');
const data=path.resolve(option('--data-dir')||path.join(app.getPath('userData'),'relay'));
const external=process.argv.includes('--external');
const startupArgs=['--background',...(option('--data-dir')?['--data-dir',data]:[])];
const bridge=app.isPackaged?path.join(process.resourcesPath,'bridge'):path.resolve(__dirname,'../bridge');
let window,tray,child,quitting=false,notice='',discovered=null,wanted=false,launching=null,recovering=false,launchStage='idle';
let btChild=null,btStatus='Désactivé',btStarting=null,btRetryTimer=null;
let internetCache={origin:'',at:0,value:''};
app.disableHardwareAcceleration();
if(smoke||startupTest)app.setPath('userData',path.join(data,'electron-profile'));
const read=async(name,fallback={})=>{try{return JSON.parse((await fs.readFile(path.join(data,name),'utf8')).replace(/^\uFEFF/,''));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
const write=async(name,value)=>{await fs.mkdir(data,{recursive:true});await fs.writeFile(path.join(data,name),JSON.stringify(value,null,2),{mode:0o600});};
function stopBluetooth(){if(btRetryTimer){clearTimeout(btRetryTimer);btRetryTimer=null;}const old=btChild;btChild=null;if(old)old.kill();btStatus='Désactivé';}
async function startBluetooth(){
  const settings=await read('bluetooth.json');if(!settings.enabled||!child)return;
  if(btChild)return;if(btStarting)return btStarting;
  btStarting=(async()=>{
    const config=await read('config.json');const port=Number(config.port||8787);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Port du relais invalide.');
    const executable=app.isPackaged?path.join(process.resourcesPath,'CodexWatchBluetooth.exe'):path.resolve(__dirname,'../.tools/CodexWatchBluetooth.exe');
    btStatus='Démarrage…';const processBt=spawn(executable,[String(port),String(process.pid)],{windowsHide:true,stdio:['ignore','pipe','ignore']});btChild=processBt;
    try{await new Promise((resolve,reject)=>{let settled=false,buffer='';const timer=setTimeout(()=>done(Error('Le Bluetooth ne répond pas.')),10000);function done(e){if(settled)return;settled=true;clearTimeout(timer);e?reject(e):resolve();}processBt.once('error',()=>done(Error('Bluetooth indisponible.')));processBt.once('exit',()=>done(Error('Bluetooth indisponible.')));processBt.stdout.on('data',b=>{buffer+=b.toString();const lines=buffer.split(/\r?\n/);buffer=lines.pop();for(const line of lines){if(line==='READY'){btStatus='En attente de la montre';done();}else if(line==='CONNECTED')btStatus='Montre connectée en Bluetooth';else if(line==='DISCONNECTED')btStatus='En attente de la montre';}});});
      processBt.once('exit',()=>{if(btChild===processBt){btChild=null;btStatus='Bluetooth interrompu · reconnexion…';scheduleBluetoothRestart();}});
    }catch(e){if(btChild===processBt)btChild=null;processBt.kill();btStatus='Bluetooth indisponible sur ce PC.';throw e;}
  })().finally(()=>{btStarting=null;});return btStarting;
}
function scheduleBluetoothRestart(){if(btRetryTimer||!wanted||quitting)return;btRetryTimer=setTimeout(()=>{btRetryTimer=null;if(wanted&&child&&!btChild)void startBluetooth().catch(()=>{btStatus='Bluetooth indisponible · nouvelle tentative…';scheduleBluetoothRestart();});},5000);btRetryTimer.unref();}
async function token(){return(await fs.readFile(path.join(data,'pairing-token.txt'),'utf8')).trim();}
async function health(){try{const c=await read('config.json');const r=await fetch(`http://127.0.0.1:${c.port||8787}/v1/health`,{headers:{Authorization:'Bearer '+await token()},signal:AbortSignal.timeout(1800)});return r.ok?await r.json():null;}catch{return null;}}
async function internetState(config){
  if(!config.publicUrl)return 'Non configuré';
  if(!child&&!external)return 'Relais arrêté';
  try{const url=new URL(config.publicUrl);if(url.protocol!=='https:'||url.username||url.password)return 'Adresse invalide';
    if(internetCache.origin===url.origin&&Date.now()-internetCache.at<10000)return internetCache.value;
    const response=await fetch(url.origin+'/healthz',{headers:{Authorization:'Bearer '+await token()},redirect:'error',signal:AbortSignal.timeout(2000)});
    const value=response.ok?'Relais accessible par Internet':'Relais Internet indisponible';internetCache={origin:url.origin,at:Date.now(),value};return value;
  }catch{return 'Relais Internet indisponible';}
}
async function relayAudio(method='GET',route='settings',body=null){
  const c=await read('config.json');
  if (!['settings','phonon-voice','mode','openai-voice','budget','speed','auto-read-dictation'].includes(route)) throw Error('Réglage vocal invalide.');
  const r=await fetch(`http://127.0.0.1:${c.port||8787}/v1/audio/${route}`,{method,headers:{Authorization:'Bearer '+await token(),'Content-Type':'application/json'},...(method==='PUT'?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(method==='GET'?1800:30000)});
  const result=await r.json();if(!r.ok)throw Error(result.error||'Réglage vocal indisponible.');return result;
}
async function filterProjects(projects){
  if(!Array.isArray(projects))throw Error('Liste de projets invalide.');
  const checked=await Promise.all(projects.map(async p=>{if(!p||typeof p.path!=='string')return null;try{return (await fs.stat(p.path)).isDirectory()?p:null;}catch{return null;}}));
  return checked.filter(Boolean);
}
async function discover(){
  const home=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
  const old=await read('runtime.json');let appToolsServer=old.appToolsServer,codexExecutable=old.codexExecutable,originThreadId=old.originThreadId;
  async function newest(root,leaf){try{const entries=await fs.readdir(root);const found=[];for(const e of entries){const p=path.join(root,e,leaf);try{found.push({p,time:(await fs.stat(p)).mtimeMs});}catch{}}return found.sort((a,b)=>b.time-a.time)[0]?.p;}catch{return null;}}
  appToolsServer||=await newest(path.join(home,'plugins/cache/openai-bundled/codex-app-tools'),'server.mjs');
  codexExecutable||=process.platform==='win32'?await newest(path.join(process.env.LOCALAPPDATA||'','OpenAI/Codex/bin'),'codex.exe'):null;
  if(!originThreadId){
    // Only the first metadata line is inspected; no conversation content is imported.
    async function visit(root,depth=0){if(depth>4)return null;let entries;try{entries=await fs.readdir(root,{withFileTypes:true});}catch{return null;}entries.sort((a,b)=>b.name.localeCompare(a.name));for(const e of entries){const p=path.join(root,e.name);if(e.isDirectory()){const found=await visit(p,depth+1);if(found)return found;}else if(e.name.endsWith('.jsonl')){const file=await fs.open(p,'r');try{const buffer=Buffer.alloc(32768);const {bytesRead}=await file.read(buffer,0,buffer.length,0);const first=JSON.parse(buffer.subarray(0,bytesRead).toString().split('\n')[0]);if(first.type==='session_meta'&&first.payload?.id)return first.payload.id;}catch{}finally{await file.close();}}}return null;}
    originThreadId=await visit(path.join(home,'sessions'));
  }
  const runtime={...old,codexHome:home,codexExecutable,appToolsServer,originThreadId};
  let projects=[];let error='';
  if(appToolsServer&&originThreadId){
    const {DesktopClient}=await import(pathToFileURL(path.join(bridge,'desktop.mjs')));const client=new DesktopClient(runtime);
    try{await client.start();projects=(client.projects?.projects||[]).filter(p=>p.projectKind==='local'&&p.hostId==='local'&&p.path).map(p=>({id:p.projectId,name:p.name||path.basename(p.path),path:p.path}));}catch(e){error='Ouvre Codex sur le PC, puis réessaie la détection.';}finally{client.stop();}
  }else error='Installe Codex et ouvre un premier chat pour associer le bureau.';
  if(smoke&&process.argv.includes('--missing-project-test'))projects.push({id:'missing-fixture',name:'Projet indisponible',path:path.join(data,'missing-fixture'),available:false});
  projects=await filterProjects(projects);
  discovered={runtime,projects};return {desktop:!!(appToolsServer&&originThreadId),codex:!!codexExecutable,projects,error};
}
async function state(){const config=await read('config.json');return {platform:process.platform,configured:Array.isArray(config.projects),config:{backend:config.codexBackend||'desktop',projects:await filterProjects(config.projects||[]),publicUrl:config.publicUrl||''},health:await health(),audio:await relayAudio().catch(()=>null),phononCompute:await read('phonon-compute.json',{device:'cpu',keepLoaded:false}),phononComputeStatus:await read('phonon-compute-status.json',{}),bluetoothEnabled:!!(await read('bluetooth.json')).enabled,bluetoothStatus:btStatus,internetStatus:await internetState(config),running:!!child,external,notice,watchPaired:await confirmedPairing(data),keyPresent:!!(await read('secrets.json')).key,phononReady:await phononSetup.installed(data),autostart:app.getLoginItemSettings({args:startupArgs}).openAtLogin,version:app.getVersion()};}
function start(){wanted=true;if(!launching)launching=launch().catch(async e=>{notice=launchStage==='vault'?'Le coffre Windows est indisponible : reconnecte-toi à ta session Windows puis relance le relais.':'Le relais n’a pas démarré. Vérifie la configuration puis utilise Démarrer.';const code=typeof e.code==='string'&&/^[A-Z0-9_]+$/.test(e.code)?e.code:e.name||'Error';await fs.appendFile(path.join(data,'relay-process.log'),`${new Date().toISOString()} start-failed=${code} stage=${launchStage}\n`).catch(()=>{});throw e;}).finally(()=>{launching=null;});return launching;}
async function launch(){
  launchStage='health';if(await health())return state();if(child)throw Error('Le relais démarre déjà.');
  launchStage='config';const config=await read('config.json');if(!config.projects?.length)throw Error('Choisis au moins un projet.');
  launchStage='vault';let key,vaultWarning='';
  try{
    const vault=await read('secrets.json'),encrypted=vault.key;
    if(encrypted){if(!await safeStorage.isAsyncEncryptionAvailable())throw Error('Vault unavailable');const value=await safeStorage.decryptStringAsync(Buffer.from(encrypted,'base64'));key=value.result;if(value.shouldReEncrypt)await write('secrets.json',{...vault,key:(await safeStorage.encryptStringAsync(key)).toString('base64')});}
  }catch{
    vaultWarning='Relais actif. La clé audio est inaccessible : vérifie-la dans Voix et budget.';
    void fs.appendFile(path.join(data,'relay-process.log'),`${new Date().toISOString()} audio-vault-unavailable\n`).catch(()=>{});
  }
  const env={...process.env,WATCH_DATA_DIR:data,WATCH_CONFIG:path.join(data,'config.json'),WATCH_GUI_KEY_MANAGED:'1',ELECTRON_RUN_AS_NODE:'1'};delete env.OPENAI_API_KEY;if(key)env.OPENAI_API_KEY=key;
  if(!wanted||quitting)return state();
  launchStage='spawn';child=spawn(process.execPath,[path.join(bridge,'server.mjs')],{cwd:bridge,env,windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
  // Only a generic diagnostic reaches the window; stderr can contain provider details.
  child.stderr.on('data',()=>{notice='Démarrage du relais à vérifier.';});
  const launched=child;
  child.on('error',()=>{if(child===launched)child=null;notice='Impossible de lancer le relais. Nouvelle tentative automatique.';});
  child.on('exit',(code,signal)=>{if(child===launched){child=null;stopBluetooth();}if(wanted&&!quitting)notice='Connexion interrompue. Reconnexion automatique…';void fs.appendFile(path.join(data,'relay-process.log'),`${new Date().toISOString()} exit=${code} signal=${signal}\n`).catch(()=>{});});
  // Start Bluetooth as soon as the relay process exists. A slow Codex startup
  // must not permanently skip Bluetooth after the health confirmation times out.
  void startBluetooth().catch(()=>{btStatus='Bluetooth indisponible · nouvelle tentative…';scheduleBluetoothRestart();});
  launchStage='health-confirmation';for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,250));if(await health()){notice=vaultWarning;return state();}if(!child)break;}
  throw Error('Démarrage non confirmé. Vérifie Codex et la configuration.');
}
async function stop(){if(!child){if(external)throw Error('Ce relais est géré par le service existant.');wanted=false;stopBluetooth();return state();}const active=await read('state.json');if(Object.entries(active.audio?.jobs||{}).some(([id,j])=>id.startsWith('live:')&&j.state==='pending'))throw Error('Termine le Live avant d’arrêter le relais.');wanted=false;stopBluetooth();child.send({type:'stop'});for(let i=0;i<80&&child;i++)await new Promise(r=>setTimeout(r,100));if(child)throw Error('Fermeture du relais à vérifier.');return state();}
async function watchesControl(action,watchId){
  if(!child?.connected)throw Error('Démarre le relais pour gérer les montres.');
  const running=child,id=randomUUID();
  return await new Promise((resolve,reject)=>{
    let done=false;const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);running.off('message',onMessage);running.off('exit',onExit);error?reject(error):resolve(value);};
    const onMessage=m=>{if(m?.type==='watches-control-result'&&m.id===id)finish(m.ok?null:Error('Gestion des montres indisponible.'),m.value);};
    const onExit=()=>finish(Error('Le relais s’est arrêté.'));
    const timer=setTimeout(()=>finish(Error('Le relais ne répond pas.')),8000);
    running.on('message',onMessage);running.once('exit',onExit);
    try{running.send({type:'watches-control',id,action,watchId});}catch{finish(Error('Relais indisponible.'));}
  });
}
const routes={
  watchList:async()=>watchesControl('list'),
  watchRevoke:async id=>{if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))throw Error('Montre invalide.');return watchesControl('revoke',id);},
  bluetooth:async enabled=>{if(typeof enabled!=='boolean')throw Error('Choix Bluetooth invalide.');if(enabled&&!child)throw Error('Démarre le relais avant le Bluetooth.');await write('bluetooth.json',{enabled});if(enabled)try{await startBluetooth();}catch(e){btStatus='Bluetooth indisponible · nouvelle tentative…';scheduleBluetoothRestart();throw e;}else stopBluetooth();return state();},
  installPhonon:async value=>{await phononSetup.install(data,value);return state();},
  phononVoice:async value=>{if(typeof value!=='string'||value.length>30)throw Error('Voix invalide.');await relayAudio('PUT','phonon-voice',{voice:value});return state();},
  audioMode:async mode=>{await relayAudio('PUT','mode',{mode});return state();},
  audioAutoRead:async enabled=>{await relayAudio('PUT','auto-read-dictation',{enabled});return state();},
  openaiVoice:async voice=>{await relayAudio('PUT','openai-voice',{voice});return state();},
  audioBudget:async monthlyLimitCents=>{await relayAudio('PUT','budget',{monthlyLimitCents});return state();},
  audioSpeed:async settings=>{await relayAudio('PUT','speed',settings);return state();},
  phononCompute:async settings=>{
    if(!settings||!['cpu','auto','gpu'].includes(settings.device)||typeof settings.keepLoaded!=='boolean'||typeof settings.preload!=='boolean'||(settings.preload&&!settings.keepLoaded))throw Error('Choisis un mode de calcul valide.');
    const temp=path.join(data,'.phonon-compute-'+randomUUID()+'.tmp');
    try{await fs.writeFile(temp,JSON.stringify({device:settings.device,keepLoaded:settings.keepLoaded,preload:settings.preload}),{mode:0o600,flag:'wx'});await fs.rename(temp,path.join(data,'phonon-compute.json'));}
    finally{await fs.unlink(temp).catch(()=>{});}
    if(child?.connected)child.send({type:'phonon-config-changed'});
    return state();
  },
  phononComputeTest:async()=>{
    if(!child?.connected)throw Error('Démarre le relais avant de tester Phonon.');
    const running=child,id=randomUUID();
    const ok=await new Promise((resolve,reject)=>{
      const finish=(error,value)=>{clearTimeout(timer);running.off('message',onMessage);running.off('exit',onExit);error?reject(error):resolve(value);};
      const onMessage=m=>{if(m?.type==='phonon-test-result'&&m.id===id)finish(null,m.ok);};
      const onExit=()=>finish(Error('Le relais s’est arrêté pendant le test.'));
      const timer=setTimeout(()=>finish(Error('Le test Phonon a expiré.')),60000);
      running.on('message',onMessage);running.once('exit',onExit);
      try{running.send({type:'phonon-test',id});}catch{finish(Error('Relais indisponible.'));}
    });
    if(!ok)throw Error('Test Phonon indisponible. Vérifie son installation et réessaie.');
    return state();
  },
  apply:async input=>{const current=await read('state.json');if(Object.entries(current.audio?.jobs||{}).some(([id,j])=>id.startsWith('live:')&&j.state==='pending'))throw Error('Termine le Live avant d’appliquer les réglages.');const running=!!child;await routes.save(input);if(running)await stop();return start();},
  restart:async()=>{await stop();return start();},
  state,discover,filterProjects,
  folder:async()=>{const result=await dialog.showOpenDialog(window,{properties:['openDirectory']});return result.canceled?null:result.filePaths[0];},
  save:async input=>{
    if(!input||!['desktop','standalone'].includes(input.backend))throw Error('Choisis le moteur.');
    const projects=[];for(const [index,p]of (input.projects||[]).entries()){if(typeof p.path!=='string'||typeof p.name!=='string')throw Error('Projet invalide');let folder;try{folder=await fs.realpath(p.path);if(!(await fs.stat(folder)).isDirectory())throw Error('Not a folder');}catch{throw Error(`Le dossier du projet « ${p.name.slice(0,80)} » est indisponible. Actualise la liste des projets avant d’appliquer.`);}projects.push({id:p.id||'project-'+index,name:p.name.slice(0,100),path:folder});}
    if(!projects.length)throw Error('Choisis au moins un projet.');
    if(input.publicUrl){const url=new URL(input.publicUrl);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Utilise une adresse HTTPS sans chemin.');}
    const old=await read('config.json');
    await write('config.json',{...old,host:'127.0.0.1',port:old.port||8787,codexBackend:input.backend,projects,chatgptDesktop:input.backend==='desktop',publicUrl:input.publicUrl||'',chatModel:''});
    if(discovered)await write('runtime.json',discovered.runtime);
    return state();
  },start,stop,
  pair:async()=>{if(!await health())throw Error('Démarre le relais avant l’association.');const c=await read('config.json');if(!c.publicUrl)throw Error('Renseigne l’adresse HTTPS.');const code=String(randomInt(100000,1000000)),id=randomUUID(),expiresAt=Date.now()+120000;await write('pairing-window.json',{id,hash:createHash('sha256').update(code).digest('hex'),expiresAt});return {code,id,url:c.publicUrl,expiresAt};},
  pairStatus:async id=>{if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))throw Error('Association invalide.');const result=await read('pairing-result-'+id+'.json',null);if(result?.id===id)return {status:result.status==='confirmed'?'confirmed':Date.now()>result.expiresAt?'unconfirmed':'accepted'};const current=await read('pairing-window.json',null);if(current?.id===id)return {status:Date.now()>current.expiresAt?'expired':'waiting'};return {status:'pending'};},
  revealKey:async()=>{const vault=await read('secrets.json');if(!vault.key)throw Error('Aucune clé enregistrée.');try{const value=await safeStorage.decryptStringAsync(Buffer.from(vault.key,'base64'));if(!value.result)throw Error();return {key:value.result};}catch{throw Error('Le coffre Windows ne permet pas de lire cette clé.');}},
  key:async value=>{const current=await read('state.json');if(Object.entries(current.audio?.jobs||{}).some(([id,j])=>id.startsWith('live:')&&j.state==='pending'))throw Error('Termine le Live avant de modifier la clé.');if(typeof value!=='string'||value.length>500||value&&!/^sk-[A-Za-z0-9_-]+$/.test(value))throw Error('Clé API invalide');if(value&&!await safeStorage.isAsyncEncryptionAvailable())throw Error('Le coffre système est indisponible');await write('secrets.json',{managed:true,...(value?{key:(await safeStorage.encryptStringAsync(value)).toString('base64')}:{})});return {ok:true};},
  changeKey:async value=>{const running=!!child;if(running)await stop();try{await routes.key(value);}catch(e){if(running)await start().catch(()=>{});throw e;}return running?start():state();},
  tunnel:async()=>{const executable=process.platform==='win32'?path.join(process.env.ProgramFiles||'C:/Program Files','Tailscale/tailscale.exe'):'tailscale';const c=await read('config.json');await execute(executable,['funnel','--bg','--https=8443',String(c.port||8787)],{windowsHide:true,timeout:20000});const {stdout}=await execute(executable,['status','--json'],{windowsHide:true,timeout:10000});const status=JSON.parse(stdout);const name=status.Self?.DNSName?.replace(/\.$/,'');if(!name)throw Error('Connecte Tailscale avant de continuer.');c.publicUrl=`https://${name}:8443`;await write('config.json',c);return state();},
  autostart:async value=>{if(typeof value!=='boolean')throw Error('Choix invalide');app.setLoginItemSettings({openAtLogin:value,args:startupArgs});return state();},
  open:async name=>{const urls={'bluetooth-settings':'ms-settings:bluetooth',codex:'https://chatgpt.com/codex',tailscale:'https://tailscale.com/download',privacy:'https://platform.openai.com/docs/guides/your-data',phononModel:'https://huggingface.co/gradium/phonon-40m-multilingual',hfToken:'https://huggingface.co/settings/tokens'};if(!urls[name])throw Error('Lien invalide');await shell.openExternal(urls[name]);return {ok:true};}
};
for(const[name,handler]of Object.entries(routes))ipcMain.handle('relay:'+name,async(event,arg)=>{if(event.sender!==window?.webContents||!event.senderFrame?.url.startsWith(pathToFileURL(path.join(__dirname,'ui/index.html')).href))throw Error('Origine interdite');try{return {ok:true,value:await handler(arg)};}catch(e){return {ok:false,error:e.message?.replace(/sk-[A-Za-z0-9_-]+/g,'[masqué]')||'Action impossible'};}});
async function testRendererRecovery(){const backendPid=child?.pid;try{const loaded=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Window recovery timeout')),12000);window.webContents.once('did-finish-load',()=>{clearTimeout(timer);resolve();});});window.webContents.forcefullyCrashRenderer();await loaded;await new Promise(r=>setTimeout(r,500));const usable=await window.webContents.executeJavaScript('!!document.getElementById("status")');await fs.writeFile(path.join(data,'renderer-recovery.json'),JSON.stringify({usable,relayUnchanged:child?.pid===backendPid,backendHealthy:(await health())?.codex}));await fs.writeFile(path.join(data,'relay-recovered.png'),(await window.webContents.capturePage()).toPNG());}catch(e){await fs.writeFile(path.join(data,'renderer-recovery.json'),JSON.stringify({error:e.message}));}}
async function testTrayReopen(){
 const backendPid=child?.pid,checks=[];
 try{
  for(let i=0;i<3;i++){
   const old=window;const closed=new Promise(resolve=>old.once('closed',resolve));old.close();await closed;if(!old.isDestroyed())throw Error('Window was not closed');
   show(false);const current=window;
   await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Reopen timeout')),12000);current.webContents.once('did-finish-load',()=>{clearTimeout(timeout);resolve();});});
   current.showInactive();await new Promise(r=>setTimeout(r,400));
   const content=await current.webContents.executeJavaScript('({title:document.title,heading:document.querySelector("h2")?.textContent,hasControls:!!document.getElementById("start")})');
   const png=(await current.webContents.capturePage()).toPNG();
   checks.push({newWindow:current!==old,content,painted:png.length>10000,relayUnchanged:child?.pid===backendPid,backendHealthy:!!(await health())});
   if(i===2)await fs.writeFile(path.join(data,'tray-reopened.png'),png);
  }
  await fs.writeFile(path.join(data,'tray-reopen.json'),JSON.stringify({checks}));
 }catch(e){await fs.writeFile(path.join(data,'tray-reopen.json'),JSON.stringify({error:e.message,checks}));}
}
let renderRecoveries=0,renderRecovering=false;
async function recoverWindow(reason){
 if(!window||window.isDestroyed()||quitting||renderRecovering)return;
 renderRecovering=true;await fs.appendFile(path.join(data,'window-process.log'),new Date().toISOString()+' '+reason+'\n').catch(()=>{});
 if(++renderRecoveries>3){notice='L’interface ne répond plus. Ferme puis rouvre cette fenêtre ; le relais continue en arrière-plan.';renderRecovering=false;return;}
 setTimeout(()=>{if(window&&!window.isDestroyed())void window.loadFile(path.join(__dirname,'ui/index.html')).catch(()=>{});renderRecovering=false;},500);
}
function show(visible=true){
 if(window&&!window.isDestroyed()){
  if(!window.isVisible()&&!smoke){window.destroy();window=null;}
  else {if(window.webContents.isCrashed()){renderRecoveries=0;void recoverWindow('reopen');}if(visible&&!smoke){if(window.isMinimized())window.restore();window.show();window.focus();}return;}
 }
 window=new BrowserWindow({width:920,height:760,minWidth:700,minHeight:600,show:false,backgroundColor:'#07100d',title:'Codex Watch Relay',icon:path.join(__dirname,'ui/icon.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 const created=window;
 window.setMenuBarVisibility(false);window.once('ready-to-show',()=>{if(visible&&!smoke&&!created.isDestroyed())created.show();});
 if(visible&&!smoke)setTimeout(()=>{if(!created.isDestroyed()&&!created.isVisible())created.show();},4000).unref();
 window.webContents.on('render-process-gone',(_event,details)=>{void recoverWindow('renderer:'+details.reason);});
 window.webContents.on('did-fail-load',(_event,code)=>{if(code!==-3)void recoverWindow('load:'+code);});
 window.on('unresponsive',()=>{if(!quitting)window.webContents.forcefullyCrashRenderer();});
 window.webContents.on('did-finish-load',()=>{setTimeout(()=>{renderRecoveries=0;},30000).unref();});
 void window.loadFile(path.join(__dirname,'ui/index.html')).catch(()=>recoverWindow('load-rejected'));
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
 window.on('closed',()=>{if(window===created)window=null;});
}
app.on('window-all-closed',()=>{}); // The tray and relay remain active without a window.
if(!app.requestSingleInstanceLock())app.quit();else{
  app.on('second-instance',(_event,argv)=>{if(!argv.includes('--background')){show();if(!wanted&&!external)start().catch(()=>{});}});
  app.whenReady().then(async()=>{
    await fs.mkdir(data,{recursive:true});if(smoke||!process.argv.includes('--background'))show(!process.argv.includes('--background'));
    if(!smoke&&!external){
      // Preserve the Windows login preference when the executable is renamed.
      if(app.isPackaged&&process.platform==='win32'&&!option('--data-dir')){
        const oldExe=path.join(process.env.LOCALAPPDATA||'','Programs','Codex Watch Relay','Pipex Relay.exe');
        const oldStartup=app.getLoginItemSettings({path:oldExe,args:['--background']});
        if(oldStartup.openAtLogin&&oldStartup.executableWillLaunchAtLogin)app.setLoginItemSettings({openAtLogin:true,args:startupArgs});
      }
      const legacy=await read('runtime.json');const vault=await read('secrets.json');
      if(!vault.managed&&legacy.assistantEnv){try{const text=await fs.readFile(legacy.assistantEnv,'utf8');const match=/^\s*OPENAI_API_KEY\s*=\s*["']?(sk-[A-Za-z0-9_-]+)/m.exec(text);if(match)await routes.key(match[1]);}catch{notice='Clé API à enregistrer dans Voix et budget.';}}
      if(process.argv.includes('--enable-autostart'))app.setLoginItemSettings({openAtLogin:true,args:startupArgs});
    }
    if(!smoke&&!external&&(await read('config.json')).projects?.length)start().catch(()=>{notice='Ouvre les réglages pour reconnecter le relais.';});
    try{
      const icon=nativeImage.createFromPath(path.join(__dirname,'ui/icon.png'));
      tray=new Tray(icon);tray.setToolTip('Codex Watch Relay · cliquer pour ouvrir');tray.setContextMenu(Menu.buildFromTemplate([{label:'Ouvrir le relais',click:()=>show()},{label:'Quitter et arrêter le relais',click:()=>app.quit()}]));tray.on('click',()=>show());
    }catch{notice='Icône de notification indisponible. Garde cette fenêtre ouverte.';show();void fs.appendFile(path.join(data,'relay-process.log'),`${new Date().toISOString()} tray-unavailable\n`).catch(()=>{});}
    if(!external)setInterval(createWatchdog({allowed:()=>wanted&&!quitting&&!recovering&&!launching,child:()=>child,healthy:health,start,terminate:async stalled=>{if(child===stalled)stalled.kill();},onFailure:()=>{notice='Le relais ne répond plus. Reconnexion automatique…';}}),5000).unref();
    if(startupTest){
      const deadline=Date.now()+30000;while(Date.now()<deadline&&(!window?.isVisible()||!await health()))await new Promise(r=>setTimeout(r,250));
      const result={visible:!!window?.isVisible(),backendHealthy:!!(await health()),running:!!child,notice};
      if(window&&!window.isDestroyed()){await window.webContents.executeJavaScript('refresh()').catch(()=>{});result.heading=await window.webContents.executeJavaScript('document.querySelector("h2")?.textContent').catch(()=>null);await fs.writeFile(path.join(data,'startup.png'),(await window.webContents.capturePage()).toPNG()).catch(()=>{});}
      await fs.writeFile(path.join(data,'startup.json'),JSON.stringify(result));app.quit();
    }
    if(smoke){window.webContents.once('did-finish-load',async()=>{await new Promise(r=>setTimeout(r,1500));const result=await window.webContents.executeJavaScript('({title:document.title,buttons:[...document.querySelectorAll("button")].map(b=>b.textContent),overflow:document.documentElement.scrollWidth>innerWidth})');await fs.writeFile(path.join(data,'ui-smoke.json'),JSON.stringify(result));await fs.writeFile(path.join(data,'relay-ui.png'),(await window.webContents.capturePage()).toPNG());if(process.argv.includes('--integration-test')){try{const found=await discover();if(!found.projects.length)throw Error('No projects detected');await write('config.json',{port:8789,discovery:false});await routes.save({backend:'desktop',projects:found.projects.filter(p=>p.available!==false).slice(0,1),publicUrl:'https://relay.example'});if(process.argv.includes('--missing-project-test')){const c=await read('config.json');c.projects.push({id:'missing-config',name:'Projet indisponible',path:path.join(data,'missing-config')});await write('config.json',c);}await start();const filteredInitial=!(await state()).config.projects.some(p=>p.id==='missing-config');if(process.argv.includes('--renderer-recovery-test'))await testRendererRecovery();if(process.argv.includes('--tray-reopen-test'))await testTrayReopen();if(process.argv.includes('--ux-test')){const ux=await window.webContents.executeJavaScript(`(async()=>{await refresh();document.getElementById('url').value=state.config.publicUrl;await action(discover);const n=projects.length;document.getElementById('all-projects').click();const all=projects.filter(p=>p.available!==false).every(p=>p.selected)&&projects.filter(p=>p.available===false).every(p=>!p.selected);const missing=projects.filter(p=>p.available===false).length;const missingVisible=document.getElementById('projects').textContent.includes('Projet indisponible');await document.getElementById('save').onclick();const applied=document.getElementById('saved').textContent.includes('appliqu');document.getElementById('all-projects').click();const none=projects.every(p=>!p.selected);document.getElementById('error').textContent='Test';document.getElementById('error').hidden=false;await refresh();return {count:n,missing,missingVisible,all,none,applied,errorPreserved:!document.getElementById('error').hidden};})()`);await fs.writeFile(path.join(data,'ux.json'),JSON.stringify(ux));}let recovered=null;if(process.argv.includes('--recovery-test')){const previous=child.pid;child.kill();for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,200));if(child&&child.pid!==previous&&(await health())?.codex){recovered=true;break;}}if(!recovered)throw Error('Automatic recovery failed');}const pair=await routes.pair();const response=await fetch('http://127.0.0.1:8789/v1/pair',{method:'POST',body:JSON.stringify({code:pair.code})});const receipt=await response.json();const replay=await fetch('http://127.0.0.1:8789/v1/pair',{method:'POST',body:JSON.stringify({code:pair.code})});if(process.argv.includes('--pair-ui-test')){const ui=await window.webContents.executeJavaScript(`(async()=>{page('pair');await pair();return {code:document.getElementById('code').textContent,id:pairId};})()`);const response=await fetch('http://127.0.0.1:8789/v1/pair',{method:'POST',body:JSON.stringify({code:ui.code})});const acquired=await response.json();await window.webContents.executeJavaScript('checkPair()');const accepted=await window.webContents.executeJavaScript(`document.getElementById('pair-label').textContent==='CODE ACCEPTÉ'`);const confirm=await fetch('http://127.0.0.1:8789/v1/pair/confirm',{method:'POST',headers:{Authorization:'Bearer '+acquired.token},body:JSON.stringify(acquired.receipt)});await window.webContents.executeJavaScript('checkPair()');const confirmed=await window.webContents.executeJavaScript(`document.getElementById('pair-label').textContent==='ASSOCIATION RÉUSSIE'`);await fs.writeFile(path.join(data,'pair-ui.json'),JSON.stringify({acquired:response.status===200,accepted,confirm:confirm.status,confirmed}));}await routes.key('sk-local-test');const vault=await read('secrets.json');if(process.argv.includes('--key-ui-test')){await routes.changeKey('sk-local-test2');await window.webContents.executeJavaScript(`(async()=>{await refresh();page('audio');await document.getElementById('showkey').onclick();})()`);const shown=await window.webContents.executeJavaScript(`document.getElementById('current-key').value==='sk-local-test2'&&document.getElementById('current-key').type==='text'`);await window.webContents.executeJavaScript(`document.getElementById('showkey').onclick()`);const hidden=await window.webContents.executeJavaScript(`document.getElementById('current-key').value===''&&document.getElementById('current-key').type==='password'`);await window.webContents.executeJavaScript(`document.getElementById('savekey').onclick()`);const emptyRejected=(await routes.revealKey()).key==='sk-local-test2';await fs.writeFile(path.join(data,'key-ui.json'),JSON.stringify({shown,hidden,emptyRejected,healthy:!!await health()}));}await routes.key('');await fs.writeFile(path.join(data,'integration.json'),JSON.stringify({detected:found.projects.length,filteredInitial,recovered,health:(await health())?.codex,pairStatus:response.status,tokenReceived:typeof receipt.token==='string',replay:replay.status,keyEncrypted:!!vault.key&&!vault.key.includes('sk-local-test')}));await stop();}catch(e){await fs.writeFile(path.join(data,'integration.json'),JSON.stringify({error:e.message}));}}quitting=true;app.quit();});}
  });
}
app.on('before-quit',event=>{quitting=true;if(child){event.preventDefault();stop().then(()=>app.quit()).catch(()=>{quitting=false;show();notice='Termine le Live avant de quitter le relais.';});}});

}
