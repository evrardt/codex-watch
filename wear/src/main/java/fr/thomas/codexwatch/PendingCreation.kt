package fr.thomas.codexwatch

import org.json.JSONObject

internal sealed interface PendingCreation {
    data class Ready(val id:String):PendingCreation
    data object Waiting:PendingCreation
    data object Ambiguous:PendingCreation
    data object Uncertain:PendingCreation
}

internal fun pendingCreation(result:JSONObject,kind:String):PendingCreation = when(result.optString("state")) {
    "ready" -> result.optString("id").takeIf{it.isNotBlank()&&result.optString("kind")==kind}?.let{PendingCreation.Ready(it)} ?: PendingCreation.Waiting
    "ambiguous" -> PendingCreation.Ambiguous
    "unknown","rejected" -> PendingCreation.Uncertain
    else -> PendingCreation.Waiting
}

internal fun pendingCreationMessage(result:JSONObject,elapsedMillis:Long):String = when {
    result.optString("reason")=="rate_limited" -> "ChatGPT limite la vérification. Création non confirmée ; vérifie avant de renvoyer."
    elapsedMillis >= 120_000L -> "Création non confirmée. Vérifie les conversations avant de renvoyer."
    else -> "Le PC prépare la conversation. Création non confirmée."
}
