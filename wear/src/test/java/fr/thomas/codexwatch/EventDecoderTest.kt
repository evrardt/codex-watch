package fr.thomas.codexwatch

import org.junit.Assert.*
import org.junit.Test

class EventDecoderTest {
    @Test fun decodesEventsAcrossLinesAndIgnoresHeartbeat() {
        val decoder = EventDecoder()
        assertNull(decoder.line(": keepalive")); assertNull(decoder.line(""))
        decoder.line("event: task"); decoder.line("data: {\"id\":\"a\",\"type\":\"completed\"}")
        assertEquals(EventFrame("task", "{\"id\":\"a\",\"type\":\"completed\"}"), decoder.line(""))
        decoder.line("event: checkpoint"); decoder.line("data: {\"cursor\":\"a\"}")
        assertEquals("checkpoint", decoder.line("")?.event)
    }
    @Test(expected = IllegalStateException::class) fun oversizedEventIsRejected() {
        EventDecoder().line("data: " + "x".repeat(17000))
    }
}
