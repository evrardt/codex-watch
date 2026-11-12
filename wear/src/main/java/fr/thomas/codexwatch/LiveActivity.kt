package fr.thomas.codexwatch

import androidx.compose.ui.res.stringResource
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.media.AudioManager
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.selection.selectable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.semantics.Role
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.wear.compose.foundation.lazy.items
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.json.JSONArray

/** Same component name as the former voice shortcut: existing button assignments keep working. */
class VoiceActivity : LiveActivity()

open class LiveActivity : ComponentActivity() {
    private var entry by mutableIntStateOf(0)
    private lateinit var live: LiveConnection
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState);volumeControlStream=AudioManager.STREAM_MUSIC;live=LiveConnection(applicationContext)
        setContent { WatchTheme { LiveApp(entry) } }
    }
    override fun onNewIntent(intent: Intent){
        super.onNewIntent(intent)
        if(live.state==LiveState.CONNECTED&&intent.action==Intent.ACTION_MAIN)return
        live.end("Préparation du nouveau contexte.");setIntent(intent);entry++
    }
    override fun onStop(){super.onStop();live.end("Live fermé en quittant l’écran. Les tâches continuent sur le PC.")}
    override fun onDestroy(){live.dispose();super.onDestroy()}

    @Composable private fun LiveApp(entry: Int) {
        val scope=rememberCoroutineScope()
        val connections=remember{ConnectionStore(this)}
        val connection=remember(entry){runCatching{connections.read(connections.activeSlot())}.getOrElse{Connection("pc","","")}}
        val api=remember(connection){BridgeApi(connection)}
        val prefs=remember{getSharedPreferences("live_contexts",MODE_PRIVATE)}
        val key=remember(connection){ReadStateStore.digest("${connection.slot}\u0000${connection.url}")}
        var options by remember{mutableStateOf(JSONObject())}
        var projects by remember{mutableStateOf(JSONObject())}
        val bindings=remember{mutableStateMapOf<String,JSONObject>()}
        var target by remember{mutableStateOf("chatgpt")}
        var voice by remember{mutableStateOf("brise")}
        var picker by remember{mutableStateOf("")}
        var loading by remember{mutableStateOf(true)}
        var error by remember{mutableStateOf("")}
        var pluginSelection by rememberSaveable(entry,connection.slot){mutableStateOf("[]")}
        val pluginPicker=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()){result->
            if(result.resultCode==RESULT_OK){pluginSelection=result.data?.getStringExtra("selection")?:"[]";if(JSONArray(pluginSelection).length()>0&&bindings.containsKey("codex"))target="codex"}
        }
        val active=live.state in listOf(LiveState.CONNECTING,LiveState.CONNECTED,LiveState.ENDING)
        fun start() {
            if(!lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))return
            val context=bindings[target]
            if(context==null||(context.optString("mode")=="new"&&target=="codex"&&context.optString("project").isBlank())){error="Choisis un projet avant de démarrer.";return}
            val edit=prefs.edit().putString("voice:$key",voice)
            for((kind,chat)in bindings)if(chat.optString("mode")=="new")edit.putString("project:$key:$kind",chat.optString("project"))
            edit.apply()
            error=""
            val selected=bindings.mapValues{(kind,value)->JSONObject(value.toString()).also{if(kind=="codex")InferenceStore(this).read(connection,if(value.optString("mode")=="existing")value.optString("id") else "").applyTo(it)}}
            val plugins=JSONArray(pluginSelection).objects().map{it.getString("id")}
            if(plugins.isNotEmpty()&&!options.optBoolean("pluginSelection")){error="Mets à jour le relais pour utiliser les plugins en Live.";return}
            try{live.connect(connection,target,selected,voice,plugins)}catch(e:Exception){error=e.message?:"Live indisponible"}
        }
        val microphone=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()){granted->if(granted)start()else error="Autorise le microphone pour parler en Live. La dictée habituelle reste accessible dans les conversations."}
        fun begin(){if(ContextCompat.checkSelfPermission(this,Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)start()else microphone.launch(Manifest.permission.RECORD_AUDIO)}
        LaunchedEffect(entry,connection) {
            while(live.state==LiveState.ENDING)delay(100)
            live.prepare()
            loading=true;error="";bindings.clear()
            val openedKind=intent.getStringExtra("kind")
            val openedId=intent.getStringExtra("threadId").orEmpty()
            target=liveLaunchKind(openedKind,openedId)
            voice=prefs.getString("voice:$key","brise")?:"brise"
            try {
                require(connection.token.isNotBlank()){"Associe d’abord un relais dans Codex Watch → Paramètres → Connexions."}
                options=api.request("/v1/live/options");projects=options.optJSONObject("projects")?:JSONObject()
                for(kind in listOf("codex","chatgpt")) {
                    val candidates=projects.optJSONArray(kind)?.objects().orEmpty()
                    if(candidates.isEmpty()&&!(kind==openedKind&&openedId.isNotBlank()))continue
                    val saved=prefs.getString("project:$key:$kind","").orEmpty()
                    val chosen=candidates.find{it.optString("id")==saved}
                    bindings[kind]=liveLaunchContext(kind,chosen?.optString("id").orEmpty(),chosen?.optString("name")?:"Choisir un projet",openedKind,openedId,intent.getStringExtra("title")?:"Conversation ouverte")
                }
                loading=false
            }catch(e:kotlinx.coroutines.CancellationException){throw e}catch(e:Exception){error=e.message?:"Relais Live inaccessible";loading=false}
        }
        LaunchedEffect(live.boundContexts){for((kind,context)in live.boundContexts)bindings[kind]=context}
        LaunchedEffect(live.state){if(live.state==LiveState.ENDED)runCatching{options=api.request("/v1/live/options")}}
        DisposableEffect(active){if(active)window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);onDispose{window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)}}
        BackHandler(active){live.end()}
        BackHandler(!active&&picker.isNotBlank()){picker=""}
        if(active) {
            Column(Modifier.fillMaxSize().padding(horizontal=25.dp).padding(top=16.dp,bottom=10.dp),horizontalAlignment=Alignment.CenterHorizontally) {
                val color=if(live.target=="codex")Mint else Lilac
                Eyebrow(if(live.target=="codex")"Codex" else "ChatGPT",color)
                Text(bindings[live.target]?.optString("title").orEmpty(),fontSize=10.sp,lineHeight=12.sp,color=Muted,maxLines=1,overflow=TextOverflow.Ellipsis)
                Text(statusText(live.delivery),fontSize=10.sp,lineHeight=12.sp,color=color,maxLines=1)
                Box(Modifier.weight(1f).fillMaxWidth(),contentAlignment=Alignment.Center){LiveOrb(live.target,if(live.speaking)live.outputLevel else live.level,live.speaking,live.muted,live.state){live.interrupt()}}
                Text(when(live.state){LiveState.CONNECTING->stringResource(R.string.ui_280398acb030);LiveState.ENDING->stringResource(R.string.ui_68cbdeed1df6);else->if(live.reconnecting)stringResource(R.string.ui_6dd94fd1a64c) else if(live.muted)stringResource(R.string.ui_ea725cd912f8) else if(live.speaking)stringResource(R.string.ui_13f84f75174c) else stringResource(R.string.ui_c487bdcb6356)},fontSize=12.sp,lineHeight=15.sp,color=color,maxLines=1)
                val caption = if (live.notice.isNotBlank()) statusText(live.notice) else if (live.captionIsStatus) statusText(live.caption) else live.caption
                Text(caption,fontSize=12.sp,lineHeight=15.sp,maxLines=2,overflow=TextOverflow.Ellipsis,textAlign=TextAlign.Center,modifier=Modifier.fillMaxWidth().padding(top=2.dp))
                Row(Modifier.fillMaxWidth().height(48.dp),horizontalArrangement=Arrangement.SpaceEvenly) {
                    IconButton(onClick={live.toggleMute()},enabled=live.state==LiveState.CONNECTED&&!live.reconnecting,modifier=Modifier.size(48.dp)){Icon(if(live.muted)Icons.Rounded.MicOff else Icons.Rounded.Mic,if(live.muted)stringResource(R.string.ui_84d45b2dd77f) else stringResource(R.string.ui_adf95471a387),tint=Lilac)}
                    val other=if(live.target=="codex")"chatgpt" else "codex"
                    IconButton(onClick={live.select(other)},enabled=live.state==LiveState.CONNECTED&&!live.reconnecting&&bindings.containsKey(other),modifier=Modifier.size(48.dp)){Icon(Icons.Rounded.SwapHoriz,stringResource(R.string.live_switch_to,if(other=="codex")"Codex" else "ChatGPT"),tint=color)}
                    IconButton(onClick={live.end()},modifier=Modifier.size(48.dp).background(Color(0xFF512D36),CircleShape)){Icon(Icons.Rounded.CallEnd,stringResource(R.string.ui_23dd2706ff2e),tint=Color(0xFFFFC5CE))}
                }
                val elapsed="${live.elapsed/60}:${(live.elapsed%60).toString().padStart(2,'0')}"
                val remaining="${live.remaining/60}:${(live.remaining%60).toString().padStart(2,'0')}"
                Text(if(live.remaining>0) "$elapsed · ${stringResource(R.string.app_time_remaining,remaining)}" else stringResource(R.string.app_audio_quota),fontSize=10.sp,lineHeight=12.sp,color=Muted,maxLines=2,textAlign=TextAlign.Center)
            }
        } else WatchList("live:$picker:${connection.slot}",bottomAction=if(picker.isBlank())({
            val context=bindings[target]
            val selected=context!=null&&(context.optString("mode")=="existing"||target=="chatgpt"||context.optString("project").isNotBlank())
            ActionButton(if(live.state==LiveState.ENDED)stringResource(R.string.ui_ddd913203fe2) else stringResource(R.string.ui_0253f2a67040),Icons.Rounded.Mic,Lilac,enabled=!loading&&options.optBoolean("ready")&&selected){begin()}
        })else null) {
            item{
                if(picker.isNotBlank())PageTitle(stringResource(R.string.ui_1fc798128adb),if(picker=="codex")"Codex" else "ChatGPT",Lilac)
                else Column {
                    Eyebrow("Live",Lilac);Spacer(Modifier.height(4.dp))
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(6.dp)){
                        for(kind in listOf("chatgpt","codex")){
                            val selected=target==kind;val color=if(kind=="codex")Mint else Lilac
                            Row(Modifier.weight(1f).height(48.dp).background(color.copy(alpha=if(selected).17f else .06f),RoundedCornerShape(22.dp))
                                .selectable(selected=selected,role=Role.RadioButton){target=kind},verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.Center){
                                Icon(if(selected)Icons.Rounded.RadioButtonChecked else Icons.Rounded.RadioButtonUnchecked,null,Modifier.size(16.dp),tint=color)
                                Spacer(Modifier.width(4.dp));Text(if(kind=="codex")"Codex" else "ChatGPT",fontSize=12.sp,color=color)
                            }
                        }
                    }
                }
            }
            if(loading)item{CircularProgressIndicator(Modifier.size(24.dp),color=Lilac,strokeWidth=2.dp)}
            if(error.isNotBlank())item{SmallNote(statusText(error),Color(0xFFFFBA9D))}
            if(!loading&&picker.isBlank()&&bindings[target]==null)item{SmallNote(stringResource(R.string.live_context_unavailable,if(target=="chatgpt")"ChatGPT" else "Codex"))}
            if(!loading&&picker.isBlank()&&!options.optBoolean("ready"))item{SmallNote(statusText(when(options.optString("reason")){
                "BUDGET_REACHED" -> "Budget Live insuffisant. Vérifie le plafond audio."
                "DEMO" -> "Live désactivé dans l’aperçu."
                "API_KEY_MISSING" -> "Connecte une clé API sur le relais pour le Live."
                else -> if(options.optJSONObject("budget")?.optBoolean("ready")!=true)"Connecte une clé API sur le relais pour le Live." else "Reconnecte Codex sur le relais pour le Live."
            }))}
            if(picker.isNotBlank()) {
                val candidates=projects.optJSONArray(picker)?.objects().orEmpty()
                items(candidates){project->WatchCard(project.optString("name"),if(bindings[picker]?.optString("project")==project.optString("id"))stringResource(R.string.ui_42345d238922) else null,Icons.Rounded.FolderOpen,if(picker=="codex")Mint else Lilac){bindings[picker]=liveLaunchContext(picker,project.optString("id"),project.optString("name"),null,"","");picker=""}}
                if(candidates.isEmpty())item{SmallNote(stringResource(R.string.ui_01ee9d3187c2))}
                item{TextButton(onClick={picker=""}){Text(stringResource(R.string.ui_ef23a5940244),fontSize=12.sp)}}
            } else {
                val selected=bindings[target]
                if(selected?.optString("mode")=="existing")item{SmallNote(stringResource(R.string.live_current_chat,selected.optString("title")),Lilac)}
                if(live.state==LiveState.ENDED&&selected?.optString("id")?.isNotBlank()==true)item{WatchCard(stringResource(R.string.ui_513b51523bce),selected.optString("title"),Icons.Rounded.ChatBubbleOutline,Lilac){startActivity(Intent(this@LiveActivity,MainActivity::class.java).putExtra("eventId","live").putExtra("kind",target).putExtra("threadId",selected.optString("id")))}}
                item{
                    val existing=selected?.optString("mode")=="existing"
                    Row(Modifier.fillMaxWidth().heightIn(min=48.dp).background(Color(0xFF1C2923),RoundedCornerShape(22.dp)).clickable(enabled=!existing){picker=target}.padding(horizontal=12.dp,vertical=7.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
                        Icon(if(existing)Icons.Rounded.ChatBubbleOutline else Icons.Rounded.FolderOpen,null,Modifier.size(19.dp),tint=if(target=="codex")Mint else Lilac)
                        Column(Modifier.weight(1f)){
                            Text(if(existing)stringResource(R.string.ui_e7a2d9d4939c) else stringResource(R.string.ui_2a6d0198e8dc),fontSize=10.sp,lineHeight=12.sp,color=Muted)
                            Text(if(existing)selected?.optString("title").orEmpty() else selected?.optString("title")?.removePrefix("Nouveau chat · ")?:stringResource(R.string.ui_1fc798128adb),fontSize=12.sp,lineHeight=14.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
                        }
                    }
                }
                if(live.state==LiveState.ENDED&&live.notice.isNotBlank())item{SmallNote(statusText(live.notice),Lilac)}
                item{SmallNote(if(selected?.optString("mode")=="existing")stringResource(R.string.ui_c383bb2c749b) else stringResource(R.string.ui_fc858be0b309))}
                item{
                    val names=JSONArray(pluginSelection).objects().map{it.optString("name")}.filter{it.isNotBlank()}
                    WatchCard(stringResource(R.string.ui_8bd51d06272e),if(names.isEmpty())stringResource(R.string.ui_447a13646629) else names.joinToString(", "),Icons.Rounded.Extension,Mint,enabled=!loading&&bindings.containsKey("codex")){
                        if(options.optBoolean("pluginSelection"))pluginPicker.launch(Intent(this@LiveActivity,PluginPickerActivity::class.java).putExtra("selection",pluginSelection))
                        else error="Mets à jour le relais pour choisir des plugins en Live."
                    }
                }
                if(JSONArray(pluginSelection).length()>0&&target!="codex")item{SmallNote(stringResource(R.string.ui_e1a7d15a23c6),Mint)}
                if(target=="chatgpt")item{SmallNote(stringResource(R.string.ui_1497c7b53e51),Lilac)}
                item{WatchCard(stringResource(R.string.app_voice_named,voice.replaceFirstChar{it.uppercase()}),stringResource(R.string.ui_3a72e4b43c68),Icons.Rounded.RecordVoiceOver,Lilac){val voices=listOf("brise","sillage","marin","cedar","coral");voice=voices[(voices.indexOf(voice)+1)%voices.size]}}
                item{SmallNote("0,05 $ / min · 5 min maximum")}
                val budget=options.optJSONObject("budget")
                if(budget!=null)item{BudgetChart(budget)}
                if(target=="codex")item{WatchCard(stringResource(R.string.ui_e61bbb839ef8), stringResource(R.string.ui_fc8b3826cea8),Icons.Rounded.Psychology,Mint){val current=bindings["codex"];startActivity(Intent(this@LiveActivity,ManagementActivity::class.java).putExtra("section","models").putExtra("threadId",if(current?.optString("mode")=="existing")current.optString("id") else ""))}}
                item{TextButton(onClick={finish()}){Text(stringResource(R.string.ui_711e5f2e198d),fontSize=12.sp)}}
            }
        }
    }
}

