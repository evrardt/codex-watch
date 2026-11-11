const {createPrivateKey,randomUUID} = require('node:crypto');

// Both files are parsed in the trusted main process; the private key is never sent to the renderer.
function parseFirebaseFiles(androidText, serviceText) {
  if (typeof androidText !== 'string' || typeof serviceText !== 'string' || androidText.length > 262144 || serviceText.length > 262144)
    throw Error('Fichiers Firebase invalides ou trop volumineux.');
  let android, service;
  try { android=JSON.parse(androidText); service=JSON.parse(serviceText); }
  catch { throw Error('Les deux fichiers Firebase doivent être des fichiers JSON valides.'); }
  const projectId=android?.project_info?.project_id, senderId=android?.project_info?.project_number;
  const client=Array.isArray(android?.client) ? android.client.find(c=>c?.client_info?.android_client_info?.package_name==='fr.thomas.codexwatch') : null;
  const appId=client?.client_info?.mobilesdk_app_id, apiKey=client?.api_key?.[0]?.current_key;
  if (typeof projectId!=='string'||! /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) ||
      typeof senderId!=='string'||! /^\d{3,32}$/.test(senderId) ||
      typeof appId!=='string'||!new RegExp(`^1:${senderId}:android:[a-fA-F0-9]+$`).test(appId) ||
      typeof apiKey!=='string'||apiKey.length<10||apiKey.length>256 || !client)
    throw Error('Le fichier Android ne correspond pas à l’application Codex Watch.');
  if (service?.type!=='service_account'||service.project_id!==projectId ||
      typeof service.client_email!=='string'||!new RegExp('^[a-z0-9-]+@'+projectId+'\\.iam\\.gserviceaccount\\.com$').test(service.client_email) ||
      typeof service.private_key!=='string'||service.private_key.length>16384)
    throw Error('Le compte de service doit appartenir au même projet Firebase.');
  try { if(createPrivateKey(service.private_key).asymmetricKeyType!=='rsa') throw Error('Not RSA'); }
  catch { throw Error('La clé privée du compte de service est invalide.'); }
  return {firebase:{enabled:true,projectId,appId,senderId,apiKey}, credentials:JSON.stringify({type:'service_account',project_id:projectId,client_email:service.client_email,private_key:service.private_key})};
}
async function prepareFirebaseConfig(current,android,service,encrypt){
  const parsed=parseFirebaseFiles(android,service);
  const encrypted=await encrypt(parsed.credentials);
  if(!Buffer.isBuffer(encrypted)||!encrypted.length)throw Error('Le coffre Windows est indisponible.');
  return {...current,firebase:{...parsed.firebase,revision:randomUUID()},firebaseVault:{managed:true,key:encrypted.toString('base64')}};
}
module.exports={parseFirebaseFiles,prepareFirebaseConfig};
