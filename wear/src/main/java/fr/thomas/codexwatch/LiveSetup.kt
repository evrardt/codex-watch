package fr.thomas.codexwatch

import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.sign

internal fun liveLaunchKind(kind: String?, threadId: String): String =
    if(threadId.isNotBlank() && kind in listOf("codex","chatgpt")) kind!! else "chatgpt"

internal fun liveLaunchContext(kind: String, project: String, projectName: String, openedKind: String?, openedId: String, openedTitle: String): JSONObject =
    if(kind==openedKind&&openedId.isNotBlank()) JSONObject().put("mode","existing").put("id",openedId).put("title",openedTitle)
    else JSONObject().put("mode","new").put("project",project).put("title","Nouveau chat · $projectName")

/** +6 dB for quiet speech, with a soft knee to avoid hard clipping of loud syllables. */
internal fun boostSpeechPcm16(input: ByteArray): ByteArray {
    val output=input.copyOf()
    for(i in 0 until input.size-1 step 2) {
        val value=((input[i].toInt() and 255) or (input[i+1].toInt() shl 8)).toShort().toDouble()*2
        val magnitude=abs(value)
        val limited=if(magnitude<=24000) value else sign(value)*(24000+8767*(1-exp(-(magnitude-24000)/8767)))
        val sample=limited.toInt().coerceIn(-32768,32767)
        output[i]=sample.toByte();output[i+1]=(sample shr 8).toByte()
    }
    return output
}

internal fun pcmEnergy(bytes:ByteArray,offset:Int=0,count:Int=bytes.size):Float {
    var sum=0.0;var samples=0
    for(i in offset until (offset+count-1).coerceAtMost(bytes.size-1) step 2){val v=((bytes[i].toInt() and 255) or (bytes[i+1].toInt() shl 8)).toShort().toDouble()/32768;sum+=v*v;samples++}
    return if(samples==0)0f else (kotlin.math.sqrt(sum/samples)*5).toFloat().coerceIn(0f,1f)
}
