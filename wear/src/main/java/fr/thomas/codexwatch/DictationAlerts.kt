package fr.thomas.codexwatch

import android.os.Handler
import android.os.Looper

/** Wait briefly for actual playback; never silence an unconfirmed or background reply. */
internal class PendingDictationAlerts(private val schedule: (Long, () -> Unit) -> Unit) {
    private data class Active(val profile:String,val kind:String,val thread:String,val request:String,var playing:Boolean=false)
    private data class Waiting(val request:String,val deliver:(Boolean)->Unit)
    private var active:Active?=null
    private val waiting=mutableMapOf<String,Waiting>()
    private val reserved=mutableSetOf<String>()
    private var handledRequest=""

    @Synchronized fun arm(profile:String,kind:String,thread:String,request:String) {
        if(thread.isBlank()||request.isBlank()||request==handledRequest)return
        val existing=active
        if(existing?.request==request&&existing.profile==profile&&existing.kind==kind&&existing.thread==thread)return
        cancel()
        active=Active(profile,kind,thread,request)
        schedule(60*60*1000L) { expire(request) }
    }
    @Synchronized fun route(key:String,profile:String,kind:String,thread:String,type:String,protect:()->Boolean={true},deliver:(Boolean)->Unit):Boolean {
        if(key in reserved)return true
        val task=active ?: return false
        if(type!="completed"||task.profile!=profile||task.kind!=kind||task.thread!=thread)return false
        if(!protect())return false
        reserved.add(key)
        if(task.playing){handledRequest=task.request;active=null;dispatch(key,deliver,true);return true}
        waiting[key]=Waiting(task.request,deliver)
        schedule(12000L) { resolve(key,false) }
        return true
    }
    @Synchronized fun started(profile:String,kind:String,thread:String,request:String) {
        val task=active ?: return
        if(task.profile!=profile||task.kind!=kind||task.thread!=thread||task.request!=request)return
        task.playing=true
        val keys=waiting.filterValues{it.request==request}.keys.toList()
        if(keys.isEmpty()) schedule(30000L) { expire(request) }
        else keys.forEach{resolve(it,true)}
    }
    @Synchronized fun cancel() {
        active=null
        waiting.keys.toList().forEach{resolve(it,false)}
    }
    @Synchronized private fun expire(request:String) { if(active?.request==request)cancel() }
    @Synchronized private fun resolve(key:String,silent:Boolean) {
        val entry=waiting.remove(key) ?: return
        if(active?.request==entry.request)active=null
        handledRequest=entry.request
        dispatch(key,entry.deliver,silent)
    }
    private fun dispatch(key:String,deliver:(Boolean)->Unit,silent:Boolean) {
        schedule(0L) { try { deliver(silent) } finally { synchronized(this) { reserved.remove(key) } } }
    }
}

internal object DictationAlerts {
    private val handler=Handler(Looper.getMainLooper())
    val gate=PendingDictationAlerts { delay, action -> handler.postDelayed({ action() },delay) }
}
