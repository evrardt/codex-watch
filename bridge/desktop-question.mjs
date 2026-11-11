import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {StringDecoder} from 'node:string_decoder';

const script=fileURLToPath(new URL('./desktop-question.ps1',import.meta.url));
function run(action,payload){
  return new Promise((resolve,reject)=>{
    const systemRoot=process.env.SystemRoot||'C:\\Windows';
    const exe=path.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
    // Do not inherit PowerShell 7 module paths into Windows PowerShell 5.1.
    const env={...process.env,PSModulePath:path.join(systemRoot,'System32','WindowsPowerShell','v1.0','Modules')};
    const child=spawn(exe,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Action',action],{env,windowsHide:true,stdio:['pipe','pipe','ignore']});
    let output='',settled=false;const decoder=new StringDecoder('utf8');const timer=setTimeout(()=>{child.kill();finish(Error('desktop question timeout'));},30000);timer.unref();
    function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);}
    child.on('error',()=>finish(Error('desktop question unavailable')));
    child.stdout.on('data',data=>{output+=decoder.write(data);if(output.length>32768){child.kill();finish(Error('desktop question too large'));}});
    child.on('close',()=>{try{output+=decoder.end();finish(null,JSON.parse(output.trim()));}catch{finish(Error('desktop question unavailable'));}});
    child.stdin.on('error',()=>{});child.stdin.end(payload?JSON.stringify(payload):'');
  });
}
export class DesktopQuestionReader {
  constructor({runner=run,platform=process.platform}={}){this.runner=runner;this.platform=platform;}
  async read(){
    if(this.platform!=='win32')return null;
    const q=await this.runner('read');
    if(!q?.available||typeof q.identity!=='string'||!q.identity||q.identity.length>200||typeof q.title!=='string'||!q.title||q.title.length>500||typeof q.question!=='string'||!q.question.trim()||q.question.length>4000||!Array.isArray(q.options)||q.options.length>12||q.options.some(x=>typeof x!=='string'||!x||x.length>1500))return null;
    const position=typeof q.position==='string'&&q.position.length<=30?q.position:'';
    return {identity:q.identity,title:q.title,question:q.question,position,options:q.options};
  }
  async answer(question,answer){
    if(this.platform!=='win32'||typeof answer!=='string'||!answer.trim()||answer.length>4000)throw Error('Réponse invalide.');
    let result;try{result=await this.runner('answer',{...question,answer});}
    catch{throw Error('Envoi non confirmé. Vérifie sur le PC avant de recommencer.');}
    if(result?.submitted===true)return;
    if(result?.formClosedAfterInput===true)throw Object.assign(Error('Envoi non confirmé. Vérifie sur le PC avant de recommencer.'),{code:'DESKTOP_FORM_CLOSED_AFTER_INPUT'});
    throw Error(result?.uncertain?'Envoi non confirmé. Vérifie sur le PC avant de recommencer.':'Cette demande n’est plus disponible sur le PC. Vérifie la conversation.');
  }
}
