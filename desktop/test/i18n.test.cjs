const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function page(language,source='../ui/i18n.js',original='Paramètres'){
 const script=fs.readFileSync(path.join(__dirname,source),'utf8');
 const option={tagName:'OPTION',attrs:{},hasAttribute(key){return Object.hasOwn(this.attrs,key)},setAttribute(key,value){this.attrs[key]=value}};
 const text={parentElement:option,nodeValue:'  '+original+'  '};let index=0;
 const document={documentElement:{},body:{},createTreeWalker(){return {currentNode:null,nextNode(){if(index++)return false;this.currentNode=text;return true}}},querySelectorAll(){return []}};
 const context={document,navigator:{language},NodeFilter:{SHOW_TEXT:4},window:{},Intl};vm.runInNewContext(script,context);
 return {context,text,option};
}

test('interface follows supported system languages and preserves option values',()=>{
 for(const [locale,expected] of [['en-US','Settings'],['de-DE','Einstellungen'],['es-ES','Configuración'],['pt-PT','Configurações']]){
  const {context,text,option}=page(locale);
  assert.equal(context.document.documentElement.lang,locale.slice(0,2));
  assert.equal(text.nodeValue.trim(),expected);
  assert.equal(option.attrs.value,'Paramètres');
 }
});

test('server administration also localizes labels without changing form values',()=>{
 for(const [locale,expected] of [['en-US','Password'],['de-DE','Passwort'],['es-ES','Contraseña'],['pt-PT','Palavra-passe']]){
  const {text,option}=page(locale,'../../bridge/vps-i18n.js','Mot de passe');
  assert.equal(text.nodeValue.trim(),expected);
  assert.equal(option.attrs.value,'Mot de passe');
 }
});

test('French stays unchanged, unknown languages fall back to English, and values are formatted as text',()=>{
 assert.equal(page('fr-FR').text.nodeValue.trim(),'Paramètres');
 const {context}=page('it-IT');assert.equal(context.window.cwI18n.language,'en');
 assert.equal(context.window.cwI18n.format('expires',{seconds:42}),'Valid for 42 s');
 assert.equal(context.window.cwI18n.t('a user-written project title'),'a user-written project title');
 assert.equal(context.window.cwI18n.t('constructor'),'constructor');
 assert.equal(context.window.cwI18n.t('Enregistre d’abord une clé API.'),'Save an API key first.');
});
