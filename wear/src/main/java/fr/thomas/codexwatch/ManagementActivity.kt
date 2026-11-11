package fr.thomas.codexwatch

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.items
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import org.json.JSONObject

class ManagementActivity:ComponentActivity(){
    override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState);setContent{WatchTheme{Page()}}}
    @Composable private fun Page(){
        val scope=rememberCoroutineScope();val store=remember{ConnectionStore(this)}
        val connection=remember{runCatching{store.read(store.activeSlot())}.getOrElse{Connection("pc","","")}}
        val api=remember{BridgeApi(connection)};val inference=remember{InferenceStore(this)}
        val threadId=remember{intent.getStringExtra("threadId").orEmpty()}
        var section by remember{mutableStateOf(intent.getStringExtra("section")?:"models")}
        var choice by remember{mutableStateOf(inference.read(connection,threadId))}
        var specific by remember{mutableStateOf(inference.hasOverride(connection,threadId))}
        var models by remember{mutableStateOf(emptyList<JSONObject>())}
        var plugins by remember{mutableStateOf(emptyList<JSONObject>())}
        var plugin by remember{mutableStateOf<JSONObject?>(null)}
        var busy by remember{mutableStateOf(false)};var error by remember{mutableStateOf("")}
        var confirm by remember{mutableStateOf("")}
        var query by remember{mutableStateOf("")};var offset by remember{mutableIntStateOf(0)};var nextOffset by remember{mutableIntStateOf(-1)}
        LaunchedEffect(section,query,offset){
            if(section !in listOf("models","effort","plugins","catalogue"))return@LaunchedEffect
            if(section=="effort"&&models.isNotEmpty())return@LaunchedEffect
            busy=true;error=""
            try{if(section in listOf("models","effort"))models=api.request("/v1/models").optJSONArray("data")?.objects().orEmpty()
                else{if(section=="catalogue")delay(350);val result=api.request("/v1/plugins${if(section=="catalogue")"?available=1&q=${BridgeApi.encode(query)}&offset=$offset" else ""}");plugins=(result.optJSONArray(if(section=="catalogue")"available" else "installed")?.objects().orEmpty()+if(section=="plugins")result.optJSONArray("cached")?.objects().orEmpty()else emptyList()).distinctBy{it.optString("id")};error=result.optString("notice");nextOffset=if(result.isNull("nextOffset"))-1 else result.optInt("nextOffset",-1)}}
            catch(e:kotlinx.coroutines.CancellationException){throw e}
            catch(e:Exception){error=e.message?:"Fonction indisponible"}finally{busy=false}
        }
        fun save(value:InferenceChoice){choice=value;inference.save(connection,value,threadId);specific=threadId.isNotBlank()}
        fun action(value:String){confirm=value;section="confirmation"}
        BackHandler(section in listOf("detail","confirmation","effort","catalogue")){section=if(section=="effort")"models" else if(section=="confirmation")"detail" else "plugins";confirm=""}
        WatchList("management:$section"){
            item{PageTitle(when(section){"models"->"Modèle";"effort"->"Réflexion";"catalogue"->"Catalogue";"detail"->plugin?.optString("name").orEmpty();"confirmation"->"Confirmer";else->"Plugins"},if(section in listOf("models","effort"))if(threadId.isBlank())"Codex · général" else "Ce chat Codex" else if(connection.slot=="server")"Sur le serveur" else "Sur ce PC",Lilac)}
            if(busy)item{CircularProgressIndicator(Modifier.size(22.dp),color=Lilac,strokeWidth=2.dp)}
            if(error.isNotBlank())item{SmallNote(error)}
            when(section){
                "models"->{
                    if(!busy&&error.isBlank()&&choice.model.isNotBlank()&&models.none{it.optString("id")==choice.model})item{SmallNote("Le modèle enregistré n’est plus disponible. Choisis un modèle actuel ou le réglage du PC.")}
                    if(threadId.isNotBlank())item{WatchCard("Réglage général",if(!specific)"Sélectionné" else "Suivre les paramètres",if(!specific)Icons.Rounded.RadioButtonChecked else Icons.Rounded.RadioButtonUnchecked,Lilac){inference.useGeneral(connection,threadId);specific=false;choice=inference.read(connection)}}
                    item{val selected=choice.model.isBlank()&&(threadId.isBlank()||specific);WatchCard(if(connection.slot=="server")"Du serveur" else "Du PC",if(selected)"Sélectionné" else "Réglage de la conversation",if(selected)Icons.Rounded.RadioButtonChecked else Icons.Rounded.RadioButtonUnchecked,Lilac){save(InferenceChoice())}}
                    if(choice.model.isNotBlank())item{WatchCard("Réflexion",effortLabel(choice.thinking),Icons.Rounded.Psychology,Lilac){section="effort"}}
                    items(models){m->val selected=choice.model==m.optString("id")&&(threadId.isBlank()||specific);WatchCard(m.optString("name"),if(selected)"Sélectionné" else null,if(selected)Icons.Rounded.RadioButtonChecked else Icons.Rounded.RadioButtonUnchecked,Lilac){
                        val supported=m.optJSONArray("efforts");val preferred=listOf("medium","low").firstOrNull{value->supported?.toString()?.contains("\"$value\"")==true}.orEmpty();save(InferenceChoice(m.optString("id"),preferred));section="effort"
                    }}
                    item{SmallNote(if(threadId.isBlank())"Appliqué par défaut aux prochaines demandes Codex. Chaque chat peut choisir son propre réglage." else "Appliqué aux prochaines demandes de ce chat, y compris en Live. Les autres chats gardent leurs réglages.")}
                }
                "effort"->{
                    val values=models.find{it.optString("id")==choice.model}?.optJSONArray("efforts")
                    if(values!=null)for(i in 0 until values.length()){val value=values.getString(i);item{WatchCard(effortLabel(value),if(choice.thinking==value)"Sélectionnée" else null,if(choice.thinking==value)Icons.Rounded.RadioButtonChecked else Icons.Rounded.RadioButtonUnchecked,Lilac){save(choice.copy(thinking=value))}}}
                    if(!busy&&error.isBlank()&&values==null)item{SmallNote(if(choice.model.isBlank())"Choisis d’abord un modèle pour régler sa réflexion." else "Réflexion indisponible pour ce modèle.");ActionButton("Modèle",Icons.Rounded.Psychology,Lilac){section="models"}}
                }
                "plugins","catalogue"->{
                    if(section=="catalogue")item{OutlinedTextField(query,{query=it;offset=0},singleLine=true,label={Text("Rechercher",fontSize=11.sp)},modifier=Modifier.fillMaxWidth())}
                    if(section=="plugins")item{ActionButton("Catalogue",Icons.Rounded.Add,Lilac,enabled=!busy){section="catalogue"}}
                    items(plugins){p->WatchCard(p.optString("name"),if(p.optBoolean("cached"))"En cache · à vérifier" else if(!p.optBoolean("installed"))"Disponible" else if(p.optBoolean("enabled"))"Actif" else "Inactif",Icons.Rounded.Extension,Lilac){plugin=p;section="detail"}}
                    if(!busy&&plugins.isEmpty())item{SmallNote("Aucun plugin à afficher.")}
                    if(section=="catalogue"&&nextOffset>=0)item{ActionButton("Suivants",Icons.Rounded.ExpandMore,Lilac,enabled=!busy){offset=nextOffset}}
                }
                "detail"->{
                    item{SmallNote(listOf(plugin?.optString("marketplace"),plugin?.optString("version")).filter{!it.isNullOrBlank()}.joinToString(" · "))}
                    item{SmallNote("Les connexions et autorisations des services se règlent sur le PC.")}
                    if(plugin?.optBoolean("cached")==true)item{SmallNote("Le catalogue distant ne confirme pas son état. Réessaie plus tard pour le modifier.")}
                    else if(plugin?.optBoolean("installed")==true){
                        item{ActionButton(if(plugin?.optBoolean("enabled")==true)"Désactiver" else "Activer",Icons.Rounded.PowerSettingsNew,Lilac,enabled=!busy){action(if(plugin?.optBoolean("enabled")==true)"disable" else "enable")}}
                        item{ActionButton("Retirer",Icons.Rounded.DeleteOutline,Lilac,enabled=!busy){action("remove")}}
                    }else item{ActionButton("Installer",Icons.Rounded.Download,Lilac,enabled=!busy){action("add")}}
                }
                "confirmation"->{
                    item{SmallNote("${when(confirm){"remove"->"Retirer";"disable"->"Désactiver";"enable"->"Activer";else->"Installer"}} ${plugin?.optString("name")}? Cette action concerne Codex sur ce relais.")}
                    item{ActionButton("Confirmer",Icons.Rounded.Check,Lilac,enabled=!busy){scope.launch{
                        busy=true;error=""
                        try{api.request("/v1/plugins/${BridgeApi.encode(plugin!!.getString("id"))}","POST",JSONObject().put("action",confirm));section="plugins";confirm=""}
                        catch(e:Exception){error=e.message?:"Modification impossible"}finally{busy=false}
                    }}}
                    item{ActionButton("Annuler",Icons.Rounded.Close){section="detail";confirm=""}}
                }
            }
            item{TextButton(onClick={when(section){"effort"->section="models";"confirmation"->section="detail";"detail","catalogue"->section="plugins";else->finish()}},modifier=Modifier.heightIn(min=48.dp)){Text("Retour",fontSize=12.sp)}}
        }
    }
}
internal fun effortLabel(value:String)=when(value){"none"->"Aucune";"minimal"->"Minimale";"low"->"Faible";"medium"->"Standard";"high"->"Haute";"xhigh"->"Très haute";"max"->"Maximum";"ultra"->"Ultra";else->"Du PC"}
