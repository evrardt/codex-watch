// Isolated local-only Electron worker. No text or credentials leave the PC.
const {app,BrowserWindow}=require('electron');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');

const root=path.resolve(process.env.WATCH_DATA_DIR||'');
if(!process.env.WATCH_DATA_DIR)throw Error('Worker data directory required');
app.setPath('userData',path.join(root,'phonon-worker-profile'));
const secret=randomBytes(24).toString('hex');
const prefix='/'+secret+'/';
const assets=path.join(__dirname,'node_modules','phonon-tts');
const model=path.join(root,'phonon','model-multilingual');
const voices=path.join(root,'phonon','voices');
const page=`<!doctype html><html><head><meta charset="utf-8"><base href="${prefix}"></head><body><script type="module" src="client.js"></script></body></html>`;
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self' blob:"};
const server=http.createServer((req,res)=>{
  if(req.method!=='GET'||!req.url?.startsWith(prefix)){res.writeHead(404);return res.end();}
  const item=req.url.slice(prefix.length);let file;
  if(item==='index.html'){res.writeHead(200,{'Content-Type':'text/html',...headers});return res.end(page);}
  if(item==='client.js')file=path.join(__dirname,'phonon-worker-ui','client.js');
  else if(/^model\/(config\.json|tokenizer\.json|model\.q8\.gguf)$/.test(item))file=path.join(model,item.slice(6));
  else if(/^voice\/[A-Za-z0-9_-]{16}\.safetensors$/.test(item))file=path.join(voices,item.slice(6));
  else if(/^pkg\/[A-Za-z0-9_./-]+$/.test(item)&&!item.includes('..'))file=path.join(assets,item.slice(4));
  else {res.writeHead(404);return res.end();}
  const ext=path.extname(file);res.writeHead(200,{'Content-Type':ext==='.js'?'text/javascript':ext==='.wasm'?'application/wasm':'application/octet-stream',...headers});
  fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
});
let win,busy=false;
const send=message=>{if(process.connected)process.send(message);};
const shutdown=()=>{if(win&&!win.isDestroyed())win.destroy();server.close();app.quit();};
process.once('disconnect',shutdown);
process.on('message',async msg=>{
  if(msg?.type==='stop')return shutdown();
  if(msg?.type!=='synth'||busy||!win)return;
  busy=true;
  try {
    const input={text:msg.text,voice:msg.voice,language:msg.language,device:msg.device};
    if(typeof input.text!=='string'||input.text.length>600)throw Error('Invalid text');
    const result=await win.webContents.executeJavaScript(`window.generatePhonon(${JSON.stringify(input)})`);
    send({type:'result',id:msg.id,ok:true,...result});
  } catch {send({type:'result',id:msg.id,ok:false});}
  finally {busy=false;}
});
app.whenReady().then(()=>server.listen(0,'127.0.0.1',async()=>{
  const origin=`http://127.0.0.1:${server.address().port}`;
  win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  win.webContents.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith(origin+'/')}));
  try {
    await win.loadURL(origin+prefix+'index.html');
    await win.webContents.executeJavaScript(`(async()=>{for(let i=0;i<100;i++){if(typeof window.generatePhonon==='function')return;await new Promise(r=>setTimeout(r,100));}throw Error('Worker failed');})()`);
    send({type:'ready'});
  } catch {send({type:'failed'});shutdown();}
}));
