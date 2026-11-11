package fr.thomas.codexwatch

/** Keep an ambiguous delivery warning actionable without repeating the relay's instruction. */
internal fun submissionError(message: String?, definite: Boolean): String {
    val text=message?.takeIf { it.isNotBlank() } ?: "Envoi non confirmé"
    val alreadyExplains=text.contains("vérifi",ignoreCase=true) && text.contains("conversation",ignoreCase=true)
    return if(definite || alreadyExplains) text else "$text · Vérifier la conversation avant de renvoyer."
}
