package fr.thomas.codexwatch.pairing;

import android.app.*;
import android.content.*;
import android.graphics.Bitmap;
import android.os.*;
import android.view.*;
import android.view.accessibility.AccessibilityNodeInfo;
import java.io.*;
import java.lang.reflect.*;
import java.util.*;

/** Audio/settings check only: no chat creation, submission, or new paid audio. */
public final class AudioProbeInstrumentation extends Instrumentation {
    private UiAutomation ui; private Activity activity; private Object speech; private final Bundle result=new Bundle();
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    private AccessibilityNodeInfo find(AccessibilityNodeInfo node,String label){
        if(node==null)return null;
        if(node.isVisibleToUser()&&label.contentEquals(node.getText()==null?"":node.getText()))return node;
        for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo found=find(node.getChild(i),label);if(found!=null)return found;}return null;
    }
    private AccessibilityNodeInfo editable(AccessibilityNodeInfo node){
        if(node==null)return null;if(node.isVisibleToUser()&&node.isEditable())return node;
        for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo found=editable(node.getChild(i));if(found!=null)return found;}return null;
    }
    private void swipe(){
        float x=activity.getResources().getDisplayMetrics().widthPixels/2f,h=activity.getResources().getDisplayMetrics().heightPixels;long down=SystemClock.uptimeMillis();
        for(int i=0;i<=8;i++){MotionEvent e=MotionEvent.obtain(down,SystemClock.uptimeMillis(),i==0?MotionEvent.ACTION_DOWN:i==8?MotionEvent.ACTION_UP:MotionEvent.ACTION_MOVE,x,h*(.77f-.45f*i/8f),0);e.setSource(InputDevice.SOURCE_TOUCHSCREEN);ui.injectInputEvent(e,true);e.recycle();SystemClock.sleep(25);}SystemClock.sleep(300);
    }
    private AccessibilityNodeInfo seek(String label){for(int i=0;i<18;i++){AccessibilityNodeInfo node=find(ui.getRootInActiveWindow(),label);if(node!=null)return node;swipe();}return null;}
    private boolean click(String label){AccessibilityNodeInfo node=seek(label);while(node!=null&&!node.isClickable())node=node.getParent();boolean ok=node!=null&&node.performAction(AccessibilityNodeInfo.ACTION_CLICK);SystemClock.sleep(500);return ok;}
    private void check(String name,boolean ok){result.putBoolean(name,ok);if(!ok)throw new IllegalStateException(name);}
    private Object call(Object target,String method,Class<?>[] types,Object... values){try{return target.getClass().getMethod(method,types).invoke(target,values);}catch(Exception e){throw new IllegalStateException(method,e);}}
    private void mainCall(String name){runOnMainSync(()->call(speech,name,new Class<?>[0]));}
    private String state(){Object[] out={null};runOnMainSync(()->out[0]=call(speech,"getState",new Class<?>[0]));return String.valueOf(out[0]);}
    private String notice(){Object[] out={null};runOnMainSync(()->out[0]=call(speech,"getNotice",new Class<?>[0]));return String.valueOf(out[0]);}
    private boolean waitState(String wanted){for(int i=0;i<200;i++){if(wanted.equals(state()))return true;SystemClock.sleep(100);}return false;}
    @Override public void onStart(){
        Context context=getTargetContext();SharedPreferences prefs=context.getSharedPreferences("audio_settings",0);Map<String,?> before=new HashMap<>(prefs.getAll());int code=Activity.RESULT_OK;
        try{
            activity=startActivitySync(new Intent().setClassName(context,"fr.thomas.codexwatch.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
            runOnMainSync(()->activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));
            ui=getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);SystemClock.sleep(1500);
            check("settingsFromHome",click("Paramètres"));check("audioSettingsOpened",click("Voix et budget"));
            check("watchSourceVisible",find(ui.getRootInActiveWindow(),"Voix de la montre")!=null);
            check("openaiSourceSelected",click("Voix OpenAI"));check("apiVoiceVisible",seek("Marin")!=null);
            Bitmap screenshot=ui.takeScreenshot();try(FileOutputStream out=new FileOutputStream(new File(context.getFilesDir(),"watch-audio-choices.png"))){screenshot.compress(Bitmap.CompressFormat.PNG,100,out);}
            check("dollarLimitVisible",seek("Montant en dollars")!=null);
            AccessibilityNodeInfo field=editable(ui.getRootInActiveWindow());Bundle value=new Bundle();value.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,"0.00");
            check("zeroDollarLimitEntered",field!=null&&field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,value));
            check("audioSettingsSaved",click("Enregistrer"));
            ClassLoader loader=context.getClassLoader();Class<?> connectionClass=loader.loadClass("fr.thomas.codexwatch.Connection"),apiClass=loader.loadClass("fr.thomas.codexwatch.BridgeApi"),speechClass=loader.loadClass("fr.thomas.codexwatch.SpeechPlayer");
            Object connectionStore=loader.loadClass("fr.thomas.codexwatch.ConnectionStore").getConstructor(Context.class).newInstance(context);
            Object slot=call(connectionStore,"activeSlot",new Class<?>[0]);Object connection=call(connectionStore,"read",new Class<?>[]{String.class},slot);
            Object api=apiClass.getConstructor(connectionClass).newInstance(connection);
            runOnMainSync(()->{try{speech=speechClass.getConstructor(Context.class).newInstance(context);}catch(Exception e){throw new RuntimeException(e);}});SystemClock.sleep(1500);
            runOnMainSync(()->call(speech,"play",new Class<?>[]{String.class,String.class,apiClass,boolean.class},"audio-cache-check","Bonjour. La voix OpenAI est prête sur la montre.",api,true));
            check("cachedOpenaiPlayback",waitState("PLAYING"));mainCall("pause");check("audioPaused","PAUSED".equals(state()));SystemClock.sleep(300);
            mainCall("resume");check("audioResumed","PLAYING".equals(state()));check("audioCompleted",waitState("IDLE"));
            runOnMainSync(()->call(speech,"play",new Class<?>[]{String.class,String.class,apiClass,boolean.class},"audio-fallback-check","Cette lecture utilise la voix de la montre.",api,true));
            check("quotaFallbackPlayback",waitState("PLAYING"));check("quotaFallbackExplained",notice().contains("Plafond"));mainCall("stop");
            check("returnedToAudioSettings",click("Voix et budget"));check("dollarUsageVisible",seek("CE MOIS-CI")!=null);
            screenshot=ui.takeScreenshot();try(FileOutputStream out=new FileOutputStream(new File(context.getFilesDir(),"watch-audio-budget.png"))){screenshot.compress(Bitmap.CompressFormat.PNG,100,out);}
            result.putString("status","audio_watch_checked");
        }catch(Exception e){result.putString("status","failed");result.putString("error",e.getMessage());
            if(ui!=null)try{AccessibilityNodeInfo root=ui.getRootInActiveWindow();result.putString("activePackage",root==null?"none":String.valueOf(root.getPackageName()));Bitmap screenshot=ui.takeScreenshot();try(FileOutputStream out=new FileOutputStream(new File(context.getFilesDir(),"watch-audio-failed.png"))){screenshot.compress(Bitmap.CompressFormat.PNG,100,out);}}catch(Exception ignored){}code=Activity.RESULT_CANCELED;}
        finally{
            if(speech!=null)mainCall("close");SharedPreferences.Editor edit=prefs.edit().clear();for(Map.Entry<String,?> item:before.entrySet())if(item.getValue() instanceof Boolean)edit.putBoolean(item.getKey(),(Boolean)item.getValue());edit.commit();
        }
        finish(code,result);
    }
}
