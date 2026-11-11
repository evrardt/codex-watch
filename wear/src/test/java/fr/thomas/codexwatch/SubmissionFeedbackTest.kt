package fr.thomas.codexwatch

import org.junit.Assert.assertEquals
import org.junit.Test

class SubmissionFeedbackTest {
    @Test fun uncertainWarningsAreNotRepeated() {
        val message="Demande déjà reçue. Vérifier la conversation avant de renvoyer."
        assertEquals(message,submissionError(message,false))
    }
    @Test fun ambiguousTransportErrorsTellTheUserToCheck() {
        assertEquals("Connection reset · Vérifier la conversation avant de renvoyer.",submissionError("Connection reset",false))
        assertEquals("Code invalide",submissionError("Code invalide",true))
    }
}
