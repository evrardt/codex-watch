// Install one pinned Gradium Windows runtime and its gated multilingual checkpoint.
// Tokens are held in memory for the download and are never written by this module.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const catalog = require(path.join(__dirname,'../bridge/phonon-voices.json'));
const run = promisify(execFile);
const version = '0.6.0';
const revision = '1537ce46c64f42903e0d608b132ccb073dac46d2';
const archiveHash = '96994f8150ae1cbd0c1ff492d3892c22030998272940fe70518e598a56169adc';
const files = [
  ['config.json', 4674, 'git', '5ddd955511e851a1f8c744ac23b69eb6000565d5'],
  ['tokenizer.json', 277749, 'git', 'e2d7bebf27916234f26883ad8e55c5219d0ae148'],
  ['model.q8.gguf', 74553568, 'sha256', '96fa067813244e0c6c5997b98ec2596b65ec8574b14916b48e97db056ff97e27'],
  ['default-voice.safetensors', 256136, 'sha256', 'dc537478eaadc1a5257fcda2e3501ab81e14c111a5d95a5838f350db2afd0f1a'],
];
const installed = async data => {
  try {
    await Promise.all(['ready.json','ptts.exe',...files.map(([name])=>path.join('model-multilingual',name)),path.join('voices',catalog.default+'.safetensors')].map(name=>fs.access(path.join(data,'phonon',name))));
    return true;
  } catch { return false; }
};
async function download(url, token, size, kind, expected) {
  const response = await fetch(url, { headers:token ? {Authorization:`Bearer ${token}`} : {}, signal:AbortSignal.timeout(180000) });
  if (!response.ok) throw Error(token && [401,403].includes(response.status) ? 'Accès au modèle refusé. Vérifie le jeton Hugging Face et les conditions acceptées.' : 'Téléchargement Phonon impossible. Vérifie la connexion Internet.');
  const chunks=[]; let length=0;
  for await (const chunk of response.body) { length+=chunk.length; if(length>size) throw Error('Téléchargement Phonon invalide.'); chunks.push(chunk); }
  if(length!==size) throw Error('Téléchargement Phonon incomplet.');
  const buffer=Buffer.concat(chunks);
  const hash=kind==='git' ? createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex') : createHash('sha256').update(buffer).digest('hex');
  if(hash!==expected) throw Error('Vérification du téléchargement Phonon échouée.');
  return buffer;
}
async function install(data, providedToken='') {
  if (process.platform !== 'win32') throw Error('Installation automatique disponible sur Windows uniquement.');
  if (await installed(data)) return;
  let token=typeof providedToken==='string' ? providedToken.trim() : '';
  if (!token) token=process.env.HF_TOKEN || await fs.readFile(path.join(os.homedir(),'.cache','huggingface','token'),'utf8').then(s=>s.trim()).catch(()=>'');
  if (!/^hf_[A-Za-z0-9]{15,}$/.test(token)) throw Error('Renseigne un jeton de lecture Hugging Face ou connecte-toi sur ce PC.');
  await fs.mkdir(data,{recursive:true});
  const stage=await fs.mkdtemp(path.join(data,'.phonon-install-'));
  try {
    const archive=`ptts-${version}-x86_64-pc-windows-msvc.zip`;
    const zip=await download(`https://github.com/gradium-ai/xn-ptts/releases/download/v${version}/${archive}`,'',7783042,'sha256',archiveHash);
    const archivePath=path.join(stage,archive); await fs.writeFile(archivePath,zip);
    const tar=path.join(process.env.SystemRoot || 'C:\\Windows','System32','tar.exe');
    await run(tar,['-xf',archivePath,'-C',stage],{windowsHide:true,timeout:30000});
    const dest=path.join(stage,'result'); const model=path.join(dest,'model-multilingual'); await fs.mkdir(model,{recursive:true});
    await fs.copyFile(path.join(stage,`ptts-${version}-x86_64-pc-windows-msvc`,'ptts.exe'),path.join(dest,'ptts.exe'));
    for (const [name,size,kind,hash] of files) {
      const body=await download(`https://huggingface.co/gradium/phonon-40m-multilingual/resolve/${revision}/${name}`,token,size,kind,hash);
      await fs.writeFile(path.join(model,name),body);
    }
    const defaultVoice=catalog.voices.find(v=>v.id===catalog.default);
    const voice=await download(`https://huggingface.co/gradium/phonon-voices/resolve/${catalog.revision}/voices/${defaultVoice.id}.safetensors`,'',256136,'sha256',defaultVoice.sha256);
    await fs.mkdir(path.join(dest,'voices')); await fs.writeFile(path.join(dest,'voices',defaultVoice.id+'.safetensors'),voice);
    await fs.writeFile(path.join(dest,'ready.json'),JSON.stringify({version,revision}));
    const existing=path.join(data,'phonon');
    try { await fs.access(existing); }
    catch { await fs.rename(dest,existing); return; }
    // Upgrade 0.11.6 without deleting or replacing the working French model.
    await fs.mkdir(path.join(existing,'voices'),{recursive:true});
    await fs.copyFile(path.join(dest,'voices',defaultVoice.id+'.safetensors'),path.join(existing,'voices',defaultVoice.id+'.safetensors'));
    await fs.rename(model,path.join(existing,'model-multilingual'));
    await fs.copyFile(path.join(dest,'ready.json'),path.join(existing,'ready.json'));
  } finally {
    if(path.dirname(path.resolve(stage))===path.resolve(data) && path.basename(stage).startsWith('.phonon-install-'))
      await fs.rm(stage,{recursive:true,force:true});
  }
}
module.exports={install,installed};
