package fr.thomas.codexwatch

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
                Text(live.delivery,fontSize=10.sp,lineHeight=12.sp,color=color,maxLines=1)
                Box(Modifier.weight(1f).fillMaxWidth(),contentAlignment=Alignment.Center){LiveOrb(live.target,if(live.speaking)live.outputLevel else live.level,live.speaking,live.muted,live.state){live.interrupt()}}
                Text(when(live.state){LiveState.CONNECTING->"Connexion…";LiveState.ENDING->"Fin de l’appel…";else->if(live.reconnecting)"Reconnexion…" else if(live.muted)"Micro coupé" else if(live.speaking)"Je parle" else "Je t’écoute"},fontSize=12.sp,lineHeight=15.sp,color=color,maxLines=1)
                Text(live.notice.ifBlank{live.caption},fontSize=12.sp,lineHeight=15.sp,maxLines=1,overflow=TextOverflow.Ellipsis,textAlign=TextAlign.Center,modifier=Modifier.fillMaxWidth().padding(top=2.dp))
                Row(Modifier.fillMaxWidth().height(48.dp),horizontalArrangement=Arrangement.SpaceEvenly) {
                    IconButton(onClick={live.toggleMute()},enabled=live.state==LiveState.CONNECTED&&!live.reconnecting,modifier=Modifier.size(48.dp)){Icon(if(live.muted)Icons.Rounded.MicOff else Icons.Rounded.Mic,if(live.muted)"Rétablir le micro" else "Couper le micro",tint=Lilac)}
                    val other=if(live.target=="codex")"chatgpt" else "codex"
                    IconButton(onClick={live.select(other)},enabled=live.state==LiveState.CONNECTED&&!live.reconnecting&&bindings.containsKey(other),modifier=Modifier.size(48.dp)){Icon(Icons.Rounded.SwapHoriz,"Passer à ${if(other=="codex")"Codex" else "ChatGPT"}",tint=color)}
                    IconButton(onClick={live.end()},modifier=Modifier.size(48.dp).background(Color(0xFF512D36),CircleShape)){Icon(Icons.Rounded.CallEnd,"Terminer le Live",tint=Color(0xFFFFC5CE))}
                }
                Text(if(live.remaining>0)"${live.elapsed/60}:${(live.elapsed%60).toString().padStart(2,'0')} · ${live.remaining/60}:${(live.remaining%60).toString().padStart(2,'0')} restantes" else "Quota audio partagé",fontSize=10.sp,lineHeight=12.sp,color=Muted,maxLines=1)
            }
        } else WatchList("live:$picker:${connection.slot}",bottomAction=if(picker.isBlank())({
            val context=bindings[target]
            val selected=context!=null&&(context.optString("mode")=="existing"||target=="chatgpt"||context.optString("project").isNotBlank())
            ActionButton(if(live.state==LiveState.ENDED)"Reprendre" else "Démarrer",Icons.Rounded.Mic,Lilac,enabled=!loading&&options.optBoolean("ready")&&selected){begin()}
        })else null) {
            item{
                if(picker.isNotBlank())PageTitle("Choisir un projet",if(picker=="codex")"Codex" else "ChatGPT",Lilac)
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
            if(error.isNotBlank())item{SmallNote(error,Color(0xFFFFBA9D))}
            if(!loading&&picker.isBlank()&&bindings[target]==null)item{SmallNote("${if(target=="chatgpt")"ChatGPT" else "Codex"} indisponible sur ce relais. Choisis un autre contexte.")}
            if(!loading&&picker.isBlank()&&!options.optBoolean("ready"))item{SmallNote(when(options.optString("reason")){
                "BUDGET_REACHED" -> "Budget Live insuffisant. Vérifie le plafond audio."
                "DEMO" -> "Live désactivé dans l’aperçu."
                "API_KEY_MISSING" -> "Connecte une clé API sur le relais pour le Live."
                else -> if(options.optJSONObject("budget")?.optBoolean("ready")!=true)"Connecte une clé API sur le relais pour le Live." else "Reconnecte Codex sur le relais pour le Live."
            })}
            if(picker.isNotBlank()) {
                val candidates=projects.optJSONArray(picker)?.objects().orEmpty()
                items(candidates){project->WatchCard(project.optString("name"),if(bindings[picker]?.optString("project")==project.optString("id"))"Sélectionné" else null,Icons.Rounded.FolderOpen,if(picker=="codex")Mint else Lilac){bindings[picker]=liveLaunchContext(picker,project.optString("id"),project.optString("name"),null,"","");picker=""}}
                if(candidates.isEmpty())item{SmallNote("Aucun projet accessible pour ce contexte.")}
                item{TextButton(onClick={picker=""}){Text("Retour",fontSize=12.sp)}}
            } else {
                val selected=bindings[target]
                if(selected?.optString("mode")=="existing")item{SmallNote("Le Live utilise le chat ouvert : ${selected.optString("title")}",Lilac)}
                if(live.state==LiveState.ENDED&&selected?.optString("id")?.isNotBlank()==true)item{WatchCard("Ouvrir le chat",selected.optString("title"),Icons.Rounded.ChatBubbleOutline,Lilac){startActivity(Intent(this@LiveActivity,MainActivity::class.java).putExtra("eventId","live").putExtra("kind",target).putExtra("threadId",selected.optString("id")))}}
                item{
                    val existing=selected?.optString("mode")=="existing"
                    Row(Modifier.fillMaxWidth().heightIn(min=48.dp).background(Color(0xFF1C2923),RoundedCornerShape(22.dp)).clickable(enabled=!existing){picker=target}.padding(horizontal=12.dp,vertical=7.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
                        Icon(if(existing)Icons.Rounded.ChatBubbleOutline else Icons.Rounded.FolderOpen,null,Modifier.size(19.dp),tint=if(target=="codex")Mint else Lilac)
                        Column(Modifier.weight(1f)){
                            Text(if(existing)"Conversation ouverte" else "Projet · nouveau chat",fontSize=10.sp,lineHeight=12.sp,color=Muted)
                            Text(if(existing)selected?.optString("title").orEmpty() else selected?.optString("title")?.removePrefix("Nouveau chat · ")?:"Choisir un projet",fontSize=12.sp,lineHeight=14.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
                        }
                    }
                }
                if(live.state==LiveState.ENDED&&live.notice.isNotBlank())item{SmallNote(live.notice,Lilac)}
                item{SmallNote(if(selected?.optString("mode")=="existing")"L’appel continue dans cette conversation." else "Un nouveau chat sera créé à ta première demande. Le micro reste fermé avant Démarrer.")}
                item{
                    val names=JSONArray(pluginSelection).objects().map{it.optString("name")}.filter{it.isNotBlank()}
                    WatchCard("Plugins Codex",if(names.isEmpty())"Facultatif" else names.joinToString(", "),Icons.Rounded.Extension,Mint,enabled=!loading&&bindings.containsKey("codex")){
                        if(options.optBoolean("pluginSelection"))pluginPicker.launch(Intent(this@LiveActivity,PluginPickerActivity::class.java).putExtra("selection",pluginSelection))
                        else error="Mets à jour le relais pour choisir des plugins en Live."
                    }
                }
                if(JSONArray(pluginSelection).length()>0&&target!="codex")item{SmallNote("Plugins utilisés pour les demandes à Codex.",Mint)}
                if(target=="chatgpt")item{SmallNote("Sélection des apps ChatGPT indisponible sur ce relais.",Lilac)}
                item{WatchCard("Voix · ${voice.replaceFirstChar{it.uppercase()}}",if(voice=="brise"||voice=="sillage")"Voix française" else "Lecture en français",Icons.Rounded.RecordVoiceOver,Lilac){val voices=listOf("brise","sillage","marin","cedar","coral");voice=voices[(voices.indexOf(voice)+1)%voices.size]}}
                item{SmallNote("0,05 $ / min · 5 min maximum")}
                val budget=options.optJSONObject("budget")
                if(budget!=null)item{BudgetChart(budget)}
                if(target=="codex")item{WatchCard("Modèle", "Réflexion",Icons.Rounded.Psychology,Mint){val current=bindings["codex"];startActivity(Intent(this@LiveActivity,ManagementActivity::class.java).putExtra("section","models").putExtra("threadId",if(current?.optString("mode")=="existing")current.optString("id") else ""))}}
                item{TextButton(onClick={finish()}){Text("Fermer",fontSize=12.sp)}}
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
