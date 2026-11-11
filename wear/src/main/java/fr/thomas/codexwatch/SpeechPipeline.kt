package fr.thomas.codexwatch

import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.supervisorScope

/** At most one upcoming part is prepared while the current one plays. */
internal data class SpeechPart<T>(val start: Int, val end: Int, val value: T?, val fallback: String? = null)

internal suspend fun <T> playSpeechParts(
    start: Int,
    length: Int,
    load: suspend (Int) -> SpeechPart<T>,
    play: suspend (T, Deferred<SpeechPart<T>>?) -> Unit,
    progressed: (Int) -> Unit,
    waiting: () -> Unit,
    fallback: (String?) -> Unit,
) = supervisorScope {
    var position=start
    var pending: Deferred<SpeechPart<T>>?=null
    while (position < length) {
        if (pending != null && !pending.isCompleted) waiting()
        val part=pending?.await() ?: load(position)
        check(part.start==position && part.end>position && part.end<=length) { "Invalid speech segment" }
        if (part.value==null) { fallback(part.fallback); return@supervisorScope }
        pending=if(part.end<length) async { load(part.end) } else null
        play(part.value,pending)
        position=part.end
        progressed(position)
    }
}
