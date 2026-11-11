package fr.thomas.codexwatch
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.compose.material3.Text
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.items
import org.json.JSONObject

class LiveHistoryActivity:ComponentActivity(){
 override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState);setContent{WatchTheme{
  val connection=remember{ConnectionStore(this).let{it.read(it.activeSlot())}};var messages by remember{mutableStateOf(emptyList<JSONObject>())};var error by remember{mutableStateOf("")}
  LaunchedEffect(Unit){try{val route="/v1/live/history?kind=${BridgeApi.encode(intent.getStringExtra("kind")?:"codex")}&threadId=${BridgeApi.encode(intent.getStringExtra("threadId").orEmpty())}";messages=BridgeApi(connection).request(route).optJSONArray("data")?.objects().orEmpty()}catch(e:Exception){error=e.message?:"Historique indisponible"}}
  WatchList("live-history",initialEndIndex=messages.size.takeIf{it>0}){
   item{PageTitle("Échanges Live","Dans ce chat",Lilac)}
   if(error.isNotBlank())item{SmallNote(error)}
   items(messages){m->Eyebrow(if(m.optString("role")=="user")"Toi · Live" else "Voix Live",Lilac);Text(m.optString("text"),fontSize=13.sp,lineHeight=18.sp)}
   if(messages.isEmpty()&&error.isBlank())item{SmallNote("Les nouveaux échanges vocaux de ce chat apparaîtront ici.")}
  }
 }}}
}
