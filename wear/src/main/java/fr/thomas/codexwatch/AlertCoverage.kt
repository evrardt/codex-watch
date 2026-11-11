package fr.thomas.codexwatch

internal data class AlertRouteCoverage(val bluetoothPossible: Boolean, val cloudConfirmed: Boolean)

// For more than one relay, direct listening is the safe shared fallback until
// each route can be independently verified across process restarts.
internal fun needsDirectAlertCoverage(routes: List<AlertRouteCoverage>): Boolean =
    routes.size > 1 || routes.any { it.bluetoothPossible || !it.cloudConfirmed }
