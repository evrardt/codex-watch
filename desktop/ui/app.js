const $=id=>document.getElementById(id);
let state={},projects=[],busy=false,catalogLoaded=false,pairExpiry=0,pairId='',pairState='',pairChecking=false,keyRevealTimer=null,keyRevealRevision=0,computeDirty=false;
async function call(name,value,quiet=false){if(!quiet)$('error').hidden=true;const r=await window.relay.call(name,value);if(!r.ok)throw Error(r.error);return r.value;}
function showError(e){$('error').textContent=e.message;$('error').hidden=false;$('error').scrollIntoView({block:'nearest'});}
function countProjects(){const n=projects.filter(p=>p.selected).length;$('all-projects').checked=projects.length>0&&n===projects.length;$('all-projects').indeterminate=n>0&&n<projects.length;$('all-projects').disabled=busy||!projects.length;$('project-count').textContent=`${n} / ${projects.length}`;}
function dirty(){$('saved').textContent='Modifications à appliquer';}
function projectList(){const root=$('projects');root.replaceChildren();for(const p of projects){const label=document.createElement('label');label.className='check';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=!!p.selected;checkbox.disabled=busy;checkbox.onchange=()=>{p.selected=checkbox.checked;countProjects();dirty();};const text=document.createElement('span');text.textContent=p.name;label.append(checkbox,text);root.append(label);}countProjects();}
function renderPhononVoices(audio,installed){const select=$('phonon-voice');if(document.activeElement===select&&!busy)return;select.replaceChildren();if(!audio?.phononVoices?.length){select.add(new Option('Relais indisponible',''));select.disabled=true;return;}const labels={fr:'Français',en:'Anglais',de:'Allemand',es:'Espagnol',pt:'Portugais'};for(const code of ['fr','en','de','es','pt']){const group=document.createElement('optgroup');group.label=labels[code];for(const voice of audio.phononVoices.filter(v=>v.language===code)){const option=new Option(voice.name+(voice.locale==='en-gb'?' · UK':voice.locale==='en-us'?' · US':voice.locale==='es-mx'?' · MX':''),voice.id);group.append(option);}select.append(group);}select.value=audio.phononVoice;select.disabled=busy||!installed;}
function render(s){
 state=s;const a=s.audio,mode=a?.mode||'';
 const mac=s.platform==='darwin';document.querySelector('nav [data-page=bluetooth]').hidden=mac;if(mac)document.querySelector('nav [data-page=setup]').textContent='Connexion Mac';
 $('audio-auto-read').checked=a?.autoReadDictation!==false;$('audio-auto-read').disabled=busy||!a;
 $('bluetooth-summary').textContent=s.bluetoothStatus||'Désactivé';$('internet-summary').textContent=s.internetStatus||'Non configuré';$('bluetooth-state').textContent=s.bluetoothStatus||'Désactivé';$('bluetooth-toggle').textContent=s.bluetoothEnabled?'Désactiver':'Activer';$('bluetooth-toggle').disabled=busy||(!s.running&&!s.bluetoothEnabled);
 $('pair-status').textContent=s.watchPaired?'Montre associée':'Aucune association confirmée';$('pair-detail').textContent=s.watchPaired?'Association confirmée sur ce relais. La montre peut être hors ligne.':'Génère un code pour associer une montre.';$('paircode').textContent=s.watchPaired?'Associer une autre montre':'Générer le code';
 $('status').textContent=s.health?'Relais actif':s.running?'Démarrage…':'Relais arrêté';$('home-title').textContent=s.health?'Relais actif.':'Relais indisponible.';
 $('codex').textContent=s.health?.codex?'Connecté':'À reconnecter';$('chatgpt').textContent=s.health?.chatgpt?'Connecté':'À reconnecter';$('notice').textContent=s.notice||'';
 for(const button of document.querySelectorAll('[data-audio-mode]')){const selected=button.dataset.audioMode===mode;button.setAttribute('aria-pressed',String(selected));button.querySelector('small').textContent=selected?'Sélectionnée':'Sélectionner';button.disabled=busy||!a||(mac&&button.dataset.audioMode==='phonon');}
 for(const id of ['watch','openai','phonon'])$('voice-'+id).hidden=mode!==id;
 $('audio-selection').textContent=!a?'Démarre le relais pour choisir une sortie.':mode==='phonon'&&!s.phononReady?'Phonon sélectionné · installation nécessaire.':mode==='openai'&&!s.keyPresent?'OpenAI sélectionné · clé API nécessaire.':'Choix enregistré et partagé avec la montre.';
 $('key-state').textContent=!s.keyPresent?'Aucune clé enregistrée.':s.health?.audioKeyReady===true?'Clé enregistrée et chargée par le relais.':s.health?.audioKeyReady===false?'Clé enregistrée, mais non chargée par le relais.':'Clé enregistrée dans le coffre Windows.';
 $('openai-state').textContent=s.keyPresent?'Clé enregistrée sur ce PC.':'Ajoute une clé API pour utiliser cette voix.';
 $('phonon-state').textContent=s.phononReady?'Modèle multilingue installé.':'Modèle multilingue non installé.';$('phonon-setup').hidden=!!s.phononReady;renderPhononVoices(a,s.phononReady);
 $('phonon-install').disabled=mac||!!s.phononReady||busy;if(mac)$('phonon-state').textContent='Phonon non disponible dans cette version Mac.';
 if(!computeDirty){$('phonon-device').value=s.phononCompute?.device||'cpu';$('phonon-keep').checked=!!s.phononCompute?.keepLoaded;$('phonon-preload').checked=!!s.phononCompute?.preload;}
 const compute=s.phononComputeStatus||{},actual=compute.actual==='webgpu'?`GPU WebGPU${compute.vendor?' · '+compute.vendor.toUpperCase():''}`:compute.actual==='cpu'?'CPU':null;
 $('phonon-compute-state').textContent=computeDirty?'Modifications non enregistrées.':actual?`Dernier calcul : ${actual} · modèle ${compute.resident?'en mémoire':'non conservé'}${compute.reason&&compute.reason.includes('repli')?' · repli CPU':''}.`:compute.reason?.includes('Préchargement')?compute.reason:'Aucun test depuis le démarrage du relais.';
 $('phonon-device').disabled=busy||!s.phononReady;$('phonon-keep').disabled=busy||!s.phononReady;$('phonon-preload').disabled=busy||!s.phononReady;$('phonon-compute-save').disabled=busy||!s.phononReady;$('phonon-compute-test').disabled=busy||!s.phononReady||!s.running;
 for(const provider of ['watch','openai','phonon']){const field=$('speed-'+provider);if(!field.dataset.editing){field.value=String(a?.speechSpeeds?.[provider]??1);updateSpeedLabel(provider);}field.disabled=busy||!a;}
 $('openai-voice').value=a?.voice||'marin';$('openai-voice').disabled=busy||!a;$('showkey').disabled=!s.keyPresent||busy;
 $('budget-state').textContent=a?`${Number(a.usedUsd||0).toFixed(2)} $ utilisés · plafond ${(a.monthlyLimitCents/100).toFixed(2)} $`:'Démarre le relais pour voir le budget.';
 if(a&&document.activeElement!==$('budget-limit'))$('budget-limit').value=(a.monthlyLimitCents/100).toFixed(2);
 $('budget-save').disabled=busy||!a;$('budget-limit').disabled=busy||!a;
 $('autostart').checked=s.autostart;$('version').textContent='Version '+s.version;$('start').hidden=!!s.running;$('stop').hidden=!s.running;$('restart').hidden=!s.running;
}
async function refresh(){render(await call('state',undefined,true));if(catalogLoaded&&!busy&&!$('setup').hidden){const checked=projects.slice(),accessible=await call('filterProjects',checked,true),checkedPaths=new Set(checked.map(p=>p.path)),accessiblePaths=new Set(accessible.map(p=>p.path));const remaining=projects.filter(p=>!checkedPaths.has(p.path)||accessiblePaths.has(p.path));if(remaining.length!==projects.length){projects=remaining;projectList();}}}
async function discover(){const result=await call('discover');if(result.error)throw Error(result.error);const prior=new Map((await call('filterProjects',projects)).map(p=>[p.path,p]));projects=result.projects.map(p=>({...p,selected:prior.get(p.path)?.selected??state.config.projects.some(old=>old.path===p.path)}));if($('backend').value==='standalone')for(const p of prior.values())if(!projects.some(x=>x.path===p.path))projects.push(p);catalogLoaded=true;projectList();$('discovery').textContent=`${projects.length} projets accessibles. Choisis ceux accessibles depuis la montre.`;}
async function action(fn){if(busy)return;busy=true;for(const b of document.querySelectorAll('button,input,select'))b.disabled=true;projectList();try{await fn();}catch(e){showError(e);}finally{busy=false;for(const b of document.querySelectorAll('button,input,select'))b.disabled=false;$('folder').disabled=$('backend').value==='desktop';projectList();render(state);}}
function hideKey(){keyRevealRevision++;clearTimeout(keyRevealTimer);$('current-key').value='';$('current-key').type='password';$('showkey').textContent='Afficher la clé';}
async function refreshWatches(){
  const status=$('watch-list-status'),root=$('watch-list');
  try{const result=await call('watchList',undefined,true);root.replaceChildren();status.textContent=result.data.length?'Accès individuels actifs :':'Aucun accès individuel actif.';
    for(const watch of result.data){const line=document.createElement('div');line.className='actions';const label=document.createElement('span');label.textContent=watch.label+' · '+new Date(watch.createdAt).toLocaleString();const button=document.createElement('button');button.textContent='Retirer';button.onclick=async()=>{if(!confirm('Retirer l’accès de cette montre ?'))return;try{button.disabled=true;await call('watchRevoke',watch.id);await refreshWatches();}catch(e){showError(e);button.disabled=false;}};line.append(label,button);root.append(line);}
  }catch{root.replaceChildren();status.textContent='Démarre le relais pour afficher les montres.';}
}
function page(id){if(id==='pair')void refreshWatches();if(id!=='audio')hideKey();for(const s of document.querySelectorAll('main section'))s.hidden=s.id!==id;for(const b of document.querySelectorAll('nav button'))b.classList.toggle('selected',b.dataset.page===id);if(id==='setup'&&!catalogLoaded&&state.configured)void action(discover);}
function bind(id,fn){$(id).onclick=()=>action(fn);}
for(const b of document.querySelectorAll('[data-page]'))b.onclick=()=>page(b.dataset.page);
bind('start',async()=>render(await call('start')));bind('stop',async()=>render(await call('stop')));bind('restart',async()=>render(await call('restart')));bind('discover',discover);
bind('folder',async()=>{const folder=await call('folder');if(folder&&!projects.some(p=>p.path===folder)){projects.push({name:folder.split(/[\\/]/).pop(),path:folder,selected:true});projectList();dirty();}});
$('all-projects').onchange=()=>{for(const p of projects)p.selected=$('all-projects').checked;projectList();dirty();};
$('backend').onchange=()=>{$('folder').disabled=$('backend').value==='desktop';dirty();};$('url').oninput=dirty;
bind('save',async()=>{render(await call('apply',{backend:$('backend').value,projects:projects.filter(p=>p.selected).map(({selected,...p})=>p),publicUrl:$('url').value.trim()}));$('saved').textContent='Réglages appliqués au relais';});
bind('getcodex',()=>call('open','codex'));bind('tailscale',()=>call('open','tailscale'));bind('tunnel',async()=>{render(await call('tunnel'));$('url').value=state.config.publicUrl;$('saved').textContent='HTTPS configuré. Applique les réglages pour actualiser la découverte Wi-Fi.';});
async function pair(){const r=await call('pair');pairId=r.id;pairState='waiting';pairExpiry=r.expiresAt;$('pair-empty').hidden=true;$('pair-result').hidden=false;$('pair-label').textContent='CODE TEMPORAIRE';$('code').textContent=r.code;$('pair-url').textContent=r.url;$('again').textContent='Renouveler';updateExpiry();}
function updateExpiry(){if(!pairExpiry||pairState!=='waiting')return;const seconds=Math.max(0,Math.ceil((pairExpiry-Date.now())/1000));$('expiry').textContent=seconds?`Valable encore ${seconds} s`:'Code expiré : renouvelle-le pour associer une montre.';if(!seconds)$('code').textContent='Expiré';}
async function checkPair(){if(!pairId||pairChecking)return;const id=pairId;pairChecking=true;try{const result=await call('pairStatus',id,true);if(pairId!==id)return;pairState=result.status;if(result.status==='confirmed'){$('pair-label').textContent='ASSOCIATION RÉUSSIE';$('code').textContent='✓';$('expiry').textContent='La montre est connectée et a enregistré le relais.';$('again').textContent='Associer une autre montre';pairId='';pairExpiry=0;}else if(result.status==='accepted'){$('pair-label').textContent='CODE ACCEPTÉ';$('code').textContent='…';$('expiry').textContent='La montre vérifie et enregistre la connexion…';}else if(result.status==='expired'){$('pair-label').textContent='CODE EXPIRÉ';$('code').textContent='Expiré';$('expiry').textContent='Renouvelle le code et réessaie.';pairId='';pairExpiry=0;}else if(result.status==='unconfirmed'||result.status==='pending'&&Date.now()>pairExpiry){$('pair-label').textContent='CONFIRMATION NON REÇUE';$('code').textContent='…';$('expiry').textContent='Vérifie la connexion sur la montre, puis renouvelle le code si nécessaire.';pairId='';pairExpiry=0;}}catch{}finally{pairChecking=false;}}
bind('paircode',pair);bind('again',pair);
bind('showkey',async()=>{if($('current-key').value){hideKey();return;}const revision=++keyRevealRevision,result=await call('revealKey');if(revision!==keyRevealRevision)return;$('current-key').value=result.key;$('current-key').type='text';$('showkey').textContent='Masquer la clé';keyRevealTimer=setTimeout(hideKey,30000);});
window.addEventListener('blur',hideKey);document.addEventListener('visibilitychange',()=>{if(document.hidden)hideKey();else if(!busy){void refresh().catch(()=>{});updateExpiry();void checkPair();}});
bind('savekey',async()=>{const value=$('key').value.trim();if(!value)throw Error('Saisis une nouvelle clé pour la remplacer. Pour la supprimer, utilise Retirer.');const next=await call('changeKey',value);hideKey();$('key').value='';render(next);});bind('removekey',async()=>{const next=await call('changeKey','');hideKey();$('key').value='';render(next);});
$('autostart').onchange=()=>action(async()=>{try{render(await call('autostart',$('autostart').checked));}catch(e){$('autostart').checked=state.autostart;throw e;}});
refresh().then(()=>{$('backend').value=state.config.backend;$('url').value=state.config.publicUrl;projects=state.config.projects.map(p=>({...p,selected:true}));projectList();$('folder').disabled=$('backend').value==='desktop';if(!state.configured)page('setup');}).catch(showError);
setInterval(()=>{if(!document.hidden&&!busy){void refresh().catch(()=>{});if(!$('pair').hidden)void refreshWatches();}},10000);setInterval(()=>{if(!document.hidden){updateExpiry();void checkPair();}},1000);

