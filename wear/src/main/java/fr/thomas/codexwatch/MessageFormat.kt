package fr.thomas.codexwatch

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.sp
import org.commonmark.node.*
import org.commonmark.parser.Parser
import org.commonmark.ext.gfm.tables.*
import org.commonmark.ext.gfm.strikethrough.Strikethrough
import org.commonmark.ext.gfm.strikethrough.StrikethroughExtension

private val messageParser = Parser.builder().extensions(listOf(TablesExtension.create(), StrikethroughExtension.create())).build()
private fun Node.children(): List<Node> = generateSequence(firstChild) { it.next }.toList()

/** Reuse formatted replies when a lazy list removes and later recreates a row. */
internal class MessageFormatCache(private val maxChars:Int=250_000) {
    private val entries=LinkedHashMap<String,AnnotatedString>(16,0.75f,true)
    private var chars=0
    fun format(text:String,fromUser:Boolean):AnnotatedString {
        if(fromUser)return AnnotatedString(text)
        entries[text]?.let{return it}
        val formatted=formatMessage(text,false)
        val cost=text.length+formatted.length
        if(cost>maxChars)return formatted
        while(chars+cost>maxChars&&entries.isNotEmpty()) {
            val oldest=entries.entries.iterator();val entry=oldest.next()
            chars-=entry.key.length+entry.value.length;oldest.remove()
        }
        entries[text]=formatted;chars+=cost
        return formatted
    }
}

/** Render locally into text spans; never execute HTML or fetch a link/image. */
fun formatMessage(text: String, fromUser: Boolean, forSpeech: Boolean = false): AnnotatedString {
    if (fromUser) return AnnotatedString(text)
    val out = AnnotatedString.Builder()
    val plain = StringBuilder()
    fun add(value: CharSequence) { out.append(value); plain.append(value) }
    val bold = SpanStyle(fontWeight = FontWeight.SemiBold)
    val code = SpanStyle(fontFamily = FontFamily.Monospace)
    fun newline() { if (plain.isNotEmpty() && plain.last() != '\n') add("\n") }
    fun render(node: Node) {
        fun children() { node.children().forEach { render(it) } }
        when (node) {
            is Text -> add(node.literal)
            is StrongEmphasis -> out.withStyle(bold) { children() }
            is Emphasis -> out.withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { children() }
            is Strikethrough -> out.withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { children() }
            is Heading -> { newline(); out.withStyle(bold.copy(fontSize = 15.sp)) { children() }; add("\n") }
            is Paragraph -> { children(); newline() }
            is Code -> out.withStyle(code) { add(node.literal) }
            is FencedCodeBlock -> { newline(); out.withStyle(code) { add(node.literal) }; newline() }
            is IndentedCodeBlock -> { newline(); out.withStyle(code) { add(node.literal) }; newline() }
            is SoftLineBreak, is HardLineBreak -> add("\n")
            is BulletList -> { newline(); node.children().forEach { add("• "); render(it) }; newline() }
            is OrderedList -> { newline(); node.children().forEachIndexed { index, child -> add("${(node.markerStartNumber ?: 1) + index}. "); render(child) }; newline() }
            is ListItem -> { children(); newline() }
            is Link -> {
                val start = plain.length
                out.withStyle(SpanStyle(textDecoration = TextDecoration.Underline)) { children() }
                if (!forSpeech && plain.substring(start) != node.destination) add(" (${node.destination})")
            }
            is Image -> { add("[Image : "); children(); add("]") }
            is BlockQuote -> { newline(); out.withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { children() }; newline() }
            is ThematicBreak -> { newline(); add("—\n") }
            is HtmlInline -> add(node.literal)
            is HtmlBlock -> { add(node.literal); newline() }
            is TableBlock -> {
                newline()
                val headers = node.children().filterIsInstance<TableHead>().flatMap { it.children() }.filterIsInstance<TableRow>().firstOrNull()?.children().orEmpty()
                val rows = node.children().filterIsInstance<TableBody>().flatMap { it.children() }.filterIsInstance<TableRow>()
                if (rows.isEmpty()) { headers.forEach { render(it); newline() } }
                for (row in rows) {
                    row.children().forEachIndexed { index, cell ->
                        headers.getOrNull(index)?.let { out.withStyle(bold) { render(it) }; add(" : ") }
                        render(cell); newline()
                    }
                    add("\n")
                }
            }
            else -> children()
        }
    }
    render(messageParser.parse(text))
    val rendered = out.toAnnotatedString()
    return rendered.subSequence(0, rendered.text.trimEnd('\n').length)
}
