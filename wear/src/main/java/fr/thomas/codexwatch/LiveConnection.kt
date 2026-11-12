package fr.thomas.codexwatch

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.*
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.compose.runtime.*
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import okhttp3.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.math.sqrt

enum class LiveState { IDLE, CONNECTING, CONNECTED, ENDING, ENDED }
private data class LiveAudioFrame(val epoch:Int,val revision:Int,val stream:Int,val encoding:String,val pcmBytes:Int,val data:ByteArray,val receivedAt:Long)

/** Owns only the microphone/audio transport. Thread access remains on the authenticated relay. */
class LiveConnection(private val context: Context) {
    var state by mutableStateOf(LiveState.IDLE); private set
    var target by mutableStateOf("chatgpt"); private set
    var muted by mutableStateOf(false); private set
    var speaking by mutableStateOf(false); private set
    var level by mutableFloatStateOf(0f); private set
    var outputLevel by mutableFloatStateOf(0f); private set
    @Volatile private var playbackEnergy=0f
    var caption by mutableStateOf(""); private set
    var captionIsStatus by mutableStateOf(true); private set
    var notice by mutableStateOf(""); private set
    var remaining by mutableIntStateOf(0); private set
    var elapsed by mutableIntStateOf(0); private set
    var backend by mutableStateOf(""); private set
    var reconnecting by mutableStateOf(false); private set
    var delivery by mutableStateOf("Échange vocal"); private set
    var boundContexts by mutableStateOf<Map<String,JSONObject>>(emptyMap()); private set
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val http = OkHttpClient.Builder().connectTimeout(12,TimeUnit.SECONDS).readTimeout(0,TimeUnit.MILLISECONDS).build()
    @Volatile private var socket: WebSocket? = null
    private var socketRevision=0
    private var resumeToken=""
    private var liveConnection:Connection?=null
    private var selectedPlugins:List<String> = emptyList()
    private var transport="internet"
    private var reconnectStarted=0L
    private var reconnectAttempt=0
    private var reconnectTimer:Job?=null
    private var capture: AudioRecord? = null
    private var echo: AcousticEchoCanceler? = null
    private var noise: NoiseSuppressor? = null
    private var track: AudioTrack? = null
    private var captureJob: Job? = null
    private var playbackJob: Job? = null
    private var heartbeat: Job? = null
    private var closeJob: Job? = null
    private var queue = Channel<LiveAudioFrame>(40)
    private var opusPreparation:Deferred<LiveOpusDecoder?>?=null
    @Volatile private var opusDisabled=false
    @Volatile private var epoch=0
    @Volatile private var lastAudio=0L
    @Volatile private var revision=0
    private var serverAudioRevision=0
    private var waitingForInterruption=false
    private var userEnd=-1L
    private var botEnd=-1L
    private var userText=""
    private var botText=""
    private var focus: AudioFocusRequest? = null
    private val manager=context.getSystemService(AudioManager::class.java)
    fun prepare(){if(state==LiveState.ENDED){state=LiveState.IDLE;notice="";caption="";captionIsStatus=true;backend="";boundContexts=emptyMap()}}
    private fun send(value: JSONObject) { if(!reconnecting || value.optString("type")=="close")socket?.send(value.toString()) }
    fun connect(connection: Connection, kind: String, bindings: Map<String,JSONObject>, voice: String, plugins:List<String> = emptyList()) {
        if(state in listOf(LiveState.CONNECTING,LiveState.CONNECTED,LiveState.ENDING))return
        check(ContextCompat.checkSelfPermission(context,Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED) { "Autoriser le microphone pour le Live" }
        state=LiveState.CONNECTING;target=kind;notice="";caption="Connexion à l’agent Live…";captionIsStatus=true;backend="";muted=false;elapsed=0;remaining=0
        serverAudioRevision=0;waitingForInterruption=false;userEnd=-1;botEnd=-1;userText="";botText="";queue=Channel(40);opusDisabled=false;boundContexts=emptyMap();resumeToken="";reconnecting=false;liveConnection=connection;selectedPlugins=plugins.toList()
        val sessionRevision=++revision
        val candidates=transportOrder(connection.transportMode,connection.bluetoothAddress.isNotBlank(),BluetoothTunnel.connected(connection))
        val last=ConnectionStatus.last(connection)
        val first=if(connection.transportMode=="auto" && last in candidates) last else candidates.first()
        openSocket(connection,first,sessionRevision,false,kind,bindings,voice)
        heartbeat=scope.launch {
            var pingTick=0
            while(isActive&&state!=LiveState.ENDED) {
                if(pingTick++%30==0)send(JSONObject().put("type","ping"))
                speaking=state==LiveState.CONNECTED&&SystemClock.elapsedRealtime()-lastAudio<450
                outputLevel=if(speaking)(outputLevel*.25f+playbackEnergy*.75f) else outputLevel*.5f
                if(state==LiveState.CONNECTING&&elapsed++>150){end("Le relais ne répond pas.");break}
                delay(100)
            }
        }
    }
    private fun openSocket(connection:Connection,selected:String,sessionRevision:Int,resume:Boolean,kind:String="",bindings:Map<String,JSONObject> = emptyMap(),voice:String="") {
        val attempt=++socketRevision
        if(resume)reconnectTimer=scope.launch {
            delay(4500)
            if(reconnecting&&attempt==socketRevision){socketRevision++;socket?.cancel();retryResume(sessionRevision)}
        }
        scope.launch {
        val base=try { withContext(Dispatchers.IO) { if(selected=="bluetooth")BluetoothTunnel.bluetoothBase(connection) else ConnectionStore.normalizeUrl(connection.url) } }
        catch(_:Exception){if(sessionRevision==revision&&attempt==socketRevision){reconnectTimer?.cancel();if(resume)scope.launch{delay(250);retryResume(sessionRevision)}else finish("Connexion au relais indisponible.")};return@launch}
        if(sessionRevision!=revision||attempt!=socketRevision||(resume&&!reconnecting)||(!resume&&state!=LiveState.CONNECTING))return@launch
        val url=base.replaceFirst("https://","wss://").replaceFirst("http://","ws://")+"/v1/live"+(if(resume)"?resume=$resumeToken" else "")
        val request=Request.Builder().url(url).header("Authorization","Bearer ${connection.token}").build()
        socket=http.newWebSocket(request,object: WebSocketListener() {
            override fun onOpen(webSocket: WebSocket,response: Response) {
                if(sessionRevision!=revision||attempt!=socketRevision||(!resume&&state!=LiveState.CONNECTING)){webSocket.close(1000,null);return}
                if(!resume)webSocket.send(JSONObject().put("type","start").put("kind",kind).put("voice",voice).put("language",context.resources.configuration.locales[0].language).put("bindings",JSONObject(bindings)).put("plugins",JSONArray(selectedPlugins))
                    .put("outputEncodings",JSONArray().put("deflate-pcm16").put("delta-deflate-pcm16").put("opus-24k")).put("outputEncoding",if(selected=="bluetooth")"deflate-pcm16" else "pcm16").toString())
            }
            override fun onMessage(webSocket: WebSocket,text: String) { scope.launch {
                if(sessionRevision!=revision||attempt!=socketRevision)return@launch
                if(resume&&reconnecting&&runCatching{JSONObject(text).optString("type")=="resumed"}.getOrDefault(false)) {
                    reconnecting=false;reconnectTimer?.cancel();transport=selected;ConnectionStatus.success(connection,selected);notice="";caption="Je t’écoute";captionIsStatus=true
                    chooseOutputEncoding()
                    if(!muted)runCatching{startCapture()}.onFailure{end("Microphone indisponible.")}
                }
                try { event(JSONObject(text)) } catch (_: Exception) { end("Audio Live indisponible sur cette montre.") }
            } }
            override fun onFailure(webSocket: WebSocket,t: Throwable,response: Response?) { scope.launch {
                if(sessionRevision!=revision||attempt!=socketRevision||state==LiveState.ENDED)return@launch
                if(reconnecting){reconnectTimer?.cancel();scope.launch{delay(250);retryResume(sessionRevision)}}
                else if(state==LiveState.CONNECTED&&resumeToken.isNotBlank())beginReconnect(sessionRevision)
                else finish(if(response?.code==409) "Un Live est déjà ouvert sur ce relais." else "Connexion Live interrompue. Les tâches restent sur le PC.")
            } }
            override fun onClosed(webSocket: WebSocket,code: Int,reason: String) { scope.launch {
                if(sessionRevision!=revision||attempt!=socketRevision||state==LiveState.ENDED)return@launch
                if(reconnecting){reconnectTimer?.cancel();scope.launch{delay(250);retryResume(sessionRevision)}}
                else if(state==LiveState.CONNECTED&&resumeToken.isNotBlank())beginReconnect(sessionRevision)
                else finish("Appel terminé.")
            } }
        })
        if(!resume)transport=selected
        }
    }
    private fun beginReconnect(sessionRevision:Int) {
        if(reconnecting||state!=LiveState.CONNECTED)return
        reconnecting=true;reconnectStarted=SystemClock.elapsedRealtime();reconnectAttempt=0;stopCapture()
        notice="Changement de connexion · micro en pause";caption="Reconnexion…";captionIsStatus=true;retryResume(sessionRevision)
    }
    private fun retryResume(sessionRevision:Int) {
        if(!reconnecting||sessionRevision!=revision||state!=LiveState.CONNECTED)return
        if(SystemClock.elapsedRealtime()-reconnectStarted>10000){finish("Reconnexion impossible. Les tâches restent sur le PC.");return}
        val connection=liveConnection?:run{finish("Connexion Live indisponible.");return}
        val available=if(connection.transportMode=="auto"&&connection.bluetoothAddress.isNotBlank()) listOf(if(transport=="bluetooth")"internet" else "bluetooth",transport) else listOf(transport)
        val next=available[reconnectAttempt++%available.size]
        openSocket(connection,next,sessionRevision,true)
    }
    private fun chooseOutputEncoding(){
        if(transport!="bluetooth"){send(JSONObject().put("type","output_encoding").put("encoding","pcm16"));return}
        send(JSONObject().put("type","output_encoding").put("encoding","delta-deflate-pcm16"))
        val preparation=opusPreparation?:return;val sessionRevision=revision
        scope.launch {
            val decoder=runCatching{preparation.await()}.getOrNull()
            if(decoder!=null&&!opusDisabled&&revision==sessionRevision&&state==LiveState.CONNECTED&&!reconnecting&&transport=="bluetooth"&&opusPreparation===preparation)
                send(JSONObject().put("type","output_encoding").put("encoding","opus-24k"))
        }
    }
    private fun event(event: JSONObject) {
        when(event.optString("type")) {
            "ready" -> {
                if(state!=LiveState.CONNECTING){send(JSONObject().put("type","close"));return}
                target=event.optString("kind",target);remaining=event.optInt("maxSeconds");elapsed=0;delivery="Échange vocal";resumeToken=event.optString("resumeToken").takeIf{it.matches(Regex("[a-f0-9-]{36}"))}.orEmpty();liveConnection?.let{ConnectionStatus.success(it,transport)}
                val contexts=event.optJSONObject("bindings")?:JSONObject()
                boundContexts=contexts.keys().asSequence().associateWith{contexts.getJSONObject(it)}
                openAudio();state=LiveState.CONNECTED;chooseOutputEncoding();caption="Je t’écoute";captionIsStatus=true;startCapture()
            }
            "audio" -> if(state==LiveState.CONNECTED&&!waitingForInterruption) {
                val packetRevision=event.optInt("audioRevision",serverAudioRevision)
                if(packetRevision<serverAudioRevision)return
                if(packetRevision>serverAudioRevision){serverAudioRevision=packetRevision;clearAudio()}
                val encoded=Base64.decode(event.getString("audio"),Base64.DEFAULT)
                val frame=LiveAudioFrame(epoch,packetRevision,event.optInt("opusStream",0),event.optString("encoding"),event.optInt("pcmBytes",-1),encoded,SystemClock.elapsedRealtime())
                if(!queue.trySend(frame).isSuccess)end("Connexion trop lente pour le Live. Réessaie avec un meilleur réseau.")
            }
            "transcript" -> {
                val start=event.optLong("startMs");val end=event.optLong("endMs");val delta=event.optString("text")
                if(event.optString("role")=="user") {
                    if(start>userEnd+900)userText=""
                    userText=(userText+delta).takeLast(1000);userEnd=end;caption=userText;captionIsStatus=false

                } else {
                    if(start>botEnd+900)botText=""
                    botText=(botText+delta).takeLast(1000);botEnd=end;caption=botText;captionIsStatus=false
                }
            }
            "target" -> {target=event.optString("kind",target);backend=""}
            "bound" -> {boundContexts=boundContexts+mapOf(event.getString("kind") to event.getJSONObject("context"))}
            "submitted" -> {backend="Consigne transmise à ${if(event.optString("kind")=="codex") "Codex" else "ChatGPT"}";delivery="Transmis au chat"}
            "backend" -> if(event.optString("kind",target)==target){notice="";backend=if(event.optString("status")=="active")"Consigne transmise · réponse en cours" else "Réponse reçue du PC";delivery=if(event.optString("status")=="active")"Réponse en cours" else "Réponse du chat"}
            "usage" -> {remaining=event.optInt("remainingSeconds");elapsed=event.optInt("seconds")}
            "notice" -> notice=event.optString("message")
            "error" -> {notice=event.optString("message");end(notice)}
            "clear_audio" -> {serverAudioRevision=maxOf(serverAudioRevision,event.optInt("audioRevision",serverAudioRevision));waitingForInterruption=false;clearAudio()}
            "ending" -> {notice=event.optString("message");stopAudio();state=LiveState.ENDING}
            "closed" -> finish(event.optString("message","Appel terminé."))
        }
    }
    private fun openAudio() {
        val attrs=AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
        focus=AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attrs)
            .setOnAudioFocusChangeListener { change -> if(change==AudioManager.AUDIOFOCUS_LOSS||change==AudioManager.AUDIOFOCUS_LOSS_TRANSIENT)scope.launch {end("Live arrêté : une autre application utilise l’audio.")} }.build()
        check(manager.requestAudioFocus(focus!!)==AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {"Audio déjà occupé"}
        val format=AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(24000).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build()
        val min=AudioTrack.getMinBufferSize(24000,AudioFormat.CHANNEL_OUT_MONO,AudioFormat.ENCODING_PCM_16BIT)
        // A little extra output buffering helps absorb Bluetooth jitter without delaying the microphone.
        val minimumPlaybackBytes=if(liveConnection?.transportMode!="internet")19200 else 12000
        track=AudioTrack.Builder().setAudioAttributes(attrs).setAudioFormat(format).setTransferMode(AudioTrack.MODE_STREAM).setBufferSizeInBytes(maxOf(min*2,minimumPlaybackBytes)).build()
        check(track?.state==AudioTrack.STATE_INITIALIZED);track?.setVolume(1f);track?.play()
        val preparation=scope.async(Dispatchers.IO){runCatching{LiveOpusDecoder()}.getOrNull()};opusPreparation=preparation
        val frames=queue;val activeTrack=track!!
        playbackJob=scope.launch(Dispatchers.IO) {
            try {
                var opusRevision=-1;var opusStream=-1
                val diagnostic=context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0
                var windowStart=SystemClock.elapsedRealtime();var previousUnderruns=activeTrack.underrunCount
                var frameCount=0;var empty=0;var maxDecode=0L;var maxWait=0L;var maxGap=0L;var lastArrival=0L
                fun report() {
                    if(!diagnostic||frameCount==0)return
                    val underruns=activeTrack.underrunCount
                    Log.i("CodexWatchAudioDiag", "frames=$frameCount empty=$empty maxDecodeMs=$maxDecode maxQueueMs=$maxWait maxArrivalGapMs=$maxGap underruns=${underruns-previousUnderruns}")
                    previousUnderruns=underruns;frameCount=0;empty=0;maxDecode=0;maxWait=0;maxGap=0;windowStart=SystemClock.elapsedRealtime()
                }
                for(frame in frames) {
                    if(frame.epoch!=epoch)continue
                    val started=SystemClock.elapsedRealtime()
                    if(diagnostic){frameCount++;maxWait=maxOf(maxWait,started-frame.receivedAt);if(lastArrival>0)maxGap=maxOf(maxGap,frame.receivedAt-lastArrival);lastArrival=frame.receivedAt}
                    val raw=if(frame.encoding=="opus-24k"){
                        if(opusDisabled)continue
                        try {
                            require(frame.stream>0){"Flux Opus invalide"}
                            val decoder=preparation.await() ?: error("Décodeur Opus indisponible")
                            if(opusStream>=0&&(opusStream!=frame.stream||opusRevision!=frame.revision))decoder.reset()
                            opusStream=frame.stream;opusRevision=frame.revision
                            decoder.decode(frame.data)
                        }catch(e:CancellationException){throw e}catch(_:Exception){
                            opusDisabled=true
                            withContext(Dispatchers.Main){if(state==LiveState.CONNECTED){notice="Compression Opus indisponible · mode compatible";send(JSONObject().put("type","output_encoding").put("encoding","delta-deflate-pcm16"))}}
                            continue
                        }
                    } else decodeLiveAudio(frame.data,frame.encoding,frame.pcmBytes)
                    if(diagnostic){maxDecode=maxOf(maxDecode,SystemClock.elapsedRealtime()-started);if(raw.isEmpty())empty++}
                    val bytes=boostSpeechPcm16(raw)
                    var offset=0
                    while(isActive&&frame.epoch==epoch&&offset<bytes.size) {
                        val count=activeTrack.write(bytes,offset,minOf(2048,bytes.size-offset),AudioTrack.WRITE_NON_BLOCKING)
                        if(count<0)throw IllegalStateException()
                        if(count==0)delay(5) else {playbackEnergy=pcmEnergy(bytes,offset,count);offset+=count;if(playbackEnergy>.015f)lastAudio=SystemClock.elapsedRealtime()}
                    }
                    if(diagnostic&&SystemClock.elapsedRealtime()-windowStart>=5000)report()
                }
            } catch(e: CancellationException){throw e} catch(_: Exception){withContext(Dispatchers.Main){end("Lecture Live interrompue.")}}
            finally {withContext(NonCancellable){runCatching{preparation.await()?.close()}}}
        }
    }
    @SuppressLint("MissingPermission")
    private fun startCapture() {
        if(muted||state!=LiveState.CONNECTED||captureJob?.isActive==true)return
        val min=AudioRecord.getMinBufferSize(24000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT)
        check(min>0){"Microphone 24 kHz indisponible"}
        val recorder=AudioRecord.Builder().setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
            .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(24000).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build())
            .setBufferSizeInBytes(maxOf(min*4,7680)).build()
        check(recorder.state==AudioRecord.STATE_INITIALIZED){"Microphone indisponible"}
        capture=recorder
        if(AcousticEchoCanceler.isAvailable())echo=AcousticEchoCanceler.create(recorder.audioSessionId)?.also {it.enabled=true}
        if(NoiseSuppressor.isAvailable())noise=NoiseSuppressor.create(recorder.audioSessionId)?.also {it.enabled=true}
        recorder.startRecording()
        captureJob=scope.launch(Dispatchers.IO) {
            val turnDetector=DuplexTurnDetector()
            val bytes=ByteArray(1920);var lastSignal=0L;var lastMeter=0L
            try {
                while(isActive&&!muted) {
                    val count=recorder.read(bytes,0,bytes.size,AudioRecord.READ_BLOCKING)
                    if(count<=0)break
                    var sum=0.0
                    for(i in 0 until count-1 step 2){val sample=((bytes[i].toInt()and 255)or(bytes[i+1].toInt()shl 8)).toShort().toDouble();sum+=sample*sample}
                    val rms=(sqrt(sum/(count/2))/32768.0).toFloat();val now=SystemClock.elapsedRealtime()
                    if(turnDetector.frame(rms,now-lastAudio<450&&playbackEnergy>.015f)){withContext(Dispatchers.Main){interruptPlayback(true)}}
                    if(now-lastMeter>100){lastMeter=now;withContext(Dispatchers.Main){level=(rms*9).coerceIn(0f,1f)}}
                    if(rms>.02&&now-lastSignal>500){lastSignal=now;send(JSONObject().put("type","activity"))}
                    if((socket?.queueSize()?:0L)>512*1024){withContext(Dispatchers.Main){end("Réseau trop lent pour le microphone.")};break}
                    send(JSONObject().put("type","audio").put("audio",Base64.encodeToString(bytes,0,count-count%2,Base64.NO_WRAP)))
                }
            }catch(e: CancellationException){throw e}catch(_: Exception){withContext(Dispatchers.Main){end("Microphone Live interrompu.")}}
        }
    }
    private fun stopCapture() {
        captureJob?.cancel();captureJob=null
        runCatching{capture?.stop()};capture?.release();capture=null
        echo?.release();echo=null;noise?.release();noise=null;level=0f
    }
    fun toggleMute() {
        if(state!=LiveState.CONNECTED||reconnecting)return
        muted=!muted;send(JSONObject().put("type","mute").put("muted",muted))
        if(muted)stopCapture()else runCatching{startCapture()}.onFailure{end("Microphone indisponible.")}
    }
    fun select(kind: String){if(state==LiveState.CONNECTED&&!reconnecting)send(JSONObject().put("type","target").put("kind",kind))}
    fun interrupt(){interruptPlayback(false)}
    private fun interruptPlayback(voice:Boolean){if(state==LiveState.CONNECTED&&!reconnecting&&!waitingForInterruption){waitingForInterruption=true;clearAudio();send(JSONObject().put("type",if(voice)"speech_started" else "interrupt"))}}
    private fun clearAudio(){epoch++;while(queue.tryReceive().isSuccess){};runCatching{track?.pause();track?.flush();track?.play()};lastAudio=0;speaking=false}
    fun end(message: String="Appel terminé.") {
        if(state in listOf(LiveState.ENDING,LiveState.ENDED,LiveState.IDLE))return
        notice=message;state=LiveState.ENDING;stopAudio();reconnectTimer?.cancel();send(JSONObject().put("type","close"));reconnecting=false
        closeJob=scope.launch{delay(12000);socket?.cancel();finish(message)}
    }
    private fun stopAudio(){stopCapture();playbackJob?.cancel();playbackJob=null;queue.close();runCatching{track?.stop()};track?.release();track=null;speaking=false
        focus?.let{manager.abandonAudioFocusRequest(it)};focus=null}
    private fun finish(message: String){revision++;socketRevision++;reconnecting=false;reconnectTimer?.cancel();stopAudio();state=LiveState.ENDED;notice=message;heartbeat?.cancel();closeJob?.cancel();socket?.close(1000,null);socket=null}
    fun dispose(){end();scope.launch{delay(13000);http.dispatcher.executorService.shutdown();http.connectionPool.evictAll();scope.cancel()}}
}
