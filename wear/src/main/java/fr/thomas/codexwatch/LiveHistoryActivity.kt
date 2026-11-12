package fr.thomas.codexwatch
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.compose.material3.Text
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.items
import org.json.JSONObject

import androidx.compose.ui.res.stringResource
class LiveHistoryActivity:ComponentActivity(){
 override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState);setContent{WatchTheme{
  val connection=remember{ConnectionStore(this).let{it.read(it.activeSlot())}};var messages by remember{mutableStateOf(emptyList<JSONObject>())};var error by remember{mutableStateOf("")}
  LaunchedEffect(Unit){try{val route="/v1/live/history?kind=${BridgeApi.encode(intent.getStringExtra("kind")?:"codex")}&threadId=${BridgeApi.encode(intent.getStringExtra("threadId").orEmpty())}";messages=BridgeApi(connection).request(route).optJSONArray("data")?.objects().orEmpty()}catch(e:Exception){error=e.message?:"Historique indisponible"}}
  WatchList("live-history",initialEndIndex=messages.size.takeIf{it>0}){
   item{PageTitle(stringResource(R.string.ui_58569bcd7473),stringResource(R.string.ui_b4093dec64fd),Lilac)}
   if(error.isNotBlank())item{SmallNote(statusText(error))}
   items(messages){m->Eyebrow(if(m.optString("role")=="user")stringResource(R.string.ui_f7e354dbca69) else stringResource(R.string.ui_3a72e4b43c68),Lilac);Text(m.optString("text"),fontSize=13.sp,lineHeight=18.sp)}
   if(messages.isEmpty()&&error.isBlank())item{SmallNote(stringResource(R.string.ui_75f0fb1bdd3c))}
  }
 }}}
}
