package fr.thomas.codexwatch

/** Keep an in-flight or failed submission visible while ignoring already confirmed requests. */
internal fun <T> mergePendingRequests(fresh: List<T>, previous: List<T>, sending: String, failed: String, completed: Set<String>, key: (T) -> String): List<T> {
    val incoming = fresh.filterNot { key(it) in completed }
    val present = incoming.map(key).toSet()
    val retained = previous.filter { key(it).isNotBlank() && key(it) in setOf(sending, failed) && key(it) !in present && key(it) !in completed }
    return incoming + retained
}
