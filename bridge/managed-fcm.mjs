// A private parent/child channel keeps service credentials out of inherited environment variables.
export function receiveManagedFcm(channel=process,timeoutMs=5000){
  if(!channel.connected)return Promise.resolve(null);
  return new Promise(resolve=>{
    const done=value=>{clearTimeout(timer);channel.off('message',onMessage);channel.off('disconnect',onDisconnect);resolve(value);};
    const onMessage=message=>{if(message?.type==='firebase-credentials')done(typeof message.credentials==='string' ? message.credentials : null);};
    const onDisconnect=()=>done(null);
    const timer=setTimeout(()=>done(null),timeoutMs);timer.unref?.();
    channel.on('message',onMessage);channel.once('disconnect',onDisconnect);
    // Request the secret only after the receiver is listening; a parent that
    // sends immediately after spawn can otherwise race the child's imports.
    if(typeof channel.send==='function')channel.send({type:'firebase-credentials-ready'},()=>{});
  });
}
