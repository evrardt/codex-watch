package fr.thomas.codexwatch

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.net.URI
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class Connection(val slot: String, val url: String, val token: String, val bluetoothAddress: String = "", val transportMode: String = "internet")

class ConnectionStore(context: Context) {
    private val prefs = context.getSharedPreferences("connections", Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("codexwatch_v1", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("codexwatch_v1", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun isConfigured(slot: String): Boolean = !prefs.getString("${slot}_url", "").isNullOrBlank() && !prefs.getString("${slot}_token", "").isNullOrBlank()
    fun activeSlot(): String = resolveSlot(prefs.getString("active", "pc") ?: "pc", isConfigured("pc"), isConfigured("server"))
    fun select(slot: String) { require(slot in listOf("pc", "server")); check(prefs.edit().putString("active", slot).commit()) }
    fun read(slot: String = activeSlot()): Connection {
        val url = prefs.getString("${slot}_url", "") ?: ""
        val encrypted = prefs.getString("${slot}_token", null) ?: return Connection(slot, url, "")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(prefs.getString("${slot}_iv", ""), Base64.NO_WRAP)))
        val address=prefs.getString("${slot}_bluetooth", "") ?: ""
        val mode=prefs.getString("${slot}_transport",null)?.takeIf{it in listOf("auto","bluetooth","internet")}
            ?: if(address.isNotBlank()) "auto" else "internet"
        return Connection(slot, url, cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)).toString(Charsets.UTF_8),address,mode)
    }
    fun save(slot: String, url: String, token: String) {
        val normalized = normalizeUrl(url)
        require(slot in listOf("pc", "server"))
        require(token.trim().length >= 32) { "Jeton d’association incomplet" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val encrypted = cipher.doFinal(token.trim().toByteArray(Charsets.UTF_8))
        val edit=prefs.edit().putString("${slot}_url", normalized)
            .putString("${slot}_token", Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .putString("${slot}_iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
        if(!prefs.getString("${slot}_url", "").isNullOrBlank()&&prefs.getString("${slot}_url", "")!=normalized){edit.remove("${slot}_bluetooth").remove("${slot}_transport");BluetoothTunnel.reset()}
        check(edit.commit())
    }
    fun forget(slot: String) {
        check(prefs.edit().remove("${slot}_url").remove("${slot}_token").remove("${slot}_iv").remove("${slot}_bluetooth").remove("${slot}_transport").commit());BluetoothTunnel.reset()
    }
    fun bluetooth(slot:String,address:String) {
        require(slot in listOf("pc", "server"))
        require(address.isEmpty() || Regex("(?i)^[0-9a-f]{2}(:[0-9a-f]{2}){5}$").matches(address))
        check(prefs.edit().putString("${slot}_bluetooth",address).putString("${slot}_transport",if(address.isBlank())"internet" else "auto").commit());BluetoothTunnel.reset()
    }
    fun transport(slot:String,mode:String) {
        require(slot in listOf("pc","server") && mode in listOf("auto","bluetooth","internet"))
        if(mode=="bluetooth")require(!prefs.getString("${slot}_bluetooth","").isNullOrBlank()) { "Associe d’abord le PC en Bluetooth." }
        check(prefs.edit().putString("${slot}_transport",mode).commit())
        if(mode=="internet")BluetoothTunnel.reset()
    }
    companion object {
        fun resolveSlot(preferred: String, pc: Boolean, server: Boolean): String = when {
            pc && !server -> "pc"
            server && !pc -> "server"
            preferred == "server" -> "server"
            else -> "pc"
        }
        fun normalizeUrl(raw: String): String {
            val uri = try { URI(raw.trim().trimEnd('/')) } catch (_: Exception) { throw IllegalArgumentException("Adresse HTTPS invalide") }
            require(uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null && (uri.path.isNullOrEmpty() || uri.path == "/")) { "Utiliser une adresse HTTPS sans chemin ni identifiants" }
            return uri.toString().trimEnd('/')
        }
    }
}