@Composable private fun LiveOrb(kind:String,level:Float,speaking:Boolean,muted:Boolean,state:LiveState,onClick:()->Unit) {
    val transition=rememberInfiniteTransition(label="live")
    val breath by transition.animateFloat(.72f,1f,infiniteRepeatable(tween(1500,easing=FastOutSlowInEasing),RepeatMode.Reverse),label="breath")
    val energy by animateFloatAsState(if(muted&&!speaking)0f else level,tween(100),label="energy")
    val color=if(kind=="codex")Mint else Lilac
    Box(Modifier.size(82.dp).clickable(enabled=state==LiveState.CONNECTED,onClick=onClick),contentAlignment=Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val radius=size.minDimension*.40f
            drawCircle(color.copy(alpha=.08f+.1f*energy),radius*(1.12f+.1f*breath))
            drawCircle(color.copy(alpha=.28f),radius,style=Stroke(2.dp.toPx()))
            // A quiet breathing ring becomes a waveform driven by actual PCM energy.
            for(i in 0..31){val angle=Math.PI*2*i/32;val variation=(.55+.45*kotlin.math.sin(i*.9+breath*5)).toFloat();val len=(2+energy*15*variation).dp.toPx();val start=radius*.88f
                drawLine(color.copy(alpha=.38f+.55f*energy),Offset(center.x+kotlin.math.cos(angle).toFloat()*start,center.y+kotlin.math.sin(angle).toFloat()*start),Offset(center.x+kotlin.math.cos(angle).toFloat()*(start-len),center.y+kotlin.math.sin(angle).toFloat()*(start-len)),2.dp.toPx(),StrokeCap.Round)}

        }
        Icon(if(muted)Icons.Rounded.MicOff else if(speaking)Icons.Rounded.GraphicEq else Icons.Rounded.Mic,null,tint=color,modifier=Modifier.size(25.dp))
    }
}
