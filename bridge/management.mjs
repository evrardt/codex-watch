import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {codexCommand,CodexRpc} from './rpc.mjs';
import {readFile,readdir,writeFile}from'node:fs/promises';
import os from'node:os';import path from'node:path';

export function nativeModels(catalog=[]) {
  const description=catalog.find(t=>t.name==='send_message_to_thread')?.inputSchema?.properties?.model?.description||'';
  return [...description.matchAll(/([a-z0-9][a-z0-9.-]+) \(([^;]+); supported reasoning efforts: ([a-z, ]+)\)/g)].map(m=>({id:m[1],name:m[1].replace(/^gpt-/,'GPT-').replace(/-(sol|terra|luna|astra)$/,' $1'),description:m[2],efforts:m[3].split(',').map(s=>s.trim())}));
}
export function validateInference(body,models) {
  if(!body.model&&!body.thinking)return {};
  const selected=models.find(m=>m.id===body.model);
  if(!selected||body.thinking&&!selected.efforts.includes(body.thinking))throw Object.assign(Error('Modèle ou réflexion non disponible sur ce PC.'),{status:400});
  return {model:selected.id,...(body.thinking?{thinking:body.thinking}:{})};
}
const execute=promisify(execFile);
export class PluginManager {
  cache=null;
  constructor({cacheFile=null,home=()=>process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),run=async(args)=>{
    const[command,prefix]=codexCommand();
    const{stdout}=await execute(command,[...prefix.slice(0,-1),'plugin',...args],{windowsHide:true,timeout:args[0]==='list'?5000:25000,maxBuffer:32*1024*1024,encoding:'utf8'});
    return JSON.parse(stdout);
  },configure=async(id,enabled)=>{
    const rpc=new CodexRpc();
    try{await rpc.start();await rpc.call('config/value/write',{keyPath:`plugins.${JSON.stringify(id)}.enabled`,value:enabled,mergeStrategy:'replace'});}finally{rpc.stop();}
  }}={}){this.run=run;this.configure=configure;this.cacheFile=cacheFile;this.home=home;}
  async cachedInventory(){
    const root=path.join(this.home(),'plugins/cache'),rows=[];
    for(const market of await readdir(root,{withFileTypes:true}).catch(()=>[]))if(market.isDirectory()){
      for(const plugin of await readdir(path.join(root,market.name),{withFileTypes:true}).catch(()=>[]))if(plugin.isDirectory()){
        const versions=(await readdir(path.join(root,market.name,plugin.name)).catch(()=>[])).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
        for(const version of versions){let manifest;try{manifest=JSON.parse(await readFile(path.join(root,market.name,plugin.name,version,'.codex-plugin/plugin.json'),'utf8'));}catch{continue;}
          rows.push({id:plugin.name+'@'+market.name,name:manifest.interface?.displayName||manifest.name||plugin.name,marketplace:market.name,version,kind:manifest.skills?'workflow':manifest.apps?'app':'plugin',installed:false,enabled:null,cached:true,verified:false});break;
        }
      }
    }
    return rows;
  }
  async list(available=false) {
    if(this.cache&&Date.now()-this.cache.at<30000&&(!available||this.cache.available))return this.cache.value;
    if(this.loading)return this.loading;
    this.loading=this.load(available).finally(()=>{this.loading=null;});return this.loading;
  }
  async load(available){
    const clean=p=>({id:p.pluginId,name:p.name,marketplace:p.marketplaceName,version:p.version,installed:!!p.installed,enabled:!!p.enabled,installPolicy:p.installPolicy,authPolicy:p.authPolicy});
    let result,notice='',cached=[];
    try{result=await this.run(['list',...(available?['--available']:[]),'--json']);}
    catch{
      const inventory=await this.cachedInventory();
      const markets=[...new Set(inventory.map(p=>p.marketplace))];
      const partial=await Promise.allSettled(markets.map(m=>this.run(['list','--marketplace',m,...(available?['--available']:[]),'--json'])));
      result={installed:partial.flatMap(r=>r.status==='fulfilled'?r.value.installed||[]:[]),available:partial.flatMap(r=>r.status==='fulfilled'?r.value.available||[]:[])};
      const known=new Set(result.installed.map(p=>p.pluginId));
      cached=inventory.filter(p=>!known.has(p.id));
      if(this.cacheFile){try{const saved=JSON.parse(await readFile(this.cacheFile,'utf8'));for(const row of saved.installed||[])if(!known.has(row.id)&&!cached.some(p=>p.id===row.id))cached.push({...row,verified:false,cached:true});}catch{}}
      notice='Le catalogue distant répond lentement. Les plugins locaux restent disponibles ; les entrées en cache sont à vérifier.';
      if(!result.installed.length&&!cached.length)throw Object.assign(Error('Catalogue de plugins temporairement indisponible.'),{status:503,code:'PLUGINS_UNAVAILABLE'});
    }
    const value={installed:(result.installed||[]).map(clean),available:(result.available||[]).map(clean),cached,notice,scope:'codex-on-this-host'};
    if(this.cacheFile&&!notice)await writeFile(this.cacheFile,JSON.stringify(value),{mode:0o600}).catch(()=>{});
    this.cache={at:Date.now(),value,available};return value;
  }
  async decorate(text,ids=[]){
    if(!ids?.length)return text;
    if(!Array.isArray(ids)||ids.length>5||ids.some(id=>typeof id!=='string'))throw Object.assign(Error('Sélection de plugins invalide.'),{status:400});
    const list=await this.list(),rows=[...list.installed,...(list.cached||[])];
    const selected=[...new Set(ids)].map(id=>{const p=rows.find(p=>p.id===id);if(!p||!/^[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,200}$/.test(id))throw Object.assign(Error('Plugin non disponible sur ce relais.'),{status:400});return p;});
    const mentions=selected.map(p=>`[@${String(p.name||'Plugin').replace(/[\[\]\\\r\n]/g,' ').slice(0,120)}](plugin://${p.id})`).join(' ');
    return `${mentions}\n\n${text}\n\nPlugins demandés pour ce message : ${selected.map(p=>JSON.stringify(p.name)).join(', ')}. Applique leurs consignes et leur processus lorsqu’ils sont disponibles ; signale toute indisponibilité sans installer de plugin.`;
  }
  async change(id,action) {
    if(typeof id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,200}$/.test(id)||!['add','remove','enable','disable'].includes(action))throw Object.assign(Error('Action plugin invalide.'),{status:400});
    const list=await this.list(action==='add');
    const entry=[...list.installed,...list.available].find(p=>p.id===id);
    if(!entry)throw Object.assign(Error('Plugin absent du catalogue autorisé ou distant indisponible.'),{status:404});
    if(['enable','disable'].includes(action))await this.configure(id,action==='enable');
    else await this.run([action,id,'--json']);
    this.cache=null;return {ok:true,...await this.list()};
  }
}
