package fr.thomas.codexwatch

import org.junit.Assert.assertEquals
import org.junit.Test

class ConnectionTest {
    @Test fun selectsTheOnlyConfiguredRelayAndPreservesChoiceWhenBothExist() {
        assertEquals("server", ConnectionStore.resolveSlot("pc", false, true))
        assertEquals("pc", ConnectionStore.resolveSlot("server", true, false))
        assertEquals("server", ConnectionStore.resolveSlot("server", true, true))
        assertEquals("pc", ConnectionStore.resolveSlot("pc", true, true))
        assertEquals("pc", ConnectionStore.resolveSlot("pc", false, false))
    }
    @Test fun validHttpsIsNormalized() { assertEquals("https://watch.example:8443", ConnectionStore.normalizeUrl(" https://watch.example:8443/ ")) }
    @Test fun rejectsUnsafeDestinationsAndEmbeddedCredentials() {
        for (value in listOf("http://example.org", "https://user:pass@example.org", "https://example.org/path", "https://example.org?token=x", "https://example.org#fragment", "file:///tmp/data", "https://")) {
            try { ConnectionStore.normalizeUrl(value); throw AssertionError("Accepted: $value") }
            catch (_: IllegalArgumentException) { }
        }
    }
}
