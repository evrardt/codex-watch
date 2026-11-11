package fr.thomas.codexwatch.pairing;

import android.app.Activity;
import android.app.Instrumentation;
import android.media.MediaCodec;
import android.media.MediaFormat;
import android.os.Bundle;
import android.util.Base64;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/** Tests decoding a generated 440 Hz sample without using the microphone or network. */
public final class OpusProbeInstrumentation extends Instrumentation {
 @Override public void onCreate(Bundle arguments){super.onCreate(arguments);start();}
 @Override public void onStart(){Bundle result=new Bundle();MediaCodec codec=null;String step="create";try{
  codec=MediaCodec.createDecoderByType("audio/opus");MediaFormat format=MediaFormat.createAudioFormat("audio/opus",24000,1);
  ByteBuffer header=ByteBuffer.allocate(19).order(ByteOrder.LITTLE_ENDIAN);
  header.put(new byte[]{'O','p','u','s','H','e','a','d'}).put((byte)1).put((byte)1).putShort((short)0).putInt(24000).putShort((short)0).put((byte)0).flip();
  ByteBuffer skip=ByteBuffer.allocate(8).order(ByteOrder.nativeOrder());skip.putLong(0);skip.flip();
  ByteBuffer preroll=ByteBuffer.allocate(8).order(ByteOrder.nativeOrder());preroll.putLong(0);preroll.flip();
  format.setByteBuffer("csd-0",header);format.setByteBuffer("csd-1",skip);format.setByteBuffer("csd-2",preroll);
  step="configure";codec.configure(format,null,null,0);codec.start();
  byte[] packet=Base64.decode("aIKIXWyemawAAARf+DAGfPi0wF/v43F++YUDatFfSGZgmV19nNzlP35PSIO+u9FRPwdmtjzQVwSzK3wJiS35ZEQb8dG9e33r86cF4D8wxNlskm7QZwg=",Base64.DEFAULT);
  MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();int in=0,bytes=0,rate=0;long deadline=System.currentTimeMillis()+4000;
  step="decode";while(System.currentTimeMillis()<deadline&&bytes==0){
   if(in<4){int i=codec.dequeueInputBuffer(10000);if(i>=0){ByteBuffer b=codec.getInputBuffer(i);b.clear();b.put(packet);codec.queueInputBuffer(i,0,packet.length,in*20000L,0);in++;}}
   int o=codec.dequeueOutputBuffer(info,10000);if(o==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED){rate=codec.getOutputFormat().getInteger(MediaFormat.KEY_SAMPLE_RATE);}else if(o>=0){bytes+=info.size;codec.releaseOutputBuffer(o,false);}
  }
  if(bytes<=0||rate<=0)throw new IllegalStateException();result.putString("status","opus_decode_ok");result.putInt("sampleRate",rate);result.putInt("decodedBytes",bytes);finish(Activity.RESULT_OK,result);
 }catch(Exception e){result.putString("status","opus_decode_failed");result.putString("stage",step);result.putString("failure",e.getClass().getSimpleName());finish(Activity.RESULT_CANCELED,result);}finally{if(codec!=null){try{codec.stop();}catch(Exception ignored){}codec.release();}}}
}
