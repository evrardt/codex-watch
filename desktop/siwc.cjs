'use strict';
const http=require('node:http');
const {randomBytes,createHash,createPublicKey,verify,timingSafeEqual}=require('node:crypto');

const issuer='https://auth.openai.com';
const resource='https://api.openai.com/v1';
const enc=b=>Buffer.from(b).toString('base64url');
function same(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y);}
async function verifiedIdentity(jwt,{clientId,nonce,fetchImpl=fetch,now=Date.now()}){
 const parts=String(jwt||'').split('.');if(parts.length!==3)throw Error('Identité ChatGPT invalide.');
 let head,claims;try{head=JSON.parse(Buffer.from(parts[0],'base64url'));claims=JSON.parse(Buffer.from(parts[1],'base64url'));}catch{throw Error('Identité ChatGPT invalide.');}
 if(head.alg!=='RS256'||!head.kid)throw Error('Signature ChatGPT non prise en charge.');
 const meta=await fetchImpl(issuer+'/.well-known/openid-configuration',{signal:AbortSignal.timeout(15000)});
 if(!meta.ok)throw Error('Vérification ChatGPT indisponible.');const config=await meta.json();
 if(config.issuer!==issuer||config.jwks_uri!==issuer+'/.well-known/jwks.json')throw Error('Configuration ChatGPT inattendue.');
 const response=await fetchImpl(config.jwks_uri,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Clés de vérification ChatGPT indisponibles.');
 const keys=(await response.json()).keys||[];const matches=keys.filter(k=>k.kid===head.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig'));
 if(matches.length!==1||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:matches[0],format:'jwk'}),Buffer.from(parts[2],'base64url')))throw Error('Signature ChatGPT invalide.');
 const aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
 if(claims.iss!==issuer||!aud.includes(clientId)||!Number.isFinite(claims.exp)||claims.exp*1000<=now||!same(claims.nonce,nonce)||typeof claims.sub!=='string'||!claims.sub)throw Error('Identité ChatGPT non vérifiée.');
 if(aud.length>1&&claims.azp!==clientId)throw Error('Destinataire ChatGPT invalide.');
 return {subject:claims.sub,email:typeof claims.email==='string'?claims.email:''};
}
async function authorize({hostId,clientId='',expectedSubject='',openBrowser,fetchImpl=fetch,timeoutMs=180000}){
 if(!/^urn:uuid:[a-f0-9-]{36}$/i.test(hostId)||typeof openBrowser!=='function')throw Error('Configuration ChatGPT invalide.');
 const state=enc(randomBytes(32)),nonce=enc(randomBytes(32)),verifier=enc(randomBytes(48));
 let resolveCallback,rejectCallback,done=false;
 const callback=new Promise((resolve,reject)=>{resolveCallback=resolve;rejectCallback=reject;});
 const server=http.createServer((req,res)=>{
  const u=new URL(req.url||'/', 'http://127.0.0.1');
  if(req.method!=='GET'||u.pathname!=='/auth/callback'||u.searchParams.getAll('state').length!==1||!same(u.searchParams.get('state'),state)){res.writeHead(400);res.end('Requete invalide.');return;}
  if(done){res.writeHead(409);res.end('Connexion deja utilisee.');return;}done=true;
  const error=u.searchParams.get('error');const code=u.searchParams.get('code');const issued=u.searchParams.get('client_id')||clientId;
  if(error||!code||!/^oaiapp_[A-Za-z0-9_-]+$/.test(issued)||(clientId&&issued!==clientId)){
   res.writeHead(400,{'Content-Type':'text/plain; charset=utf-8'});res.end('Connexion non terminee. Retourne dans Codex Watch.');rejectCallback(Error('Connexion ChatGPT refusée ou incomplète.'));return;
  }
  res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end('Connexion reçue. Tu peux retourner dans Codex Watch.');resolveCallback({code,issued});
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const redirect=`http://127.0.0.1:${server.address().port}/auth/callback`;
 const params=new URLSearchParams({client_id:clientId||'dynamic_agent_client',ext_agent_host_id:hostId,response_type:'code',redirect_uri:redirect,
  scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',resource,state,nonce,code_challenge_method:'S256',code_challenge:enc(createHash('sha256').update(verifier).digest())});
 if(!clientId)params.set('agent_name_hint','Codex Watch');
 let timer;
 try{
  timer=setTimeout(()=>rejectCallback(Error('Connexion ChatGPT expirée.')),timeoutMs);
  await openBrowser(issuer+'/api/accounts/authorize?'+params.toString());
  const {code,issued}=await callback;
  const response=await fetchImpl(issuer+'/api/accounts/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({grant_type:'authorization_code',client_id:issued,code,code_verifier:verifier,redirect_uri:redirect,resource}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Connexion ChatGPT impossible : autorisation expirée ou refusée.');
  const t=await response.json();const scopes=String(t.scope||'').split(/\s+/);
  if(!t.access_token||!t.refresh_token||!t.id_token||!scopes.includes('chatgpt.tokens.use.direct')||!Number.isFinite(Number(t.expires_in)))throw Error('Autorisation d’utilisation de l’abonnement absente.');
  const identity=await verifiedIdentity(t.id_token,{clientId:issued,nonce,fetchImpl});
  if(expectedSubject&&identity.subject!==expectedSubject)throw Error('Ce compte diffère du compte déjà connecté au serveur.');
  return {host_id:hostId,client_id:issued,subject:identity.subject,email:identity.email,access_token:t.access_token,refresh_token:t.refresh_token,id_token:t.id_token,scope:t.scope,expires_at:Date.now()+Number(t.expires_in)*1000};
 }finally{clearTimeout(timer);server.close();}
}
module.exports={authorize,verifiedIdentity};
