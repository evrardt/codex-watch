package fr.thomas.codexwatch

/** Detects a new, sustained user onset. Existing user speech does not mute the bot. */
internal class DuplexTurnDetector {
    private var userSpeaking=false
    private var voiced=0
    private var silent=0
    private var strong=0
    private var bargeCandidate=false
    fun frame(rms:Float,assistantAudible:Boolean):Boolean {
        if(rms>.012f){
            if(!userSpeaking&&voiced==0)bargeCandidate=assistantAudible
            voiced++;silent=0
            if(voiced>=3)userSpeaking=true
            strong=if(rms>.025f)strong+1 else 0
            if(bargeCandidate&&strong>=3){bargeCandidate=false;return true}
        }else{
            silent++;voiced=0;strong=0
            if(silent>=10){userSpeaking=false;bargeCandidate=false}
        }
        return false
    }
}
