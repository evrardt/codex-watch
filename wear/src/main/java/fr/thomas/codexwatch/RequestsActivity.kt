package fr.thomas.codexwatch

import androidx.compose.ui.res.stringResource
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import org.json.JSONObject

// Old notifications can still target this component after an app update.
class RequestsActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startActivity(Intent(this, MainActivity::class.java).putExtras(intent.extras ?: Bundle())
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
        finish()
    }
}

@Composable fun ConversationRequestCard(request: JSONObject, api: BridgeApi, onSending: () -> Unit, onFinished: () -> Unit, onFailed: () -> Unit, onSent: () -> Unit) {
    val scope = rememberCoroutineScope()
    val haptic = LocalHapticFeedback.current
    val key = request.optString("key")
    val answers = remember(key) { mutableStateMapOf<String, String>() }
    var busy by remember(key) { mutableStateOf(false) }
    var error by remember(key) { mutableStateOf("") }
    fun send(body: JSONObject, questions: Boolean = false) {
        if (busy) return
        busy = true; error = ""
        onSending()
        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        scope.launch {
            try {
                if (questions && request.optString("source") == "desktop-ui") body.put("asyncConfirm", true)
                val result = api.request("/v1/approvals/${BridgeApi.encode(key)}${if (questions) "/answers" else ""}", "POST", body)
                if (result.optBoolean("pending")) {
                    var confirmed = false
                    repeat(70) {
                        if (!confirmed) {
                            delay(1000)
                            when (api.request("/v1/approvals/${BridgeApi.encode(key)}/result", timeoutMs = 5000).optString("state")) {
                                "confirmed" -> confirmed = true
                                "uncertain" -> throw IllegalStateException("Envoi non confirmé. Vérifie la conversation avant de recommencer.")
                            }
                        }
                    }
                    if (!confirmed) throw IllegalStateException("Confirmation indisponible. Vérifie la conversation avant de recommencer.")
                }
                onSent()
            } catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (e: Exception) { error = e.message ?: "Réponse non transmise"; onFailed() }
            finally { busy = false; onFinished() }
        }
    }
    Column(Modifier.fillMaxWidth()) {
        Text(if (request.optString("type") == "questions") stringResource(R.string.ui_1c5cb9921cbe) else stringResource(R.string.ui_03b196c82005), color = Lilac, fontSize = 10.sp)
        if (request.optString("type") == "questions") {
            val questions = request.optJSONArray("questions")?.objects().orEmpty()
            for (q in questions) {
                val id = q.optString("id")
                SmallNote(q.optString("question"))
                // The PC's Other radio represents the free-text field below, not a complete answer on its own.
                val options = q.optJSONArray("options")?.objects().orEmpty().filterNot {
                    request.optString("source") == "desktop-ui" && it.optString("label").trim().lowercase() in listOf("autre", "other")
                }
                for (option in options) {
                    val label = option.optString("label")
                    WatchCard(label, option.optString("description"), if (answers[id] == label) Icons.Rounded.RadioButtonChecked else Icons.Rounded.RadioButtonUnchecked, Lilac, enabled = !busy, titleMaxLines = Int.MAX_VALUE, subtitleMaxLines = Int.MAX_VALUE) { answers[id] = label }
                }
                val chosen = answers[id].orEmpty()
                val customAnswer = if (options.any { it.optString("label") == chosen }) "" else chosen
                OutlinedTextField(customAnswer, { answers[id] = it }, label = { Text(if (options.isEmpty()) stringResource(R.string.ui_c42aba381489) else stringResource(R.string.ui_d55db9643385), fontSize = 11.sp) },
                    modifier = Modifier.fillMaxWidth(), enabled = !busy,
                    visualTransformation = if (q.optBoolean("isSecret")) PasswordVisualTransformation() else VisualTransformation.None)
            }
            ActionButton(if (busy) stringResource(R.string.ui_1ccef8a10ca7) else stringResource(R.string.ui_79075209f2bb), Icons.Rounded.Send, Lilac,
                enabled = !busy && questions.isNotEmpty() && questions.all { answers[it.optString("id")]?.isNotBlank() == true }, working = busy) {
                val values = JSONObject(); questions.forEach { values.put(it.optString("id"), answers[it.optString("id")]) }
                send(JSONObject().put("answers", values), true)
            }
            if (request.optString("source") != "desktop-ui") TextButton(onClick = { send(JSONObject().put("cancel", true), true) }, enabled = !busy) { Text(stringResource(R.string.ui_46ad3916f6a0), maxLines = 1) }
        } else {
            SmallNote(request.optString("title")); SmallNote(request.optString("cwd"))
            ActionButton(if (busy) stringResource(R.string.ui_1ccef8a10ca7) else stringResource(R.string.ui_5fa07aecdbea), Icons.Rounded.Check, Lilac, enabled = !busy, working = busy) { send(JSONObject().put("decision", "accept")) }
            TextButton(onClick = { send(JSONObject().put("decision", "decline")) }, enabled = !busy) { Text(stringResource(R.string.ui_283348d05e1c), maxLines = 1) }
        }
        if (error.isNotBlank()) SmallNote(statusText(error), Color(0xFFFFBA9D))
    }
}
