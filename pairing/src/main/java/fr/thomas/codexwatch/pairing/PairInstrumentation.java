package fr.thomas.codexwatch.pairing;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import org.json.JSONObject;
import java.io.File;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/** Temporary same-signature instrumentation. No launcher and no plaintext credential output. */
public final class PairInstrumentation extends Instrumentation {
    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }
    @Override public void onStart() {
        Bundle result = new Bundle();
        File inputFile = new File(getTargetContext().getFilesDir(), "pairing.json");
        HttpURLConnection connection = null;
        String stage = "read";
        try {
            JSONObject input = new JSONObject(new String(Files.readAllBytes(inputFile.toPath()), StandardCharsets.UTF_8));
            if (!inputFile.delete()) throw new IllegalStateException();
            String url = input.getString("url"), token = input.getString("token"), slot = input.optString("slot", "pc");
            if (input.optBoolean("foreground", false)) {
                stage = "foreground";
                Intent launch = getTargetContext().getPackageManager().getLaunchIntentForPackage(getTargetContext().getPackageName());
                if (launch == null) throw new IllegalStateException();
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivitySync(launch);
                Thread.sleep(800);
            }
            Class<?> storeClass = getTargetContext().getClassLoader().loadClass("fr.thomas.codexwatch.ConnectionStore");
            Object store = storeClass.getConstructor(Context.class).newInstance(getTargetContext());
            // The installed application's normal URL validation and Keystore encryption are reused.
            stage = "https";
            connection = (HttpURLConnection) URI.create(url + "/v1/health").toURL().openConnection();
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(20000);
            connection.setRequestProperty("Authorization", "Bearer " + token);
            int code = connection.getResponseCode();
            result.putInt("http", code);
            if (code != 200) throw new IllegalStateException();
            JSONObject health;
            try (java.io.InputStream stream = connection.getInputStream()) {
                health = new JSONObject(new String(stream.readAllBytes(), StandardCharsets.UTF_8));
            }
            if (!health.optBoolean("codex") || health.optBoolean("demo")) throw new IllegalStateException();
            stage = "save";
            storeClass.getMethod("save", String.class, String.class, String.class).invoke(store, slot, url, token);
            if (input.optBoolean("select", true)) storeClass.getMethod("select", String.class).invoke(store, slot);
            result.putString("status", "paired"); result.putBoolean("codex", true);
            result.putBoolean("chat", health.optBoolean("chat")); result.putBoolean("push", health.optBoolean("push"));
            finish(Activity.RESULT_OK, result);
        } catch (Exception error) {
            inputFile.delete(); result.putString("status", "pairing_failed"); result.putString("stage", stage); result.putString("error_type", error.getClass().getSimpleName()); finish(Activity.RESULT_CANCELED, result);
        } finally { if (connection != null) connection.disconnect(); }
    }
}
