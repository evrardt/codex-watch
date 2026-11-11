package fr.thomas.codexwatch.pairing;

import android.app.*;
import android.content.*;
import android.graphics.*;
import android.os.*;
import android.view.*;
import android.view.accessibility.AccessibilityNodeInfo;
import java.util.*;
import java.io.*;

/** Confirms an existing human message is visible. No Send action and no synthetic chat. */
public final class RenderProbeInstrumentation extends Instrumentation {
    private Bundle args;
    private UiAutomation ui;
    private Activity activity;
    @Override public void onCreate(Bundle input){args=input;super.onCreate(input);start();}
    private AccessibilityNodeInfo find(AccessibilityNodeInfo node,String value){
        if(node==null)return null;
        if(node.isVisibleToUser()&&node.getText()!=null&&value.contentEquals(node.getText()))return node;
        for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo found=find(node.getChild(i),value);if(found!=null)return found;}return null;
    }
    private AccessibilityNodeInfo scroller(AccessibilityNodeInfo node){if(node==null)return null;if(node.isScrollable())return node;for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo found=scroller(node.getChild(i));if(found!=null)return found;}return null;}
    private void drag(float delta){
        float x=activity.getResources().getDisplayMetrics().widthPixels/2f,h=activity.getResources().getDisplayMetrics().heightPixels;
        float start=delta>0?h*.28f:h*.72f;long down=SystemClock.uptimeMillis();
        for(int i=0;i<=8;i++){MotionEvent event=MotionEvent.obtain(down,SystemClock.uptimeMillis(),i==0?MotionEvent.ACTION_DOWN:i==8?MotionEvent.ACTION_UP:MotionEvent.ACTION_MOVE,x,start+delta*i/8f,0);
            event.setSource(InputDevice.SOURCE_TOUCHSCREEN);ui.injectInputEvent(event,true);event.recycle();SystemClock.sleep(25);}SystemClock.sleep(250);
    }
    private void restore(SharedPreferences prefs,Map<String,?> before){SharedPreferences.Editor editor=prefs.edit().clear();for(Map.Entry<String,?> e:before.entrySet())if(e.getValue() instanceof String)editor.putString(e.getKey(),(String)e.getValue());editor.commit();}
    @Override public void onStart(){
        Context context=getTargetContext();SharedPreferences reading=context.getSharedPreferences("reading",0),nav=context.getSharedPreferences("navigation",0);
        Map<String,?> readBefore=new HashMap<>(reading.getAll()),navBefore=new HashMap<>(nav.getAll());Bundle result=new Bundle();int code=Activity.RESULT_OK;
        try{
            String thread=args.getString("threadId"),expected=new String(android.util.Base64.decode(args.getString("text"),android.util.Base64.DEFAULT),java.nio.charset.StandardCharsets.UTF_8);
            if(thread==null||!thread.matches("[a-zA-Z0-9-]{16,80}"))throw new IllegalArgumentException();
            Intent target=new Intent().setClassName(context,"fr.thomas.codexwatch.MainActivity").putExtra("event_id","render-check").putExtra("profile","pc").putExtra("kind","codex").putExtra("threadId",thread).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK);
            activity=startActivitySync(target);ui=getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);SystemClock.sleep(2500);
            AccessibilityNodeInfo list=scroller(ui.getRootInActiveWindow());Bundle position=new Bundle();position.putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_ROW_INT,Integer.parseInt(args.getString("row")));position.putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_COLUMN_INT,0);
            result.putBoolean("accessiblePositionRequest",list!=null&&list.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_TO_POSITION.getId(),position));SystemClock.sleep(500);
            AccessibilityNodeInfo found=null;int scrolls=0;float h=activity.getResources().getDisplayMetrics().heightPixels;
            for(int i=0;i<60&&found==null;i++){found=find(ui.getRootInActiveWindow(),expected);if(found==null){drag(h*.42f);scrolls++;}}
            result.putBoolean("userTextUnchanged",found!=null);result.putInt("historyScrolls",scrolls);
            if(found==null)throw new IllegalStateException("Existing watch message not visible");
            for(int i=0;i<8;i++){found=find(ui.getRootInActiveWindow(),expected);if(found==null)break;Rect bounds=new Rect();found.getBoundsInScreen(bounds);float delta=Math.max(-h*.42f,Math.min(h*.42f,h*.45f-bounds.top));if(Math.abs(delta)<=15)break;drag(delta);}
            result.putBoolean("userRoleVisible",find(ui.getRootInActiveWindow(),"TOI")!=null);
            result.putBoolean("receiptLabelVisible",find(ui.getRootInActiveWindow(),"Depuis la montre · transmise au PC")!=null);
            if(!result.getBoolean("userRoleVisible")||!result.getBoolean("receiptLabelVisible"))throw new IllegalStateException("User bubble label outside viewport");
            Bitmap screenshot=ui.takeScreenshot();try(FileOutputStream out=new FileOutputStream(new File(context.getFilesDir(),"watch-render-check.png"))){screenshot.compress(Bitmap.CompressFormat.PNG,100,out);}
            result.putString("status","render_checked");
        }catch(Exception error){result.putString("status","failed");result.putString("error",error.getMessage());code=Activity.RESULT_CANCELED;}
        finally{restore(reading,readBefore);restore(nav,navBefore);}finish(code,result);
    }
}