bind('phonon-model',()=>call('open','phononModel'));
bind('phonon-token-page',()=>call('open','hfToken'));
bind('phonon-install',async()=>{const token=$('phonon-token').value.trim();$('phonon-token').value='';$('phonon-progress').textContent='Téléchargement et vérification en cours…';try{render(await call('installPhonon',token));$('phonon-progress').textContent='Installation terminée. Choisis Phonon sur la montre.';}catch(e){$('phonon-progress').textContent='Installation non terminée.';throw e;}});

$('phonon-voice').onchange=()=>{const voice=$('phonon-voice').value;return action(async()=>{try{render(await call('phononVoice',voice));}catch(e){render(state);throw e;}});};

for(const button of document.querySelectorAll('[data-audio-mode]'))button.onclick=()=>action(async()=>{render(await call('audioMode',button.dataset.audioMode));});
$('audio-auto-read').onchange=()=>action(async()=>{try{render(await call('audioAutoRead',$('audio-auto-read').checked));}catch(e){render(state);throw e;}});
$('openai-voice').onchange=()=>{const voice=$('openai-voice').value;return action(async()=>render(await call('openaiVoice',voice)));};
$('budget-save').onclick=()=>action(async()=>{const value=$('budget-limit').value.trim();if(!/^\d{1,3}(?:[.,]\d{1,2})?$/.test(value))throw Error('Choisis un plafond entre 0 et 100 dollars.');const cents=Math.round(Number(value.replace(',','.'))*100);if(cents>10000)throw Error('Choisis un plafond entre 0 et 100 dollars.');render(await call('audioBudget',cents));});
$('open-live-settings').onclick=()=>{$('live-settings').open=true;$('live-settings').scrollIntoView({block:'start',behavior:'smooth'});};

