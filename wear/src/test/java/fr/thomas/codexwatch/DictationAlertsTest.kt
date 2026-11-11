package fr.thomas.codexwatch

import org.junit.Assert.*
import org.junit.Test

class DictationAlertsTest {
    private class Clock {
        var now=0L
        val tasks=mutableListOf<Pair<Long,()->Unit>>()
        val gate=PendingDictationAlerts { delay,run -> tasks.add(now+delay to run) }
        fun advance(ms:Long) {
            val end=now+ms
            while(true){val next=tasks.filter{it.first<=end}.minByOrNull{it.first} ?: break;tasks.remove(next);now=next.first;next.second()}
            now=end
        }
    }
    @Test fun silentOnlyAfterConfirmedPlayback() {
        val c=Clock();val values=mutableListOf<Boolean>();c.gate.arm("pc","codex","chat","req")
        assertTrue(c.gate.route("event","pc","codex","chat","completed"){values.add(it)})
        assertTrue(values.isEmpty());c.gate.started("pc","codex","chat","req");c.advance(0)
        assertEquals(listOf(true),values)
    }
    @Test fun timeoutAndClosedAppRemainAudible() {
        val c=Clock();val values=mutableListOf<Boolean>();c.gate.arm("pc","codex","chat","req")
        c.gate.route("event","pc","codex","chat","completed"){values.add(it)}
        c.advance(12000);assertEquals(listOf(false),values)
        c.gate.arm("pc","codex","chat","next");c.gate.route("event2","pc","codex","chat","completed"){values.add(it)}
        c.gate.cancel();c.advance(0);assertEquals(listOf(false,false),values)
        assertFalse(c.gate.route("event3","pc","codex","chat","completed"){})
    }
    @Test fun unrelatedEventsAndErrorsAreNeverSilenced() {
        val c=Clock();c.gate.arm("pc","codex","chat","req")
        assertFalse(c.gate.route("other","pc","codex","other","completed"){})
        assertFalse(c.gate.route("other","server","codex","chat","completed"){})
        assertFalse(c.gate.route("error","pc","codex","chat","failed"){})
        assertFalse(c.gate.route("question","pc","codex","chat","attention"){})
    }
    @Test fun playbackBeforeAlertAndDuplicateDelivery() {
        val c=Clock();val values=mutableListOf<Boolean>();c.gate.arm("pc","codex","chat","req")
        c.gate.started("pc","codex","chat","req")
        assertTrue(c.gate.route("event","pc","codex","chat","completed"){values.add(it)})
        assertTrue(c.gate.route("event","pc","codex","chat","completed"){values.add(it)})
        c.advance(0);assertEquals(listOf(true),values)
        c.gate.arm("pc","codex","chat","req")
        assertFalse(c.gate.route("later","pc","codex","chat","completed"){})
    }
    @Test fun wrongPlaybackCannotSilenceTheAlert() {
        val c=Clock();val values=mutableListOf<Boolean>();c.gate.arm("pc","codex","chat","req")
        c.gate.route("event","pc","codex","chat","completed"){values.add(it)}
        c.gate.started("pc","codex","chat","different");c.advance(12000)
        assertEquals(listOf(false),values)
    }
    @Test fun inabilityToProtectPendingAlertMeansItIsDeliveredNormally() {
        val c=Clock();c.gate.arm("pc","codex","chat","req")
        assertFalse(c.gate.route("event","pc","codex","chat","completed",protect={false}){})
    }
}
