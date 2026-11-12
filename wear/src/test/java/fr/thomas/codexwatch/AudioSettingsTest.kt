package fr.thomas.codexwatch

import org.junit.Assert.*
import org.junit.Test

class AudioSettingsTest {
    @Test fun moneyUsesExactCentsWithFrenchOrEnglishDecimalSeparator() {
        assertEquals(125, dollarCents("1,25")); assertEquals(125, dollarCents("1.25"))
        assertEquals(0, dollarCents("0")); assertEquals(10000, dollarCents("100.00"))
        for (bad in listOf("-1", "100.01", "1.001", "NaN", "", "1 000")) assertNull(dollarCents(bad))
    }
    @Test fun moneyDisplayUsesTheSelectedLocale() {
        assertEquals("1,25 $", dollars(1.25, java.util.Locale.FRANCE))
        assertEquals("1.25 $", dollars(1.25, java.util.Locale.US))
    }
    @Test fun chunkingLongFrenchTextKeepsEveryCharacterAndSurrogatePair() {
        val text = "Bonjour à tous 👋, voici une réponse longue. ".repeat(50)
        var position = 0; val parts = mutableListOf<String>()
        while (position < text.length) { val end = speechChunkEnd(text, position, 500); parts.add(text.substring(position,end)); position=end }
        assertEquals(text,parts.joinToString("")); assertTrue(parts.all { it.length <= 500 })
        assertTrue(parts.none { Character.isHighSurrogate(it.last()) || Character.isLowSurrogate(it.first()) })
    }
}
