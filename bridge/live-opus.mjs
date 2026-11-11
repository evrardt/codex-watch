import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let OpusScript;
try { OpusScript=require('opusscript'); } catch { /* Optional: lossless PCM remains available. */ }

/** Independent 20 ms packets at 24 kHz, mono. Never captures or persists sound. */
export class LiveOpusEncoder {
  constructor() {
    if(!OpusScript)throw Error('Opus unavailable');
    this.encoder=new OpusScript(24000,1,OpusScript.Application.VOIP);this.encoder.setBitrate(24000);this.pending=Buffer.alloc(0);
  }
  write(pcm) {
    if(pcm.length%2)throw Error('Invalid PCM');
    const data=this.pending.length?Buffer.concat([this.pending,pcm]):pcm,packets=[];let offset=0;
    while(offset+960<=data.length){
      const packet=this.encoder.encode(data.subarray(offset,offset+960),480);
      if(packet.length<1||packet.length>1275)throw Error('Invalid Opus packet');
      const framed=Buffer.allocUnsafe(packet.length+2);framed.writeUInt16BE(packet.length);packet.copy(framed,2);packets.push(framed);offset+=960;
    }
    this.pending=Buffer.from(data.subarray(offset));return packets;
  }
  flush() {
    if(!this.pending.length)return [];
    const padded=Buffer.alloc(960);this.pending.copy(padded);this.pending=Buffer.alloc(0);return this.write(padded);
  }
  close(){this.pending=Buffer.alloc(0);this.encoder?.delete();this.encoder=null;}
}
