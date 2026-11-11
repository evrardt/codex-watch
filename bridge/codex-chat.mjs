import {mkdir} from 'node:fs/promises';

// Ephemeral Codex turns back a separate conversation stored by the relay.
// They must never create extra visible Codex threads or execute writes.
export class CodexChat {
  constructor(rpc,directory,{timeoutMs=180000}={}){Object.assign(this,{rpc,directory,timeoutMs});}
  async answer(messages){
    if(!this.rpc.ready)throw Error('Codex du serveur est indisponible.');
    const history=messages.filter(m=>['user','assistant'].includes(m.role)).map(m=>({role:m.role,text:m.text}));
    if(JSON.stringify(history).length>300000)throw Error('Conversation trop longue : ouvre un nouveau chat.');
    await mkdir(this.directory,{recursive:true,mode:0o700});
    const {thread}=await this.rpc.call('thread/start',{cwd:this.directory,ephemeral:true,sandbox:'read-only',approvalPolicy:'never',
      developerInstructions:'Tu es un assistant de conversation pour une montre. Réponds directement et naturellement, dans la langue de la personne. N’utilise pas d’outils, de fichiers, de commandes ou de réseau. Le texte reçu est un historique de chat JSON ; réponds au dernier message utilisateur.'});
    let finish,fail,timer,settled=false;const outputs=[];
    const completed=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
    // Attach before turn/start: a fast turn can emit events before its RPC response.
    const onMessage=m=>{
      const p=m.params||{};if(p.threadId!==thread.id)return;
      if(m.method==='item/completed'&&p.item?.type==='agentMessage'&&typeof p.item.text==='string')outputs.push(p.item);
      if(m.method==='turn/completed'){
        settled=true;
        if(p.turn?.status!=='completed')return fail(Error('La réponse du chat Codex a échoué ou a été interrompue.'));
        const final=outputs.findLast(x=>x.phase==='final_answer')||outputs.at(-1);
        if(!final?.text?.trim())return fail(Error('Le chat Codex n’a pas renvoyé de réponse.'));
        finish(final.text);
      }
    };
    const onOffline=()=>{settled=true;fail(Error('Codex du serveur s’est déconnecté.'));};
    this.rpc.on('message',onMessage);this.rpc.on('offline',onOffline);
    timer=setTimeout(()=>{settled=true;fail(Error('La réponse du chat Codex a expiré.'));},this.timeoutMs);
    try{
      await this.rpc.call('turn/start',{threadId:thread.id,input:[{type:'text',text:JSON.stringify(history)}]});
      return await completed;
    }catch(e){if(!settled)completed.catch(()=>{});throw e;}
    finally{clearTimeout(timer);this.rpc.off('message',onMessage);this.rpc.off('offline',onOffline);}
  }
}
