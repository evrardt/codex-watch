package fr.thomas.codexwatch

import android.content.Context
import org.json.JSONObject

/** Only navigation metadata; no messages, API keys or relay tokens. */
class NavigationStore(context: Context) {
    private val prefs = context.getSharedPreferences("navigation", Context.MODE_PRIVATE)
    private fun key(connection: Connection) = ReadStateStore.digest("${connection.slot}\u0000${connection.url}")
    fun last(connection: Connection): JSONObject? = runCatching {
        JSONObject(prefs.getString("last:${key(connection)}", "").orEmpty()).takeIf {
            it.optString("id").isNotBlank() && it.optString("kind") in listOf("codex", "chatgpt", "chat")
        }
    }.getOrNull()
    fun remember(connection: Connection, kind: String, detail: JSONObject, project: String, projectName: String) {
        if (!detail.has("id")) return
        val value = JSONObject().put("id", detail.getString("id")).put("kind", kind).put("title", detail.optString("title"))
            .put("projectId", project).put("projectName", projectName)
        val entry = "last:${key(connection)}"
        if (prefs.getString(entry, "") != value.toString()) prefs.edit().putString(entry, value.toString()).apply()
    }
    fun project(connection: Connection, kind: String) = prefs.getString("project:${key(connection)}:$kind", "").orEmpty()
    fun selectProject(connection: Connection, kind: String, project: String) {
        prefs.edit().putString("project:${key(connection)}:$kind", project).apply()
    }
}

fun sourceLabel(kind: String): String = when (kind) { "chatgpt" -> "ChatGPT"; "chat" -> "Assistant API"; else -> "Codex" }
