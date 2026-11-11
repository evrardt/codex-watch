package fr.thomas.codexwatch

import org.junit.Assert.*
import org.junit.Test

class MessageFormatTest {
    @Test fun userWordsAreVerbatimIncludingCodeAccentsAndLineBreaks() {
        val text = "Mon **texte** 🕒\n<svg> et `code` : éèà"
        assertEquals(text, formatMessage(text, true).text)
    }
    @Test fun emphasisAndHeadingsBecomeStylesWithoutLosingWords() {
        val result = formatMessage("## Résultat\n\nVoici **la correction** et *son détail*.", false)
        assertEquals("Résultat\nVoici la correction et son détail.", result.text)
        assertTrue(result.spanStyles.size >= 3)
    }
    @Test fun codeLiteralsAndUrlsStayComplete() {
        val text = "```js\nconst x = '**texte**';\n```\n\n[Source](https://example.org/a?q=1)"
        val result = formatMessage(text, false).text
        assertTrue(result.contains("const x = '**texte**';"))
        assertTrue(result.contains("Source (https://example.org/a?q=1)"))
        assertFalse(result.contains("```"))
        assertEquals("https://example.org", formatMessage("<https://example.org>", false).text)
    }
    @Test fun speechReadsLinkLabelWithoutDestination() {
        val text="Le [guide d'installation](</C:/Projets/Un dossier/README.md>) a été mis à jour. [Site](https://example.org/path)"
        assertEquals("Le guide d'installation a été mis à jour. Site",formatMessage(text,false,forSpeech=true).text)
        assertTrue(formatMessage(text,false).text.contains("README.md"))
    }
    @Test fun watchTablesKeepEveryHeaderAndValueInVerticalRows() {
        val result = formatMessage("| Choix | Prix |\n| --- | --- |\n| A | 25 € |\n| B | 40 € |", false).text
        assertEquals("Choix : A\nPrix : 25 €\n\nChoix : B\nPrix : 40 €", result)
    }
    @Test fun longTextAndEmojiAreNotTruncated() {
        val text = "Réponse 🕒 ".repeat(800).trimEnd()
        assertEquals(text, formatMessage(text, false).text)
    }
    @Test fun manyFormattedParagraphsPreserveLinksAndEndOfLongMessages() {
        val text=(1..500).joinToString("\n\n"){"Paragraphe **$it** avec [source](https://example.org/$it)."}
        val result=formatMessage(text,false).text
        assertTrue(result.startsWith("Paragraphe 1 avec source (https://example.org/1)."))
        assertTrue(result.endsWith("Paragraphe 500 avec source (https://example.org/500)."))
        assertEquals(500,Regex("Paragraphe ").findAll(result).count())
    }
    @Test fun formattedRepliesAreReusedAndCacheIsBounded() {
        val cache=MessageFormatCache(maxChars=70)
        val first=cache.format("**Bonjour**",false)
        assertSame(first,cache.format("**Bonjour**",false))
        cache.format("Une réponse de longueur moyenne",false)
        assertNotSame(first,cache.format("**Bonjour**",false))
        assertEquals("**Bonjour**",cache.format("**Bonjour**",true).text)
    }
}
