package fr.thomas.codexwatch

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

object WatchAlerts {
    fun show(context: Context, profile: String, event: JSONObject) {
        val id=event.optString("id");if(id.isBlank())return
        if(DictationAlerts.gate.route("$profile:$id",profile,event.optString("kind","codex"),event.optString("threadId"),event.optString("type"),protect={DictationAlertFallback.arm(context,profile,event)}) { silent ->
            showNow(context.applicationContext,profile,event,silent);DictationAlertFallback.cancel(context,profile,id)
        })return
        showNow(context,profile,event,false)
    }
    internal fun showFallback(context:Context,profile:String,event:JSONObject) = showNow(context,profile,event,false)
    @Synchronized private fun showNow(context: Context, profile: String, event: JSONObject, silent:Boolean) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val eventId = event.getString("id")
        val seenKey = "$profile:$eventId"
        val prefs = context.getSharedPreferences("delivered_alerts", Context.MODE_PRIVATE)
        val seen = runCatching { JSONArray(prefs.getString("ids", "[]")) }.getOrDefault(JSONArray())
        val ids = (0 until seen.length()).map { seen.getString(it) }
        if (seenKey in ids) return
        val status = when (event.optString("type")) {
            "completed" -> "Tâche terminée"
            "failed" -> "La tâche a rencontré une erreur"
            "interrupted" -> "Tâche interrompue"
            "approval", "attention" -> "Codex attend ton attention"
            "test" -> "Notification de test"
            else -> "Codex a été mis à jour"
        }
        val title = event.optString("title").ifBlank { status }
        val preview = event.optString("preview").ifBlank {
            when (event.optString("type")) {
                "completed" -> "Ouvre la conversation pour lire le résultat."
                "failed" -> "Ouvre la conversation pour consulter l’erreur."
                "test" -> "Toucher pour vérifier l’ouverture."
                else -> "Ouvre la conversation pour retrouver les détails."
            }
        }
        val body = if (title == status) preview else "$status\n$preview"
        val target = Intent(context, MainActivity::class.java).setAction("fr.thomas.codexwatch.OPEN_CHAT")
            .setData(Uri.parse("codexwatch://notification/${Uri.encode(profile)}/${Uri.encode(eventId)}"))
            .putExtra("event_id", eventId).putExtra("threadId", event.optString("threadId"))
            .putExtra("kind", event.optString("kind", "codex")).putExtra("profile", profile)
            .putExtra("focusRequest", event.optString("target") == "requests")
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pending = PendingIntent.getActivity(context, 0, target, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, if(silent) "dictation_silent" else "tasks").setSmallIcon(R.drawable.ic_watch)
            .setContentTitle(title).setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setSubText(if (profile == "pc") "Mon PC" else "Mon serveur")
            .setContentIntent(pending).setAutoCancel(true).setOnlyAlertOnce(true).setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setSilent(silent)
            .extend(NotificationCompat.WearableExtender().setHintContentIntentLaunchesActivity(true).setContentIntentAvailableOffline(true))
            .build()
        try { NotificationManagerCompat.from(context).notify(seenKey, 0, notification) }
        catch (_: SecurityException) { return }
        prefs.edit().putString("ids", JSONArray((ids + seenKey).takeLast(256)).toString()).apply()
    }
}
