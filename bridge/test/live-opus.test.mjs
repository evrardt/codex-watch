import test from 'node:test';
import assert from 'node:assert/strict';
import OpusScript from 'opusscript';
import {LiveOpusEncoder} from '../live-opus.mjs';

test('Opus sends a second of speech at a small fraction of PCM bandwidth',()=>{
 const pcm=Buffer.alloc(48000);for(let i=0;i<24000;i++)pcm.writeInt16LE(Math.round(9000*Math.sin(2*Math.PI*440*i/24000)),i*2);
 const encoder=new LiveOpusEncoder(),parts=[];
 try {for(let i=0;i<pcm.length;i+=1376)parts.push(...encoder.write(pcm.subarray(i,Math.min(i+1376,pcm.length))));parts.push(...encoder.flush());}
 finally{encoder.close();}
 assert.equal(parts.length,50);assert.ok(parts.reduce((n,p)=>n+p.length,0)<8000);
 const decoder=new OpusScript(24000,1,OpusScript.Application.VOIP);let decoded=0,energy=0;
 try{for(const frame of parts){assert.equal(frame.readUInt16BE(0),frame.length-2);const data=decoder.decode(frame.subarray(2));decoded+=data.length;for(let i=0;i<data.length;i+=2)energy+=Math.abs(data.readInt16LE(i));}}
 finally{decoder.delete();}
 assert.equal(decoded,pcm.length);assert.ok(energy>100000);
});

test('flush emits one padded tail and close does not emit old audio',()=>{
 const encoder=new LiveOpusEncoder();
 try{assert.equal(encoder.write(Buffer.alloc(400)).length,0);assert.equal(encoder.flush().length,1);assert.equal(encoder.flush().length,0);}
 finally{encoder.close();}
});
