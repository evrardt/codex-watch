package fr.thomas.codexwatch

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.foundation.layout.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.items
import org.json.JSONArray
import org.json.JSONObject

class PluginPickerActivity:ComponentActivity(){
 override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState);setContent{WatchTheme{
  val connection=remember{ConnectionStore(this).let{it.read(it.activeSlot())}}
  var rows by remember{mutableStateOf(emptyList<JSONObject>())};var error by remember{mutableStateOf("")};var loading by remember{mutableStateOf(true)}
  val selected=remember{mutableStateMapOf<String,JSONObject>().apply{runCatching{JSONArray(intent.getStringExtra("selection")?:"[]").objects().forEach{put(it.getString("id"),it)}}}}
  var query by remember{mutableStateOf("")}
  var searching by remember{mutableStateOf(false)}
  LaunchedEffect(Unit){try{val data=BridgeApi(connection).request("/v1/plugins");rows=(data.optJSONArray("installed")?.objects().orEmpty()+data.optJSONArray("cached")?.objects().orEmpty()).distinctBy{it.optString("id")};error=data.optString("notice")}catch(e:Exception){error=e.message?:"Plugins indisponibles"}finally{loading=false}}
  WatchList("plugin-picker",bottomAction=({ActionButton("Choisir",Icons.Rounded.Check,Lilac){setResult(Activity.RESULT_OK,Intent().putExtra("selection",JSONArray(selected.values.toList()).toString()));finish()}})){
   item{Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Box(Modifier.weight(1f)){Eyebrow("Plugins",Lilac)};IconButton(onClick={searching=!searching},modifier=Modifier.size(48.dp)){Icon(Icons.Rounded.Search,"Rechercher",tint=Lilac)}}}
   if(searching)item{OutlinedTextField(query,{query=it},singleLine=true,label={Text("Rechercher",fontSize=11.sp)},modifier=Modifier.fillMaxWidth())}
   if(loading)item{CircularProgressIndicator(Modifier.size(22.dp),color=Lilac)}
   if(error.isNotBlank()&&rows.isEmpty())item{SmallNote(error)}
   items(rows.filter{it.optString("name").contains(query,true)}){p->val id=p.getString("id");val type=when(p.optString("kind")){"workflow"->"Plugin · consignes";"app"->"Application";else->"Plugin"};WatchCard(p.optString("name"),if(selected.containsKey(id))"Sélectionné · $type" else if(p.optBoolean("cached"))"$type · à vérifier" else type,if(selected.containsKey(id))Icons.Rounded.CheckBox else Icons.Rounded.CheckBoxOutlineBlank,Lilac){if(selected.containsKey(id))selected.remove(id)else if(selected.size<5)selected[id]=JSONObject().put("id",id).put("name",p.optString("name"))else error="Cinq plugins maximum par message."}}
   if(!loading&&rows.isEmpty())item{SmallNote("Aucun plugin disponible sur ce relais.")}
   if(error.isNotBlank()&&rows.isNotEmpty())item{SmallNote(error)}
   item{SmallNote("Codex vérifiera leur disponibilité. Aucune installation automatique.")}
  }
 }}}
}
