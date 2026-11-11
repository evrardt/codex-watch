package fr.thomas.codexwatch

/** Transport preference never changes the identity or pairing of a relay. */
internal fun transportOrder(mode:String, bluetoothConfigured:Boolean, bluetoothConnected:Boolean):List<String> = when(mode) {
    "bluetooth" -> listOf("bluetooth")
    "auto" -> if(!bluetoothConfigured) listOf("internet") else if(bluetoothConnected) listOf("bluetooth","internet") else listOf("internet","bluetooth")
    else -> listOf("internet")
}

/** A lost HTTP response is ambiguous; replay only read requests and idempotent chat submissions. */
internal fun canRetryOnAnotherTransport(method:String,path:String,requestId:String?):Boolean =
    method=="GET" || (method=="POST" && requestId!=null && (path=="/v1/threads" || Regex("^/v1/threads/[^/]+/messages$").matches(path)))

object ConnectionStatus {
    private val last=java.util.concurrent.ConcurrentHashMap<String,String>()
    private fun key(connection:Connection) = connection.slot+"\u0000"+connection.url
    fun success(connection:Connection,transport:String) {last[key(connection)]=transport}
    fun last(connection:Connection):String = last[key(connection)].orEmpty()
}
