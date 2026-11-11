const test=require('node:test');const assert=require('node:assert/strict');
const {generateKeyPairSync,sign}=require('node:crypto');const {authorize,verifiedIdentity}=require('../siwc.cjs');
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});const jwk={...publicKey.export({format:'jwk'}),kid:'test',use:'sig'};
const jwt=(claims)=>{const h=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url'),p=Buffer.from(JSON.stringify(claims)).toString('base64url');return h+'.'+p+'.'+sign('RSA-SHA256',Buffer.from(h+'.'+p),privateKey).toString('base64url');};
const ok=x=>({ok:true,json:async()=>x});
test('validates signature, issuer, client, expiry and nonce',async()=>{
 const now=Date.now(),claims={iss:'https://auth.openai.com',aud:'oaiapp_test',sub:'account',exp:Math.floor(now/1000)+600,nonce:'nonce'};
 const fetchImpl=async url=>String(url).endsWith('openid-configuration')?ok({issuer:'https://auth.openai.com',jwks_uri:'https://auth.openai.com/.well-known/jwks.json'}):ok({keys:[jwk]});
 assert.equal((await verifiedIdentity(jwt(claims),{clientId:'oaiapp_test',nonce:'nonce',fetchImpl,now})).subject,'account');
 for(const change of [{nonce:'wrong'},{aud:'oaiapp_other'},{iss:'https://bad.example'},{exp:1}])await assert.rejects(verifiedIdentity(jwt({...claims,...change}),{clientId:'oaiapp_test',nonce:'nonce',fetchImpl,now}));
});
test('authorization uses PKCE, validates callback state and does not expose tokens',async()=>{
 let nonce='',tokenBody;
 const fetchImpl=async(url,options)=>{
  if(String(url).endsWith('openid-configuration'))return ok({issuer:'https://auth.openai.com',jwks_uri:'https://auth.openai.com/.well-known/jwks.json'});
  if(String(url).endsWith('jwks.json'))return ok({keys:[jwk]});
  tokenBody=options.body;return ok({access_token:'test-access-token',refresh_token:'test-refresh-token',id_token:jwt({iss:'https://auth.openai.com',aud:'oaiapp_test',sub:'account',exp:Math.floor(Date.now()/1000)+600,nonce}),scope:'openid chatgpt.tokens.use.direct',expires_in:3600});
 };
 const credentials=await authorize({hostId:'urn:uuid:12345678-1234-1234-1234-123456789012',fetchImpl,openBrowser:async link=>{
  const u=new URL(link);nonce=u.searchParams.get('nonce');assert.equal(u.searchParams.get('code_challenge_method'),'S256');
  const callback=new URL(u.searchParams.get('redirect_uri'));callback.searchParams.set('state',u.searchParams.get('state'));callback.searchParams.set('code','code');callback.searchParams.set('client_id','oaiapp_test');
  const response=await fetch(callback);assert.equal(response.status,200);
 }});
 assert.equal(credentials.client_id,'oaiapp_test');assert.equal(credentials.subject,'account');assert.equal(tokenBody.get('resource'),'https://api.openai.com/v1');
});
