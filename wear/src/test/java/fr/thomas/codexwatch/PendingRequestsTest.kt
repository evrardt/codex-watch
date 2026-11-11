package fr.thomas.codexwatch

import org.junit.Assert.assertEquals
import org.junit.Test

class PendingRequestsTest {
    @Test fun anInFlightRequestDoesNotDisappearBeforeConfirmation() {
        assertEquals(listOf("new", "sending"), mergePendingRequests(listOf("new"), listOf("sending"), "sending", "", emptySet()) { it })
    }
    @Test fun aConfirmedRequestCannotReappearFromAnOldPoll() {
        assertEquals(listOf("new"), mergePendingRequests(listOf("sent", "new"), listOf("sent"), "", "", setOf("sent")) { it })
    }
    @Test fun anUnconfirmedRequestStaysVisibleForVerification() {
        assertEquals(listOf("failed"), mergePendingRequests(emptyList(), listOf("failed"), "", "failed", emptySet()) { it })
    }
}
