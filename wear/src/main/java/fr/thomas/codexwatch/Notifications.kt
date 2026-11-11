package fr.thomas.codexwatch

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

class WatchApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        BluetoothTunnel.init(this)
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("tasks", "Tâches et réponses", NotificationManager.IMPORTANCE_DEFAULT).apply { enableVibration(true) })
        manager.createNotificationChannel(NotificationChannel("dictation_silent", "Réponses dictées en lecture", NotificationManager.IMPORTANCE_LOW).apply { setSound(null,null); enableVibration(false) })
        manager.createNotificationChannel(NotificationChannel("link", "Connexion aux relais", NotificationManager.IMPORTANCE_LOW))
        DictationAlertFallback.recover(this)
        DirectNotifications.enabled = DirectNotifications.prefs(this).getBoolean("enabled", false)
        CloudNotifications.restore(this)
        // A relay without independently confirmed FCM still needs direct listening.
        CloudNotifications.reconcile(this)
    }
}
