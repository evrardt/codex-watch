package fr.thomas.codexwatch

import androidx.compose.ui.res.stringResource
import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import android.speech.RecognizerIntent
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.wear.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.UUID

fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }

open class MainActivity : ComponentActivity() {
    private var entry by mutableIntStateOf(0)
    private var voiceEntry by mutableStateOf(false)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        voiceEntry = savedInstanceState == null && intent.getBooleanExtra("voice", false)
        setContent { WatchTheme { WatchApp(entry, voiceEntry) { voiceEntry = false } } }
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent); setIntent(intent)
        voiceEntry = intent.getBooleanExtra("voice", false); entry++
    }
    override fun onPause() { DictationAlerts.gate.cancel(); super.onPause() }

    @Composable private fun WatchApp(entry: Int, voiceEntry: Boolean, consumeVoice: () -> Unit) {
        val context = LocalContext.current
        val displayLocale = LocalConfiguration.current.locales[0] ?: java.util.Locale.getDefault()
        val scope = rememberCoroutineScope()
        val store = remember { ConnectionStore(context) }
        val readState = remember { ReadStateStore(context) }
        val navigation = remember { NavigationStore(context) }
        val audioPrefs = remember { AudioSettingsStore(context) }
        val editorFocus = remember { FocusRequester() }
        val keyboard = LocalSoftwareKeyboardController.current
        val haptic = LocalHapticFeedback.current
        val editorFocusManager = LocalFocusManager.current
        var editorRequest by remember { mutableIntStateOf(0) }
        var editOnOpen by remember { mutableStateOf(false) }
        var slot by rememberSaveable { mutableStateOf(store.activeSlot()) }
        var connection by remember { mutableStateOf(runCatching { store.read(slot) }.getOrElse { Connection(slot, "", "") }) }
        val api = remember(connection) { BridgeApi(connection) }
        val bluetoothSettings=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
            connection=runCatching{store.read(slot)}.getOrElse{connection}
            runCatching{DirectNotifications.refresh(context.applicationContext)}
        }
        var screen by rememberSaveable { mutableStateOf(if (connection.token.isEmpty()) "welcome" else "home") }
        var preview by rememberSaveable { mutableStateOf(false) }
        var error by remember { mutableStateOf("") }
        var networkError by remember { mutableStateOf("") }
        var notice by rememberSaveable { mutableStateOf("") }
        var loading by remember { mutableStateOf(false) }
        var health by remember { mutableStateOf(JSONObject()) }
        var projects by remember { mutableStateOf(emptyList<JSONObject>()) }
        var threads by remember { mutableStateOf(emptyList<JSONObject>()) }
        var recentThreads by remember { mutableStateOf(emptyList<JSONObject>()) }
        var recentUnavailable by remember { mutableStateOf(emptyList<String>()) }
        var lastChat by remember(connection) { mutableStateOf(navigation.last(connection)) }
        var threadsLoaded by remember { mutableStateOf(false) }
        var showProjects by rememberSaveable { mutableStateOf(false) }
        var showSearch by rememberSaveable { mutableStateOf(false) }
        var choosingNewProject by rememberSaveable { mutableStateOf(false) }
        var events by remember { mutableStateOf(emptyList<JSONObject>()) }
        var approvals by remember { mutableStateOf(emptyList<JSONObject>()) }
        var pendingSignals by remember { mutableStateOf(emptyList<JSONObject>()) }
        var requestRefresh by remember { mutableIntStateOf(0) }
        var sendingRequestKey by remember(connection) { mutableStateOf("") }
        var settlingRequest by remember(connection) { mutableStateOf(false) }
        var failedRequestKey by remember(connection) { mutableStateOf("") }
        var completedRequestKeys by remember(connection) { mutableStateOf(emptySet<String>()) }
        var cursor by remember { mutableStateOf("") }
        var threadSearch by rememberSaveable { mutableStateOf("") }
        var projectId by rememberSaveable { mutableStateOf("") }
        var projectName by rememberSaveable { mutableStateOf("") }
        var kind by rememberSaveable { mutableStateOf("codex") }
        var threadId by rememberSaveable { mutableStateOf("") }
        var threadEntry by rememberSaveable { mutableIntStateOf(0) }
        var focusOnRequest by rememberSaveable { mutableStateOf(false) }
        var threadOrigin by rememberSaveable { mutableStateOf("home") }
        var detail by remember { mutableStateOf(JSONObject()) }
        var draft by rememberSaveable { mutableStateOf("") }
        var draftDictated by rememberSaveable { mutableStateOf(false) }
        var autoReadDictation by remember { mutableStateOf(true) }
        var autoSpeakAnchor by rememberSaveable { mutableStateOf("") }
        var autoSpeakText by rememberSaveable { mutableStateOf("") }
        var autoSpeakBaseline by rememberSaveable { mutableStateOf("[]") }
        var requestId by rememberSaveable { mutableStateOf(UUID.randomUUID().toString()) }
        var creatingId by rememberSaveable { mutableStateOf("") }
        var creatingSlot by rememberSaveable { mutableStateOf("") }
        var creatingKind by rememberSaveable { mutableStateOf("") }
        var creatingText by rememberSaveable { mutableStateOf("") }
        var creatingAutoRead by rememberSaveable { mutableStateOf(false) }
        var creatingStartedAt by rememberSaveable { mutableLongStateOf(0L) }
        var creatingStatus by remember { mutableStateOf("") }
        var pluginSelection by rememberSaveable { mutableStateOf("[]") }
        val pluginPicker=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()){result->if(result.resultCode==android.app.Activity.RESULT_OK){pluginSelection=result.data?.getStringExtra("selection")?:"[]";requestId=UUID.randomUUID().toString()}}
        var inferenceRevision by remember { mutableIntStateOf(0) }
        val modelPicker=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()){inferenceRevision++}
        DisposableEffect(lifecycle) {
            val observer=LifecycleEventObserver { _,event -> if(event==Lifecycle.Event.ON_RESUME)inferenceRevision++ }
            lifecycle.addObserver(observer);onDispose{lifecycle.removeObserver(observer)}
        }
        val threadInference=remember(connection,threadId,inferenceRevision){InferenceStore(context).read(connection,threadId)}
        var draftOrigin by rememberSaveable { mutableStateOf("home") }
        var configSlot by rememberSaveable { mutableStateOf(slot) }
        var configUrl by rememberSaveable { mutableStateOf("") }
        // Tokens intentionally are not saved into the Android instance-state bundle.
        var configToken by remember { mutableStateOf("") }
        var pushStatus by remember { mutableStateOf("") }
        var clock by remember { mutableStateOf("") }
        var autoSpeak by remember { mutableStateOf(false) }
        var spokenId by remember { mutableStateOf("") }
        var audioMode by remember { mutableStateOf("watch") }
        var effectiveAudioMode by remember(connection) { mutableStateOf(audioPrefs.mode(connection)) }
        var audioVoice by remember { mutableStateOf("marin") }
        var audioLimit by remember { mutableStateOf("5.00") }
        var audioBudget by remember { mutableStateOf(JSONObject()) }
        var audioLoaded by remember { mutableStateOf(false) }
        var audioReturnFromVoices by remember { mutableStateOf(false) }
        var phononLanguage by remember { mutableStateOf("fr") }
        val speech = remember { SpeechPlayer(context) }
        val messageCache = remember(connection,threadId) { MessageFormatCache() }
        DisposableEffect(Unit) { onDispose { speech.close() } }
        LaunchedEffect(speech.error) { if (speech.error.isNotBlank()) { DictationAlerts.gate.cancel();error = speech.error } }
        LaunchedEffect(autoReadDictation) { if(!autoReadDictation)DictationAlerts.gate.cancel() }
        fun speak(text: String, id: String, onStarted:(() -> Unit)? = null) {
            scope.launch {
                var mode=audioPrefs.mode(connection)
                var relayAvailable=!preview
                if (!preview) try {
                    val settings=api.request("/v1/audio/settings",timeoutMs=2500)
                    audioPrefs.saveSpeeds(connection,settings.optJSONObject("speechSpeeds"))
                    val remote=settings.optString("mode",mode)
                    if (remote in listOf("watch","openai","phonon")) { mode=remote; audioPrefs.select(connection,mode); effectiveAudioMode=mode }
                } catch (e: kotlinx.coroutines.CancellationException) { throw e }
                catch (_: Exception) { relayAvailable=false }
                try { speech.play(id, formatMessage(text, false, forSpeech=true).text, api, relayAvailable && mode != "watch", audioPrefs.speed(connection,mode), audioPrefs.speed(connection,"watch"), onStarted) }
                catch (e: Exception) { if(onStarted!=null)DictationAlerts.gate.cancel();error = e.message ?: "Lecture indisponible" }
            }
        }
        fun selectAudioMode(mode: String) {
            if (loading || !audioLoaded) return
            loading=true; error=""
            scope.launch {
                try {
                    val result=api.request("/v1/audio/mode","PUT",JSONObject().put("mode",mode))
                    audioBudget=result; audioMode=mode; effectiveAudioMode=mode; audioPrefs.select(connection,mode); speech.stop()
                } catch (e: Exception) { error=e.message ?: "Choix non enregistré" }
                finally { loading=false }
            }
        }
        fun navigate(target: String) { if(screen=="thread"&&target!="thread")DictationAlerts.gate.cancel();error = ""; networkError = ""; screen = target }
        fun settings(target: String = slot) {
            configSlot = target
            try { val c = store.read(target); configUrl = c.url; configToken = "" }
            catch (_: Exception) { configUrl = ""; configToken = ""; error = "Réassocier ce profil" }
            navigate("settings")
        }
        fun selectConnection(value: String) {
            try {
                val c = store.read(value)
                if (c.token.isBlank()) settings(value)
                else {
                    DictationAlerts.gate.cancel(); speech.stop()
                    store.select(value); slot = value; connection = c; health = JSONObject()
                    projects = emptyList(); threads = emptyList(); recentThreads = emptyList(); recentUnavailable = emptyList()
                    projectId = ""; threadId = ""; navigate("home")
                }
            } catch (_: Exception) { settings(value) }
        }
        fun associate() {
            if(loading)return
            loading=true;error=""
            scope.launch {
                try {
                    val entered=configToken.trim()
                    val pairing=if(Regex("[0-9]{6}").matches(entered))BridgeApi.pair(configUrl,entered)else null
                    val secret=pairing?.getString("token")?:entered.ifBlank { store.read(configSlot).token }
                    val c=Connection(configSlot,ConnectionStore.normalizeUrl(configUrl),secret)
                    require(c.token.length>=32){"Jeton d’association incomplet"}
                    val result=BridgeApi(c).health()
                    pairing?.optJSONObject("receipt")?.let { receipt ->
                        try { BridgeApi(c).request("/v1/pair/confirm","POST",receipt) }
                        catch (first: Exception) {
                            if(first is kotlinx.coroutines.CancellationException)throw first
                            delay(500)
                            try { BridgeApi(c).request("/v1/pair/confirm","POST",receipt) }
                            catch (second: Exception) { if(second is kotlinx.coroutines.CancellationException)throw second;throw IllegalStateException("Confirmation non reçue. Génère un nouveau code et réessaie.") }
                        }
                    }
                    store.save(configSlot,c.url,c.token);store.select(configSlot);slot=configSlot
                    CloudNotifications.reconcile(context.applicationContext)
                    runCatching{DirectNotifications.refresh(context.applicationContext)}
                    connection=c;configToken="";health=result;projectId="";threadId="";preview=false;navigate("home")
                    Toast.makeText(context,context.getString(R.string.app_paired),Toast.LENGTH_LONG).show()
                }catch(e:Exception){error=e.message?:"Association impossible"}finally{loading=false}
            }
        }
        fun openThread(id: String, type: String, origin: String = screen) {
            DictationAlerts.gate.cancel()
            threadOrigin = origin.takeIf { it in listOf("home", "threads", "activity") } ?: "home"
            threadEntry++
            focusOnRequest = type == "codex" && (approvals + pendingSignals).any { it.optString("threadId") == id }
            threadId = id; kind = type; detail = JSONObject(); autoSpeak = false; notice = ""; navigate("thread")
        }
        fun openRecent(chat: JSONObject) {
            projectId = chat.optString("projectId"); projectName = chat.optString("projectName")
            openThread(chat.getString("id"), chat.optString("kind", "codex"), "home")
        }
        fun openLibrary(type: String) {
            kind = type; threadId = ""; threadSearch = ""; threads = emptyList(); projects = emptyList()
            projectId = navigation.project(connection, type); projectName = ""
            threadsLoaded = false; showProjects = false; showSearch = false; choosingNewProject = false; notice = ""
            navigate("threads")
        }
        LaunchedEffect(screen) {
            if (screen == "assistants") openLibrary("chatgpt")
            else if (screen == "projects") openLibrary(kind)
        }
        fun compose(type: String, existing: String = "", origin: String = screen, voiceFirst: Boolean = false) {
            pluginSelection="[]"
            kind = type; threadId = existing; draft = ""; draftDictated = false; draftOrigin = origin
            if (origin != "thread") threadOrigin = origin.takeIf { it in listOf("home", "threads", "activity") } ?: "home"
            editOnOpen = !voiceFirst; editorRequest++
            requestId = UUID.randomUUID().toString(); navigate("compose")
        }
        val voice = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == RESULT_OK) {
                val text = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
                if (!text.isNullOrBlank()) { draft = appendDictation(draft,text); draftDictated = true; requestId=UUID.randomUUID().toString(); navigate("compose") }
            }
        }
        fun dictate() {
            try {
                voice.launch(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_PROMPT, context.getString(if (kind == "chat") R.string.app_prompt_assistant else R.string.app_prompt_codex)))
            } catch (_: ActivityNotFoundException) { error = "Dictée indisponible. Utiliser le clavier de la montre." }
        }
        fun activateNotifications() {
            try {
                DirectNotifications.enable(context.applicationContext)
                if (health.optBoolean("push")) CloudNotifications.register(context.applicationContext, connection, health) { pushStatus = it }
                else pushStatus = ""
            } catch (e: Exception) { pushStatus = e.message ?: "Activation impossible" }
        }
        val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) activateNotifications() else pushStatus = "Notifications désactivées dans Android"
        }
        fun allowNotifications() {
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                permission.launch(Manifest.permission.POST_NOTIFICATIONS)
            else activateNotifications()
        }
        LaunchedEffect(Unit) { runCatching { DirectNotifications.refresh(context.applicationContext) } }
        LaunchedEffect(connection, health.optBoolean("push"), entry) {
            if (health.optBoolean("push") && (DirectNotifications.enabled || CloudNotifications.enabled))
                CloudNotifications.register(context.applicationContext, connection, health) { pushStatus = it }
        }
        fun back() {
            speech.stop()
            if (screen == "phononVoices") { navigate("phononLanguages"); return }
            if (screen == "audioSpeed") { navigate("audioProvider"); return }
            if (screen == "phononLanguages") { navigate("audioProvider"); return }
            if (screen == "audioProvider" || screen == "audioBudget") { audioReturnFromVoices = true; navigate("audio"); return }
            if (screen == "threads" && showProjects) { showProjects = false; choosingNewProject = false; return }
            if (screen == "threads" && showSearch) { showSearch = false; threadSearch = ""; threadsLoaded = false; return }
            navigate(when (screen) {
                "compose", "confirm" -> draftOrigin
                "creating" -> "threads"
                "threads" -> "home"
                "thread" -> threadOrigin
                "audio", "notifications", "connections", "activity" -> "preferences"
                "settings" -> "connections"
                else -> "home"
            })
        }
        BackHandler(enabled = screen != "home" && screen != "welcome" && !loading) { back() }
        fun sendDraft() {
            if(loading || draft.isBlank() || health.optBoolean("demo")) return
            val submittedText=draft
            val submittedId=requestId
            haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
            keyboard?.hide(); editorFocusManager.clearFocus(); loading = true; error = ""
            scope.launch {
                try {
                    val previousIds=detail.optJSONArray("messages")?.objects().orEmpty().map{it.optString("id")}.filter{it.isNotBlank()}
                    val shouldRead=draftDictated && (try { api.request("/v1/audio/settings",timeoutMs=2500).optBoolean("autoReadDictation",autoReadDictation) } catch (_: Exception) { autoReadDictation })
                    if(draftDictated)autoReadDictation=shouldRead
                    if(shouldRead&&lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))DictationAlerts.gate.arm(slot,kind,threadId,submittedId)
                    val result = api.send(kind, threadId, projectId, submittedText, submittedId,InferenceStore(context).read(connection,threadId),JSONArray(pluginSelection).objects().map{it.getString("id")})
                    draft = ""; draftDictated=false
                    if (result.optBoolean("pending")) {
                        DictationAlerts.gate.cancel()
                        creatingId=submittedId;creatingSlot=slot;creatingKind=kind;creatingText=submittedText;creatingAutoRead=shouldRead
                        creatingStartedAt=System.currentTimeMillis();creatingStatus="Le PC prépare la conversation. Création non confirmée.";navigate("creating")
                    } else {
                        threadId = result.getString("id"); detail = JSONObject(); spokenId = ""; autoSpeak=shouldRead;autoSpeakAnchor=submittedId;autoSpeakText=submittedText;autoSpeakBaseline=JSONArray(previousIds).toString(); if(shouldRead&&lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))DictationAlerts.gate.arm(slot,kind,threadId,submittedId);navigate("thread")
                    }
                } catch (e: Exception) {
                    DictationAlerts.gate.cancel()
                    val definite = e is BridgeException && e.status in 400..499 && e.code != "SUBMISSION_UNCERTAIN"
                    error = submissionError(e.message,definite)
                } finally { loading = false }
            }
        }
        LaunchedEffect(screen,connection,creatingId) {
            if(screen!="creating"||creatingId.isBlank()||creatingSlot!=slot)return@LaunchedEffect
            lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                val requested=creatingId
                while(screen=="creating"&&creatingId==requested) {
                    var nextDelay=5000L
                    try {
                        val result=api.request("/v1/operations/${BridgeApi.encode(requested)}",timeoutMs=20000)
                        if(screen!="creating"||creatingId!=requested)return@repeatOnLifecycle
                        when(val creation=pendingCreation(result,creatingKind)) {
                            is PendingCreation.Ready -> {
                                val created=creation.id
                                threadId=created;kind=creatingKind;threadEntry++;detail=JSONObject();spokenId=""
                                autoSpeak=creatingAutoRead;autoSpeakAnchor=requested;autoSpeakText=creatingText;autoSpeakBaseline="[]"
                                if(autoSpeak&&lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))DictationAlerts.gate.arm(slot,kind,threadId,requested)
                                creatingId="";creatingStatus="";navigate("thread");return@repeatOnLifecycle
                            }
                            PendingCreation.Ambiguous -> creatingStatus="Plusieurs conversations possibles. Ouvre la bonne dans la liste."
                            PendingCreation.Uncertain -> creatingStatus="Réception à vérifier dans la liste avant de renvoyer."
                            PendingCreation.Waiting -> {
                                creatingStatus=pendingCreationMessage(result,System.currentTimeMillis()-creatingStartedAt)
                                if(result.optString("reason")=="rate_limited") {
                                    val seconds=result.optInt("retryAfterSeconds",30).coerceAtLeast(1)
                                    nextDelay=(seconds.toLong()*1000).coerceIn(5000L,30000L)
                                }
                            }
                        }
                    } catch(e:kotlinx.coroutines.CancellationException){throw e}
                    catch(e:Exception){creatingStatus="Ouverture en attente · le relais réessaie."}
                    delay(nextDelay)
                }
            }
        }
        LaunchedEffect(entry) {
            if (voiceEntry) {
                consumeVoice()
                if (connection.token.isBlank()) settings()
                else startActivity(Intent(context,VoiceActivity::class.java))
            } else if (intent.hasExtra("event_id") || intent.hasExtra("eventId")) {
                val targetSlot = intent.getStringExtra("profile") ?: slot
                if (targetSlot in listOf("pc", "server")) {
                    try {
                        val c = store.read(targetSlot)
                        if (c.token.isNotBlank()) { store.select(targetSlot); slot = targetSlot; connection = c }
                    } catch (_: Exception) { error = "Connexion de la notification à réassocier" }
                }
                val targetThread = intent.getStringExtra("threadId").orEmpty()
                if (targetThread.isNotEmpty()) {
                    projectId = ""; projectName = ""
                    openThread(targetThread, intent.getStringExtra("kind") ?: "codex", "home")
                    if (intent.getBooleanExtra("focusRequest", false)) focusOnRequest = true
                } else navigate("activity")
            }
        }
        LaunchedEffect(connection) {
            speech.stop()
            health = JSONObject()
            recentThreads = emptyList(); recentUnavailable = emptyList(); threads = emptyList(); threadsLoaded = false
            if (connection.token.isNotBlank()) {
                try { health = api.health(); networkError = "" }
                catch (e: kotlinx.coroutines.CancellationException) { throw e }
                catch (e: Exception) { health = JSONObject(); networkError = e.message ?: "Relais injoignable. Vérifier Connexions." }
            }
        }
        LaunchedEffect(screen, connection) {
            if (screen != "audio") return@LaunchedEffect
            audioLoaded = false; audioBudget = JSONObject()
            if (!audioReturnFromVoices) audioMode = audioPrefs.mode(connection)
            audioReturnFromVoices = false
            audioVoice = "marin"; audioLimit = "5.00"
            if (!preview) try {
                val result = api.request("/v1/audio/settings")
                audioBudget = result; audioVoice = result.optString("voice", "marin")
                autoReadDictation=result.optBoolean("autoReadDictation",true)
                audioMode = result.optString("mode",audioMode); effectiveAudioMode=audioMode; audioPrefs.select(connection,audioMode)
                audioLimit = String.format(java.util.Locale.US, "%.2f", result.optInt("monthlyLimitCents", 500) / 100.0)
                audioLoaded = true
            } catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (_: Exception) { error = "Relais indisponible. La voix de la montre reste utilisable." }
        }
        LaunchedEffect(screen, connection, preview) {
            if (preview || screen !in listOf("audio", "audioProvider", "audioBudget", "phononLanguages", "phononVoices")) return@LaunchedEffect
            while (true) {
                delay(5000)
                if (!loading) try {
                    val result=api.request("/v1/audio/settings")
                    if (!loading) { audioBudget=result; audioLoaded=true; autoReadDictation=result.optBoolean("autoReadDictation",true); audioMode=result.optString("mode",audioMode); effectiveAudioMode=audioMode; audioPrefs.select(connection,audioMode) }
                }
                catch (e: kotlinx.coroutines.CancellationException) { throw e }
                catch (_: Exception) { /* Keep the last selection visible until the relay reconnects. */ }
            }
        }
        LaunchedEffect(connection, preview) {
            if (preview) return@LaunchedEffect
            lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    try {
                        val result=api.request("/v1/audio/settings")
                        if (!loading) { autoReadDictation=result.optBoolean("autoReadDictation",true); val mode=result.optString("mode",effectiveAudioMode); if (mode in listOf("watch","openai","phonon")) { effectiveAudioMode=mode; audioPrefs.select(connection,mode) } }
                    } catch (e: kotlinx.coroutines.CancellationException) { throw e }
                    catch (_: Exception) { }
                    delay(15000)
                }
            }
        }
        LaunchedEffect(screen, connection, kind, projectId, threadId, threadEntry, preview, threadSearch) {
            lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                var threadTag=""
                var threadSnapshot:String?=null
                if (screen == "threads" && threadSearch.isNotBlank()) delay(400)
                do {
                    var refreshFailed = false
                    try {
                        if (preview) {
                            health = JSONObject().put("demo", true)
                            projects = listOf(JSONObject().put("id", "example").put("name", context.getString(R.string.demo_project)))
                            threads = listOf(JSONObject().put("id", "example").put("title", context.getString(R.string.demo_thread)).put("status", "completed"))
                            if (screen == "thread") detail = JSONObject().put("id", "example").put("title", context.getString(R.string.demo_title)).put("status", "completed")
                                .put("messages", JSONArray().put(JSONObject().put("role", "user").put("text", context.getString(R.string.demo_question))).put(JSONObject().put("role", "assistant").put("text", context.getString(R.string.demo_answer))))
                        } else when (screen) {
                            "home" -> {
                                health = api.health()
                                val recent = try { api.request("/v1/recents") } catch (e: BridgeException) { if (e.status == 404) JSONObject() else throw e }
                                recentThreads = recent.optJSONArray("data")?.objects().orEmpty()
                                val unavailable = recent.optJSONArray("unavailable") ?: JSONArray()
                                recentUnavailable = (0 until unavailable.length()).map { unavailable.getString(it) }
                            }
                            "threads" -> {
                                if (kind != "chat") {
                                    projects = api.request("/v1/projects?kind=$kind").optJSONArray("data")?.objects().orEmpty()
                                    if (projectId.isNotEmpty() && projects.none { it.optString("id") == projectId }) projectId = ""
                                    if (kind == "codex" && !health.optBoolean("codexAllProjects") && projectId.isEmpty() && projects.isNotEmpty()) projectId = projects.first().getString("id")
                                    projectName = projects.find { it.optString("id") == projectId }?.optString("name").orEmpty()
                                }
                                val result = api.request("/v1/threads?kind=$kind&project=${BridgeApi.encode(projectId)}&q=${BridgeApi.encode(threadSearch)}")
                                threads = result.optJSONArray("data")?.objects().orEmpty(); cursor = result.optString("nextCursor").takeIf { it != "null" }.orEmpty()
                                threadsLoaded = true
                            }
                            "thread" -> {
                                val incoming=api.request("/v1/threads/${BridgeApi.encode(threadId)}?kind=$kind",ifNoneMatch=threadTag)
                                if(!incoming.optBoolean("_watchUnchanged")) {
                                    threadTag=incoming.optString("_watchEtag")
                                    val fingerprint=withContext(Dispatchers.Default){incoming.toString()}
                                    if(fingerprint!=threadSnapshot){
                                        threadSnapshot=fingerprint;detail=incoming
                                        navigation.remember(connection, kind, detail, projectId, projectName)
                                        lastChat = navigation.last(connection)
                                    }
                                }
                                if(autoSpeak&&autoReadDictation){
                                    val rows=detail.optJSONArray("messages")?.objects().orEmpty()
                                    val ids=JSONArray(autoSpeakBaseline).let { data -> (0 until data.length()).map{data.optString(it)}.toSet() }
                                    val last = dictatedAnswer(rows,autoSpeakAnchor,autoSpeakText,ids)
                                    if (last != null && last.optString("id") != spokenId && detail.optString("status") != "active" && !detail.optBoolean("historyStale")) {
                                        spokenId = last.optString("id"); val sourceSlot=slot;val sourceKind=kind;val sourceThread=threadId;val sourceRequest=autoSpeakAnchor
                                        speak(last.optString("text"), spokenId) { DictationAlerts.gate.started(sourceSlot,sourceKind,sourceThread,sourceRequest) }; autoSpeak = false
                                    }
                                }
                            }
                            "activity" -> { events = api.request("/v1/events").optJSONArray("data")?.objects().orEmpty() }
                        }
                        networkError = ""
                    } catch (e: kotlinx.coroutines.CancellationException) { throw e }
                    catch (e: Exception) { networkError = e.message ?: "Connexion interrompue"; refreshFailed = true }
                    delay(if (refreshFailed) 5000 else if (screen == "thread") 3500 else 20000)
                } while (refreshFailed || screen in listOf("home", "thread", "activity"))
            }
        }
        LaunchedEffect(screen, connection, preview, requestRefresh) {
            if (preview || screen !in listOf("home", "threads", "thread")) return@LaunchedEffect
            lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    try {
                        val result = api.request("/v1/approvals")
                        approvals = mergePendingRequests(result.optJSONArray("data")?.objects().orEmpty(), approvals,
                            sendingRequestKey, failedRequestKey, completedRequestKeys) { it.optString("key") }
                        pendingSignals = result.optJSONArray("desktopPending")?.objects().orEmpty()
                    } catch (e: kotlinx.coroutines.CancellationException) { throw e }
                    catch (_: Exception) { /* Keep the current list until the next successful refresh. */ }
                    delay(4000)
                }
            }
        }
        LaunchedEffect(connection) { approvals = emptyList(); pendingSignals = emptyList() }
        LaunchedEffect(screen, threadId) { failedRequestKey = "" }
        LaunchedEffect(Unit) {
            lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) { clock = LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm")); delay(30000) }
            }
        }
        val messageItems = remember(detail) { detail.optJSONArray("messages")?.objects().orEmpty() }
        val threadRequests = if (screen == "thread" && kind == "codex") approvals.filter { it.optString("threadId") == threadId } else emptyList()
        val pendingThreadIds = (approvals + pendingSignals).mapNotNull { it.optString("threadId").takeIf(String::isNotBlank) }.toSet()
        val taskActive = detail.optString("status") == "active"
        val historyCursor = detail.optString("historyCursor").takeUnless { it == "null" }.orEmpty()
        val readingKey = "$slot\u0000${connection.url}\u0000$kind\u0000$threadId"
        val readMarkerOnOpen = remember(screen, readingKey, threadEntry) { readState.read(readingKey) }
        val lastAssistantIndex = messageItems.indexOfLast { it.optString("role") == "assistant" }
        val lastAssistantMarker = messageItems.getOrNull(lastAssistantIndex)?.let {
            ReadStateStore.messageMarker(it.optString("id"), it.optString("text"))
        }.orEmpty()
        // Clock, optional banners, title and subtitle precede the transcript's bottom marker.
        val displayError = error.ifBlank { networkError }
        val headerItemCount = 1 + (if (health.optBoolean("demo") && !preview) 1 else 0) +
            (if (displayError.isNotBlank()) 1 else 0) + (if (loading) 1 else 0)
        val transcriptStartIndex = headerItemCount + 2 + (if (detail.optString("source") == "chatgpt-export") 1 else 0) +
            (if (historyCursor.isNotBlank()) 1 else 0)
        val conversationEndIndex = if (screen == "thread" && detail.has("id"))
            transcriptStartIndex + messageItems.size + (if (taskActive) 1 else 0) + threadRequests.size + (if (detail.optString("error").isNotBlank()) 1 else 0) else null
        val unreadOpeningIndex = if (lastAssistantIndex >= 0 && lastAssistantMarker != readMarkerOnOpen)
            transcriptStartIndex + lastAssistantIndex else null
        val transcriptRevision = messageItems.lastOrNull()?.let { "${it.optString("id")}:${it.optString("text").hashCode()}:$taskActive:${detail.optString("error")}" }.orEmpty() + threadRequests.joinToString { it.optString("key") }
        val listKey = when (screen) { "threads" -> "$screen:$slot:$kind:$projectId"; "thread" -> "$screen:$slot:$kind:$threadId:$threadEntry"; else -> "$screen:$slot" }
        WatchList(listKey, initialEndIndex = conversationEndIndex, restorePosition = screen in listOf("home", "threads", "activity"),
            openingItemIndex = if (screen == "compose") headerItemCount + 2 else if(screen=="creating"&&creatingText.isNotBlank())headerItemCount + 1 else if (screen == "thread" && threadRequests.isEmpty()) unreadOpeningIndex else null,
            contentRevision = transcriptRevision,
            pauseAutoFollow = screen == "thread" && (sendingRequestKey.isNotBlank() || settlingRequest),
            requestFocusRevision = if (focusOnRequest && detail.has("id") && threadRequests.isNotEmpty()) threadRequests.joinToString { it.optString("key") } else "",
            requestFocusIndex = if (focusOnRequest && detail.has("id") && threadRequests.isNotEmpty()) transcriptStartIndex + messageItems.size + (if (taskActive) 1 else 0) else null,
            onItemsVisible = { indices ->
                if (screen == "thread" && lastAssistantIndex >= 0 && indices.contains(transcriptStartIndex + lastAssistantIndex))
                    readState.mark(readingKey, lastAssistantMarker)
            }, bottomAction = if (screen in listOf("compose", "confirm")) ({
                Column(horizontalAlignment=Alignment.CenterHorizontally) {
                    if(error.isNotBlank()&&!loading) Text(statusText(error),color=Color(0xFFFFBA9D),fontSize=10.sp,lineHeight=12.sp,maxLines=3)
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceEvenly){
                        Column(Modifier.clickable(enabled=!loading){editOnOpen=false;keyboard?.hide();editorFocusManager.clearFocus();pluginPicker.launch(Intent(context,PluginPickerActivity::class.java).putExtra("selection",pluginSelection))},horizontalAlignment=Alignment.CenterHorizontally){IconButton(onClick={editOnOpen=false;keyboard?.hide();editorFocusManager.clearFocus();pluginPicker.launch(Intent(context,PluginPickerActivity::class.java).putExtra("selection",pluginSelection))},enabled=!loading,modifier=Modifier.size(48.dp).background(Lilac.copy(alpha=.2f),CircleShape)){Icon(Icons.Rounded.Extension,stringResource(R.string.ui_25eeb246ac1c),tint=Lilac)};Text("Plugins",fontSize=12.sp,lineHeight=14.sp,maxLines=1)}
                        Column(Modifier.clickable(enabled=draft.isNotBlank()&&!loading&&!health.optBoolean("demo")){sendDraft()},horizontalAlignment=Alignment.CenterHorizontally){IconButton(onClick={sendDraft()},enabled=draft.isNotBlank()&&!loading&&!health.optBoolean("demo"),modifier=Modifier.size(48.dp).background(Mint.copy(alpha=.2f),CircleShape)){if(loading)CircularProgressIndicator(Modifier.size(22.dp),color=Mint,strokeWidth=2.dp) else Icon(Icons.Rounded.Send,stringResource(R.string.ui_79075209f2bb),tint=Mint)};Text(if(loading)stringResource(R.string.ui_1ccef8a10ca7) else stringResource(R.string.ui_79075209f2bb),fontSize=12.sp,lineHeight=14.sp,maxLines=1)}
                    }
                }
            }) else null) {
            item { Eyebrow(if (preview) "$clock · ${stringResource(R.string.app_preview)}" else if (screen == "home") "$clock  ·  ${if (slot == "pc") "PC" else stringResource(R.string.app_server)}" else clock, Muted) }
            if (health.optBoolean("demo") && !preview) item { SmallNote(stringResource(R.string.ui_24a1ba87cec4), Lilac) }
            if (displayError.isNotBlank()) item { SmallNote(statusText(displayError), Color(0xFFFFBA9D)) }
            if (loading) item { CircularProgressIndicator(Modifier.size(22.dp), color = Mint, strokeWidth = 2.dp) }
            when (screen) {
                "welcome" -> {
                    item { VoiceOrb { settings() } }
                    item { SmallNote(stringResource(R.string.ui_e0458ad4193b)) }
                    item { ActionButton(stringResource(R.string.ui_a12845022289), Icons.Rounded.Computer) { settings("pc") } }
                    item { ActionButton(stringResource(R.string.ui_506b15ff5b20), Icons.Rounded.Cloud) { settings("server") } }
                    item { TextButton(onClick = { preview = true; navigate("home") }, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.ui_91c1696532fb), fontSize = 12.sp, color = Lilac) } }
                    item { SmallNote(stringResource(R.string.ui_c6ead326333e)) }
                }
                "home" -> {
                    item { Eyebrow(stringResource(R.string.ui_6753ba13dc6b), Lilac) }
                    if(creatingId.isNotBlank()&&creatingSlot==slot)item{WatchCard(stringResource(R.string.ui_137aa0409065),stringResource(R.string.ui_14c61cd87998),Icons.Rounded.Pending,Lilac){navigate("creating")}}
                    item { Row(Modifier.requiredWidth((LocalConfiguration.current.screenWidthDp-32).dp), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        WatchQuickAction("Live", Icons.Rounded.Call, LiveRed, Modifier.weight(1f)) { startActivity(Intent(context,VoiceActivity::class.java)) }
                        WatchQuickAction("Chat", Icons.Rounded.Forum, Lilac, Modifier.weight(1f)) { openLibrary("chatgpt") }
                        WatchQuickAction("Codex", Icons.Rounded.Terminal, Mint, Modifier.weight(1f)) { openLibrary("codex") }
                    } }
                    val resume = lastChat?.takeIf { it.optString("kind") in listOf("codex", "chatgpt") }
                    if (resume != null) {
                        item { Eyebrow(stringResource(R.string.ui_ddd913203fe2)) }
                        item {
                            val current = recentThreads.find { it.optString("id") == resume.optString("id") && it.optString("kind") == resume.optString("kind") }
                            val state = current?.optString("status").orEmpty(); val pending = resume.optString("kind") == "codex" && resume.optString("id") in pendingThreadIds
                            val fallbackTitle = stringResource(R.string.state_last_chat)
                            WatchCard(resume.optString("title").ifBlank { fallbackTitle }, listOf(sourceLabel(resume.optString("kind")), if (pending) stringResource(R.string.state_pending_request) else if (state.isNotBlank()) statusLabel(state) else "").filter { it.isNotBlank() }.joinToString(" · "), if (pending) Icons.Rounded.HelpOutline else if (state in listOf("idle", "completed")) Icons.Rounded.CheckCircle else Icons.Rounded.History, if (pending || resume.optString("kind") != "codex") Lilac else Mint, working = !pending && state in listOf("active", "inProgress")) { openRecent(resume) }
                        }
                    }
                    val homeRecents = recentThreads.filter { it.optString("kind") in listOf("codex", "chatgpt") && (it.optString("id") != resume?.optString("id") || it.optString("kind") != resume?.optString("kind")) }.take(4)
                    if (homeRecents.isNotEmpty()) item { Eyebrow(stringResource(R.string.ui_4d507c848429)) }
                    items(homeRecents, key = { "recent:${it.optString("kind")}:${it.optString("id")}" }) { chat ->
                        val pending = chat.optString("kind") == "codex" && chat.optString("id") in pendingThreadIds
                        val state = chat.optString("status")
                        WatchCard(chat.optString("title"), listOf(sourceLabel(chat.optString("kind")), chat.optString("projectName"), if (pending) stringResource(R.string.state_pending_request) else statusLabel(state)).filter { it.isNotBlank() }.joinToString(" · "), if (pending) Icons.Rounded.HelpOutline else if (state in listOf("idle", "completed")) Icons.Rounded.CheckCircle else Icons.Rounded.ChatBubbleOutline, if (pending) Lilac else if (chat.optString("kind") == "codex") Mint else Lilac, working = !pending && state in listOf("active", "inProgress")) { openRecent(chat) }
                    }
                    val homeUnavailable = recentUnavailable.filter { it in listOf("codex", "chatgpt") }
                    if (homeUnavailable.isNotEmpty()) item {
                        val reconnectLabel = stringResource(R.string.ui_de785acefc92)
                        SmallNote(homeUnavailable.joinToString(" · ") { "${sourceLabel(it)} ${reconnectLabel.trimStart()}" })
                    }
                    item { WatchCard(stringResource(R.string.ui_01923df7a446), stringResource(R.string.ui_e66986d59f54), Icons.Rounded.Settings, Lilac) { navigate("preferences") } }
                    if (!preview && store.isConfigured("pc") && store.isConfigured("server")) item { WatchCard(stringResource(if (slot == "pc") R.string.state_my_pc else R.string.state_my_server), stringResource(if (slot == "pc") R.string.state_to_server else R.string.state_to_pc), if (slot == "pc") Icons.Rounded.Computer else Icons.Rounded.Cloud, Mint) { selectConnection(if (slot == "pc") "server" else "pc") } }
                    if (preview) item { ActionButton(stringResource(R.string.ui_4974161dd854), Icons.Rounded.Close) { preview = false; health = JSONObject(); navigate("welcome") } }
                }
                "preferences" -> {
                    item { PageTitle(stringResource(R.string.ui_01923df7a446), stringResource(R.string.ui_2141eb36e60f), Lilac) }
                    item { WatchCard(stringResource(R.string.ui_e61bbb839ef8), stringResource(R.string.ui_3917c40cc207), Icons.Rounded.Psychology,Lilac){startActivity(Intent(context,ManagementActivity::class.java).putExtra("section","models"))} }
                    item { WatchCard("Plugins", stringResource(R.string.ui_dd32c4d6bd50), Icons.Rounded.Extension,Lilac){startActivity(Intent(context,ManagementActivity::class.java).putExtra("section","plugins"))} }
                    item { WatchCard(stringResource(R.string.ui_f2c157f7bcd5), when (effectiveAudioMode) { "openai" -> stringResource(R.string.state_api_credits); "phonon" -> "Phonon · local"; else -> stringResource(R.string.ui_1720e9334dbc) }, Icons.Rounded.RecordVoiceOver, Lilac) { navigate("audio") } }
                    item { WatchCard("Live", stringResource(R.string.ui_71d1058956cc), Icons.Rounded.Call, LiveRed) { startActivity(Intent(context,VoiceActivity::class.java).putExtra("configure",true)) } }
                    item { WatchCard(stringResource(R.string.ui_788011833a5a), stringResource(R.string.ui_e69f1975982c), Icons.Rounded.NotificationsActive) { navigate("notifications") } }
                    item { WatchCard(stringResource(R.string.ui_6b2b8f1b80e0), stringResource(R.string.ui_fdfd3e6c1f16), Icons.Rounded.Notifications) { navigate("activity") } }
                    item { WatchCard(stringResource(R.string.ui_689351db7e17), stringResource(if (slot == "pc") R.string.state_my_pc else R.string.state_my_server), Icons.Rounded.Sensors) { navigate("connections") } }
                }
                "audio" -> {
                    item { PageTitle(stringResource(R.string.ui_0a00eb556d59), stringResource(R.string.ui_c9229a0e7e1d), Lilac) }
                    if (!audioLoaded) item { SmallNote(stringResource(R.string.ui_d8f2fd233f69), Lilac) }
                    item { WatchCard(stringResource(R.string.ui_3fd60bd8c0ab),stringResource(if(autoReadDictation) R.string.state_dictation_on else R.string.state_dictation_off),if(autoReadDictation)Icons.Rounded.VolumeUp else Icons.Rounded.VolumeOff,Lilac,enabled=audioLoaded&&!loading){
                        loading=true;scope.launch { try { audioBudget=api.request("/v1/audio/auto-read-dictation","PUT",JSONObject().put("enabled",!autoReadDictation));autoReadDictation=audioBudget.optBoolean("autoReadDictation",true) } catch(e:Exception){error=e.message?:"Réglage non enregistré"} finally{loading=false} }
                    } }
                    for (mode in listOf("watch","openai","phonon")) item {
                        val title=when(mode){"watch"->stringResource(R.string.state_watch);"openai"->"OpenAI";else->"Phonon"}
                        val subtitle=when(mode){"watch"->stringResource(R.string.ui_9f11a4c68085);"openai"->stringResource(R.string.state_ai_voice);else->stringResource(R.string.ui_28f8369a4df3)}
                        val selected=audioMode==mode
                        WatchCard(title, if(selected) "${stringResource(R.string.state_selected)} · $subtitle" else subtitle, if(selected) Icons.Rounded.RadioButtonChecked else Icons.Rounded.RadioButtonUnchecked, if(selected) Mint else Muted, enabled=audioLoaded&&!loading) { selectAudioMode(mode) }
                    }
                    if (audioLoaded) item {
                        val title=stringResource(when(audioMode){"openai"->R.string.ui_346f31141b08;"phonon"->R.string.ui_fa6b36afff44;else->R.string.state_watch_settings})
                        val detail=stringResource(when(audioMode){"openai"->R.string.state_voice_key;"phonon"->R.string.state_language_voice;else->R.string.ui_9f11a4c68085})
                        WatchCard(title,detail,Icons.Rounded.Settings,Lilac){navigate("audioProvider")}
                    }
                    item { WatchCard(stringResource(R.string.ui_a7ca7706feae), stringResource(R.string.ui_cf0b88dfcabd), Icons.Rounded.PieChart,Lilac,enabled=audioLoaded){ audioLimit=String.format(java.util.Locale.US,"%.2f",audioBudget.optInt("monthlyLimitCents",500)/100.0); navigate("audioBudget") } }
                }
                "audioProvider" -> {
                    when(audioMode) {
                        "watch" -> { item { PageTitle(stringResource(R.string.ui_1720e9334dbc), stringResource(R.string.ui_9f11a4c68085), Lilac) }; item { SmallNote(stringResource(R.string.ui_89bc8bff1984)) } }
                        "openai" -> {
                            item { PageTitle(stringResource(R.string.ui_346f31141b08), stringResource(R.string.ui_0a00eb556d59), Lilac) }
                            item { SmallNote(if(audioBudget.optBoolean("ready")) stringResource(R.string.ui_c64176845d91) else stringResource(R.string.ui_b7c65abfa4c4),Lilac) }
                            for ((value,label) in listOf("marin" to "Marin","coral" to "Coral","cedar" to "Cedar")) item {
                                val selected=audioBudget.optString("voice","marin")==value
                                WatchCard(label,if(selected) stringResource(R.string.ui_0674422b0d91) else null,if(selected) Icons.Rounded.CheckCircle else Icons.Rounded.VolumeUp,if(selected) Lilac else Muted,enabled=!loading){
                                    loading=true; error=""
                                    scope.launch { try { audioBudget=api.request("/v1/audio/openai-voice","PUT",JSONObject().put("voice",value)) } catch(e: Exception){error=e.message?:"Voix non enregistrée"} finally{loading=false} }
                                }
                            }
                        }
                        else -> {
                            val selected=audioBudget.optJSONArray("phononVoices")?.objects()?.firstOrNull { it.optString("id")==audioBudget.optString("phononVoice") }
                            item { PageTitle(stringResource(R.string.ui_fa6b36afff44), stringResource(R.string.ui_28f8369a4df3), Lilac) }
                            item { SmallNote(stringResource(when {
                                !audioLoaded -> R.string.app_phonon_unknown
                                audioBudget.optBoolean("phononReady") -> R.string.app_phonon_ready
                                else -> R.string.app_phonon_missing
                            }),Lilac) }
                            item { WatchCard(stringResource(R.string.app_voice_named, selected?.optString("name") ?: "Noémie"),stringResource(R.string.app_language_and_voice),Icons.Rounded.RecordVoiceOver,Lilac,enabled=audioLoaded){navigate("phononLanguages")} }
                        }
                    }
                    val speed=audioBudget.optJSONObject("speechSpeeds")?.optDouble(audioMode,1.0) ?: 1.0
                    item { WatchCard(stringResource(R.string.ui_3d17399adcee),String.format(displayLocale,"%.2f×",speed),Icons.Rounded.Speed,Lilac,enabled=audioLoaded&&!loading){navigate("audioSpeed")} }
                }
                "audioSpeed" -> {
                    item { PageTitle(stringResource(R.string.ui_3d17399adcee), stringResource(R.string.ui_7a199a981848), Lilac) }
                    item {
                        var speedDraft by remember(audioMode) { mutableFloatStateOf((audioBudget.optJSONObject("speechSpeeds")?.optDouble(audioMode,1.0) ?: 1.0).toFloat()) }
                        Column(Modifier.fillMaxWidth(),horizontalAlignment=Alignment.CenterHorizontally) {
                            Text(String.format(displayLocale,"%.2f×",speedDraft),style=MaterialTheme.typography.headlineSmall,color=Lilac)
                            Slider(value=speedDraft,onValueChange={speedDraft=it},valueRange=.75f..1.5f,steps=14,enabled=!loading,modifier=Modifier.fillMaxWidth())
                            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
                                Text("0,75×",style=MaterialTheme.typography.labelSmall,color=Muted)
                                Text("1,50×",style=MaterialTheme.typography.labelSmall,color=Muted)
                            }
                            Spacer(Modifier.height(8.dp))
                            ActionButton(stringResource(R.string.ui_71dc74873e23),Icons.Rounded.Check,Lilac,enabled=!loading) {
                            loading=true; error=""
                                val speed=kotlin.math.round(speedDraft * 20f).toInt() / 20.0
                                scope.launch { try { audioBudget=api.request("/v1/audio/speed","PUT",JSONObject().put("mode",audioMode).put("speed",speed));audioPrefs.saveSpeeds(connection,audioBudget.optJSONObject("speechSpeeds"));navigate("audioProvider") } catch(e: Exception){error=e.message?:"Vitesse non enregistrée"} finally{loading=false} }
                            }
                        }
                    }
                }
                "audioBudget" -> {
                    item { PageTitle(stringResource(R.string.ui_a7ca7706feae), stringResource(R.string.ui_42a9ad18718f), Lilac) }
                    item { BudgetChart(audioBudget) }
                    item { OutlinedTextField(audioLimit,{audioLimit=it},modifier=Modifier.fillMaxWidth(),label={Text(stringResource(R.string.ui_62db675acc9f),fontSize=10.sp)},singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal)) }
                    item { Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceEvenly){ for(amount in listOf(1,5,10)) TextButton(onClick={audioLimit="$amount.00"},modifier=Modifier.weight(1f).heightIn(min=48.dp),contentPadding=PaddingValues(0.dp)){Text("$amount $",fontSize=12.sp,maxLines=1,softWrap=false)} } }
                    item { ActionButton(stringResource(R.string.ui_71dc74873e23),Icons.Rounded.Check,Lilac,enabled=!loading&&audioLoaded){
                        val cents=dollarCents(audioLimit)
                        if(cents==null) error="Choisir un montant de 0 à 100 $, avec deux décimales maximum."
                        else { loading=true; error=""; scope.launch { try { audioBudget=api.request("/v1/audio/budget","PUT",JSONObject().put("monthlyLimitCents",cents));audioReturnFromVoices=true;navigate("audio") } catch(e: Exception){error=e.message?:"Plafond non enregistré"} finally{loading=false} } }
                    } }
                    item { SmallNote(stringResource(R.string.ui_da88e0c9b350)) }
                }
                "phononLanguages" -> {
                    item { PageTitle(stringResource(R.string.ui_5f6baab4dbe1), stringResource(R.string.ui_8ba7e602ff15), Lilac) }
                    for (code in listOf("fr", "en", "de", "es", "pt")) item {
                        val label=java.util.Locale.forLanguageTag(code).getDisplayLanguage(displayLocale).replaceFirstChar { it.titlecase(displayLocale) }
                        WatchCard(label, null, Icons.Rounded.Translate, Lilac) { phononLanguage=code; navigate("phononVoices") }
                    }
                }
                "phononVoices" -> {
                    item { PageTitle(stringResource(R.string.ui_1e5e42e2e05d), "Phonon", Lilac) }
                    val voices=audioBudget.optJSONArray("phononVoices")?.objects()?.filter { it.optString("language") == phononLanguage }.orEmpty()
                    for (voice in voices) item {
                        val id=voice.optString("id"); val selected=id==audioBudget.optString("phononVoice")
                        val locale=voice.optString("locale"); val hint=when {
                            selected -> stringResource(R.string.state_selected)
                            locale in listOf("en-gb", "en-us", "es-mx") -> java.util.Locale.forLanguageTag(locale).getDisplayName(displayLocale).replaceFirstChar { it.titlecase(displayLocale) }
                            else -> null
                        }
                        WatchCard(voice.optString("name"), hint, if (selected) Icons.Rounded.CheckCircle else Icons.Rounded.VolumeUp, if (selected) Lilac else Muted, enabled=!loading) {
                            loading=true; error=""
                            scope.launch {
                                try { audioBudget=api.request("/v1/audio/phonon-voice","PUT",JSONObject().put("voice",id)); navigate("audioProvider") }
                                catch (e: Exception) { error=e.message ?: "Voix indisponible sur le relais" }
                                finally { loading=false }
                            }
                        }
                    }
                }
                "connections" -> {
                    item { PageTitle(stringResource(R.string.ui_ded4c52f4a44), stringResource(R.string.ui_689351db7e17)) }
                    for (value in listOf("pc", "server")) item {
                        val label = stringResource(if (value == "pc") R.string.state_my_pc else R.string.state_my_server)
                        WatchCard(label, if (slot == value) stringResource(R.string.ui_df58611fe284) else stringResource(R.string.ui_fc0597cc702a), if (value == "pc") Icons.Rounded.Computer else Icons.Rounded.Cloud,
                            if (value == slot) Mint else Lilac) {
                            selectConnection(value)
                        }
                    }
                    item { WatchCard(stringResource(R.string.ui_42e37604b638), icon = Icons.Rounded.Settings) { settings() } }
                    item {
                        val mode=when(connection.transportMode){"auto"->stringResource(R.string.mode_auto);"bluetooth"->"Bluetooth";else->"Internet"}
                        val connected=stringResource(R.string.state_connected)
                        val used=if(health.length()==0) stringResource(R.string.state_check) else when(ConnectionStatus.last(connection)){"bluetooth"->if(connection.transportMode=="bluetooth")connected else "Bluetooth";"internet"->if(connection.transportMode=="internet")connected else "Internet";else->stringResource(R.string.app_relay_connected)}
                        WatchCard(stringResource(R.string.ui_b5f96c04b748), "$mode · $used",Icons.Rounded.Settings,Lilac,enabled=connection.token.isNotBlank()) { bluetoothSettings.launch(Intent(context,BluetoothActivity::class.java)) }
                    }
                    item { WatchCard(stringResource(R.string.ui_f2c157f7bcd5), stringResource(R.string.ui_f68519e94475), Icons.Rounded.RecordVoiceOver, Lilac) { navigate("audio") } }
                    item { WatchCard(stringResource(R.string.ui_788011833a5a), statusText(pushStatus.ifBlank { if (CloudNotifications.enabled || health.optBoolean("push")) CloudNotifications.status else DirectNotifications.status }), Icons.Rounded.NotificationsActive) { navigate("notifications") } }
                    if (health.optString("notice").isNotBlank()) item { SmallNote(health.optString("notice")) }
                    item { SmallNote(stringResource(R.string.ui_a6903e0f4e4e)) }
                }
                "settings" -> {
                    item { PageTitle(if (configSlot == "pc") stringResource(R.string.ui_72961a15832d) else stringResource(R.string.ui_cabe7c5ffd54), stringResource(R.string.ui_c1d4342085d2)) }
                    item { RelayDiscovery { configUrl=it } }
                    item { SmallNote(stringResource(R.string.ui_6483cc1ed0ca)) }
                    item { OutlinedTextField(configUrl, { configUrl = it }, modifier = Modifier.fillMaxWidth(), label = { Text("https://…", fontSize = 11.sp) }, singleLine = true) }
                    item { OutlinedTextField(configToken, { configToken = it }, modifier = Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.ui_e0dcbc6aba53), fontSize = 10.sp) }, visualTransformation = PasswordVisualTransformation(), singleLine = true, keyboardOptions=KeyboardOptions(imeAction=ImeAction.Done), keyboardActions=KeyboardActions(onDone={keyboard?.hide();associate()})) }
                    item { ActionButton(stringResource(R.string.ui_8ddf67471547), Icons.Rounded.Link, enabled = !loading) { associate() } }
                    item { SmallNote(stringResource(R.string.ui_b821a2859460)) }
                    item { WatchCard(stringResource(R.string.ui_34f243dc6c15), stringResource(R.string.ui_59087c87e341), Icons.Rounded.LinkOff, Lilac) {
                        store.forget(configSlot); configToken = ""; configUrl = ""
                        CloudNotifications.reconcile(context.applicationContext)
                        runCatching { DirectNotifications.refresh(context.applicationContext) }
                        if (slot == configSlot) { val other=if(slot=="pc")"server" else "pc";if(store.isConfigured(other))selectConnection(other) else { connection = Connection(slot, "", ""); health = JSONObject(); navigate("welcome") } }
                    } }
                }
                "threads" -> {
                    if (notice.isNotBlank()) item { SmallNote(statusText(notice), Mint) }
                    item { PageTitle(projectName.ifBlank { stringResource(R.string.ui_60157cfcfe3f) }, if(kind=="chatgpt"&&health.optString("chatgptMode")=="api") "Chat" else sourceLabel(kind), if (kind != "codex") Lilac else Mint) }
                    if(kind=="chatgpt"&&health.optString("chatgptMode")=="api") item { SmallNote(stringResource(R.string.ui_931705971a62),Lilac) }
                    if(kind=="chatgpt"&&health.optString("chatgptMode")=="api"&&!health.optBoolean("chatgpt")) item { SmallNote(stringResource(R.string.ui_6c2eee15a661),Lilac) }
                    item { Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        if (kind != "chat" && !(kind=="chatgpt"&&health.optString("chatgptMode") in listOf("api","plan"))) TextButton(onClick = { choosingNewProject = false; showProjects = !showProjects; showSearch = false; threadSearch = "" }, modifier = Modifier.weight(1f).heightIn(min = 48.dp), contentPadding = PaddingValues(2.dp)) {
                            Icon(Icons.Rounded.FolderOpen, null, Modifier.size(14.dp)); Spacer(Modifier.width(2.dp)); Text(stringResource(R.string.ui_9c466199f8ec), fontSize = 10.sp, maxLines = 1, softWrap = false)
                        } else Spacer(Modifier.weight(1f))
                        IconButton(onClick = {
                            if (kind == "codex" && projectId.isBlank()) { choosingNewProject = true; showProjects = true }
                            else compose(kind, origin = "threads")
                        }, modifier = Modifier.size(48.dp)) { Icon(Icons.Rounded.Add, if (kind == "chatgpt") stringResource(R.string.ui_dc4c0241ea37) else stringResource(R.string.ui_e6a6a99bbc63), tint = if (kind == "codex") Mint else Lilac) }
                        IconButton(onClick = { if (showSearch) { threadSearch = ""; threadsLoaded = false }; showSearch = !showSearch; showProjects = false; choosingNewProject = false }, modifier = Modifier.size(48.dp)) { Icon(Icons.Rounded.Search, stringResource(R.string.ui_8bb5a3c6d858), tint = Lilac) }
                    } }
                    if (showProjects) {
                        item { Eyebrow(if (choosingNewProject) stringResource(R.string.ui_aeff8f0c0409) else stringResource(R.string.ui_1fc798128adb)) }
                        if (!choosingNewProject && (kind == "chatgpt" || health.optBoolean("codexAllProjects"))) item { WatchCard(stringResource(R.string.ui_0fd2961b7d10), if (projectId.isEmpty()) stringResource(R.string.ui_42345d238922) else null, Icons.Rounded.Apps) {
                            projectId = ""; projectName = ""; showProjects = false; threads = emptyList(); threadsLoaded = false
                            navigation.selectProject(connection, kind, "")
                        } }
                        items(projects) { project -> WatchCard(project.optString("name"), if (project.optString("id") == projectId) stringResource(R.string.ui_42345d238922) else null, Icons.Rounded.FolderOpen) {
                            projectId = project.getString("id"); projectName = project.getString("name"); showProjects = false; threads = emptyList(); threadsLoaded = false
                            navigation.selectProject(connection, kind, projectId)
                            if (choosingNewProject) { choosingNewProject = false; compose(kind, origin = "threads") }
                        } }
                    }
                    if (showSearch) item { OutlinedTextField(threadSearch, { threadSearch = it; threadsLoaded = false }, singleLine = true, label = { Text(stringResource(R.string.ui_e658be766720), fontSize = 11.sp) }, modifier = Modifier.fillMaxWidth()) }
                    items(threads, key = { "chat:${it.optString("id")}" }) { thread ->
                        val state = thread.optString("status"); val pending = kind == "codex" && thread.optString("id") in pendingThreadIds
                        WatchCard(thread.optString("title"), if (pending) stringResource(R.string.state_pending_request) else statusLabel(state), if (pending) Icons.Rounded.HelpOutline else if (state in listOf("idle", "completed")) Icons.Rounded.CheckCircle else Icons.Rounded.ChatBubbleOutline,
                            if (pending || kind != "codex") Lilac else Mint, working = !pending && state in listOf("active", "inProgress")) { openThread(thread.getString("id"), kind) }
                    }
                    if (!threadsLoaded && threads.isEmpty()) item { SmallNote(stringResource(R.string.ui_f433895f5136)) }
                    else if (threads.isEmpty()) item { SmallNote(if (cursor.isNotBlank()) stringResource(R.string.ui_a446c82ed2f5) else if (threadSearch.isNotBlank()) stringResource(R.string.ui_68c5f3e0a2f0) else stringResource(R.string.ui_97d3228ab93c)) }
                    if (cursor.isNotBlank()) item { ActionButton(stringResource(R.string.ui_df1e57b28822), Icons.Rounded.ExpandMore, enabled = !loading) {
                        loading = true
                        scope.launch {
                            try {
                                val result = api.request("/v1/threads?kind=$kind&project=${BridgeApi.encode(projectId)}&cursor=${BridgeApi.encode(cursor)}&q=${BridgeApi.encode(threadSearch)}")
                                threads = (threads + result.optJSONArray("data")?.objects().orEmpty()).distinctBy { it.optString("id") }
                                cursor = result.optString("nextCursor").takeIf { it != "null" }.orEmpty()
                            } catch (e: Exception) { error = e.message ?: "Chargement impossible" }
                            finally { loading = false }
                        }
                    } }
                    if (kind == "chat") {
                        item { SmallNote(if (health.optBoolean("chat")) stringResource(R.string.ui_9e8bc386f644) else stringResource(R.string.ui_55a662c5d36b), Lilac) }
                    }
                }
                "thread" -> {
                    item { Column { PageTitle(when (kind) { "chat" -> stringResource(R.string.ui_885fb5c92a82); "chatgpt" -> if(health.optString("chatgptMode")=="api") "Chat" else "ChatGPT"; else -> "Codex" }, statusLabel(detail.optString("status")), if (kind != "codex") Lilac else Mint)
                        if(kind in listOf("codex","chatgpt")) TextButton(onClick={startActivity(Intent(context,VoiceActivity::class.java).putExtra("kind",kind).putExtra("threadId",threadId).putExtra("title",detail.optString("title")))},modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Icon(Icons.Rounded.Call,null,Modifier.size(16.dp),tint=LiveRed);Spacer(Modifier.width(5.dp));Text("Live",fontSize=12.sp,maxLines=1,color=LiveRed)}
                    } }
                    item { Column{SmallNote(detail.optString("title"));if(detail.optString("notice").isNotBlank())SmallNote(detail.optString("notice"),Lilac);if(kind in listOf("codex","chatgpt"))WatchCard(stringResource(R.string.ui_58569bcd7473), stringResource(R.string.ui_7963a6ff7831),Icons.Rounded.GraphicEq,Lilac){startActivity(Intent(context,LiveHistoryActivity::class.java).putExtra("kind",kind).putExtra("threadId",threadId))}} }
                    if (detail.optString("source") == "chatgpt-export") item { SmallNote(stringResource(R.string.ui_894097d0046b), Lilac) }
                    if (historyCursor.isNotBlank()) item { ActionButton(stringResource(R.string.ui_ab5a780da33f), Icons.Rounded.ExpandLess, enabled = !loading) {
                        loading = true
                        scope.launch {
                            try { detail = api.request("/v1/threads/${BridgeApi.encode(threadId)}?kind=$kind&cursor=${BridgeApi.encode(historyCursor)}") }
                            catch (e: Exception) { error = e.message ?: "Historique indisponible" }
                            finally { loading = false }
                        }
                    } }
                    items(messageItems, key = { it.optString("id").ifBlank { it.optString("role") + it.optString("text").hashCode() } }) { message ->
                        val fromUser = message.optString("role") == "user"
                        val formatted = remember(messageCache,message.optString("text"), fromUser) { messageCache.format(message.optString("text"), fromUser) }
                        Column(Modifier.fillMaxWidth().background(if (fromUser) Color(0xFF202D26) else Color(0xFF191A24), RoundedCornerShape(22.dp)).padding(15.dp)) {
                            Text(if (fromUser) stringResource(R.string.ui_4ab0a39eebe2) else if (kind == "chatgpt") "CHATGPT" else if (kind == "chat") "ASSISTANT" else if (message.optString("phase") == "commentary") stringResource(R.string.ui_b136480d0dc2) else "CODEX", color = if (fromUser) Mint else Lilac, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                            if (message.optString("source") == "watch") Text(if (message.optString("delivery") == "accepted") stringResource(R.string.ui_d4200b547fb3) else stringResource(R.string.ui_594e87e85de4), color = Muted, fontSize = 9.sp, modifier = Modifier.padding(top = 4.dp))
                            Text(formatted, fontSize = 13.sp, lineHeight = 18.sp, modifier = Modifier.padding(top = 7.dp))
                            if (!fromUser) {
                                val selectedSpeech = speech.messageId == message.optString("id")
                                val playing = selectedSpeech && speech.state == SpeechState.PLAYING
                                val paused = selectedSpeech && speech.state == SpeechState.PAUSED
                                val preparing = selectedSpeech && speech.state == SpeechState.LOADING
                                TextButton(onClick = {
                                    when { playing -> speech.pause(); paused -> speech.resume()
                                        else -> speak(message.optString("text"), message.optString("id")) }
                                }, enabled = !preparing, contentPadding = PaddingValues(0.dp), modifier = Modifier.heightIn(min = 48.dp)) {
                                    Icon(if (playing) Icons.Rounded.Pause else if (paused) Icons.Rounded.PlayArrow else Icons.Rounded.VolumeUp, null, Modifier.size(16.dp))
                                    Spacer(Modifier.width(5.dp)); Text(if (preparing) stringResource(R.string.ui_d038e2acfee3) else if (playing) stringResource(R.string.ui_858e4ba7a29f) else if (paused) stringResource(R.string.ui_ddd913203fe2) else stringResource(R.string.ui_b3266f2ad37b), fontSize = 11.sp)
                                }
                                if (selectedSpeech && speech.notice.isNotBlank()) Text(statusText(speech.notice), color = Muted, fontSize = 10.sp)
                            }
                        }
                    }
                    if (taskActive) item(key = "task-progress") {
                        Row(Modifier.fillMaxWidth().background(Mint.copy(alpha = .09f), RoundedCornerShape(22.dp)).padding(14.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            CircularProgressIndicator(Modifier.size(16.dp), color = Mint, strokeWidth = 2.dp)
                            Text(if (kind == "codex" && slot == "pc") stringResource(R.string.ui_76007a7c1429) else stringResource(R.string.ui_4a228d7218a4), fontSize = 11.sp, color = Mint)
                        }
                    }
                    items(threadRequests, key = { "request:${it.optString("key")}" }) { request ->
                        ConversationRequestCard(request, api, onSending = { failedRequestKey = ""; sendingRequestKey = request.optString("key") }, onFinished = { sendingRequestKey = "" }, onFailed = { failedRequestKey = request.optString("key") }) {
                            failedRequestKey = ""
                            settlingRequest = true
                            completedRequestKeys = completedRequestKeys + request.optString("key")
                            approvals = approvals.filter { it.optString("key") != request.optString("key") }
                            requestRefresh++
                            Toast.makeText(context, context.getString(R.string.msg_97e44cadc91d), Toast.LENGTH_SHORT).show()
                            scope.launch { delay(1200); settlingRequest = false }
                        }
                    }
                    if (detail.optString("error").isNotBlank()) item(key = "thread-error") { SmallNote(detail.optString("error"), Color(0xFFFFBA9D)) }
                    if(detail.has("id")) item(key = "conversation-end") {
                Column(Modifier.fillMaxWidth(),horizontalAlignment=Alignment.CenterHorizontally) {
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceEvenly) {
                    Column(Modifier.clickable(enabled=!loading&&(kind!="chat"||!taskActive)){compose(kind,threadId,"thread")},horizontalAlignment=Alignment.CenterHorizontally){
                    IconButton(onClick={compose(kind,threadId,"thread")},enabled=!loading&&(kind!="chat"||!taskActive),modifier=Modifier.size(48.dp).background((if(kind=="codex")Mint else Lilac).copy(alpha=.2f),CircleShape)){Icon(Icons.Rounded.Edit,stringResource(R.string.ui_05af80398c58),tint=if(kind=="codex")Mint else Lilac)}
                    Text(stringResource(R.string.ui_05af80398c58),fontSize=12.sp,lineHeight=14.sp,maxLines=1)
                    }
                    Column(Modifier.clickable(enabled=!loading&&(kind!="chat"||!taskActive)){compose(kind,threadId,"thread",voiceFirst=true);dictate()},horizontalAlignment=Alignment.CenterHorizontally){
                    IconButton(onClick={compose(kind,threadId,"thread",voiceFirst=true);dictate()},enabled=!loading&&(kind!="chat"||!taskActive),modifier=Modifier.size(48.dp).background(Mint.copy(alpha=.2f),CircleShape)){Icon(Icons.Rounded.Mic,stringResource(R.string.ui_c1b029f0a721),tint=Mint)}
                    Text(stringResource(R.string.ui_c1b029f0a721),fontSize=12.sp,lineHeight=14.sp,maxLines=1)
                    }
                }
                if(kind=="codex"&&threadId.isNotBlank()) {
                    Row(Modifier.fillMaxWidth().padding(top=10.dp),horizontalArrangement=Arrangement.SpaceEvenly){
                        for((section,label,icon) in listOf(Triple("models",stringResource(R.string.ui_e61bbb839ef8),Icons.Rounded.Psychology),Triple("effort",stringResource(R.string.ui_fc8b3826cea8),Icons.Rounded.Tune))){
                            Column(Modifier.clickable{modelPicker.launch(Intent(context,ManagementActivity::class.java).putExtra("section",section).putExtra("threadId",threadId))},horizontalAlignment=Alignment.CenterHorizontally){
                                IconButton(onClick={modelPicker.launch(Intent(context,ManagementActivity::class.java).putExtra("section",section).putExtra("threadId",threadId))},modifier=Modifier.size(48.dp).background(Mint.copy(alpha=.2f),CircleShape)){Icon(icon,label,tint=Mint)}
                                Text(label,fontSize=12.sp,lineHeight=14.sp,maxLines=1)
                            }
                        }
                    }
                    val defaultModel=stringResource(if(connection.slot=="server") R.string.ui_05c7f4639c83 else R.string.ui_09b6227b10b2)
                    Text(listOf(threadInference.model.ifBlank{defaultModel},if(threadInference.model.isNotBlank())effortLabel(threadInference.thinking) else "").filter{it.isNotBlank()}.joinToString(" · "),fontSize=10.sp,color=Muted,maxLines=1)
                }
                if(kind=="chatgpt")Text(when(health.optString("chatgptMode")){"api"->stringResource(R.string.ui_794caa53e7f2);"plan"->stringResource(R.string.ui_7bb57d8ff04d);else->stringResource(R.string.ui_f8cd14911fa2)},fontSize=10.sp,color=Muted,maxLines=1)
                if(kind in listOf("codex","chatgpt")) TextButton(onClick={startActivity(Intent(context,VoiceActivity::class.java).putExtra("kind",kind).putExtra("threadId",threadId).putExtra("title",detail.optString("title")))},modifier=Modifier.heightIn(min=40.dp),contentPadding=PaddingValues(horizontal=8.dp,vertical=0.dp)){Icon(Icons.Rounded.Call,"",tint=LiveRed,modifier=Modifier.size(18.dp));Spacer(Modifier.width(5.dp));Text("Live",fontSize=12.sp,color=LiveRed)}
                }
                    }
                    if (detail.has("id") && messageItems.isEmpty()) item { SmallNote(stringResource(R.string.ui_43ecbf57dbe0)) }
                    if (kind == "codex" && detail.optBoolean("canInterrupt") && !detail.isNull("activeTurnId") && detail.optString("activeTurnId").isNotEmpty()) item {
                        WatchCard(stringResource(R.string.ui_e8a25bc1db14), stringResource(R.string.ui_5881c168a9b6), Icons.Rounded.StopCircle, Lilac) {
                            scope.launch { try { api.request("/v1/threads/${BridgeApi.encode(threadId)}/interrupt", "POST", JSONObject().put("turnId", detail.getString("activeTurnId"))) }
                            catch (e: Exception) { error = e.message ?: "Interruption impossible" } }
                        }
                    }
                }
                "compose", "confirm" -> {
                    item { PageTitle(stringResource(if (kind == "chat") R.string.app_listening else if (threadId.isEmpty()) R.string.app_new_request else R.string.ui_05af80398c58), when (kind) { "chat" -> "Assistant API"; "chatgpt" -> "${if(health.optString("chatgptMode")=="api") "Chat" else "ChatGPT"} · ${projectName.ifBlank { "Conversation" }}"; else -> "Codex · ${projectName.ifBlank { "Conversation" }}" }, if (kind != "codex") Lilac else Mint) }
                    item(key = "draft-editor") {
                        OutlinedTextField(draft, { draft = it; requestId = UUID.randomUUID().toString() }, modifier = Modifier.fillMaxWidth().focusRequester(editorFocus), enabled=!loading, label = { Text(stringResource(R.string.ui_978b481a134e), fontSize = 11.sp) }, minLines = 3, maxLines = 4)
                        // A lazy item can request focus only once its field has been composed.
                        LaunchedEffect(editorRequest, editOnOpen) {
                            if (screen == "compose" && editOnOpen) {
                                editorFocus.requestFocus()
                                delay(200)
                                keyboard?.show()
                                editOnOpen = false
                            }
                        }
                    }
                    item { WatchCard(if(draft.isBlank())stringResource(R.string.ui_c1b029f0a721) else stringResource(R.string.ui_edaf484070be),stringResource(R.string.ui_73303ce22a10),Icons.Rounded.Mic,Mint,enabled=!loading){editOnOpen=false;keyboard?.hide();editorFocusManager.clearFocus();dictate()} }
                    item { SmallNote(stringResource(if (threadId.isEmpty()) R.string.app_new_conversation else R.string.app_existing_conversation)+JSONArray(pluginSelection).objects().joinToString(" · ",prefix=if(pluginSelection!="[]")"\nPlugins : "else ""){it.optString("name")}) }
                }
                "creating" -> {
                    item { PageTitle(if(creatingKind=="codex")"Codex" else if(health.optString("chatgptMode")=="api")"Chat" else "ChatGPT",stringResource(R.string.ui_9f22ff67b352),Lilac) }
                    if(creatingText.isNotBlank())item {
                        Column(Modifier.fillMaxWidth().background(Color(0xFF202D26),RoundedCornerShape(22.dp)).padding(15.dp)) {
                            Text(stringResource(R.string.ui_4ab0a39eebe2),color=Mint,fontSize=9.sp,fontWeight=FontWeight.Bold)
                            Text(creatingText,fontSize=13.sp,lineHeight=18.sp,modifier=Modifier.padding(top=7.dp))
                        }
                    }
                    item { Row(Modifier.fillMaxWidth().background(Lilac.copy(alpha=.09f),RoundedCornerShape(22.dp)).padding(14.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                        CircularProgressIndicator(Modifier.size(16.dp),color=Lilac,strokeWidth=2.dp)
                        Text(stringResource(R.string.ui_fc21326e1074),fontSize=11.sp,color=Lilac)
                    } }
                    item { SmallNote(statusText(creatingStatus.ifBlank{stringResource(R.string.ui_cfe6247094b8)}),Lilac) }
                    item { WatchCard(stringResource(R.string.ui_9c80cf8611b5),stringResource(R.string.ui_5eb2bd145931),Icons.Rounded.Forum,Lilac){kind=creatingKind;threadsLoaded=false;navigate("threads")} }
                }
                "notifications" -> {
                    item { PageTitle(stringResource(R.string.ui_788011833a5a), if (health.optBoolean("push") || CloudNotifications.enabled) stringResource(R.string.ui_bc54e3028a4f) else stringResource(R.string.ui_0ae0eb5922e2)) }
                    item { SmallNote(statusText(if (health.optBoolean("push") || CloudNotifications.enabled) CloudNotifications.status else DirectNotifications.status), Mint) }
                    if (pushStatus.isNotBlank()) item { SmallNote(statusText(pushStatus), Lilac) }
                    item { SmallNote(stringResource(R.string.ui_721bddd6b13a)) }
                    item { ActionButton(if (DirectNotifications.enabled || CloudNotifications.enabled) stringResource(R.string.ui_c07050ca8933) else stringResource(R.string.ui_77bf4e88dbc8), if (DirectNotifications.enabled || CloudNotifications.enabled) Icons.Rounded.NotificationsOff else Icons.Rounded.NotificationsActive) {
                        if (DirectNotifications.enabled || CloudNotifications.enabled) { CloudNotifications.disable(context.applicationContext); DirectNotifications.disable(context.applicationContext); pushStatus = "" } else allowNotifications()
                    } }
                    if (DirectNotifications.enabled || CloudNotifications.enabled) item { WatchCard(stringResource(R.string.ui_d5d9f6efa0d8), stringResource(R.string.ui_c63cd64dc1ea), Icons.Rounded.Notifications,
                        enabled = CloudNotifications.enabled && health.optBoolean("push") || slot in DirectNotifications.connectedSlots) {
                        scope.launch { try { api.request("/v1/notifications/test", "POST"); pushStatus = "Alerte de test envoyée" }
                        catch (e: Exception) { pushStatus = e.message ?: "Relais injoignable" } }
                    } }
                    item { SmallNote(if (DirectNotifications.enabled) stringResource(R.string.ui_86decc699fc6)
                        else stringResource(R.string.app_alert_google)) }
                }
                "activity" -> {
                    item { PageTitle(stringResource(R.string.ui_6b2b8f1b80e0), stringResource(R.string.ui_b5e0c9316662)) }
                    if (!DirectNotifications.enabled && !CloudNotifications.enabled) item { WatchCard(stringResource(R.string.ui_b00bb72da4e6), stringResource(R.string.ui_0d050db01628), Icons.Rounded.NotificationsActive) { navigate("notifications") } }
                    items(events.reversed().take(40)) { event ->
                        val status = stringResource(when (event.optString("type")) {
                        "completed" -> R.string.alert_completed
                        "approval" -> R.string.app_approval
                        "interrupted" -> R.string.alert_interrupted
                        "test" -> R.string.alert_test
                        else -> R.string.app_task_check
                        })
                        WatchCard(event.optString("title").ifBlank { status }, listOf(status, event.optString("preview")).filter { it.isNotBlank() }.joinToString(" · "), Icons.Rounded.TaskAlt) {
                        if (event.optString("threadId").isNotBlank()) openThread(event.optString("threadId"), event.optString("kind", "codex"))
                    } }
                    if (events.isEmpty()) item { SmallNote(stringResource(R.string.ui_3b48440a9086)) }
                }
            }
            if (screen !in listOf("home", "welcome")) item { TextButton(onClick = { if (!loading) back() }, modifier = Modifier.heightIn(min = 48.dp)) { Icon(Icons.Rounded.ArrowBack, null, Modifier.size(16.dp)); Spacer(Modifier.width(5.dp)); Text(stringResource(R.string.ui_ef23a5940244), fontSize = 12.sp) } }
        }
    }
}
