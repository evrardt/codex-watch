package fr.thomas.codexwatch

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class InferenceStoreTest {
    @Test fun chatOverrideInheritsGeneralAndCanExplicitlyUsePc() {
        val general="""{"model":"model-a","thinking":"high"}"""
        val specific="""{"model":"model-b","thinking":"low"}"""
        assertEquals(InferenceChoice("model-a","high"),resolveInference(general,null))
        assertEquals(InferenceChoice("model-b","low"),resolveInference(general,specific))
        assertEquals(InferenceChoice(),resolveInference(general,"{}"))
        assertEquals(InferenceChoice("model-a","high"),resolveInference(general,"invalid"))
        val payload=JSONObject();resolveInference(general,specific).applyTo(payload)
        assertEquals("model-b",payload.getString("model"));assertEquals("low",payload.getString("thinking"))
        assertFalse(resolveInference(general,"{}").applyTo(JSONObject()).has("model"))
    }
    @Test fun selectionsAreIsolatedByConnectionAndConversation() {
        assertNotEquals(inferenceThreadKey("profile-a","thread-1"),inferenceThreadKey("profile-a","thread-2"))
        assertNotEquals(inferenceThreadKey("profile-a","thread-1"),inferenceThreadKey("profile-b","thread-1"))
    }
    @Test fun everySupportedEffortHasAnExplicitLabel() {
        assertEquals("Aucune",effortLabel("none"))
        assertEquals("Minimale",effortLabel("minimal"))
        assertEquals("Du PC",effortLabel(""))
    }
}
