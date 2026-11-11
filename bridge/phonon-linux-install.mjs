import {mkdir,mkdtemp,writeFile,rename,rm,chmod,access} from 'node:fs/promises';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {createHash} from 'node:crypto';import path from 'node:path';import {PHONON_CATALOG} from './phonon.mjs';
import {cudaEnvironment} from './phonon-cuda-env.mjs';
const run=promisify(execFile),revision='1537ce46c64f42903e0d608b132ccb073dac46d2';
const builds={x64:['x86_64',9345333,'c6d0c31288e688b43bbbedf67a6eecaee86f050407124858901dda2ecf44ef89'],arm64:['aarch64',9045074,'96e315280ae3f2aed043698a6e5ff6fc2399ec917a0bf1ab24db370c5f4f6867']};
const files=[['config.json',4674,'git','5ddd955511e851a1f8c744ac23b69eb6000565d5'],['tokenizer.json',277749,'git','e2d7bebf27916234f26883ad8e55c5219d0ae148'],['model.q8.gguf',74553568,'sha256','96fa067813244e0c6c5997b98ec2596b65ec8574b14916b48e97db056ff97e27'],['default-voice.safetensors',256136,'sha256','dc537478eaadc1a5257fcda2e3501ab81e14c111a5d95a5838f350db2afd0f1a']];
async function download(url,token,size,kind,hash,timeoutMs=180000){const r=await fetch(url,{headers:token?{Authorization:'Bearer '+token}:{},signal:AbortSignal.timeout(timeoutMs)});if(!r.ok)throw Error('Téléchargement Phonon refusé ou indisponible (HTTP '+r.status+').');let chunks=[],n=0;for await(const part of r.body){n+=part.length;if(n>size)throw Error('Téléchargement trop volumineux.');chunks.push(part);}const b=Buffer.concat(chunks);const sum=kind==='git'?createHash('sha1').update(`blob ${n}\0`).update(b).digest('hex'):createHash('sha256').update(b).digest('hex');if(n!==size||sum!==hash)throw Error('Vérification des fichiers Phonon échouée.');return b;}
export async function installPhononLinux(data,token){
 if(process.platform!=='linux'||!builds[process.arch])throw Error('Linux x86-64 ou ARM64 requis.');
 if(typeof token!=='string'||!/^hf_[A-Za-z0-9]{15,}$/.test(token.trim()))throw Error('Un jeton Hugging Face de lecture est nécessaire.');token=token.trim();
 const [arch,size,hash]=builds[process.arch],archive=`ptts-0.6.0-${arch}-unknown-linux-gnu`,stage=await mkdtemp(path.join(data,'.phonon-install-'));
 try{const zip=await download(`https://github.com/gradium-ai/xn-ptts/releases/download/v0.6.0/${archive}.tar.gz`,'',size,'sha256',hash);const file=path.join(stage,'runtime.tar.gz');await writeFile(file,zip);await run('tar',['-xzf',file,'-C',stage,`${archive}/ptts`],{timeout:30000});const result=path.join(stage,'phonon'),model=path.join(result,'model-multilingual');await mkdir(model,{recursive:true,mode:0o700});await rename(path.join(stage,archive,'ptts'),path.join(result,'ptts'));await chmod(path.join(result,'ptts'),0o700);try{await run(path.join(result,'ptts'),['--help'],{timeout:15000,maxBuffer:1024*1024});}catch{throw Error('Ce serveur ne peut pas exécuter le moteur Phonon Linux. Vérifie la version de glibc et le processeur.');}
  for(const [name,n,kind,sum] of files)await writeFile(path.join(model,name),await download(`https://huggingface.co/gradium/phonon-40m-multilingual/resolve/${revision}/${name}`,token,n,kind,sum),{mode:0o600});
  const voice=PHONON_CATALOG.voices.find(v=>v.id===PHONON_CATALOG.default);await mkdir(path.join(result,'voices'));await writeFile(path.join(result,'voices',voice.id+'.safetensors'),await download(`https://huggingface.co/gradium/phonon-voices/resolve/${PHONON_CATALOG.revision}/voices/${voice.id}.safetensors`,'',256136,'sha256',voice.sha256),{mode:0o600});await writeFile(path.join(result,'ready.json'),JSON.stringify({version:'0.6.0',revision}),{mode:0o600});await rename(result,path.join(data,'phonon'));
 }finally{await rm(stage,{recursive:true,force:true});}
}

// Optional NVIDIA build. It is kept separate from the verified CPU runtime so a
// missing driver, compiler or failed installation can never replace CPU Phonon.
export async function installPhononCudaLinux(data,token,{load=download,execute=run,platform=process.platform,arch=process.arch}={}){
 if(platform!=='linux'||arch!=='x64')throw Error('CUDA nécessite un serveur Linux x86-64 compatible NVIDIA.');
 if(typeof token!=='string'||!/^hf_[A-Za-z0-9]{15,}$/.test(token.trim()))throw Error('Un jeton Hugging Face de lecture est nécessaire.');
 const folder=path.join(data,'phonon'),model=path.join(folder,'model-multilingual');
 const env=cudaEnvironment();
 try{await access(path.join(folder,'ptts'));await access(path.join(model,'model.q8.gguf'));}catch{throw Error('Installe d’abord Phonon CPU.');}
 for(const executable of ['cargo','nvcc'])try{await execute(executable,['--version'],{env,timeout:15000,maxBuffer:1024*1024});}catch{throw Error('Installation CUDA : Rust (cargo) et le toolkit NVIDIA (nvcc) doivent être installés sur le serveur.');}
 const stage=await mkdtemp(path.join(data,'.phonon-cuda-install-'));
 try{
  let weights;try{weights=await load(`https://huggingface.co/gradium/phonon-40m-multilingual/resolve/${revision}/model.safetensors`,token.trim(),121713400,'sha256','54337d793c7e6ee231a4b24164fe23621cac06a726ddb55d57776ac0f8133210',900000);}
  catch(e){if(e.name==='TimeoutError'||e.name==='AbortError')throw Error('Le téléchargement du modèle CUDA a expiré. Vérifie la connexion du serveur et réessaie.');if(e instanceof TypeError)throw Error('Connexion à Hugging Face impossible. Vérifie Internet et le DNS du serveur.');throw e;}
  await writeFile(path.join(stage,'model.safetensors'),weights,{mode:0o600});
  try{await execute('cargo',['install','ptts','--version','0.6.0','--locked','--features','cli,cuda','--root',stage],{env,timeout:30*60*1000,maxBuffer:8*1024*1024});}
  catch{throw Error('Compilation CUDA impossible. Vérifie le pilote, le toolkit CUDA et l’espace disque du serveur.');}
  const executable=path.join(stage,'bin','ptts');await chmod(executable,0o700);
  try{await execute(executable,['--help'],{env,timeout:15000,maxBuffer:1024*1024});}catch{throw Error('Le moteur CUDA compilé ne peut pas démarrer : vérifie les bibliothèques NVIDIA du serveur.');}
  await rename(path.join(stage,'model.safetensors'),path.join(model,'model.safetensors'));
  await rename(executable,path.join(folder,'ptts-cuda'));
 }finally{await rm(stage,{recursive:true,force:true});}
}
