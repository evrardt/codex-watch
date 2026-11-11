const fs=require('node:fs/promises');const path=require('node:path');
const {execFile}=require('node:child_process');const {promisify}=require('node:util');
// Extra-resource matching intentionally skips node_modules; copy the relay's
// production dependency tree explicitly into its runtime directory.
module.exports=async context=>{
 const source=path.resolve(__dirname,'../bridge/node_modules');
 const resources=path.join(context.appOutDir,'resources');
 const target=path.join(resources,'bridge/node_modules');
 await fs.cp(source,target,{recursive:true,filter:file=>!file.split(path.sep).includes('.bin')});
 if(process.platform==='win32'){
  const compiler=path.join(process.env.WINDIR,'Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  const destination=path.join(context.appOutDir,'resources','CodexWatchBluetooth.exe');
  await promisify(execFile)(compiler,['/nologo','/target:exe','/out:'+destination,path.join(__dirname,'bluetooth','CodexWatchBluetooth.cs')],{windowsHide:true});
 }
};
