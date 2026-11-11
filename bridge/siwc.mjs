import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// Independent ChatGPT-plan access. Tokens stay in a private file, never in
// the watch protocol or the conversation store.
export class PlanChat {
  constructor(file,{fetcher=fetch,now=()=>Date.now()}={}) { Object.assign(this,{file,fetcher,now}); this.refreshing=null; }
  async credentials() {
    try {
      const c=JSON.parse(await readFile(this.file,'utf8'));
      if(!c.client_id||!c.access_token||!c.refresh_token||!c.host_id||!String(c.scope||'').split(/\s+/).includes('chatgpt.tokens.use.direct'))return null;
      return c;
    } catch(e) { if(e.code==='ENOENT')return null; throw e; }
  }
  async available(){try{return !!await this.credentials();}catch{return false;}}
  async token() {
    const c=await this.credentials();if(!c)throw Error('Connecte ChatGPT sur le relais PC pour activer le chat du serveur.');
    if(Number(c.expires_at)>this.now()+60000)return c.access_token;
    if(this.refreshing)return this.refreshing;
    this.refreshing=this.refresh(c).finally(()=>{this.refreshing=null;});return this.refreshing;
  }
  async refresh(c){
    const response=await this.fetcher('https://auth.openai.com/api/accounts/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({grant_type:'refresh_token',refresh_token:c.refresh_token,client_id:c.client_id,resource:'https://api.openai.com/v1'}),signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('Connexion ChatGPT expirée. Reconnecte le compte sur le relais PC.');
    const t=await response.json();if(!t.access_token||!t.refresh_token||!Number.isFinite(Number(t.expires_in)))throw Error('Renouvellement ChatGPT incomplet.');
    const next={...c,access_token:t.access_token,refresh_token:t.refresh_token,expires_at:this.now()+Number(t.expires_in)*1000,...(t.id_token?{id_token:t.id_token}:{})};
    const tmp=this.file+'.'+randomUUID()+'.tmp';await mkdir(path.dirname(this.file),{recursive:true,mode:0o700});
    try{await writeFile(tmp,JSON.stringify(next),{mode:0o600,flag:'wx'});await rename(tmp,this.file);}catch(e){throw Error('Connexion renouvelée mais impossible à enregistrer : reconnecte ChatGPT.');}
    return next.access_token;
  }
  async answer(messages){
    const token=await this.token();const headers={Authorization:'Bearer '+token};
    const listing=await this.fetcher('https://api.openai.com/v1/models',{headers,signal:AbortSignal.timeout(20000)});
    if(!listing.ok)throw Error('Modèles ChatGPT indisponibles (HTTP '+listing.status+').');
    const data=await listing.json();const model=(data.models||[]).find(m=>m.visibility==='list'&&typeof m.slug==='string')?.slug;
    if(!model)throw Error('Aucun modèle ChatGPT disponible pour ce compte.');
    const input=messages.filter(m=>['user','assistant'].includes(m.role)).map(m=>({role:m.role,content:m.text}));
    if(JSON.stringify(input).length>300000)throw Error('Conversation trop longue : ouvre un nouveau chat.');
    const res=await this.fetcher('https://api.openai.com/v1/responses',{method:'POST',headers:{...headers,'Content-Type':'application/json'},
      body:JSON.stringify({model,input,store:false,stream:true,instructions:'Réponds de façon naturelle et concise, adaptée à une montre. Réponds dans la langue de la demande.'}),signal:AbortSignal.timeout(180000)});
    if(!res.ok)throw Error('ChatGPT indisponible (HTTP '+res.status+').');
    if(!res.body)throw Error('Réponse ChatGPT interrompue.');
    let buffer='',text='',completed=false;const decoder=new TextDecoder();
    const handle=frame=>{
      const data=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
      if(!data||data==='[DONE]')return;
      let event;try{event=JSON.parse(data);}catch{throw Error('Réponse ChatGPT invalide.');}
      if(event.type==='response.output_text.delta')text+=event.delta||'';
      if(event.type==='response.failed'||event.type==='error'){
        const code=event.response?.error?.code||event.error?.code||'';
        throw Error(code.startsWith('subscription_sharing_')?'Limite ou accès ChatGPT indisponible. Vérifie ton abonnement et son utilisation.':'La réponse ChatGPT a échoué.');
      }
      if(event.type==='response.incomplete')throw Error('Réponse ChatGPT incomplète.');
      if(event.type==='response.completed'){
        completed=true;
        if(!text)text=(event.response?.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n');
      }
      if(text.length>250000)throw Error('Réponse ChatGPT trop longue.');
    };
    for await(const chunk of res.body){buffer+=decoder.decode(chunk,{stream:true});if(buffer.length>1000000)throw Error('Réponse ChatGPT trop volumineuse.');let m;while((m=/\r?\n\r?\n/.exec(buffer))){handle(buffer.slice(0,m.index));buffer=buffer.slice(m.index+m[0].length);}}
    buffer+=decoder.decode();if(buffer.trim())handle(buffer);
    if(!completed||!text.trim())throw Error('Réponse ChatGPT interrompue ou vide.');return text;
  }
}
