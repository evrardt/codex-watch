import test from 'node:test';import assert from 'node:assert/strict';
import {DesktopQuestionReader} from '../desktop-question.mjs';
test('desktop question reader bounds untrusted UI text and never runs on other platforms',async()=>{
 let calls=0;const reader=new DesktopQuestionReader({platform:'win32',runner:async()=>{calls++;return {available:true,identity:'1:2:3',title:'Chat',question:'Choisir ?',position:'1 of 2',options:['Oui','Non']};}});
 assert.deepEqual(await reader.read(),{identity:'1:2:3',title:'Chat',question:'Choisir ?',position:'1 of 2',options:['Oui','Non']});
 reader.runner=async()=>({available:true,identity:'1',title:'Chat',question:'Choisir ?',options:['a'.repeat(500)]});assert.equal((await reader.read()).options[0].length,500);
 reader.runner=async()=>({available:true,identity:'1',title:'Chat',question:'Choisir ?',options:['a'.repeat(1501)]});assert.equal(await reader.read(),null);
 reader.runner=async()=>({available:true,identity:'1',title:'Chat',question:'x'.repeat(4001),options:[]});assert.equal(await reader.read(),null);
 const other=new DesktopQuestionReader({platform:'linux',runner:async()=>{calls++;}});assert.equal(await other.read(),null);assert.equal(calls,1);
});
test('desktop answers require confirmation and do not retry uncertain sends',async()=>{
 const calls=[];const reader=new DesktopQuestionReader({platform:'win32',runner:async(a,p)=>{calls.push({a,p});return {submitted:false,uncertain:true};}});
 const q={identity:'1',title:'Chat',question:'Choix ?',position:'',options:['Oui']};
 await assert.rejects(reader.answer(q,'Oui'),/non confirmé/);assert.equal(calls.length,1);
 reader.runner=async()=>({submitted:false,uncertain:true,formClosedAfterInput:true});
 await assert.rejects(reader.answer(q,'Oui'),e=>e.code==='DESKTOP_FORM_CLOSED_AFTER_INPUT');
 await assert.rejects(reader.answer(q,'   '),/invalide/);assert.equal(calls.length,1);
});
