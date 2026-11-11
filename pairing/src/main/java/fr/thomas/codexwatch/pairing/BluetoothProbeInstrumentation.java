package fr.thomas.codexwatch.pairing;
import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.os.Bundle;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** Temporary same-signature check. No address, credential, or response body is printed. */
public final class BluetoothProbeInstrumentation extends Instrumentation {
 private boolean internet;
 @Override public void onCreate(Bundle arguments){super.onCreate(arguments);internet="internet".equals(arguments.getString("transport"));start();}
 @Override public void onStart(){Bundle result=new Bundle();HttpURLConnection c=null;String step="store";try{
  Context ctx=getTargetContext();ClassLoader loader=ctx.getClassLoader();
  Class<?> storeType=loader.loadClass("fr.thomas.codexwatch.ConnectionStore");Object store=storeType.getConstructor(Context.class).newInstance(ctx);
  Object profile=storeType.getMethod("read",String.class).invoke(store,"pc");Class<?> profileType=profile.getClass();
  String address=(String)profileType.getMethod("getBluetoothAddress").invoke(profile);if(address.isEmpty())throw new IllegalStateException();
  String token=(String)profileType.getMethod("getToken").invoke(profile);
  step="tunnel";String base;
  if(internet){base=(String)profileType.getMethod("getUrl").invoke(profile);if(!base.startsWith("https://"))throw new IllegalStateException();}
  else {Class<?> tunnelType=loader.loadClass("fr.thomas.codexwatch.BluetoothTunnel");Object tunnel=tunnelType.getField("INSTANCE").get(null);
   tunnelType.getMethod("init",Context.class).invoke(tunnel,ctx);base=(String)tunnelType.getMethod("bluetoothBase",profileType).invoke(tunnel,profile);
   if(!base.startsWith("http://127.0.0.1:"))throw new IllegalStateException();}
  step="request";c=(HttpURLConnection)URI.create(base+"/v1/health").toURL().openConnection();c.setConnectTimeout(15000);c.setReadTimeout(35000);c.setRequestProperty("Authorization","Bearer "+token);
  if(c.getResponseCode()!=200)throw new IllegalStateException();JSONObject body=new JSONObject(new String(c.getInputStream().readAllBytes(),StandardCharsets.UTF_8));
  result.putString("status",internet?"internet_health_ok":"bluetooth_health_ok");result.putBoolean("codex",body.optBoolean("codex"));finish(Activity.RESULT_OK,result);
 }catch(Exception ignored){result.putString("stage",step);result.putString("failure",ignored.getClass().getSimpleName());result.putString("status",internet?"internet_health_failed":"bluetooth_health_failed");finish(Activity.RESULT_CANCELED,result);}finally{if(c!=null)c.disconnect();}}
}
