package fr.thomas.codexwatch

import android.content.Context
import java.security.MessageDigest
import java.math.BigDecimal
import java.math.RoundingMode

/** Device choice is separate for each relay. The dollar allowance is enforced on that relay. */
class AudioSettingsStore(context: Context) {
    private val prefs = context.getSharedPreferences("audio_settings", Context.MODE_PRIVATE)
    private fun key(connection: Connection) = MessageDigest.getInstance("SHA-256")
        .digest("${connection.slot}\u0000${connection.url}".toByteArray()).joinToString("") { "%02x".format(it) }
    fun mode(connection: Connection): String = prefs.getString("mode:" + key(connection), null)
        ?: if (prefs.getBoolean(key(connection), false)) "openai" else "watch"
    fun select(connection: Connection, mode: String) {
        require(mode in listOf("watch", "openai", "phonon"))
        prefs.edit().putString("mode:" + key(connection), mode).apply()
    }
    fun speed(connection: Connection, mode: String): Float = prefs.getFloat("speed:$mode:" + key(connection), 1f)
    fun saveSpeeds(connection: Connection, speeds: org.json.JSONObject?) {
        if (speeds == null) return
        val edit=prefs.edit()
        for (mode in listOf("watch", "openai", "phonon")) {
            val value=speeds.optDouble(mode, 1.0).toFloat()
            if(value in .75f..1.5f) edit.putFloat("speed:$mode:" + key(connection), value)
        }
        edit.apply()
    }
}

internal fun dollarCents(value: String): Int? = runCatching {
    val decimal = BigDecimal(value.trim().replace(',', '.'))
    require(decimal >= BigDecimal.ZERO && decimal <= BigDecimal(100))
    decimal.setScale(2, RoundingMode.UNNECESSARY).movePointRight(2).intValueExact()
}.getOrNull()

internal fun dollars(value: Double) = String.format(java.util.Locale.US, if (value > 0 && value < .01) "%.4f $" else "%.2f $", value)
