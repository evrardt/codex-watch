import{randomUUID}from'node:crypto';
export function recordLiveTranscript(call,event,role){
 const store=call.service.store;if(!store||typeof event.delta!=='string'||!event.delta.trim()&&!event.delta.includes(' '))return;
 const rows=store.data.liveCalls||=[];let row=rows.find(r=>r.id===call.id);
 if(!row){row={id:call.id,at:Date.now(),bindings:call.bindings,diagnostics:call.diagnostics,messages:[]};rows.push(row);store.data.liveCalls=rows.slice(-30);}
 const kind=call.target,last=row.messages.at(-1),start=Number(event.start_ms)||0,end=Number(event.end_ms)||start;
 if(last&&last.role===role&&last.kind===kind&&start-last.endMs<=900){last.text=(last.text+event.delta).slice(0,12000);last.endMs=end;}
 else row.messages.push({id:randomUUID(),role,kind,text:event.delta.slice(0,12000),startMs:start,endMs:end});
 row.messages=row.messages.slice(-120);
 clearTimeout(call.journalTimer);call.journalTimer=setTimeout(()=>{void store.save().catch(()=>{});},500);
}
export function liveHistory(store,kind,id){return (store.data.liveCalls||[]).filter(c=>c.bindings?.[kind]?.id===id).flatMap(c=>c.messages.filter(m=>m.kind===kind).map(m=>({...m,at:c.at,source:'live',callId:c.id}))).slice(-300);}
