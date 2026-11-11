package fr.thomas.codexwatch

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class DictationTest {
    private fun row(id:String,role:String,text:String,phase:String="") = JSONObject().put("id",id).put("role",role).put("text",text).put("phase",phase)
    @Test fun appendMultipleSegments() {
        assertEquals("Bonjour tout le monde",appendDictation(appendDictation("", "Bonjour"),"tout le monde"))
        assertEquals("Bonjour",appendDictation("Bonjour", "  "))
    }
    @Test fun onlyReadNewAnswerAfterTheSubmittedMessage() {
        val old=row("old","assistant","ancienne réponse")
        val user=row("native","user","[@plugin](plugin://x)\n\nMa demande")
        val interim=row("progress","assistant","Je cherche","commentary")
        val answer=row("new","assistant","nouvelle réponse","final_answer")
        assertNull(dictatedAnswer(listOf(old),"req","Ma demande",setOf("old")))
        assertNull(dictatedAnswer(listOf(old,user,interim),"req","Ma demande",setOf("old")))
        assertEquals("new",dictatedAnswer(listOf(old,user,answer),"req","Ma demande",setOf("old"))?.optString("id"))
        assertNull(dictatedAnswer(listOf(old,user,answer),"req","Ma demande",setOf("old","native")))
        assertEquals("new",dictatedAnswer(listOf(old,row("watch-req","user","décoré"),answer),"req","Ma demande",setOf("old"))?.optString("id"))
    }
}
