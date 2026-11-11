package fr.thomas.codexwatch

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import org.json.JSONObject

/** Durable audible fallback if the app dies before it can confirm playback. */
internal object DictationAlertFallback {
    private fun prefs(context:Context)=context.getSharedPreferences("dictation_alert_fallback",Context.MODE_PRIVATE)
    private fun key(profile:String,id:String)=ReadStateStore.digest("$profile\u0000$id")
    private fun intent(context:Context,profile:String,id:String):PendingIntent {
        val target=Intent(context,DictationAlertReceiver::class.java)
            .setData(Uri.parse("codexwatch://dictation-alert/${Uri.encode(profile)}/${Uri.encode(id)}"))
            .putExtra("profile",profile).putExtra("eventId",id)
        return PendingIntent.getBroadcast(context,0,target,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    @Synchronized fun arm(context:Context,profile:String,event:JSONObject):Boolean {
        val id=event.optString("id");if(id.isBlank())return false
        val key=key(profile,id)
        val payload=JSONObject().put("profile",profile).put("event",event).toString()
        if(!prefs(context).edit().putString(key,payload).commit())return false
        return try {
            context.getSystemService(AlarmManager::class.java).setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,SystemClock.elapsedRealtime()+12000L,intent(context,profile,id))
            true
        } catch(_:Exception) { prefs(context).edit().remove(key).commit();false }
    }
    @Synchronized fun cancel(context:Context,profile:String,id:String) {
        prefs(context).edit().remove(key(profile,id)).commit()
        context.getSystemService(AlarmManager::class.java).cancel(intent(context,profile,id))
    }
    @Synchronized fun deliver(context:Context,profile:String,id:String) {
        val name=key(profile,id);val raw=prefs(context).getString(name,null) ?: return
        val event=runCatching{JSONObject(raw).getJSONObject("event")}.getOrNull()
        if(event!=null)WatchAlerts.showFallback(context,profile,event)
        prefs(context).edit().remove(name).commit()
    }
    @Synchronized fun recover(context:Context) {
        for(raw in prefs(context).all.values.filterIsInstance<String>()) {
            val payload=runCatching{JSONObject(raw)}.getOrNull() ?: continue
            val profile=payload.optString("profile");val event=payload.optJSONObject("event") ?: continue
            val id=event.optString("id");if(profile !in listOf("pc","server")||id.isBlank())continue
            deliver(context,profile,id);context.getSystemService(AlarmManager::class.java).cancel(intent(context,profile,id))
        }
    }
}

class DictationAlertReceiver:BroadcastReceiver() {
    override fun onReceive(context:Context,intent:Intent) {
        val profile=intent.getStringExtra("profile")?.takeIf{it in listOf("pc","server")} ?: return
        val id=intent.getStringExtra("eventId").orEmpty();if(id.isBlank())return
        DictationAlertFallback.deliver(context,profile,id)
    }
}
