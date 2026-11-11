package fr.thomas.codexwatch

import org.junit.Assert.*
import org.junit.Test

class SpeechChunkTest {
    @Test fun longSpeechPreservesAllTextAcrossChunks() {
        val text = "Une longue réponse en français, avec des espaces et des emoji 😀. ".repeat(20)
        val chunks = mutableListOf<String>()
        var offset = 0
        while (offset < text.length) {
            val end = speechChunkEnd(text, offset, 40)
            assertTrue(end > offset)
            chunks += text.substring(offset, end)
            offset = end
        }
        assertEquals(text, chunks.joinToString(""))
        assertTrue(chunks.all { it.length <= 40 && !Character.isHighSurrogate(it.last()) })
    }
    @Test fun chunkBoundaryDoesNotSplitAnEmoji() {
        val text = "123456789😀suite"
        val end = speechChunkEnd(text, 0, 10)
        assertEquals("123456789", text.substring(0, end))
        assertTrue(text.substring(end).startsWith("😀"))
    }
    @Test fun naturalSentenceEndingIsPreferredToCuttingTheNextSentence() {
        val text="Voici une première phrase assez complète. Ensuite, une deuxième phrase se poursuit encore longtemps."
        val end=speechChunkEnd(text,0,70)
        assertEquals("Voici une première phrase assez complète. ",text.substring(0,end))
        assertEquals(text,text.substring(0,end)+text.substring(end))
    }
}
