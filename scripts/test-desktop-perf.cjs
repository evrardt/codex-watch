// Isolated UI regression test; the preload supplies fictional data only.
const {app,BrowserWindow}=require('electron');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
app.setPath('userData',path.join(root,'.tools','desktop-perf-test-profile'));
app.disableHardwareAcceleration();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  const window=new BrowserWindow({width:800,height:650,show:false,webPreferences:{preload:path.join(__dirname,'guide-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  const count=async()=>window.webContents.executeJavaScript("window.relay.call('testMetrics').then(r=>r.value.stateCalls)");
  await window.loadFile(path.join(root,'desktop','ui','index.html'));window.showInactive();await wait(800);
  window.hide();await wait(800);assert.equal(await window.webContents.executeJavaScript('document.hidden'),true,'La fenêtre masquée reste visible pour le moteur.');
  const hiddenBefore=await count();await wait(11000);assert.equal(await count(),hiddenBefore,'La fenêtre masquée a actualisé son état.');
  window.showInactive();await wait(800);const visible=await count();assert.ok(visible>hiddenBefore,'La réouverture ne rafraîchit pas les données.');
  const changed=await window.webContents.executeJavaScript(`(async()=>{page('audio');const el=document.getElementById('audio-auto-read');el.checked=false;await el.onchange();return !el.checked;})()`);
  assert.equal(changed,true,'Le réglage de lecture automatique n’a pas été enregistré.');
  window.hide();await wait(500);const again=await count();await wait(11000);assert.equal(await count(),again,'La fenêtre fermée continue de se rafraîchir.');
  console.log('Interface PC : actualisation au retour, pause en arrière-plan et réglage vocal vérifiés.');
  window.destroy();app.quit();
}).catch(error=>{console.error(error.message);app.exit(1);});
