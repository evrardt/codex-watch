package fr.thomas.codexwatch.pairing;

import android.app.Activity;
import android.app.Instrumentation;
import android.os.Bundle;
import android.os.SystemClock;
import java.io.DataInputStream;
import java.io.EOFException;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.util.ArrayList;

/** Measures the installed decoder against generated Opus frames; never records user audio. */
public final class PerformanceOpusProbeInstrumentation extends Instrumentation {
 @Override public void onCreate(Bundle arguments){super.onCreate(arguments);start();}
 @Override public void onStart(){Bundle result=new Bundle();Object decoder=null;Method close=null;String stage="load";try{
  Class<?> type=getTargetContext().getClassLoader().loadClass("fr.thomas.codexwatch.LiveOpusDecoder");
  Constructor<?> init=type.getDeclaredConstructor();init.setAccessible(true);decoder=init.newInstance();
  Method decode=type.getDeclaredMethod("decode",byte[].class);close=type.getDeclaredMethod("close");decode.setAccessible(true);close.setAccessible(true);
  Method reset=type.getDeclaredMethod("reset");reset.setAccessible(true);stage="decode";
  int[] durations={20,40,20};String[] labels={"20a","40","20b"};
  for(int run=0;run<durations.length;run++){
   if(run>0)reset.invoke(decoder);int ms=durations[run];String label=labels[run];ArrayList<byte[]> packets=new ArrayList<>();
   try(DataInputStream source=new DataInputStream(getContext().getAssets().open(ms==20?"opus-probe.bin":"opus-probe-40.bin"))){
    while(true){int size;try{size=source.readUnsignedShort();}catch(EOFException end){break;}
     if(size<1||size>1275)throw new IllegalStateException();byte[] framed=new byte[size+2];framed[0]=(byte)(size>>8);framed[1]=(byte)size;source.readFully(framed,2,size);packets.add(framed);}
   }
   int decodedBytes=0,slow=0,empty=0;long totalNs=0,maxNs=0;long due=SystemClock.elapsedRealtimeNanos();
   for(byte[] framed:packets){
    long begin=SystemClock.elapsedRealtimeNanos();byte[] pcm=(byte[])decode.invoke(decoder,(Object)framed);long elapsed=SystemClock.elapsedRealtimeNanos()-begin;
    decodedBytes+=pcm.length;totalNs+=elapsed;maxNs=Math.max(maxNs,elapsed);if(elapsed>ms*1000000L)slow++;if(pcm.length==0)empty++;
    due+=ms*1000000L;long remaining=due-SystemClock.elapsedRealtimeNanos();if(remaining>0)SystemClock.sleep(remaining/1000000L);
   }
   result.putInt("ms"+label+"Bytes",decodedBytes);result.putInt("ms"+label+"SlowCalls",slow);result.putInt("ms"+label+"EmptyCalls",empty);
   result.putLong("ms"+label+"MeanUsPer20ms",totalNs/(packets.size()*ms/20)/1000);result.putLong("ms"+label+"MaxCallUs",maxNs/1000);result.putInt("ms"+label+"Calls",packets.size());
   if(decodedBytes<95000)throw new IllegalStateException();
  }
  result.putString("status","opus_timing_ok");finish(Activity.RESULT_OK,result);
 }catch(Exception e){Throwable cause=e.getCause()!=null?e.getCause():e;result.putString("status","opus_timing_failed");result.putString("stage",stage);result.putString("failure",cause.getClass().getSimpleName());finish(Activity.RESULT_CANCELED,result);}finally{if(decoder!=null&&close!=null)try{close.invoke(decoder);}catch(Exception ignored){}}}
}
