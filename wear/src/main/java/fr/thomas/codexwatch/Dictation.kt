package fr.thomas.codexwatch

import org.json.JSONObject

internal fun appendDictation(draft: String, recognized: String): String =
    listOf(draft.trim(), recognized.trim()).filter { it.isNotBlank() }.joinToString(" ")

/** Only read an answer after this submission, never an older completed message. */
internal fun dictatedAnswer(rows: List<JSONObject>, requestId: String, text: String, previousIds: Set<String>): JSONObject? {
    if (requestId.isBlank() || text.isBlank()) return null
    val anchor=rows.indexOfLast { row -> row.optString("role")=="user" &&
        (row.optString("id")=="watch-$requestId" || row.optString("id") !in previousIds && row.optString("text").contains(text)) }
    val answer=rows.lastOrNull() ?: return null
    return answer.takeIf { anchor>=0 && rows.lastIndex>anchor && it.optString("role")=="assistant" &&
        it.optString("phase")!="commentary" && it.optString("id") !in previousIds }
}
