package fr.thomas.codexwatch

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.media.MediaPlayer
import android.media.AudioAttributes
import android.media.PlaybackParams
import android.util.Base64
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.File
import java.util.UUID
import kotlin.coroutines.resume

enum class SpeechState { IDLE, LOADING, PLAYING, PAUSED }

/** Pauses by stopping the engine, then resumes at its last reported word boundary. */
class SpeechPlayer(context: Context) {
    var state by mutableStateOf(SpeechState.IDLE); private set
    var messageId by mutableStateOf(""); private set
    var error by mutableStateOf(""); private set
    var notice by mutableStateOf(""); private set
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var cloudJob: Job? = null
    private var player: MediaPlayer? = null
    private val clips = mutableMapOf<MediaPlayer, File>()
    private var ready = false
    private val main = Handler(Looper.getMainLooper())
    private var text = ""
    private var position = 0
    private var chunkStart = 0
    private var chunkEnd = 0
    private var utterance: String? = null
    private var relaySpeed = 1f
    private var watchSpeed = 1f
    private var onPlaybackStarted: (() -> Unit)? = null
    private data class AudioClip(val media: MediaPlayer, val finished: CompletableDeferred<Unit>)
    private val engine = TextToSpeech(context.applicationContext) { ready = it == TextToSpeech.SUCCESS }

