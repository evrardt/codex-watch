import {createPrivateKey,randomUUID} from 'node:crypto';
import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';

// The Android configuration is public; service credentials remain on the relay.
export function parseFirebaseFiles(androidText,serviceText){
  if(typeof androidText!=='string'||typeof serviceText!=='string'||Buffer.byteLength(androidText)>65536||Buffer.byteLength(serviceText)>65536)throw Error('Fichiers Firebase invalides ou trop volumineux.');
  let android,service;try{android=JSON.parse(androidText);service=JSON.parse(serviceText);}catch{throw Error('Les deux fichiers Firebase doivent être des fichiers JSON valides.');}
  const projectId=android?.project_info?.project_id,senderId=android?.project_info?.project_number;
  const client=Array.isArray(android?.client)?android.client.find(c=>c?.client_info?.android_client_info?.package_name==='fr.thomas.codexwatch'):null;
  const appId=client?.client_info?.mobilesdk_app_id,apiKey=client?.api_key?.[0]?.current_key;
  if(typeof projectId!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)||typeof senderId!=='string'||!/^\d{3,32}$/.test(senderId)||typeof appId!=='string'||!new RegExp(`^1:${senderId}:android:[a-fA-F0-9]+$`).test(appId)||typeof apiKey!=='string'||apiKey.length<10||apiKey.length>256||!client)throw Error('Le fichier Android ne correspond pas à l’application Codex Watch.');
  if(service?.type!=='service_account'||service.project_id!==projectId||typeof service.client_email!=='string'||!new RegExp('^[a-z0-9-]+@'+projectId+'\\.iam\\.gserviceaccount\\.com$').test(service.client_email)||typeof service.private_key!=='string'||service.private_key.length>16384)throw Error('Le compte de service doit appartenir au même projet Firebase.');
  try{if(createPrivateKey(service.private_key).asymmetricKeyType!=='rsa')throw Error('Invalid');}catch{throw Error('La clé privée du compte de service est invalide.');}
  return {firebase:{enabled:true,projectId,appId,senderId,apiKey},credentials:{type:'service_account',project_id:projectId,client_email:service.client_email,private_key:service.private_key}};
}

export async function saveFirebaseFiles({data,configFile,android,service}){
  const parsed=parseFirebaseFiles(android,service),dest=path.join(data,`firebase-service-account-${randomUUID()}.json`),runtimeFile=path.join(data,'runtime.json');
  const runtime=await readFile(runtimeFile,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return {};throw e;}),config=JSON.parse(await readFile(configFile,'utf8'));
  if(config.firebase?.enabled&&config.firebase.projectId&&config.firebase.projectId!==parsed.firebase.projectId)throw Error('Ce relais utilise déjà un autre projet Firebase. Utilise le même projet sur le PC et le serveur.');
  const atomic=async(file,value)=>{const tmp=file+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,value,{mode:0o600,flag:'wx'});await rename(tmp,file);}finally{await unlink(tmp).catch(()=>{});}};
  await atomic(dest,JSON.stringify(parsed.credentials));await atomic(runtimeFile,JSON.stringify({...runtime,fcmCredentials:dest},null,2));await atomic(configFile,JSON.stringify({...config,firebase:parsed.firebase},null,2));
  const prior=runtime.fcmCredentials;
  if(typeof prior==='string'&&path.dirname(prior)===data&&/^firebase-service-account-[a-f0-9-]{36}\.json$/.test(path.basename(prior)))await unlink(prior).catch(()=>{});
  return {firebase:parsed.firebase,credentialPath:dest};
}