$('phonon-device').onchange=$('phonon-keep').onchange=$('phonon-preload').onchange=(event)=>{if(event.target.id==='phonon-preload'&&event.target.checked)$('phonon-keep').checked=true;if(event.target.id==='phonon-keep'&&!event.target.checked)$('phonon-preload').checked=false;computeDirty=true;$('phonon-compute-state').textContent='Modifications non enregistrées.';};
bind('phonon-compute-save',async()=>{const settings={device:$('phonon-device').value,keepLoaded:$('phonon-keep').checked,preload:$('phonon-preload').checked};const next=await call('phononCompute',settings);computeDirty=false;render(next);$('phonon-compute-state').textContent='Réglages enregistrés. Lance un test pour vérifier le matériel utilisé.';});
bind('phonon-compute-test',async()=>{if(computeDirty)throw Error('Enregistre d’abord les réglages de calcul.');$('phonon-compute-state').textContent='Test en cours…';render(await call('phononComputeTest'));});

function updateSpeedLabel(provider){const field=$('speed-'+provider);const label=Number(field.value).toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2});$('speed-'+provider+'-value').textContent=label+'×';field.setAttribute('aria-valuetext',label+' fois');}
for(const provider of ['watch','openai','phonon']){
 const field=$('speed-'+provider);
 field.oninput=()=>{field.dataset.editing='true';updateSpeedLabel(provider);};
 field.onchange=()=>{const speed=Number(field.value);return action(async()=>{try{const next=await call('audioSpeed',{mode:provider,speed});delete field.dataset.editing;render(next);}finally{delete field.dataset.editing;}});};
}

bind('bluetooth-toggle',async()=>render(await call('bluetooth',!state.bluetoothEnabled)));
bind('bluetooth-windows',async()=>call('open','bluetooth-settings'));

