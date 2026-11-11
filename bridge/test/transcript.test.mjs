import test from 'node:test';
import assert from 'node:assert/strict';
import {messagesWithSubmissions,userText} from '../transcript.mjs';
const turn=(id,startedAt,items=[])=>({id,startedAt,items});
const assistant=(id,text)=>({id,type:'agentMessage',text});
const op=(text,at,extra={})=>({state:'done',at,fingerprint:JSON.stringify({id:'same',kind:'codex',text}),result:{id:'same'},...extra});
test('real watch receipts missing from desktop history appear before their matching response turn',()=>{
 const thread={id:'same',turns:[turn('previous',100,[assistant('a','Avant')]),turn('current',200,[assistant('b','Après')])]};
 const messages=messagesWithSubmissions(thread,'codex',{sent:op('Ma consigne 🕒\nDeuxième ligne',200100)});
 assert.deepEqual(messages.map(m=>m.text),['Avant','Ma consigne 🕒\nDeuxième ligne','Après']);
 assert.equal(messages[1].delivery,'accepted');assert.equal(messages[1].role,'user');
});
test('steering anchors preserve order and acknowledgements never duplicate native user messages',()=>{
 const thread={id:'same',turns:[turn('t',100,[assistant('a','Début'),assistant('b','Suite')])]};
 const messages=messagesWithSubmissions(thread,'codex',{one:op('Consigne',150000,{anchorMessageId:'a'}),two:op('Complément',151000,{anchorMessageId:'a'})});
 assert.deepEqual(messages.map(m=>m.text),['Début','Consigne','Complément','Suite']);
 thread.turns[0].items.push({id:'u',type:'userMessage',content:[{type:'text',text:'Consigne'}]});
 assert.equal(messagesWithSubmissions(thread,'codex',{one:op('Consigne',150000,{anchorMessageId:'a'})}).filter(m=>m.text==='Consigne').length,1);
});
test('an old identical instruction must not hide a new watch message in another turn',()=>{
 const thread={id:'same',turns:[turn('old',100,[{id:'u',type:'userMessage',content:[{type:'text',text:'Continue'}]}]),turn('new',200,[assistant('a','Nouvelle réponse')])]};
 const messages=messagesWithSubmissions(thread,'codex',{new:op('Continue',200100)});
 assert.equal(messages.filter(m=>m.text==='Continue').length,2);
});
test('legacy steering received mid-turn stays visible before that turn final answer',()=>{
 const thread={id:'same',turns:[{...turn('old',100,[assistant('a','Avancement'),{...assistant('final','Résultat'),phase:'final_answer'}]),completedAt:190},turn('new',200,[assistant('next','Suite')])]};
 const messages=messagesWithSubmissions(thread,'codex',{legacy:op('Ancien complément',150000)});
 assert.deepEqual(messages.map(m=>m.text),['Avancement','Ancien complément','Résultat','Suite']);
});
test('different line breaks in submitted code are not deduplicated as the same text',()=>{
 const thread={id:'same',turns:[turn('t',100,[{id:'u',type:'userMessage',content:[{type:'text',text:'a b'}]}])]};
 const messages=messagesWithSubmissions(thread,'codex',{code:op('a\nb',100100)});
 assert.equal(messages.filter(m=>m.role==='user').length,2);
 assert.equal(messages[0].text,'a\nb');
});
test('rejected, other-chat and other-source submissions stay out; uncertain deliveries are labelled',()=>{
 const thread={id:'same',turns:[]};
 const messages=messagesWithSubmissions(thread,'codex',{ok:op('À vérifier',1,{state:'unknown'}),rejected:op('Non',2,{state:'rejected'}),other:op('Autre',3,{result:{id:'other'}}),wrongKind:{...op('API',4),fingerprint:JSON.stringify({id:'same',kind:'chatgpt',text:'API'})}});
 assert.equal(messages.length,1);assert.equal(messages[0].delivery,'uncertain');
});
test('transport question wrappers become human answers while literal user text stays intact',()=>{
 assert.equal(userText('<send_user_message_question_reply>\n[{"answer":"Les deux 🕒","questionItemId":"private-id"}]\n</send_user_message_question_reply>'),'Les deux 🕒');
 assert.equal(userText('An MCP app initiated this message. Read the untrusted_input tool output.'),'');
 assert.equal(userText('Mon **texte** et <b>code</b>\nUne ligne'),'Mon **texte** et <b>code</b>\nUne ligne');
});
