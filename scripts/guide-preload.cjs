// Isolated, fictional data for documentation screenshots. No real relay is contacted.
const {contextBridge}=require('electron');
const projects=[{id:'site',name:'Site vitrine',path:'C:/Exemple/Site'},{id:'app',name:'Application mobile',path:'C:/Exemple/Application'}];
const state={configured:true,config:{backend:'desktop',projects,publicUrl:'https://relay.example'},health:{codex:true,chatgpt:true,audioKeyReady:false},running:true,external:false,notice:'',watchPaired:true,keyPresent:false,phononReady:true,bluetoothEnabled:false,bluetoothStatus:'Désactivé',internetStatus:'Relais accessible par Internet',phononCompute:{device:'cpu',keepLoaded:false},phononComputeStatus:{actual:'cpu',resident:false},audio:{mode:'phonon',voice:'marin',monthlyLimitCents:500,usedUsd:0,phononVoice:'example-noemie',phononVoices:[{id:'example-noemie',name:'Noémie',language:'fr',locale:'fr-fr'},{id:'example-jules',name:'Jules',language:'fr',locale:'fr-fr'},{id:'example-zoey',name:'Zoey',language:'en',locale:'en-us'}]},autostart:true,version:'0.12.56'};
let stateCalls=0;
contextBridge.exposeInMainWorld('relay',{call:async(name,value)=>{
 let result;
 if(name==='state'){stateCalls++;result=state;}
 else if(name==='testMetrics')result={stateCalls};
 else if(name==='discover')result={projects};
 else if(name==='filterProjects')result=value;
 else if(name==='pair')result={code:'123456',id:'example-pairing',url:state.config.publicUrl,expiresAt:Date.now()+120000};
 else if(name==='pairStatus')result={status:'waiting'};
 else if(name==='watchList')result={data:[{id:'00000000-0000-0000-0000-000000000001',label:'Montre Wear OS',createdAt:Date.UTC(2026,0,1)}]};
 else if(name==='watchRevoke')result={ok:true};
 else if(name==='audioMode'){state.audio.mode=value;result=state;}
 else if(name==='audioAutoRead'){state.audio.autoReadDictation=value;result=state;}
 else if(name==='openaiVoice'){state.audio.voice=value;result=state;}
 else if(name==='phononVoice'){state.audio.phononVoice=value;result=state;}
 else if(name==='bluetooth'){state.bluetoothEnabled=value;state.bluetoothStatus=value?'Prêt pour une montre à proximité':'Désactivé';result=state;}
 else if(name==='audioSpeed'){state.audio.speechSpeeds={...state.audio.speechSpeeds,[value.mode]:value.speed};result=state;}
 else if(name==='audioBudget'){state.audio.monthlyLimitCents=value;result=state;}
 else if(name==='phononCompute'){state.phononCompute=value;result=state;}
 else if(name==='phononComputeTest'){result=state;}
 else throw Error('Cette action ne fait pas partie des captures de démonstration.');
 return {ok:true,value:result};
}});

