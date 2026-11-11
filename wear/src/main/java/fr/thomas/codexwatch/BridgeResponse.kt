package fr.thomas.codexwatch

import org.json.JSONObject

internal fun parseBridgeResponse(status: Int, text: String): JSONObject {
    val result = runCatching { JSONObject(text) }.getOrNull()
    if(status !in 200..299&&result?.optString("code")?.isNotBlank()==true&&result.optString("error").isNotBlank())throw BridgeException(result.optString("error"),result.optString("code"),status)
    if (status !in 200..299) throw BridgeException(when (status) {
        401 -> "Jeton refusé. Vérifier l’association."
        in 300..399 -> "Le relais redirige la connexion. Vérifier son adresse HTTPS."
        502, 503, 504 -> "Relais PC indisponible (HTTP $status). Nouvelle tentative dans quelques instants."
        else -> result?.optString("error")?.takeIf { it.isNotBlank() } ?: "Relais indisponible (HTTP $status)"
    }, result?.optString("code").orEmpty(), status)
    return result ?: throw BridgeException("Le relais a renvoyé une réponse illisible (HTTP $status).", "INVALID_RELAY_RESPONSE", status)
}
