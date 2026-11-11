package fr.thomas.codexwatch.pairing;

import android.app.*;
import android.content.*;
import android.graphics.Rect;
import android.os.*;
import android.view.*;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.inputmethod.InputMethodManager;
import java.util.*;

/** Read-only UI walkthrough. Never presses Send, creates a task, or changes relay credentials. */
public final class NavigationProbeInstrumentation extends Instrumentation {
    private Bundle args;
    private UiAutomation ui;
    private Activity activity;
    private final Bundle results = new Bundle();
    @Override public void onCreate(Bundle input) { args = input; super.onCreate(input); start(); }
    private AccessibilityNodeInfo find(AccessibilityNodeInfo node, String label) {
        if (node == null) return null;
        if (node.isVisibleToUser() && (label.contentEquals(node.getText() == null ? "" : node.getText()) || label.contentEquals(node.getContentDescription() == null ? "" : node.getContentDescription()))) return node;
        for (int i=0; i<node.getChildCount(); i++) { AccessibilityNodeInfo found = find(node.getChild(i),label); if (found != null) return found; }
        return null;
    }
    private AccessibilityNodeInfo editable(AccessibilityNodeInfo node) {
        if (node == null) return null;
        if (node.isVisibleToUser() && node.isEditable()) return node;
        for (int i=0; i<node.getChildCount(); i++) { AccessibilityNodeInfo found = editable(node.getChild(i)); if (found != null) return found; }
        return null;
    }
    private AccessibilityNodeInfo waitFor(String text) {
        for (int i=0;i<150;i++) { AccessibilityNodeInfo node=find(ui.getRootInActiveWindow(),text); if(node!=null)return node; SystemClock.sleep(100); }
        return null;
    }
    private boolean click(String label) {
        AccessibilityNodeInfo node=waitFor(label);
        while(node!=null&&!node.isClickable())node=node.getParent();
        return node!=null&&node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
    }
    private void check(String name, boolean value) { results.putBoolean(name,value); if(!value)throw new IllegalStateException(name); }
    private void back() {
        sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);SystemClock.sleep(500);
    }
    private void swipe() {
        swipe(true);
    }
    private void swipe(boolean up) {
        long down=SystemClock.uptimeMillis();float x=activity.getResources().getDisplayMetrics().widthPixels/2f, h=activity.getResources().getDisplayMetrics().heightPixels;
        for(int i=0;i<=8;i++) { MotionEvent e=MotionEvent.obtain(down,SystemClock.uptimeMillis(),i==0?MotionEvent.ACTION_DOWN:i==8?MotionEvent.ACTION_UP:MotionEvent.ACTION_MOVE,x,h*(up ? .78f-.48f*i/8f : .30f+.48f*i/8f),0);
            e.setSource(InputDevice.SOURCE_TOUCHSCREEN);ui.injectInputEvent(e,true);e.recycle();SystemClock.sleep(25); }
        SystemClock.sleep(350);
    }
    private String decode(String key) { return new String(android.util.Base64.decode(args.getString(key),android.util.Base64.DEFAULT),java.nio.charset.StandardCharsets.UTF_8); }
    private void restore(SharedPreferences prefs, Map<String,?> before) {
        SharedPreferences.Editor editor=prefs.edit().clear();for(Map.Entry<String,?> item:before.entrySet())if(item.getValue() instanceof String)editor.putString(item.getKey(),(String)item.getValue());editor.commit();
    }
    @Override public void onStart() {
        Context context=getTargetContext();SharedPreferences navigation=context.getSharedPreferences("navigation",0),reading=context.getSharedPreferences("reading",0);
        Map<String,?> navBefore=new HashMap<>(navigation.getAll()),readBefore=new HashMap<>(reading.getAll());int code=Activity.RESULT_OK;
        try {
            navigation.edit().clear().commit();
            activity=startActivitySync(new Intent().setClassName(context,"fr.thomas.codexwatch.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
            ui=getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
            check("chatgptFromHome",click("ChatGPT"));check("chatgptListDirect",waitFor("Projets")!=null);
            check("searchOpenedInline",click("Rechercher une discussion"));
            AccessibilityNodeInfo field=null;for(int i=0;i<30&&field==null;i++){field=editable(ui.getRootInActiveWindow());SystemClock.sleep(100);}
            Bundle input=new Bundle();input.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,"__nav_missing_2026__");
            check("searchInputAccepted",field!=null&&field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,input));
            boolean empty=false;for(int i=0;i<150&&!empty;i++){AccessibilityNodeInfo root=ui.getRootInActiveWindow();empty=find(root,"Aucun titre trouvé. Essaie un autre mot.")!=null||find(root,"Aucun titre sur cette page. Voir plus pour continuer.")!=null;if(i==30||i==60)swipe();SystemClock.sleep(100);}
            check("emptySearchShown",empty);
            runOnMainSync(()->context.getSystemService(InputMethodManager.class).hideSoftInputFromWindow(activity.getWindow().getDecorView().getWindowToken(),0));
            SystemClock.sleep(500);back();
            for(int i=0;i<6&&find(ui.getRootInActiveWindow(),"Projets")==null;i++)swipe(false);
            int searchBackSteps=1;
            if(find(ui.getRootInActiveWindow(),"Rechercher un titre")!=null){back();searchBackSteps++;SystemClock.sleep(500);}
            results.putInt("searchBackSteps",searchBackSteps);
            results.putBoolean("searchFieldStillVisible",find(ui.getRootInActiveWindow(),"Rechercher un titre")!=null);
            results.putBoolean("projectControlVisible",find(ui.getRootInActiveWindow(),"Projets")!=null);
            check("backClosesSearch",waitFor("Projets")!=null&&find(ui.getRootInActiveWindow(),"Rechercher un titre")==null);
            String title=decode("title");AccessibilityNodeInfo target=null;
            for(int i=0;i<6&&target==null;i++){target=find(ui.getRootInActiveWindow(),title);if(target==null){swipe();SystemClock.sleep(300);}}
            check("existingChatFound",target!=null);Rect before=new Rect();target.getBoundsInScreen(before);
            check("existingChatOpened",click(title));check("replyVisibleWithoutScrolling",waitFor("Répondre")!=null);
            back();target=waitFor(title);check("backReturnsToList",target!=null&&find(ui.getRootInActiveWindow(),"Répondre")==null);
            Rect after=new Rect();target.getBoundsInScreen(after);results.putInt("returnPositionDelta",Math.abs(before.top-after.top));check("listPositionRestored",Math.abs(before.top-after.top)<=45);
            back();check("resumeOnHome",waitFor("REPRENDRE")!=null);
            check("codexFromHome",click("Codex"));check("codexListDirect",waitFor("Projets")!=null);
            check("projectPickerInline",click("Projets")&&waitFor("CHOISIR UN PROJET")!=null);
            String project=decode("project");for(int i=0;i<6&&find(ui.getRootInActiveWindow(),project)==null;i++)swipe();
            check("projectSelected",click(project));check("projectStaysInList",waitFor("Changer")!=null);
            check("newEditorDirect",click("Nouvelle discussion"));
            boolean[] connected={false};for(int i=0;i<40&&!connected[0];i++){SystemClock.sleep(100);runOnMainSync(()->connected[0]=context.getSystemService(InputMethodManager.class).isAcceptingText());}
            check("editorInputConnected",connected[0]);
            runOnMainSync(()->{activity.getCurrentFocus();context.getSystemService(InputMethodManager.class).hideSoftInputFromWindow(activity.getWindow().getDecorView().getWindowToken(),0);});
            SystemClock.sleep(350);back();if(find(ui.getRootInActiveWindow(),"Ta demande")!=null)back();check("editorBackKeepsProject",waitFor("Changer")!=null);
            results.putString("status","navigation_checked");
        } catch(Exception error) { results.putString("status","failed");results.putString("failedCheck",error.getMessage());code=Activity.RESULT_CANCELED; }
        finally { restore(navigation,navBefore);restore(reading,readBefore); }
        finish(code,results);
    }
}
