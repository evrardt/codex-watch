package fr.thomas.codexwatch

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

/** One encrypted Bluetooth connection multiplexes localhost HTTP, event and Live streams. */
object BluetoothTunnel {
    private val service = UUID.fromString("3f868ec6-4c41-449d-a997-d502f0344d5c")
    private const val maxFrame=16384
    private lateinit var context: Context
    private var forwarder: Forwarder?=null
    @Synchronized fun init(value: Context) { context=value.applicationContext }
    private fun adapter(): BluetoothAdapter = context.getSystemService(BluetoothManager::class.java)?.adapter ?: throw IOException("Bluetooth indisponible sur la montre")
    @SuppressLint("MissingPermission")
    private fun connect(address:String): BluetoothSocket {
        check(Build.VERSION.SDK_INT<31 || ContextCompat.checkSelfPermission(context,Manifest.permission.BLUETOOTH_CONNECT)==PackageManager.PERMISSION_GRANTED) { "Autorise les appareils à proximité." }
        val radio=adapter();check(radio.isEnabled) { "Active le Bluetooth sur la montre." }
        runCatching { radio.cancelDiscovery() }
        val socket=radio.getRemoteDevice(address).createRfcommSocketToServiceRecord(service)
        val finished=AtomicBoolean(false)
        thread(name="codex-watch-bt-connect-timeout",isDaemon=true){Thread.sleep(45000);if(!finished.get())runCatching{socket.close()}}
        try { socket.connect();return socket } catch(e:Exception) { runCatching{socket.close()};throw IOException("Relais Bluetooth inaccessible. Vérifie l’association du PC.",e) } finally {finished.set(true)}
    }
    fun probe(address:String) { connect(address).close() }
    @Synchronized fun bluetoothBase(connection:Connection): String {
        if(connection.bluetoothAddress.isBlank()) throw IOException("Associe d’abord le PC en Bluetooth")
        if(!::context.isInitialized)throw IOException("Bluetooth non initialisé")
        val previous=forwarder
        if(previous==null || previous.address!=connection.bluetoothAddress || previous.closed) {
            previous?.close();forwarder=Forwarder(connection.bluetoothAddress)
        }
        return "http://127.0.0.1:${forwarder!!.port}"
    }
    @Synchronized fun connected(connection:Connection):Boolean = forwarder?.let{it.address==connection.bluetoothAddress&&it.connected()} ?: false
    fun base(connection:Connection):String = if(connection.transportMode=="bluetooth" || connection.transportMode=="auto"&&connected(connection)) bluetoothBase(connection) else ConnectionStore.normalizeUrl(connection.url)
    @Synchronized fun reset() { forwarder?.close();forwarder=null }
    private class Client(val socket:Socket) {
        val ready=CountDownLatch(1)
        @Volatile var opened=false
        fun close(){ready.countDown();runCatching{socket.close()}}
    }
    private class Forwarder(val address:String) {
        private val listener=ServerSocket(0,16,InetAddress.getByName("127.0.0.1"))
        val port=listener.localPort
        @Volatile var closed=false
        private val clients=ConcurrentHashMap<Int,Client>()
        private val ids=AtomicInteger(0)
        private val capacity=Semaphore(16)
        private val sessionLock=Any()
        private val session=AtomicReference<Session?>(null)
        fun connected():Boolean=session.get()?.closed==false
        init { thread(name="codex-watch-bt-listener",isDaemon=true) {
            while(!closed) try { val local=listener.accept();if(!capacity.tryAcquire()){local.close();continue};thread(name="codex-watch-bt-stream",isDaemon=true){try{forward(local)}finally{capacity.release()}} }
            catch(_:Exception){if(!closed)Thread.sleep(100)}
        } }
        private fun getSession():Session=synchronized(sessionLock) {
            if(closed)throw IOException("Relais Bluetooth arrêté")
            val old=session.get();if(old!=null&&!old.closed)return@synchronized old
            val socket=connect(address);if(closed){socket.close();throw IOException("Relais Bluetooth arrêté")}
            Session(socket).also { session.set(it);it.start() }
        }
        private fun forward(local:Socket) {
            var id=0
            try {
                val active=getSession();id=ids.updateAndGet { if(it>=Int.MAX_VALUE-1)1 else it+1 }
                val client=Client(local);clients[id]=client
                active.frame(1,id,ByteArray(0),0)
                if(!client.ready.await(30,TimeUnit.SECONDS)||!client.opened)throw IOException("Relais Bluetooth inaccessible")
                val input=local.getInputStream();val buffer=ByteArray(maxFrame)
                while(!closed&&!active.closed){val n=input.read(buffer);if(n<0)break;if(n>0)active.frame(2,id,buffer,n)}
            } catch(_:Exception) { } finally { if(id!=0){clients.remove(id)?.close();runCatching{session.get()?.frame(3,id,ByteArray(0),0)}};runCatching{local.close()} }
        }
        fun close() { closed=true;runCatching{listener.close()};session.getAndSet(null)?.close();clients.values.forEach{it.close()};clients.clear() }
        private inner class Session(private val socket:BluetoothSocket) {
            @Volatile var closed=false
            private val output=DataOutputStream(socket.outputStream)
            @Synchronized fun frame(op:Int,id:Int,data:ByteArray,length:Int) {
                if(closed)throw IOException("Bluetooth déconnecté")
                try { output.writeByte(op);output.writeInt(id);output.writeInt(length);if(length>0)output.write(data,0,length);output.flush() }
                catch(e:Exception){close();throw e}
            }
            fun start() { thread(name="codex-watch-bt-reader",isDaemon=true) {
                try { val input=DataInputStream(socket.inputStream);while(!closed){val op=input.readUnsignedByte();val id=input.readInt();val length=input.readInt();if(id<=0||length !in 0..maxFrame)throw IOException("Trame Bluetooth invalide");val bytes=ByteArray(length);input.readFully(bytes);val client=clients[id];when(op){4->if(length==0&&client!=null){client.opened=true;client.ready.countDown()}else throw IOException("Accusé Bluetooth invalide");2->if(client!=null)try{client.socket.getOutputStream().write(bytes)}catch(_:Exception){clients.remove(id)?.close()};3->if(length==0)clients.remove(id)?.close() else throw IOException("Fermeture Bluetooth invalide");else->throw IOException("Trame Bluetooth invalide")}} }
                catch(_:Exception){} finally {close()}
            } }
            fun close() {
                if(closed)return;closed=true;runCatching{socket.close()}
                val isCurrent=session.compareAndSet(this,null)
                if(isCurrent){clients.values.forEach{it.close()};clients.clear()}
            }
        }
    }
}
