package fr.thomas.codexwatch

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PendingCreationTest {
    @Test fun unconfirmedCreationNeverClaimsThatTheMessageWasDelivered() {
        val limited=JSONObject().put("reason","rate_limited")
        assertTrue(pendingCreationMessage(limited,1000).contains("non confirmée"))
        assertTrue(pendingCreationMessage(JSONObject(),120_000).contains("avant de renvoyer"))
        assertFalse(pendingCreationMessage(JSONObject(),1000).contains("transmis"))
    }
    @Test fun onlyOpenAnIdentifiedChatOfTheRequestedKind() {
        val ready=JSONObject().put("state","ready").put("id","chat-id").put("kind","chatgpt")
        assertEquals(PendingCreation.Ready("chat-id"),pendingCreation(ready,"chatgpt"))
        assertEquals(PendingCreation.Waiting,pendingCreation(ready,"codex"))
        assertEquals(PendingCreation.Waiting,pendingCreation(JSONObject().put("state","ready").put("kind","chatgpt"),"chatgpt"))
        assertEquals(PendingCreation.Ambiguous,pendingCreation(JSONObject().put("state","ambiguous"),"chatgpt"))
        assertEquals(PendingCreation.Uncertain,pendingCreation(JSONObject().put("state","unknown"),"chatgpt"))
    }
}
