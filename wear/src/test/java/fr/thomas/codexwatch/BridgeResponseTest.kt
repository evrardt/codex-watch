package fr.thomas.codexwatch

import org.junit.Assert.*
import org.junit.Test

class BridgeResponseTest {
    @Test fun serviceSpecificErrorsDoNotPretendTheWholeRelayIsOffline(){
        try{parseBridgeResponse(503,"""{"error":"Catalogue temporairement indisponible","code":"PLUGINS_UNAVAILABLE"}""");fail()}
        catch(e:BridgeException){assertEquals("Catalogue temporairement indisponible",e.message);assertEquals("PLUGINS_UNAVAILABLE",e.code)}
    }
    @Test fun gatewayErrorsAreRecognizedBeforeJsonParsing() {
        for (status in listOf(502, 503, 504)) try {
            parseBridgeResponse(status, "<html>Bad Gateway</html>")
            fail("Accepted gateway error")
        } catch (error: BridgeException) {
            assertEquals(status, error.status)
            assertTrue(error.message!!.contains("Relais PC indisponible"))
            assertFalse(error.message!!.contains("invalide"))
        }
    }
    @Test fun jsonErrorsKeepTheirSubmissionCodeAndAuthenticationIsExplicit() {
        try { parseBridgeResponse(409, """{"error":"Vérifier la conversation","code":"SUBMISSION_UNCERTAIN"}"""); fail() }
        catch (error: BridgeException) { assertEquals("SUBMISSION_UNCERTAIN", error.code); assertEquals(409, error.status) }
        try { parseBridgeResponse(401, "Unauthorized"); fail() }
        catch (error: BridgeException) { assertTrue(error.message!!.contains("Jeton refusé")) }
    }
    @Test fun successRequiresJsonAndPreservesItsData() {
        assertTrue(parseBridgeResponse(200, """{"codex":true}""").getBoolean("codex"))
        try { parseBridgeResponse(200, "<html>Proxy</html>"); fail() }
        catch (error: BridgeException) { assertEquals("INVALID_RELAY_RESPONSE", error.code) }
    }
}
