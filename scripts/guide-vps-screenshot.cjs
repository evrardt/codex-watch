// Render the real server administration with fictional state for the guide.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises');const path=require('node:path');
const root=path.resolve(__dirname,'..');
app.setPath('userData',path.join(root,'.tools','guide-vps-electron-profile'));
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const window=new BrowserWindow({width:1020,height:1050,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
 await window.loadFile(path.join(root,'bridge','vps-admin.html'));window.showInactive();
 await window.webContents.executeJavaScript(`document.getElementById('login').hidden=true;document.getElementById('panel').hidden=false;document.getElementById('phonon-status').textContent='Phonon est installé.';document.getElementById('phonon-compute-status').textContent='CUDA installé.';document.getElementById('phonon-cuda-install').disabled=true;document.getElementById('phonon-install').disabled=true;document.getElementById('pair-status').textContent='Montre associée.';document.getElementById('phonon-compute').value='gpu';document.getElementById('phonon-compute').closest('article').scrollIntoView({block:'start'});`);
 await new Promise(r=>setTimeout(r,500));await fs.writeFile(path.join(root,'docs','guide','vps-phonon-calcul.png'),(await window.webContents.capturePage()).toPNG());window.destroy();app.quit();
}).catch(()=>{process.exitCode=1;app.quit();});
