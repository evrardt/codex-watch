import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesPendingThread,recentPendingCandidate,completeRecentCandidates} from '../pending-thread.mjs';
const at=1794236742682;
const thread=(text,startedAt=at/1000)=>({createdAt:at/1000,turns:[{startedAt,items:[{type:'userMessage',content:[{type:'text',text}]}]}]});
test('a pending chat requires the complete first message and a nearby creation time',()=>{
 assert.equal(matchesPendingThread(thread('Même demande'), 'Même demande',at),true);
 assert.equal(matchesPendingThread(thread('Même demande, autre texte'), 'Même demande',at),false);
 assert.equal(matchesPendingThread(thread('Même demande',(at-10000)/1000), 'Même demande',at),false);
 assert.equal(matchesPendingThread({...thread('Même demande'),historyStale:true}, 'Même demande',at),false);
 assert.equal(matchesPendingThread({turns:[{items:[]}]},'Même demande',at),false);
});
test('recent results are used only when the full relevant time window is covered, including pinned chats',()=>{
 const recent={threads:[{id:'new',kind:'chatgpt',projectId:null,updatedAt:at/1000},{id:'old',kind:'codex',updatedAt:(at-10000)/1000}],pinnedThreads:[{id:'pinned',kind:'chatgpt',updatedAt:at/1000},{id:'other',kind:'chatgpt',projectId:'elsewhere',updatedAt:at/1000}]};
 assert.deepEqual(completeRecentCandidates(recent,'chatgpt','',at).map(t=>t.id),['pinned','new']);
 assert.equal(completeRecentCandidates({...recent,threads:recent.threads.slice(0,1)},'chatgpt','',at),null);
 assert.equal(completeRecentCandidates({...recent,pinnedThreads:undefined},'chatgpt','',at),null);
 assert.equal(completeRecentCandidates({...recent,threads:[{id:'unknown'}]},'chatgpt','',at),null);
});
test('a Codex preview can identify the exact initial prompt when no user item is exposed',()=>{
 const row={preview:'Consigne entière',turns:[{startedAt:at/1000,items:[]}]};
 assert.equal(matchesPendingThread(row,'Consigne entière',at),true);
 assert.equal(matchesPendingThread(row,'Consigne entière plus longue',at),false);
 assert.equal(recentPendingCandidate({updatedAt:(at-10000)/1000},at),false);
 assert.equal(matchesPendingThread({...row,kind:'chatgpt'},'Consigne entière',at),false);
});
