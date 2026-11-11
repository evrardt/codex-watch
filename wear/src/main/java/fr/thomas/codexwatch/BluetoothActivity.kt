package fr.thomas.codexwatch

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.wear.compose.foundation.lazy.items
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

class BluetoothActivity:ComponentActivity() {
    override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState);setContent { WatchTheme { BluetoothPage() } }}
    @SuppressLint("MissingPermission")
    @Composable private fun BluetoothPage() {
        val context=LocalContext.current;val store=remember{ConnectionStore(context)};val slot=remember{store.activeSlot()}
        val adapter=remember{getSystemService(BluetoothManager::class.java)?.adapter};val scope=rememberCoroutineScope()
        val devices=remember{mutableStateMapOf<String,String>()};var scanning by remember{mutableStateOf(false)};var busy by remember{mutableStateOf(false)}
        var error by remember{mutableStateOf("")};var current by remember{mutableStateOf(runCatching{store.read(slot).bluetoothAddress}.getOrDefault(""))}
        var mode by remember{mutableStateOf(runCatching{store.read(slot).transportMode}.getOrDefault("internet"))}
        var lastUsed by remember{mutableStateOf(ConnectionStatus.last(store.read(slot)))}
        var linkState by remember(current){mutableStateOf(if(current.isBlank()) "Non associé" else "Vérification…")}
        var internetState by remember { mutableStateOf("Vérification…") }
        LaunchedEffect(current,mode) {
            while(isActive) {
                val profile=store.read(slot)
                coroutineScope {
                    val internet=async { try { BridgeApi(profile.copy(transportMode="internet")).health(timeoutMs=5000,markStatus=false);"Disponible" } catch(e:kotlinx.coroutines.CancellationException){throw e} catch(_:Exception){"Indisponible"} }
                    val bluetooth=async { if(current.isBlank())"Non associé" else if(mode=="internet")"Non utilisé" else try { BridgeApi(profile.copy(transportMode="bluetooth")).health(timeoutMs=10000,markStatus=false);"Connecté" } catch(e:kotlinx.coroutines.CancellationException){throw e} catch(_:Exception){"Indisponible"} }
                    internetState=internet.await();linkState=bluetooth.await()
                }
                lastUsed=ConnectionStatus.last(profile)
                delay(15000)
            }
        }
        fun permitted():Boolean = if(Build.VERSION.SDK_INT>=31) listOf(Manifest.permission.BLUETOOTH_CONNECT,Manifest.permission.BLUETOOTH_SCAN).all{checkSelfPermission(it)==PackageManager.PERMISSION_GRANTED} else checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED
        fun add(device:BluetoothDevice?) { if(device!=null&&permitted())runCatching{val address=device.address;devices[address]=device.name?.takeIf{it.isNotBlank()}?:"Appareil Bluetooth"} }
        fun scan() {
            if(adapter==null){error="Bluetooth indisponible sur cette montre.";return}
            if(!adapter.isEnabled){error="Active le Bluetooth de la montre.";return}
            if(!permitted()){error="Autorise les appareils à proximité.";return}
            error="";devices.clear();adapter.bondedDevices.forEach{add(it)}
            scanning=adapter.startDiscovery();if(!scanning)error="Recherche indisponible. Réessaie."
        }
        val permission=rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()){grants->if(grants.values.all{it})scan()else error="Autorise les appareils à proximité pour chercher le PC."}
        DisposableEffect(adapter) {
            val receiver=object:BroadcastReceiver(){override fun onReceive(c:Context?,intent:Intent?){when(intent?.action){BluetoothDevice.ACTION_FOUND->{@Suppress("DEPRECATION") val d=intent.getParcelableExtra<BluetoothDevice>(BluetoothDevice.EXTRA_DEVICE);add(d)};BluetoothAdapter.ACTION_DISCOVERY_FINISHED->scanning=false}}}
            val filter=IntentFilter().apply{addAction(BluetoothDevice.ACTION_FOUND);addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)}
            if(Build.VERSION.SDK_INT>=33)context.registerReceiver(receiver,filter,Context.RECEIVER_EXPORTED) else @Suppress("DEPRECATION") context.registerReceiver(receiver,filter)
            onDispose {runCatching{context.unregisterReceiver(receiver)};if(permitted())runCatching{adapter?.cancelDiscovery()}}
        }
        WatchList("bluetooth") {
            item { PageTitle("Connexions", "Choix du réseau",Lilac) }
            item { SmallNote("Internet · $internetState\nBluetooth · $linkState",Lilac) }
            if(lastUsed.isNotBlank())item { SmallNote("Dernière liaison utilisée · ${if(lastUsed=="bluetooth")"Bluetooth" else "Internet"}",Mint) }
            for((value,label,detail) in listOf(Triple("auto","Automatique","Bluetooth et Internet"),Triple("bluetooth","Bluetooth","À proximité du PC"),Triple("internet","Internet","Wi-Fi ou réseau mobile"))) item {
                val selected=mode==value
                WatchCard(label,if(selected)"Sélectionné · $detail" else detail,if(selected)Icons.Rounded.CheckCircle else Icons.Rounded.RadioButtonUnchecked,if(selected)Mint else Lilac,enabled=!busy&&(value!="bluetooth"||current.isNotBlank())) {
                    store.transport(slot,value);mode=value
                    if(value!="internet"&&current.isNotBlank()&&(DirectNotifications.enabled||CloudNotifications.enabled)&&DirectNotifications.allowed(context))runCatching{DirectNotifications.enable(context.applicationContext)}
                    else {CloudNotifications.restore(context.applicationContext);if(DirectNotifications.enabled)DirectNotifications.refresh(context.applicationContext)}
                    setResult(Activity.RESULT_OK);finish()
                }
            }
            item { SmallNote("Associe d’abord Codex Watch au relais. Sur le PC, active Bluetooth dans Codex Watch puis ouvre l’ajout d’un appareil Bluetooth.") }
            if(error.isNotBlank())item { SmallNote(error) }
            item { ActionButton(if(scanning) "Recherche…" else "Chercher",Icons.Rounded.BluetoothSearching,Lilac,enabled=!busy&&!scanning) {
                if(permitted())scan() else permission.launch(if(Build.VERSION.SDK_INT>=31) arrayOf(Manifest.permission.BLUETOOTH_CONNECT,Manifest.permission.BLUETOOTH_SCAN) else arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION,Manifest.permission.ACCESS_FINE_LOCATION))
            } }
            items(devices.entries.sortedBy{it.value.lowercase()}) { entry ->
                WatchCard(entry.value,if(entry.key==current)"Associé · $linkState" else "Connecter au relais",Icons.Rounded.Computer,Lilac,enabled=!busy) {
                    busy=true;error="";val previous=current;val previousMode=mode;scope.launch {
                        try {
                            withContext(Dispatchers.IO){adapter?.cancelDiscovery();BluetoothTunnel.reset();BluetoothTunnel.probe(entry.key)}
                            store.bluetooth(slot,entry.key);current=entry.key;mode="auto"
                            withContext(Dispatchers.IO){BridgeApi(store.read(slot).copy(transportMode="bluetooth")).health()}
                            if((DirectNotifications.enabled||CloudNotifications.enabled)&&DirectNotifications.allowed(context))runCatching{DirectNotifications.enable(context.applicationContext)}
                            setResult(Activity.RESULT_OK);finish()
                        }catch(e:Exception){store.bluetooth(slot,previous);store.transport(slot,previousMode);current=previous;mode=previousMode;error="Connexion impossible. Vérifie le relais et accepte l’association Bluetooth sur les deux appareils."}
                        finally{busy=false}
                    }
                }
            }
            if(!scanning&&devices.isEmpty())item{SmallNote("Aucun appareil trouvé pour le moment.")}
            item { androidx.compose.material3.TextButton(onClick={finish()}){Text("Retour")} }
        }
    }
}