    init {
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) { main.post { if(utteranceId!=null&&utteranceId==utterance) reportPlaybackStarted() } }
            override fun onRangeStart(utteranceId: String?, start: Int, end: Int, frame: Int) {
                main.post { if (utteranceId != null && utteranceId == utterance) position = (chunkStart + start).coerceIn(chunkStart, chunkEnd) }
            }
            override fun onDone(utteranceId: String?) {
                main.post {
                    if (utteranceId == null || utteranceId != utterance) return@post
                    position = chunkEnd
                    if (position < text.length) speakChunk() else stop()
                }
            }
            @Deprecated("Android callback")
            override fun onError(utteranceId: String?) {
                main.post {
                    if (utteranceId == null || utteranceId != utterance) return@post
                    stop(); error = "Lecture vocale interrompue. Réessayer Écouter."
                }
            }
        })
    }
    fun play(id: String, value: String, api: BridgeApi? = null, relayVoice: Boolean = false, speed: Float = 1f, localSpeed: Float = 1f, onStarted: (() -> Unit)? = null) {
        check(value.isNotBlank()) { "Aucun texte à lire" }
        stop(); error = ""; notice = ""; messageId = id; text = value; position = 0; onPlaybackStarted=onStarted
        relaySpeed=speed.coerceIn(.75f,1.5f); watchSpeed=localSpeed.coerceIn(.75f,1.5f)
        if (!relayVoice || api == null) { playLocal(); return }
        state = SpeechState.LOADING
        cloudJob = scope.launch {
            try {
                var fellBack=false
                playSpeechParts(position,text.length,
                    load={ start ->
                        val end=speechChunkEnd(text,start,500)
                        val result=api.request("/v1/audio/speech","POST",JSONObject().put("text",text.substring(start,end)))
                        if(result.optBoolean("fallback")) SpeechPart(start,end,null,result.optString("message","Voix de la montre"))
                        else {
                            val bytes=withContext(Dispatchers.Default){Base64.decode(result.getString("audio"),Base64.DEFAULT)}
                            require(bytes.size in 44..(10*1024*1024)){"Audio invalide"}
                            SpeechPart(start,end,prepareClip(bytes))
                        }
                    },
                    play={clip,next -> playClip(clip,next)},
                    progressed={position=it}, waiting={state=SpeechState.LOADING},
                    fallback={message -> notice=message ?: "Voix de la montre"; fellBack=true}
                )
                cloudJob = null
                if(fellBack) playLocal() else stop()
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) {
                releaseClips(); cloudJob = null
                notice = "Voix du relais indisponible. Voix de la montre."
                try { playLocal() } catch (e: Exception) { stop(); error = e.message ?: "Lecture indisponible" }
            }
        }
    }
    private suspend fun prepareClip(bytes: ByteArray): AudioClip {
        val file=File.createTempFile("voice-", ".wav",appContext.cacheDir)
        var media: MediaPlayer?=null
        try {
            withContext(Dispatchers.IO){file.outputStream().use{it.write(bytes)}}
            val created=MediaPlayer(); media=created; clips[created]=file
            val finished=CompletableDeferred<Unit>()
            created.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            created.setOnCompletionListener { finished.complete(Unit) }
            suspendCancellableCoroutine<Unit> { continuation ->
                created.setOnPreparedListener { if(continuation.isActive) continuation.resume(Unit) }
                created.setOnErrorListener { _,_,_ ->
                    val failure=IllegalStateException("Audio indisponible")
                    if(continuation.isActive) continuation.resumeWith(Result.failure(failure)) else finished.completeExceptionally(failure)
                    true
                }
                created.setDataSource(file.absolutePath)
                // Configure before preparation: changing speed after preparation starts the player.
                created.playbackParams=PlaybackParams().allowDefaults().setSpeed(relaySpeed).setPitch(1f)
                created.prepareAsync()
            }
            return AudioClip(created,finished)
        } catch(e: Exception) {
            if(media!=null) releaseClip(media) else withContext(NonCancellable + Dispatchers.IO){file.delete()}
            throw e
        }
    }
    private suspend fun playClip(clip: AudioClip, next: Deferred<SpeechPart<AudioClip>>?) = coroutineScope {
        player=clip.media; state=SpeechState.PLAYING
        if(!clip.finished.isCompleted && !clip.media.isPlaying) clip.media.start()
        if(clip.media.isPlaying)reportPlaybackStarted()
        val linker=next?.let { pending -> launch {
            try {
                val upcoming=pending.await().value
                if(upcoming!=null && !clip.finished.isCompleted) runCatching { clip.media.setNextMediaPlayer(upcoming.media) }
            } catch (_: Exception) { /* The queue handles a failed next part after this one finishes. */ }
        } }
        try { clip.finished.await() }
        finally { linker?.cancel(); releaseClip(clip.media) }
    }
    private fun playLocal() {
        check(ready) { "Lecture vocale indisponible sur cette montre" }
        // Keep the system engine, language, voice and pitch; speed is specific to this app.
        engine.setSpeechRate(watchSpeed)
        state = SpeechState.PLAYING; speakChunk()
    }
    fun pause() {
        if (state != SpeechState.PLAYING) return
        if (player != null) { player?.pause(); state = SpeechState.PAUSED; return }
        utterance = null; state = SpeechState.PAUSED; engine.stop()
    }
    fun resume() {
        if (state != SpeechState.PAUSED) return
        if (player != null) { player?.start(); state = SpeechState.PLAYING; return }
        state = SpeechState.PLAYING; speakChunk()
    }
    private fun speakChunk() {
        chunkStart = position
        chunkEnd = speechChunkEnd(text, chunkStart, TextToSpeech.getMaxSpeechInputLength())
        val id = UUID.randomUUID().toString(); utterance = id
        if (engine.speak(text.substring(chunkStart, chunkEnd), TextToSpeech.QUEUE_FLUSH, null, id) == TextToSpeech.ERROR) {
            stop(); error = "Lecture vocale indisponible. Réessayer Écouter."
        }
    }
    fun stop() {
        cloudJob?.cancel(); cloudJob = null; releaseClips()
        onPlaybackStarted=null
        utterance = null; engine.stop(); state = SpeechState.IDLE; messageId = ""; text = ""; position = 0
    }
    private fun reportPlaybackStarted() { val callback=onPlaybackStarted;onPlaybackStarted=null;callback?.invoke() }
    private fun releaseClip(media: MediaPlayer) {
        val file=clips.remove(media) ?: return
        if(player===media) player=null
        runCatching { media.release() }; file.delete()
    }
    private fun releaseClips() { clips.keys.toList().forEach(::releaseClip); player=null }
    fun close() { stop(); scope.cancel(); engine.shutdown() }
}

internal fun speechChunkEnd(text: String, start: Int, limit: Int): Int {
    var end = minOf(text.length, start + limit)
    if (end < text.length) {
        val floor=start+limit/2
        val sentence=(end-1 downTo floor).firstOrNull { index ->
            text[index] in ".!?…" && index+1<text.length && text[index+1].isWhitespace()
        }
        if(sentence!=null) {
            end=sentence+1
            while(end<text.length && end<start+limit && text[end].isWhitespace()) end++
        } else {
            val space = text.lastIndexOf(' ', end - 1)
            if (space > floor) end = space + 1
        }
        if (end > start && Character.isHighSurrogate(text[end - 1]) && Character.isLowSurrogate(text[end])) end--
    }
    return end
}
