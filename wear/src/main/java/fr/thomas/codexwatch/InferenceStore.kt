package fr.thomas.codexwatch
import android.content.Context
import org.json.JSONObject

data class InferenceChoice(val model:String="",val thinking:String="") {
    fun applyTo(json:JSONObject):JSONObject {if(model.isNotBlank()){json.put("model",model);if(thinking.isNotBlank())json.put("thinking",thinking)};return json}
}
class InferenceStore(context:Context) {
    private val prefs=context.getSharedPreferences("inference",Context.MODE_PRIVATE)
    private fun key(c:Connection)=ReadStateStore.digest("${c.slot}\u0000${c.url}")
    private fun threadKey(c:Connection,id:String)=inferenceThreadKey(key(c),id)
    fun hasOverride(c:Connection,id:String)=id.isNotBlank()&&prefs.contains(threadKey(c,id))
    fun read(c:Connection,id:String=""):InferenceChoice {
        val general=prefs.getString(key(c),null)
        val specific=if(id.isBlank())null else prefs.getString(threadKey(c,id),null)
        return resolveInference(general,specific)
    }
    fun save(c:Connection,value:InferenceChoice,id:String=""){
        val selected=if(id.isBlank())key(c) else threadKey(c,id)
        prefs.edit().putString(selected,JSONObject().put("model",value.model).put("thinking",value.thinking).toString()).apply()
    }
    fun useGeneral(c:Connection,id:String){if(id.isNotBlank())prefs.edit().remove(threadKey(c,id)).apply()}
}
internal fun inferenceThreadKey(profileKey:String,id:String)="thread:"+ReadStateStore.digest("$profileKey\u0000$id")
internal fun resolveInference(general:String?,specific:String?):InferenceChoice {
    fun parse(value:String?)=value?.let{runCatching{val j=JSONObject(it);InferenceChoice(j.optString("model"),j.optString("thinking"))}.getOrNull()}
    return parse(specific)?:parse(general)?:InferenceChoice()
}
