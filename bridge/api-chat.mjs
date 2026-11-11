import { readFile } from 'node:fs/promises';

// This credential is separate from the watch token and never enters the chat store.
export class ApiChat {
  constructor(file, {fetcher=fetch, model='gpt-6.1-terra',onUsage=async()=>{}}={}) {
    Object.assign(this,{file,fetcher,model,onUsage});
  }
  async key() {
    try { const value=(await readFile(this.file,'utf8')).trim(); return /^sk-[A-Za-z0-9_-]{10,500}$/.test(value) ? value : ''; }
    catch (e) { if(e.code==='ENOENT')return ''; throw e; }
  }
  async available() { try { return !!await this.key(); } catch { return false; } }
  async answer(messages) {
    const key=await this.key();
    if(!key)throw Error('Configure la clé API du Chat sur le serveur.');
    const input=messages.filter(m=>['user','assistant'].includes(m.role)).map(m=>({role:m.role,content:m.text}));
    if(JSON.stringify(input).length>300000)throw Error('Conversation trop longue : ouvre un nouveau chat.');
    const model=this.model;
    let response;
    try { response=await this.fetcher('https://api.openai.com/v1/responses',{method:'POST',
      headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify({model,store:false,max_output_tokens:2048,reasoning:{effort:'low'},
        instructions:'Réponds naturellement et clairement dans la langue de la demande. Tes réponses sont consultées sur une montre : sois concis, sans sacrifier la précision.',input}),
      signal:AbortSignal.timeout(180000)}); }
    catch(e){await this.onUsage(model,null);throw e;}
    if(!response.ok){
      if(response.status===401)throw Error('Clé API invalide : vérifie la configuration du serveur.');
      if(response.status===429){
        let code='';try{const value=await response.json();code=String(value?.error?.code||value?.error?.type||'');}catch{}
        if(['insufficient_quota','credit_balance_exhausted'].includes(code))throw Error('Crédits API épuisés. Vérifie l’organisation et le projet de la clé.');
        throw Error('Limite ou crédits API indisponibles. Vérifie le projet OpenAI.');
      }
      if(response.status>=500)await this.onUsage(model,null);
      throw Error('Chat API indisponible (HTTP '+response.status+').');
    }
    let result;try{result=await response.json();}catch(e){await this.onUsage(model,null);throw e;}
    await this.onUsage(model,result.usage);
    if(result.status==='incomplete'||result.status==='failed')throw Error('Réponse API incomplète. Réessaie.');
    const text=(result.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n').trim();
    if(!text)throw Error('Aucune réponse textuelle reçue.');
    return text;
  }
}
