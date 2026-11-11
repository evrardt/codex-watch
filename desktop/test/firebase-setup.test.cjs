const test=require('node:test');const assert=require('node:assert/strict');
const {generateKeyPairSync}=require('node:crypto');
const {parseFirebaseFiles,prepareFirebaseConfig}=require('../firebase-setup.cjs');
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const project='sample-project';
const android={project_info:{project_id:project,project_number:'1234567890'},client:[{client_info:{mobilesdk_app_id:'1:1234567890:android:aabbccdd',android_client_info:{package_name:'fr.thomas.codexwatch'}},api_key:[{current_key:'public-firebase-api-key'}]}]};
const service={type:'service_account',project_id:project,client_email:'watch@sample-project.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})};
const input=(a=android,s=service)=>[JSON.stringify(a),JSON.stringify(s)];
test('Firebase import matches the Android application and encrypts the private key before saving',async()=>{
  const result=await prepareFirebaseConfig({publicUrl:'https://example.test'},...input(),async clear=>{assert.match(clear,/PRIVATE KEY/);return Buffer.from('encrypted-by-system');});
  assert.equal(result.publicUrl,'https://example.test');assert.equal(result.firebase.projectId,project);assert.equal(result.firebase.enabled,true);
  assert.equal(result.firebaseVault.managed,true);assert.equal(Buffer.from(result.firebaseVault.key,'base64').toString(),'encrypted-by-system');
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE KEY/);assert.doesNotMatch(JSON.stringify(result),/watch@sample-project/);
  const replacement=await prepareFirebaseConfig(result,...input(),async()=>Buffer.from('encrypted-again'));
  assert.match(result.firebase.revision,/^[0-9a-f-]{36}$/);assert.notEqual(result.firebase.revision,replacement.firebase.revision);
});
test('Firebase import rejects mismatched accounts, packages, keys and sender IDs',()=>{
  assert.throws(()=>parseFirebaseFiles(...input(android,{...service,project_id:'different-project'})),/même projet/);
  assert.throws(()=>parseFirebaseFiles(...input({...android,client:[]})),/application/);
  assert.throws(()=>parseFirebaseFiles(...input(android,{...service,private_key:'not a key'})),/clé privée/);
  assert.throws(()=>parseFirebaseFiles(...input({...android,project_info:{...android.project_info,project_number:'999'}})),/application/);
  assert.throws(()=>parseFirebaseFiles('not json','{}'),/JSON valides/);
});
test('Firebase import refuses to save when encryption fails',async()=>{
  await assert.rejects(prepareFirebaseConfig({},...input(),async()=>Buffer.alloc(0)),/coffre Windows/);
});
