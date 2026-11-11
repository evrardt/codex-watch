package fr.thomas.codexwatch

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.*
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.util.concurrent.ConcurrentHashMap

object DirectNotifications {
    var enabled by mutableStateOf(false)
    var status by mutableStateOf("Alertes directes désactivées")
    var connectedSlots by mutableStateOf(emptySet<String>())
    fun prefs(context: Context) = context.getSharedPreferences("direct_notifications", Context.MODE_PRIVATE)
    fun allowed(context: Context) = Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    fun enable(context: Context) {
        check(allowed(context)) { "Autoriser les notifications dans Android" }
        check(listOf("pc", "server").any { runCatching { ConnectionStore(context).read(it).token.isNotBlank() }.getOrDefault(false) }) { "Associer un relais avant d’activer les alertes" }
        prefs(context).edit().putBoolean("enabled", true).putBoolean("user_disabled", false).commit(); enabled = true; status = "Connexion au relais…"
        refresh(context)
    }
    fun refresh(context: Context) {
        if (enabled && allowed(context)) context.startForegroundService(Intent(context, DirectNotificationService::class.java))
    }
    fun disable(context: Context, userInitiated: Boolean = true) {
        prefs(context).edit().putBoolean("enabled", false).apply { if (userInitiated) putBoolean("user_disabled", true) }.commit(); enabled = false; connectedSlots = emptySet(); status = "Alertes directes désactivées"
        context.stopService(Intent(context, DirectNotificationService::class.java))
    }
    fun notify(context: Context, profile: String, event: JSONObject) {
        if (!allowed(context)) return
        val eventId = event.getString("id")
        val title = when (event.optString("type")) {
            "completed" -> "Tâche terminée"
            "failed" -> "La tâche a rencontré une erreur"
            "interrupted" -> "Tâche interrompue"
            "approval", "attention" -> "Codex attend ton attention"
            "test" -> "Notification de test"
            else -> "Codex a été mis à jour"
        }
        val target = Intent(context, MainActivity::class.java).putExtra("event_id", eventId)
            .putExtra("threadId", event.optString("threadId")).putExtra("kind", event.optString("kind", "codex"))
            .putExtra("profile", profile).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pending = PendingIntent.getActivity(context, (profile + eventId).hashCode(), target, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        context.getSystemService(NotificationManager::class.java).notify("$profile:$eventId", 0, Notification.Builder(context, "tasks")
            .setSmallIcon(R.drawable.ic_watch).setContentTitle(title)
            .setContentText(if (event.optString("type") == "test") "La liaison directe fonctionne." else "${if (profile == "pc") "Mon PC" else "Mon serveur"} · toucher pour ouvrir")
            .setContentIntent(pending).setAutoCancel(true).setOnlyAlertOnce(true).build())
    }
}

class DirectNotificationService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val sockets = ConcurrentHashMap<String, HttpURLConnection>()
    private val jobs = mutableListOf<Job>()
    private val links = mutableMapOf<String, Boolean>()
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "stop") { DirectNotifications.disable(this); return START_NOT_STICKY }
        if (!DirectNotifications.enabled || !DirectNotifications.allowed(this)) { stopSelf(); return START_NOT_STICKY }
        if (Build.VERSION.SDK_INT >= 34) startForeground(7301, connectionNotice(), ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
        else startForeground(7301, connectionNotice())
        jobs.forEach { it.cancel() }; sockets.values.forEach { it.disconnect() }; links.clear(); DirectNotifications.connectedSlots = emptySet()
        val profiles = listOf("pc", "server").mapNotNull { slot -> runCatching { ConnectionStore(this).read(slot) }.getOrNull() }
            .filter { it.token.isNotBlank() }.distinctBy { it.url }
        if (profiles.isEmpty()) { DirectNotifications.disable(this, userInitiated = false); return START_NOT_STICKY }
        jobs.clear()
        for (profile in profiles) {
            jobs += scope.launch(Dispatchers.IO) { listen(profile) }
            if(profile.transportMode=="auto"&&profile.bluetoothAddress.isNotBlank()) jobs += scope.launch(Dispatchers.IO) {
                while(isActive) {
                    try { BridgeApi(profile.copy(transportMode="bluetooth")).health(timeoutMs=10000,markStatus=false) }
                    catch(e:CancellationException){throw e} catch(_:Exception){}
                    delay(20000)
                }
            }
        }
        return START_STICKY
    }
    private fun connectionNotice(): Notification {
        val open = PendingIntent.getActivity(this, 7301, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(this, 7302, Intent(this, DirectNotificationService::class.java).setAction("stop"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return Notification.Builder(this, "link").setSmallIcon(R.drawable.ic_watch).setContentTitle("Codex Watch · alertes")
            .setContentText(DirectNotifications.status).setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
            .addAction(Notification.Action.Builder(null, "Désactiver", stop).build()).build()
    }
    private suspend fun link(slot: String, connected: Boolean) = withContext(Dispatchers.Main) {
        links[slot] = connected
        DirectNotifications.connectedSlots = links.filterValues { it }.keys.toSet()
        val count = links.values.count { it }
        DirectNotifications.status = if (count > 0) "$count relais connecté${if (count > 1) "s" else ""} · alertes directes" else "Reconnexion au relais…"
        getSystemService(NotificationManager::class.java).notify(7301, connectionNotice())
    }
    private suspend fun listen(profile: Connection) {
        val prefs = DirectNotifications.prefs(this)
        val cursorKey = ReadStateStore.digest(profile.slot + "\u0000" + profile.url)
        var retry = 2000L
        var failedTransport:String?=null
        while (currentCoroutineContext().isActive) {
            var socket: HttpURLConnection? = null
            val candidates=transportOrder(profile.transportMode,profile.bluetoothAddress.isNotBlank(),BluetoothTunnel.connected(profile))
            val transport=if(profile.transportMode=="auto"&&candidates.size>1&&failedTransport!=null)candidates.firstOrNull{it!=failedTransport}?:candidates.first() else candidates.first()
            try {
                val base=if(transport=="bluetooth")BluetoothTunnel.bluetoothBase(profile) else ConnectionStore.normalizeUrl(profile.url)
                val connection = URI(base + "/v1/events/stream").toURL().openConnection() as HttpURLConnection
                socket = connection
                connection.instanceFollowRedirects = false; connection.connectTimeout = 12000; connection.readTimeout = 130000
                connection.setRequestProperty("Authorization", "Bearer ${profile.token}")
                connection.setRequestProperty("Accept", "text/event-stream")
                prefs.getString(cursorKey, null)?.let { connection.setRequestProperty("Last-Event-ID", it) }
                sockets[profile.slot] = connection
                check(connection.responseCode == 200 && connection.contentType.orEmpty().startsWith("text/event-stream")) { "Liaison indisponible" }
                ConnectionStatus.success(profile,transport);failedTransport=null
                link(profile.slot, true); retry = 2000
                val decoder = EventDecoder()
                connection.inputStream.bufferedReader(Charsets.UTF_8).use { reader ->
                    while (currentCoroutineContext().isActive) {
                        val line = reader.readLine() ?: break
                        val frame = decoder.line(line) ?: continue
                        val data = JSONObject(frame.data)
                        if (frame.event == "task") {
                            val eventId = data.getString("id")
                            if (eventId != prefs.getString(cursorKey, "")) WatchAlerts.show(this, profile.slot, data)
                            check(prefs.edit().putString(cursorKey, eventId).commit())
                        } else if (frame.event == "checkpoint") check(prefs.edit().putString(cursorKey, data.getString("cursor")).commit())
                    }
                }
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { /* Tokens and server responses never enter logs or notifications. */ }
            finally { socket?.disconnect(); if (socket != null) sockets.remove(profile.slot, socket) }
            failedTransport=transport
            link(profile.slot, false)
            delay(retry); retry = minOf(retry * 2, 60000)
        }
    }
    override fun onDestroy() {
        DirectNotifications.connectedSlots = emptySet()
        scope.cancel(); sockets.values.forEach { it.disconnect() }; sockets.clear()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}

class NotificationBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action in listOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED)) runCatching { DirectNotifications.refresh(context) }
    }
}

internal data class EventFrame(val event: String, val data: String)
internal class EventDecoder {
    private var event = ""
    private val data = StringBuilder()
    fun line(line: String): EventFrame? {
        if (line.isEmpty()) {
            val result = if (data.isNotEmpty()) EventFrame(event, data.toString().removeSuffix("\n")) else null
            event = ""; data.clear(); return result
        }
        if (line.startsWith("event:")) event = line.substring(6).trim().take(64)
        if (line.startsWith("data:")) { check(data.length + line.length <= 16384); data.append(line.substring(5).removePrefix(" ")).append('\n') }
        return null
    }
}
