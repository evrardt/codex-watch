/** Checks the relay process, independently of Codex/ChatGPT availability. */
function createWatchdog({allowed,child,healthy,start,terminate,onFailure=()=>{}}) {
 let busy=false,failures=0,observed=null;
 return async function tick(){
  if(busy||!allowed())return;
  busy=true;
  try{
   const current=child();
   if(current!==observed){observed=current;failures=0;}
   if(!current){await start();return;}
   if(await healthy()){failures=0;return;}
   if(++failures<3)return;
   failures=0;onFailure();await terminate(current);
   // The next tick restarts only after the old child has actually exited.
  }catch{onFailure();}finally{busy=false;}
 };
}
module.exports={createWatchdog};
