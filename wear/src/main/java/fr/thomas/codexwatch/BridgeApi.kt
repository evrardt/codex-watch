package fr.thomas.codexwatch

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.io.IOException
import java.util.UUID

class BridgeException(message: String, val code: String = "", val status: Int = 0) : IllegalStateException(message)

class BridgeApi(val connection: Connection) {
    suspend fun request(path: String, method: String = "GET", body: JSONObject? = null, requestId: String? = null, timeoutMs: Int = 35000, markStatus:Boolean=true, ifNoneMatch:String?=null): JSONObject = withContext(Dispatchers.IO) {
        require(connection.token.isNotBlank()) { "Associer cette montre dans Connexions" }
        val transports=transportOrder(connection.transportMode,connection.bluetoothAddress.isNotBlank(),BluetoothTunnel.connected(connection))
        var failure:IOException?=null
        for((index,transport) in transports.withIndex()) {
            var conn:HttpURLConnection?=null
            try {
                val base=if(transport=="bluetooth") BluetoothTunnel.bluetoothBase(connection) else ConnectionStore.normalizeUrl(connection.url)
                conn=URI(base + path).toURL().openConnection() as HttpURLConnection
                conn.instanceFollowRedirects = false
                conn.connectTimeout = minOf(if(connection.transportMode=="auto") 5000 else 12000, timeoutMs)
                conn.readTimeout = if(connection.transportMode=="auto" && transport=="bluetooth" && !BluetoothTunnel.connected(connection)) minOf(timeoutMs,10000) else timeoutMs
                conn.requestMethod = method
                conn.setRequestProperty("Authorization", "Bearer ${connection.token}")
                conn.setRequestProperty("Accept", "application/json")
                if(!ifNoneMatch.isNullOrBlank())conn.setRequestProperty("If-None-Match",ifNoneMatch)
                if (requestId != null) conn.setRequestProperty("Idempotency-Key", requestId)
                if (body != null) {
                    conn.doOutput = true; conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                }
                val code = conn.responseCode
                if(code==HttpURLConnection.HTTP_NOT_MODIFIED && ifNoneMatch!=null){
                    if(markStatus)ConnectionStatus.success(connection,transport)
                    return@withContext JSONObject().put("_watchUnchanged",true)
                }
                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                val text = stream?.bufferedReader()?.use { it.readText() } ?: "{}"
                val result=parseBridgeResponse(code, text)
                if(ifNoneMatch!=null)result.put("_watchEtag",conn.getHeaderField("ETag").orEmpty())
                if(markStatus)ConnectionStatus.success(connection,transport)
                return@withContext result
            } catch(e:IOException) {
                failure=e
                if(index==transports.lastIndex || !canRetryOnAnotherTransport(method,path,requestId)) break
            } finally { conn?.disconnect() }
        }
        if(!canRetryOnAnotherTransport(method,path,requestId))throw BridgeException("Connexion interrompue. Vérifie la réception avant de renvoyer.","DELIVERY_UNCERTAIN")
        throw failure ?: IOException("Relais indisponible")
    }
    suspend fun health(timeoutMs:Int=35000,markStatus:Boolean=true) = request("/v1/health",timeoutMs=timeoutMs,markStatus=markStatus)
    suspend fun send(kind: String, id: String, project: String, text: String, requestId: String = UUID.randomUUID().toString(),inference:InferenceChoice=InferenceChoice(),plugins:List<String> = emptyList()): JSONObject {
        val route = if (id.isEmpty()) "/v1/threads" else "/v1/threads/${encode(id)}/messages"
        val body=JSONObject().put("kind", kind).put("project", project).put("text", text)
        if(kind=="codex")inference.applyTo(body)
        if(plugins.isNotEmpty())body.put("plugins",org.json.JSONArray(plugins))
        return request(route, "POST", body, requestId)
    }
    companion object {
        fun encode(s: String): String = URLEncoder.encode(s, "UTF-8")
        suspend fun pair(url:String,code:String):JSONObject=withContext(Dispatchers.IO){
            require(Regex("[0-9]{6}").matches(code)){"Entre le code à six chiffres du PC."}
            val conn=URI(ConnectionStore.normalizeUrl(url)+"/v1/pair").toURL().openConnection()as HttpURLConnection
            try{conn.instanceFollowRedirects=false;conn.connectTimeout=12000;conn.readTimeout=12000;conn.requestMethod="POST";conn.doOutput=true;conn.setRequestProperty("Content-Type","application/json");conn.outputStream.use{it.write(JSONObject().put("code",code).toString().toByteArray())};val status=conn.responseCode;val text=(if(status in 200..299)conn.inputStream else conn.errorStream)?.bufferedReader()?.use{it.readText()}.orEmpty();parseBridgeResponse(status,text)}
            finally{conn.disconnect()}
        }
    }
}
