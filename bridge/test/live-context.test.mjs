import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedText,liveSeedMessages,liveArchiveMessages,delegatedLivePrompt} from '../live-context.mjs';

test('resuming a chat preserves a follow-up question beyond the old 900 character cut',()=>{
  const question='Tu préfères le premier choix, le deuxième, ou les deux ?';
  const input=liveSeedMessages({messages:[{role:'user',text:'Compare ces possibilités.'},{role:'assistant',text:'Une longue analyse. '.repeat(90)+question}]});
  assert.equal(input[1].role,'assistant');assert.equal(input[1].content[0].type,'output_text');
  assert.ok(input[1].content[0].text.endsWith(question));
  assert.equal(input[0].role,'user');
});

test('native delegation inherits the preceding spoken dialogue with bounded context',()=>{
 const text=delegatedLivePrompt('Les deux.',[{role:'user',text:'Compare ces options.'},{role:'assistant',text:'Explication. '.repeat(1000)+'Tu préfères le premier plan ou les deux ?'}]);
 assert.ok(text.startsWith('Les deux.'));assert.ok(text.includes('Utilisateur : Compare'));assert.ok(text.includes('les deux ?'));assert.ok(text.length<3900);
 assert.equal(delegatedLivePrompt('Consigne.',[]),'Consigne.');
});

test('imported native history is a labelled archive rather than active assistant speech',()=>{
 const input=liveArchiveMessages({messages:[{role:'user',text:'Calcule 27 fois 39.'},{role:'assistant',text:'1053. Tu veux les deux solutions ?'}]});
 assert.equal(input.length,1);assert.equal(input[0].role,'user');const text=input[0].content[0].text;assert.ok(text.includes('pas de nouvelles demandes'));assert.ok(text.endsWith('1053. Tu veux les deux solutions ?"}]'));
 assert.deepEqual(liveArchiveMessages({messages:[]}),[]);
});
test('bounded history keeps the tail question even in oversized answers and excludes tool output',()=>{
  const input=liveSeedMessages({messages:[{role:'tool',text:'PRIVATE TOOL'},{role:'assistant',text:'Analyse. '.repeat(3000)+'Quel choix veux-tu ?'}]});
  assert.equal(input.length,1);assert.ok(input[0].content[0].text.endsWith('Quel choix veux-tu ?'));
  assert.ok(input.reduce((n,m)=>n+m.content[0].text.length,0)<=6500);
  assert.ok(boundedText('Début '.repeat(500)+'La question finale ?',1350).endsWith('La question finale ?'));
});
