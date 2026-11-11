package fr.thomas.codexwatch

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.WifiFind
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.launch
import java.net.URI

/** DNS-SD advertises only the public HTTPS origin. No pairing code or token is broadcast. */
@Composable fun RelayDiscovery(onSelect:(String)->Unit){
    val context=LocalContext.current;val scope=rememberCoroutineScope()
    val found=remember{mutableStateMapOf<String,String>()}
    DisposableEffect(Unit){
        val manager=context.getSystemService(Context.NSD_SERVICE)as NsdManager
        val resolving=mutableSetOf<String>()
        val listener=object:NsdManager.DiscoveryListener{
            override fun onDiscoveryStarted(type:String){}
            override fun onDiscoveryStopped(type:String){}
            override fun onStartDiscoveryFailed(type:String,error:Int){}
            override fun onStopDiscoveryFailed(type:String,error:Int){}
            override fun onServiceLost(info:NsdServiceInfo){scope.launch{found.remove(info.serviceName)}}
            @Suppress("DEPRECATION") override fun onServiceFound(info:NsdServiceInfo){
                if(!resolving.add(info.serviceName))return
                runCatching{manager.resolveService(info,object:NsdManager.ResolveListener{
                    override fun onResolveFailed(service:NsdServiceInfo,error:Int){resolving.remove(info.serviceName)}
                    override fun onServiceResolved(service:NsdServiceInfo){
                        val url=service.attributes["url"]?.toString(Charsets.UTF_8).orEmpty()
                        if(runCatching{URI(url).scheme=="https"&&URI(url).host!=null}.getOrDefault(false))scope.launch{found[service.serviceName]=url}
                    }
                })}
            }
        }
        runCatching{manager.discoverServices("_codexwatch._tcp.",NsdManager.PROTOCOL_DNS_SD,listener)}
        onDispose{runCatching{manager.stopServiceDiscovery(listener)}}
    }
    for((name,url)in found)WatchCard(name,URI(url).host,Icons.Rounded.WifiFind,Lilac){onSelect(url)}
}
