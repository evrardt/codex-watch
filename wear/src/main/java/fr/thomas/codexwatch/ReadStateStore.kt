package fr.thomas.codexwatch

import android.content.Context
import java.security.MessageDigest

/** Local reading positions, separated by relay/profile/chat. No message text is stored. */
class ReadStateStore(context: Context) {
    private val prefs = context.getSharedPreferences("reading", Context.MODE_PRIVATE)
    fun read(chatKey: String): String = prefs.getString(digest(chatKey), "").orEmpty()
    fun mark(chatKey: String, marker: String) {
        val key = digest(chatKey)
        if (prefs.getString(key, "") != marker) prefs.edit().putString(key, marker).apply()
    }
    companion object {
        fun digest(value: String): String = MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
        fun messageMarker(id: String, text: String): String = digest("$id\u0000$text")
    }
}
