const time = value => typeof value === 'number' ? value * (value < 1e12 ? 1000 : 1) : Date.parse(value) || 0;
const comparable = text => String(text || '').normalize('NFC').replace(/\r\n?/g, '\n').trim();

export function mergeTurns(cached, incoming) {
  return [...new Map([...cached,...incoming].map(t=>[t.id,t])).values()]
    .sort((a,b)=>time(a.startedAt)-time(b.startedAt));
}

export function userText(value) {
  const text = String(value || '');
  if (text.trim() === 'An MCP app initiated this message. Read the untrusted_input tool output.') return '';
  const answer = text.trim().match(/^<send_user_message_question_reply>([\s\S]*)<\/send_user_message_question_reply>$/);
  if (answer) { try { return JSON.parse(answer[1]).map(item => item.answer).filter(x=>typeof x==='string').join('\n'); } catch { return ''; } }
  if (/^\s*<(external_codex_apps_[\w]+|environment_context)>[\s\S]*<\/\1>\s*$/.test(text)) return '';
  return text;
}

// A fresh, structured Codex question reply is stronger evidence than a form
// disappearing: it identifies both the question and the exact submitted answer.
export function questionReplyIds(thread, question, answer) {
  const found = new Set();
  for (const turn of thread.turns || []) for (const item of turn.items || []) {
    if (item.type !== 'userMessage' || typeof item.id !== 'string' || !item.id || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (typeof part.text !== 'string') continue;
      const match = part.text.trim().match(/^<send_user_message_question_reply>([\s\S]*)<\/send_user_message_question_reply>$/);
      if (!match) continue;
      try {
        const replies = JSON.parse(match[1]);
        if (Array.isArray(replies) && replies.some(r => r && r.question === question && typeof r.answer === 'string' && r.answer.trim() === answer.trim())) found.add(item.id);
      } catch { /* Incomplete or malformed wrappers are not evidence. */ }
    }
  }
  return found;
}
export function messagesFromThread(thread) {
  return (thread.turns || []).flatMap(turn => (turn.items || []).flatMap(item => {
    if (item.type === 'userMessage') {
      const text = userText((item.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n'));
      return text ? [{id:item.id,role:'user',text}] : [];
    }
    if (item.type === 'agentMessage') return [{id:item.id,role:'assistant',text:item.text,phase:item.phase || null}];
    return [];
  }));
}

/** Reconstruct only this relay's recorded human submissions, never arbitrary tool output. */
export function messagesWithSubmissions(thread, kind, operations) {
  const turns = thread.turns || [], groups = turns.map(turn => messagesFromThread({turns:[turn]}));
  const nativeUsers = groups.flatMap((group,index)=>group.filter(m=>m.role==='user').map(message=>({message,group,index,used:false})));
  const submissions = Object.entries(operations).flatMap(([key,op])=>{
    if (!['done','pending','unknown'].includes(op.state)) return [];
    let input;try{input=JSON.parse(op.fingerprint);}catch{return [];}
    if ((op.result?.id || input.id)!==thread.id || (input.kind || 'codex')!==kind || typeof input.text!=='string' || !input.text.trim()) return [];
    return [{key,op,text:input.text}];
  }).sort((a,b)=>a.op.at-b.op.at);
  const before = turns.map(()=>[]), tail = [];
  for (const {key,op,text} of submissions) {
    const native = nativeUsers.find(candidate=>!candidate.used && comparable(candidate.message.text)===comparable(text) && (
      !time(turns[candidate.index].startedAt) || Math.abs(time(turns[candidate.index].startedAt)-op.at)<=10000 ||
      op.anchorMessageId && candidate.group.findIndex(m=>m.id===op.anchorMessageId)>=0 &&
      candidate.group.findIndex(m=>m.id===candidate.message.id)>candidate.group.findIndex(m=>m.id===op.anchorMessageId)));
    if (native) {native.used=true;continue;}
    const message = {id:'watch-'+key,role:'user',text,source:'watch',delivery:op.state==='done'?'accepted':'uncertain',at:op.at};
    const group = op.anchorMessageId ? groups.find(g=>g.some(m=>m.id===op.anchorMessageId)) : null;
    if (group) {
      let index=group.findIndex(m=>m.id===op.anchorMessageId)+1;
      while (group[index]?.anchorMessageId===op.anchorMessageId) index++;
      group.splice(index,0,{...message,anchorMessageId:op.anchorMessageId});continue;
    }
    // Cloud/desktop starts can omit the delegated user item. Their turn start still
    // identifies the submitted request, including receipts created by older versions.
    let closest=-1,distance=Infinity;
    turns.forEach((turn,index)=>{const delta=Math.abs(time(turn.startedAt)-op.at);if(delta<distance){distance=delta;closest=index;}});
    if (closest>=0 && distance<=10000) before[closest].push(message);
    else {
      const containing=turns.findIndex((turn,index)=>time(turn.startedAt)>0 && time(turn.startedAt)<=op.at &&
        (time(turn.completedAt) || time(turns[index+1]?.startedAt) || Infinity)>=op.at);
      if (containing>=0) {
        const group=groups[containing], final=group.findLastIndex(m=>m.role==='assistant'&&m.phase==='final_answer');
        group.splice(final>=0?final:group.length,0,message);
      } else if (!turns.length || op.at>=time(turns.at(-1).startedAt)) tail.push(message);
    }
  }
  return groups.flatMap((group,index)=>[...before[index],...group]).concat(tail);
}
