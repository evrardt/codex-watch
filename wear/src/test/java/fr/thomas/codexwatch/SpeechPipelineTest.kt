package fr.thomas.codexwatch

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.cancelAndJoin
import org.junit.Assert.*
import org.junit.Test

class SpeechPipelineTest {
    @Test fun nextSegmentStartsLoadingWhileFirstIsStillPlaying() = runBlocking {
        val secondStarted=CompletableDeferred<Unit>()
        val finishFirst=CompletableDeferred<Unit>()
        val played=mutableListOf<Int>(); val progressed=mutableListOf<Int>()
        val job=async {
            playSpeechParts(0,3,
                load={ start -> if(start==1)secondStarted.complete(Unit);SpeechPart(start,start+1,start) },
                play={value,_ -> played.add(value);if(value==0)finishFirst.await()},
                progressed={progressed.add(it)},waiting={},fallback={fail("Unexpected fallback")})
        }
        withTimeout(2000){secondStarted.await()}
        assertEquals(listOf(0),played)
        finishFirst.complete(Unit);withTimeout(2000){job.await()}
        assertEquals(listOf(0,1,2),played);assertEquals(listOf(1,2,3),progressed)
    }
    @Test fun aPrefetchFailureDoesNotInterruptTheCurrentPart() = runBlocking {
        val failureStarted=CompletableDeferred<Unit>();val finishFirst=CompletableDeferred<Unit>()
        val played=mutableListOf<Int>();var progress=0
        val job=async {
            runCatching {
                playSpeechParts(0,2,
                    load={start -> if(start==1){failureStarted.complete(Unit);error("network")};SpeechPart(start,start+1,start)},
                    play={value,_ -> played.add(value);finishFirst.await()},
                    progressed={progress=it},waiting={},fallback={})
            }
        }
        withTimeout(2000){failureStarted.await()};assertFalse(job.isCompleted)
        finishFirst.complete(Unit)
        assertTrue(withTimeout(2000){job.await()}.isFailure)
        assertEquals(listOf(0),played);assertEquals(1,progress)
    }
    @Test fun fallbackStartsAtTheUnplayedPart() = runBlocking {
        var progress=0;var reason=""
        playSpeechParts(0,2,
            load={start -> if(start==0)SpeechPart(start,1,"first") else SpeechPart(start,2,null,"fallback")},
            play={_,_->},progressed={progress=it},waiting={},fallback={reason=it.orEmpty()})
        assertEquals(1,progress);assertEquals("fallback",reason)
    }
    @Test fun stoppingPlaybackDoesNotRequestFurtherSegments() = runBlocking {
        val prefetched=CompletableDeferred<Unit>();val stillPlaying=CompletableDeferred<Unit>();val requested=mutableListOf<Int>()
        val job=async {
            playSpeechParts(0,4,
                load={start -> requested.add(start);if(start==1)prefetched.complete(Unit);SpeechPart(start,start+1,start)},
                play={_,_->stillPlaying.await()},progressed={},waiting={},fallback={})
        }
        withTimeout(2000){prefetched.await()};job.cancelAndJoin()
        assertEquals(listOf(0,1),requested)
    }
}
