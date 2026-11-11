package fr.thomas.codexwatch.pairing;

import android.app.Activity;
import android.app.Instrumentation;
import android.os.Bundle;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;

/** Exercises the actual app decoder using a generated sample, with no microphone or network. */
public final class ProductionOpusProbeInstrumentation extends Instrumentation {
 @Override public void onCreate(Bundle arguments){super.onCreate(arguments);start();}
 @Override public void onStart(){Bundle result=new Bundle();Object decoder=null;Method close=null;String step="load";try{
  Class<?> type=getTargetContext().getClassLoader().loadClass("fr.thomas.codexwatch.LiveOpusDecoder");
  Constructor<?> init=type.getDeclaredConstructor();init.setAccessible(true);decoder=init.newInstance();
  Method decode=type.getDeclaredMethod("decode",byte[].class),reset=type.getDeclaredMethod("reset");close=type.getDeclaredMethod("close");
  decode.setAccessible(true);reset.setAccessible(true);close.setAccessible(true);
  byte[] opus=Base64.decode("aIKIXWyemawAAARf+DAGfPi0wF/v43F++YUDatFfSGZgmV19nNzlP35PSIO+u9FRPwdmtjzQVwSzK3wJiS35ZEQb8dG9e33r86cF4D8wxNlskm7QZwg=",Base64.DEFAULT);
  ByteArrayOutputStream framed=new ByteArrayOutputStream();for(int i=0;i<8;i++){framed.write(opus.length>>8);framed.write(opus.length);framed.write(opus);}
  step="stream";byte[] first=(byte[])decode.invoke(decoder,(Object)framed.toByteArray());
  step="reset";reset.invoke(decoder);byte[] second=(byte[])decode.invoke(decoder,(Object)framed.toByteArray());
  int nonzero=0;for(byte b:first)if(b!=0)nonzero++;
  result.putInt("firstPcmBytes",first.length);result.putInt("resetPcmBytes",second.length);
  java.lang.reflect.Field nativeField=type.getDeclaredField("native");nativeField.setAccessible(true);boolean nativeSelected=nativeField.get(decoder)!=null;
  result.putBoolean("nativeSelected",nativeSelected);
  if(first.length!=7680||second.length!=7680||nonzero<100||!java.util.Arrays.equals(first,second))throw new IllegalStateException();
  step="invalid_frame";try{decode.invoke(decoder,(Object)new byte[]{0,10,42});throw new IllegalStateException();}
  catch(java.lang.reflect.InvocationTargetException expected){if(!(expected.getCause() instanceof IllegalArgumentException))throw expected;}
  result.putString("status","production_opus_ok");finish(Activity.RESULT_OK,result);
 }catch(Exception e){Throwable cause=e.getCause()!=null?e.getCause():e;result.putString("status","production_opus_failed");result.putString("stage",step);result.putString("failure",cause.getClass().getSimpleName());finish(Activity.RESULT_CANCELED,result);}finally{if(decoder!=null&&close!=null)try{close.invoke(decoder);}catch(Exception ignored){}}}
}
