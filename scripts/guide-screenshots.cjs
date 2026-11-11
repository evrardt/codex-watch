// Reproduce documentation captures from the real UI using fictional data only.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises');const path=require('node:path');
const root=path.resolve(__dirname,'..'),output=path.join(root,'docs','guide');
app.setPath('userData',path.join(root,'.tools','guide-electron-profile'));
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 await fs.mkdir(output,{recursive:true});
 const window=new BrowserWindow({width:1020,height:1050,show:false,webPreferences:{preload:path.join(__dirname,'guide-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 await window.loadFile(path.join(root,'desktop','ui','index.html'));window.showInactive();
 await new Promise(r=>setTimeout(r,500));
 const scenes=[
  ['pc-bluetooth.png',"page('bluetooth')"],
  ['pc-connexion.png',"(async()=>{await refresh();page('setup');await action(discover);})()"],
  ['pc-association.png',"(async()=>{page('pair');await pair();})()"],
  ['pc-phonon.png',"page('audio')"],
  ['pc-phonon-calcul.png',"(async()=>{page('audio');document.getElementById('phonon-device').scrollIntoView({block:'center'});})()"],
  ['pc-cle-api.png',"(async()=>{page('audio');document.getElementById('live-settings').open=true;document.getElementById('key-state').scrollIntoView({block:'center'});})()"]
 ];
 for(const [file,action] of scenes){await window.webContents.executeJavaScript(action);await new Promise(r=>setTimeout(r,400));await fs.writeFile(path.join(output,file),(await window.webContents.capturePage()).toPNG());}
 window.destroy();app.quit();
}).catch(()=>{process.exitCode=1;app.quit();});
