package fr.thomas.codexwatch.pairing;

import android.app.*;
import android.content.*;
import android.graphics.Rect;
import android.os.*;
import android.service.notification.StatusBarNotification;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.MotionEvent;
import android.view.InputDevice;
import android.view.inputmethod.InputMethodManager;
import java.util.UUID;
import org.json.JSONObject;

/** Temporary same-signature developer test. It touches only this app's notifications. */
public final class NotificationProbeInstrumentation extends Instrumentation {
    private Bundle args;
    private String expectedPrefix;
    private int textTop = -1;
    private AccessibilityNodeInfo replyAction(AccessibilityNodeInfo node) {
        if (node == null) return null;
        if (node.isVisibleToUser() && node.getText() != null && (node.getText().toString().equals("Répondre") || node.getText().toString().equals("Ajouter une consigne"))) return node;
        for (int i = 0; i < node.getChildCount(); i++) { AccessibilityNodeInfo found = replyAction(node.getChild(i)); if (found != null) return found; }
        return null;
    }
    private void swipeDownHistory(UiAutomation automation, Activity activity) {
        float x = activity.getResources().getDisplayMetrics().widthPixels / 2f;
        float height = activity.getResources().getDisplayMetrics().heightPixels;
        long down = SystemClock.uptimeMillis();
        for (int i = 0; i <= 8; i++) {
            MotionEvent motion = MotionEvent.obtain(down, SystemClock.uptimeMillis(), i == 0 ? MotionEvent.ACTION_DOWN : i == 8 ? MotionEvent.ACTION_UP : MotionEvent.ACTION_MOVE,
                x, height * (.78f - .48f * i / 8f), 0);
            motion.setSource(InputDevice.SOURCE_TOUCHSCREEN); automation.injectInputEvent(motion, true); motion.recycle(); SystemClock.sleep(25);
        }
    }
    @Override public void onCreate(Bundle arguments) { args = arguments; super.onCreate(arguments); start(); }
    private boolean visibleText(AccessibilityNodeInfo node) {
        if (node == null) return false;
        if (node.isVisibleToUser() && node.getText() != null && node.getText().toString().startsWith(expectedPrefix)) {
            Rect bounds = new Rect(); node.getBoundsInScreen(bounds); textTop = bounds.top; return true;
        }
        for (int i = 0; i < node.getChildCount(); i++) if (visibleText(node.getChild(i))) return true;
        return false;
    }
    @Override public void onStart() {
        Bundle result = new Bundle();
        int resultCode = Activity.RESULT_OK;
        Object reading = null; String readingKey = null, originalMarker = null;
        try {
            Context context = getTargetContext();
            String thread = args.getString("threadId");
            if (thread == null || !thread.matches("[a-zA-Z0-9-]{16,80}")) throw new IllegalArgumentException();
            expectedPrefix = new String(android.util.Base64.decode(args.getString("prefix"), android.util.Base64.DEFAULT), java.nio.charset.StandardCharsets.UTF_8);
            ClassLoader loader = context.getClassLoader();
            Class<?> connectionStore = loader.loadClass("fr.thomas.codexwatch.ConnectionStore");
            Object store = connectionStore.getConstructor(Context.class).newInstance(context);
            Object connection = connectionStore.getMethod("read", String.class).invoke(store, "pc");
            String url = (String) connection.getClass().getMethod("getUrl").invoke(connection);
            Class<?> readClass = loader.loadClass("fr.thomas.codexwatch.ReadStateStore");
            reading = readClass.getConstructor(Context.class).newInstance(context);
            readingKey = "pc\u0000" + url + "\u0000codex\u0000" + thread;
            originalMarker = (String) readClass.getMethod("read", String.class).invoke(reading, readingKey);
            readClass.getMethod("mark", String.class, String.class).invoke(reading, readingKey, "");
            Activity activity = startActivitySync(new Intent().setClassName(context, "fr.thomas.codexwatch.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            Class<?> alerts = loader.loadClass("fr.thomas.codexwatch.WatchAlerts");
            Object presenter = alerts.getField("INSTANCE").get(null);
            String id = "probe-" + UUID.randomUUID();
            JSONObject event = new JSONObject().put("id", id).put("threadId", thread).put("type", "test").put("kind", "codex");
            alerts.getMethod("show", Context.class, String.class, JSONObject.class).invoke(presenter, context, "pc", event);
            PendingIntent pending = null;
            for (StatusBarNotification notification : context.getSystemService(NotificationManager.class).getActiveNotifications())
                if (("pc:" + id).equals(notification.getTag())) pending = notification.getNotification().contentIntent;
            if (pending == null) throw new IllegalStateException("Own notification missing");
            // SystemUI normally auto-cancels a tapped notification. A raw send() does not;
            // cancel this test card first so Samsung's auto-details cannot cover the app.
            context.getSystemService(NotificationManager.class).cancel("pc:" + id, 0);
            pending.send();
            UiAutomation automation = getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
            boolean seen = false;
            for (int i = 0; i < 60 && !seen; i++) { SystemClock.sleep(100); seen = visibleText(automation.getRootInActiveWindow()); }
            result.putBoolean("correctChatIntent", thread.equals(activity.getIntent().getStringExtra("threadId")));
            result.putBoolean("latestMessageVisible", seen);
            result.putInt("latestMessageTop", textTop);
            AccessibilityNodeInfo active = automation.getRootInActiveWindow();
            result.putString("activeWindowPackage", active == null || active.getPackageName() == null ? "none" : active.getPackageName().toString());
            if ("true".equals(args.getString("checkEditor"))) {
                AccessibilityNodeInfo action = null;
                for (int i = 0; i < 5 && action == null; i++) {
                    action = replyAction(automation.getRootInActiveWindow());
                    if (action == null) { swipeDownHistory(automation, activity); SystemClock.sleep(250); }
                }
                while (action != null && !action.isClickable()) action = action.getParent();
                boolean clicked = action != null && action.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                boolean[] editor = {false};
                for (int i = 0; i < 30 && !editor[0] && clicked; i++) {
                    SystemClock.sleep(100);
                    runOnMainSync(() -> editor[0] = context.getSystemService(InputMethodManager.class).isAcceptingText());
                }
                result.putBoolean("replyActionClicked", clicked); result.putBoolean("editorInputConnected", editor[0]);
            }
            context.getSystemService(NotificationManager.class).cancel("pc:" + id, 0);
            result.putString("status", "checked");
        } catch (Exception error) {
            result.putString("status", "probe_failed"); result.putString("errorType", error.getClass().getSimpleName()); resultCode = Activity.RESULT_CANCELED;
        } finally {
            if (reading != null && readingKey != null && originalMarker != null) try {
                reading.getClass().getMethod("mark", String.class, String.class).invoke(reading, readingKey, originalMarker);
            } catch (Exception ignored) { }
        }
        finish(resultCode, result);
    }
}
