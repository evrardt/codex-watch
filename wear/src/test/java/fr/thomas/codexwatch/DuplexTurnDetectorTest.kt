package fr.thomas.codexwatch
import org.junit.Assert.*
import org.junit.Test

class DuplexTurnDetectorTest {
    @Test fun userCanInterruptAnAlreadySpeakingBot(){
        val d=DuplexTurnDetector()
        assertFalse(d.frame(.04f,true));assertFalse(d.frame(.04f,true));assertTrue(d.frame(.04f,true))
        repeat(20){assertFalse(d.frame(.04f,true))}
    }
    @Test fun botCanTakeTheFloorWhileTheUserIsAlreadySpeaking(){
        val d=DuplexTurnDetector();repeat(8){assertFalse(d.frame(.04f,false))}
        repeat(20){assertFalse(d.frame(.04f,true))}
        repeat(10){d.frame(0f,true)}
        assertFalse(d.frame(.04f,true));assertFalse(d.frame(.04f,true));assertTrue(d.frame(.04f,true))
    }
    @Test fun silenceAndBriefNoiseDoNotInterruptSpeech(){
        val d=DuplexTurnDetector();repeat(40){assertFalse(d.frame(.009f,true))}
        assertFalse(d.frame(.06f,true));repeat(10){assertFalse(d.frame(0f,true))}
    }
}
