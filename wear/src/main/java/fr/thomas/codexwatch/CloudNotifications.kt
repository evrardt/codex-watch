package fr.thomas.codexwatch

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.*
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

object CloudNotifications {
    var enabled by mutableStateOf(false)
    var status by mutableStateOf("Notifications FCM désactivées")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val registering = mutableSetOf<String>()
    private val registeredAt = ConcurrentHashMap<String, Long>()
    private fun prefs(context: Context) = context.getSharedPreferences("cloud_notifications", Context.MODE_PRIVATE)
    private fun routeKey(connection: Connection) = ReadStateStore.digest(connection.slot + "\u0000" + connection.url)
    private fun registrationKey(connection: Connection) = connection.slot + "\u0000" + connection.url
    fun reconcile(context: Context) {
        if (!enabled || !DirectNotifications.allowed(context)) return
        val store = ConnectionStore(context)
        val routes = listOf("pc", "server").filter { store.isConfigured(it) }.map { slot ->
            val c = runCatching { store.read(slot) }.getOrNull()
            if (c == null || c.token.isBlank()) AlertRouteCoverage(false, false)
            else AlertRouteCoverage(c.bluetoothAddress.isNotBlank() && c.transportMode != "internet", prefs(context).getBoolean("verified:${routeKey(c)}", false))
        }
        if (needsDirectAlertCoverage(routes)) {
            if (!DirectNotifications.enabled && !DirectNotifications.prefs(context).getBoolean("user_disabled", false))
                runCatching { DirectNotifications.enable(context) }
        } else if (routes.isNotEmpty() && DirectNotifications.enabled) DirectNotifications.disable(context, userInitiated = false)
    }
    private fun initialize(context: Context, config: JSONObject) {
        val options = FirebaseOptions.Builder().setApplicationId(config.getString("appId")).setApiKey(config.getString("apiKey"))
            .setProjectId(config.getString("projectId")).setGcmSenderId(config.getString("senderId")).build()
        val existing = FirebaseApp.getApps(context).firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }
        require(existing == null || existing.options.applicationId == options.applicationId) { "Le PC et le serveur doivent utiliser le même projet de notifications" }
        if (existing == null) FirebaseApp.initializeApp(context, options)
        prefs(context).edit().putString("firebase", config.toString()).apply()
    }
    fun restore(context: Context) {
        enabled = prefs(context).getBoolean("enabled", false)
        val saved = prefs(context).getString("firebase", null)
        if (enabled && saved != null) runCatching {
            initialize(context, JSONObject(saved)); FirebaseMessaging.getInstance().isAutoInitEnabled = true
            if (prefs(context).getBoolean("confirmed", false)) {
                status = "Alertes FCM activées"
            } else status = "FCM enregistré · réception à vérifier"
        }.onFailure { status = "Notifications à reconnecter" }
        reconcile(context)
    }
    fun register(context: Context, connection: Connection, health: JSONObject, onStatus: (String) -> Unit = {}) {
        if (!DirectNotifications.allowed(context)) { onStatus("Autoriser les notifications dans Android"); return }
        val config = health.optJSONObject("firebase")
        if (!health.optBoolean("push") || config == null) { onStatus("L’envoi FCM doit être activé sur le relais"); return }
        val registrationKey = registrationKey(connection)
        if (enabled && System.currentTimeMillis() - (registeredAt[registrationKey] ?: 0) < 300000) { reconcile(context); return }
        if (!registering.add(registrationKey)) return
        status = "Connexion aux notifications FCM…"
        try {
            initialize(context, config)
            FirebaseMessaging.getInstance().isAutoInitEnabled = true
            FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                scope.launch {
                    try {
                        check(prefs(context).edit().putBoolean("enabled", true).commit()); enabled = true
                        BridgeApi(connection).request("/v1/devices", "POST", JSONObject().put("token", token).put("profile", connection.slot))
                        registeredAt[registrationKey] = System.currentTimeMillis()
                        status = if (prefs(context).getBoolean("confirmed", false)) "Alertes FCM activées" else "FCM enregistré · réception à vérifier"
                        onStatus("")
                        reconcile(context)
                        registerOtherProfiles(context, connection.slot, token, config.getString("appId"))
                    } catch (_: Exception) { status = "Enregistrement FCM à réessayer"; onStatus(status) }
                    finally { registering.remove(registrationKey) }
                }
            }.addOnFailureListener {
                registering.remove(registrationKey); status = "Connexion au service Google à réessayer"; onStatus(status)
            }
        } catch (e: Exception) { registering.remove(registrationKey); status = e.message ?: "Configuration des notifications à vérifier"; onStatus(status) }
    }
    private suspend fun registerOtherProfiles(context: Context, current: String?, token: String, appId: String) {
        for (slot in listOf("pc", "server").filter { it != current }) try {
            val connection = ConnectionStore(context).read(slot)
            if (connection.token.isBlank()) continue
            val health = BridgeApi(connection).health()
            if (health.optBoolean("push") && health.optJSONObject("firebase")?.optString("appId") == appId) {
                BridgeApi(connection).request("/v1/devices", "POST", JSONObject().put("token", token).put("profile", slot))
                registeredAt[registrationKey(connection)] = System.currentTimeMillis()
            }
        } catch (_: Exception) { /* The next connection retries an unavailable profile. */ }
    }
    fun newToken(context: Context, token: String) {
        val preferences = prefs(context); val tokenHash = ReadStateStore.digest(token)
        if (preferences.getString("token_hash", "") != tokenHash) {
            val editor = preferences.edit().putString("token_hash", tokenHash).putBoolean("confirmed", false)
            preferences.all.keys.filter { it.startsWith("verified:") }.forEach { editor.remove(it) }
            editor.apply(); registeredAt.clear(); reconcile(context)
        }
        if (!enabled) return
        val saved = prefs(context).getString("firebase", null) ?: return
        scope.launch { registerOtherProfiles(context, null, token, JSONObject(saved).getString("appId")) }
    }
    fun confirmReceived(context: Context, profile: String) {
        val connection = runCatching { ConnectionStore(context).read(profile) }.getOrNull()
        val editor = prefs(context).edit().putBoolean("confirmed", true)
        if (connection != null && connection.token.isNotBlank() && registeredAt.containsKey(registrationKey(connection)))
            editor.putBoolean("verified:${routeKey(connection)}", true)
        editor.apply()
        status = "Alertes FCM activées"
        reconcile(context)
    }
    fun disable(context: Context) {
        val preferences = prefs(context);val editor = preferences.edit().putBoolean("enabled", false).putBoolean("confirmed", false)
        preferences.all.keys.filter { it.startsWith("verified:") }.forEach { editor.remove(it) }
        editor.apply(); enabled = false; registeredAt.clear(); status = "Notifications désactivées"
        if (FirebaseApp.getApps(context).none { it.name == FirebaseApp.DEFAULT_APP_NAME }) return
        FirebaseMessaging.getInstance().isAutoInitEnabled = false
        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            scope.launch {
                for (slot in listOf("pc", "server")) try {
                    val connection = ConnectionStore(context).read(slot)
                    if (connection.token.isNotBlank()) BridgeApi(connection).request("/v1/devices", "DELETE", JSONObject().put("token", token).put("profile", slot))
                } catch (_: Exception) { /* Delivery is also blocked locally while disabled. */ }
            }
        }
    }
}

class WatchMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) { CloudNotifications.newToken(applicationContext, token) }
    override fun onMessageReceived(message: RemoteMessage) {
        if (!CloudNotifications.enabled) return
        val eventId = message.data["eventId"] ?: return
        val profile = message.data["profile"]?.takeIf { it in listOf("pc", "server") } ?: return
        val event = JSONObject().put("id", eventId).put("type", message.data["type"] ?: "attention")
            .put("threadId", message.data["threadId"].orEmpty()).put("kind", message.data["kind"] ?: "codex")
            .put("title", message.data["title"].orEmpty()).put("preview", message.data["preview"].orEmpty()).put("target",message.data["target"].orEmpty())
        // Render immediately; no history fetch or background activity launch is required.
        WatchAlerts.show(applicationContext, profile, event)
        CloudNotifications.confirmReceived(applicationContext, profile)
    }
}
