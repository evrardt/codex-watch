package fr.thomas.codexwatch

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AlertCoverageTest {
    @Test fun aConfirmedPcDoesNotCoverAnotherRelay() {
        assertTrue(needsDirectAlertCoverage(listOf(AlertRouteCoverage(false, true), AlertRouteCoverage(false, false))))
    }
    @Test fun bluetoothAndUnverifiedRoutesNeedDirectListening() {
        assertTrue(needsDirectAlertCoverage(listOf(AlertRouteCoverage(true, true))))
        assertTrue(needsDirectAlertCoverage(listOf(AlertRouteCoverage(false, false))))
    }
    @Test fun aSingleConfirmedInternetRouteCanUseCloudOnly() {
        assertFalse(needsDirectAlertCoverage(listOf(AlertRouteCoverage(false, true))))
    }
}
