package fr.thomas.codexwatch

import androidx.compose.ui.res.stringResource
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
            item{PageTitle(when(section){"models"->stringResource(R.string.ui_e61bbb839ef8);"effort"->stringResource(R.string.ui_fc8b3826cea8);"catalogue"->stringResource(R.string.ui_103451395067);"detail"->plugin?.optString("name").orEmpty();"confirmation"->stringResource(R.string.ui_30a8b7846961);else->"Plugins"},if(section in listOf("models","effort"))if(threadId.isBlank())stringResource(R.string.ui_ab829c6050fb) else stringResource(R.string.ui_6582d798cfcb) else if(connection.slot=="server")stringResource(R.string.ui_26db79d195e4) else stringResource(R.string.ui_9f7ea2e9a212),Lilac)}
            if(busy)item{CircularProgressIndicator(Modifier.size(22.dp),color=Lilac,strokeWidth=2.dp)}
            if(error.isNotBlank())item{SmallNote(statusText(error))}
            when(section){
                "models"->{
                    if(!busy&&error.isBlank()&&choice.model.isNotBlank()&&models.none{it.optString("id")==choice.model})item{SmallNote(stringResource(R.string.ui_72be18b58dab))}
                    if(threadId.isNotBlank())item{WatchCard(stringResource(R.string.ui_335dd50def52),if(!specific)stringResource(R.string.ui_42345d238922) else stringResource(R.string.ui_299288967625),if(!specific)Icons.Rounded.RadioButtonChecked else Icons.Rounded.RadioButtonUnchecked,Lilac){inference.useGeneral(connection,threadId);specific=false;choice=inference.read(connection)}}
                    item{val selected=choice.model.isBlank()&&(threadId.isBlank()||specific);WatchCard(if(connection.slot=="server")stringResource(R.string.ui_05c7f4639c83) else stringResource(R.string.ui_09b6227b10b2),if(selected)stringResource(R.string.ui_42345d238922) else stringResource(R.string.ui_64721755ca36),if(selected)Icons.Rounded.RadioButtonChecked else Icons.Rounded.RadioButtonUnchecked,Lilac){save(InferenceChoice())}}
                    if(choice.model.isNotBlank())item{WatchCard(stringResource(R.string.ui_fc8b3826cea8),effortLabel(choice.thinking),Icons.Rounded.Psychology,Lilac){section="effort"}}
                    items(models){m->val selected=choice.model==m.optString("id")&&(threadId.isBlank()||specific);WatchCard(m.optString("name"),if(selected)stringResource(R.string.ui_42345d238922) else null,if(selected)Icons.Rounded.RadioButtonChecked else Icons.Rounded.RadioButtonUnchecked,Lilac){
                        val supported=m.optJSONArray("efforts");val preferred=listOf("medium","low").firstOrNull{value->supported?.toString()?.contains("\"$value\"")==true}.orEmpty();save(InferenceChoice(m.optString("id"),preferred));section="effort"
                    }}
                    item{SmallNote(if(threadId.isBlank())stringResource(R.string.ui_b66d536ca3ad) else stringResource(R.string.ui_0f54ccfa6c5a))}
                }
                "effort"->{
                    val values=models.find{it.optString("id")==choice.model}?.optJSONArray("efforts")
                    if(values!=null)for(i in 0 until values.length()){val value=values.getString(i);item{WatchCard(effortLabel(value),if(choice.thinking==value)stringResource(R.string.ui_0674422b0d91) else null,if(choice.thinking==value)Icons.Rounded.RadioButtonChecked else Icons.Rounded.RadioButtonUnchecked,Lilac){save(choice.copy(thinking=value))}}}
                    if(!busy&&error.isBlank()&&values==null)item{SmallNote(if(choice.model.isBlank())stringResource(R.string.ui_b0dd567019a6) else stringResource(R.string.ui_80dc402b0030));ActionButton(stringResource(R.string.ui_e61bbb839ef8),Icons.Rounded.Psychology,Lilac){section="models"}}
                }
                "plugins","catalogue"->{
                    if(section=="catalogue")item{OutlinedTextField(query,{query=it;offset=0},singleLine=true,label={Text(stringResource(R.string.ui_733d1c742675),fontSize=11.sp)},modifier=Modifier.fillMaxWidth())}
                    if(section=="plugins")item{ActionButton(stringResource(R.string.ui_103451395067),Icons.Rounded.Add,Lilac,enabled=!busy){section="catalogue"}}
                    items(plugins){p->WatchCard(p.optString("name"),if(p.optBoolean("cached"))stringResource(R.string.ui_74df479f2666) else if(!p.optBoolean("installed"))stringResource(R.string.ui_f4e4f699637b) else if(p.optBoolean("enabled"))stringResource(R.string.ui_ad26287ab66b) else stringResource(R.string.ui_cdcf2ea348f7),Icons.Rounded.Extension,Lilac){plugin=p;section="detail"}}
                    if(!busy&&plugins.isEmpty())item{SmallNote(stringResource(R.string.ui_c6624a6c8ff9))}
                    if(section=="catalogue"&&nextOffset>=0)item{ActionButton(stringResource(R.string.ui_32986d8932b4),Icons.Rounded.ExpandMore,Lilac,enabled=!busy){offset=nextOffset}}
                }
                "detail"->{
                    item{SmallNote(listOf(plugin?.optString("marketplace"),plugin?.optString("version")).filter{!it.isNullOrBlank()}.joinToString(" · "))}
                    item{SmallNote(stringResource(R.string.ui_73b5fa16b268))}
                    if(plugin?.optBoolean("cached")==true)item{SmallNote(stringResource(R.string.ui_8af2e49cac03))}
                    else if(plugin?.optBoolean("installed")==true){
                        item{ActionButton(if(plugin?.optBoolean("enabled")==true)stringResource(R.string.ui_c07050ca8933) else stringResource(R.string.ui_77bf4e88dbc8),Icons.Rounded.PowerSettingsNew,Lilac,enabled=!busy){action(if(plugin?.optBoolean("enabled")==true)"disable" else "enable")}}
                        item{ActionButton(stringResource(R.string.ui_41e22ed93372),Icons.Rounded.DeleteOutline,Lilac,enabled=!busy){action("remove")}}
                    }else item{ActionButton(stringResource(R.string.ui_bb6b121974b6),Icons.Rounded.Download,Lilac,enabled=!busy){action("add")}}
                }
                "confirmation"->{
                    item{SmallNote(stringResource(when(confirm){"remove"->R.string.plugin_confirm_remove;"disable"->R.string.plugin_confirm_disable;"enable"->R.string.plugin_confirm_enable;else->R.string.plugin_confirm_install}, plugin?.optString("name").orEmpty()))}
                    item{ActionButton(stringResource(R.string.ui_30a8b7846961),Icons.Rounded.Check,Lilac,enabled=!busy){scope.launch{
                        busy=true;error=""
                        try{api.request("/v1/plugins/${BridgeApi.encode(plugin!!.getString("id"))}","POST",JSONObject().put("action",confirm));section="plugins";confirm=""}
                        catch(e:Exception){error=e.message?:"Modification impossible"}finally{busy=false}
                    }}}
                    item{ActionButton(stringResource(R.string.ui_46ad3916f6a0),Icons.Rounded.Close){section="detail";confirm=""}}
                }
            }
            item{TextButton(onClick={when(section){"effort"->section="models";"confirmation"->section="detail";"detail","catalogue"->section="plugins";else->finish()}},modifier=Modifier.heightIn(min=48.dp)){Text(stringResource(R.string.ui_ef23a5940244),fontSize=12.sp)}}
        }
    }
}
internal fun effortLabelResource(value:String)=when(value){"none"->R.string.effort_none;"minimal"->R.string.effort_minimal;"low"->R.string.effort_low;"medium"->R.string.effort_medium;"high"->R.string.effort_high;"xhigh"->R.string.effort_xhigh;"max"->R.string.effort_max;"ultra"->R.string.effort_ultra;else->R.string.ui_09b6227b10b2}
@Composable internal fun effortLabel(value:String)=stringResource(effortLabelResource(value))
