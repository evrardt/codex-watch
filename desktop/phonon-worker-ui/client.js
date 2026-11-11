import { PhononTTS } from './pkg/index.js';

let engine=null, currentLanguage='', currentDevice='', loadedVoices=new Set();
const asset=name=>new URL(name,document.baseURI).href;
window.generatePhonon = async ({text,voice,language,device}) => {
  if (!/^[A-Za-z0-9_-]{16}$/.test(voice) || !['fr','en','de','es','pt'].includes(language) || !['cpu','webgpu','auto'].includes(device)) throw Error('Invalid synthesis configuration');
  let adapter=null;
  if(device!=='cpu') {
    adapter=await navigator.gpu?.requestAdapter();
    const software=Boolean(adapter?.info?.isFallbackAdapter ?? adapter?.isFallbackAdapter);
    if(device==='webgpu'&&(!adapter||software))throw Error('No hardware WebGPU adapter');
  }
  if (!engine || currentLanguage!==language || currentDevice!==device) {
    engine?.dispose(); engine=null; loadedVoices=new Set();
    engine=await PhononTTS.load({lang:language,device,quant:'q8',threads:3,cache:false,model:{
      weights:{q8:asset('model/model.q8.gguf')},tokenizer:asset('model/tokenizer.json'),config:asset('model/config.json'),
      voices:{[voice]:asset(`voice/${voice}.safetensors`)},defaultVoice:voice
    }});
    currentLanguage=language;currentDevice=device;loadedVoices.add(voice);
  }
  if (!loadedVoices.has(voice)) { await engine.addVoice(voice,asset(`voice/${voice}.safetensors`));loadedVoices.add(voice); }
  const wav=await engine.synthWav(text,{voice});
  if(wav.size<44 || wav.size>10*1024*1024)throw Error('Invalid audio size');
  const bytes=new Uint8Array(await wav.arrayBuffer());let binary='';
  for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  const vendor=engine.device==='webgpu' ? (adapter?.info?.vendor || '') : '';
  return {audio:btoa(binary),device:engine.device,reason:engine.deviceReason,threads:engine.threads,vendor};
};
