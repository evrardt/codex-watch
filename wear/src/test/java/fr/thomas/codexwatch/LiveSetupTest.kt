package fr.thomas.codexwatch

import org.junit.Assert.*
import org.junit.Test

class LiveSetupTest {
    @Test fun homeAndLauncherDefaultToChatgptAndCreateNewContexts() {
        assertEquals("chatgpt",liveLaunchKind(null,""))
        assertEquals("chatgpt",liveLaunchKind("codex",""))
        for(kind in listOf("codex","chatgpt")){
            val value=liveLaunchContext(kind,"project","Projet",null,"","")
            assertEquals("new",value.getString("mode"));assertEquals("project",value.getString("project"));assertFalse(value.has("id"))
        }
    }
    @Test fun launchingFromChatKeepsOnlyThatExactChatAndItsSource() {
        assertEquals("codex",liveLaunchKind("codex","thread-a"))
        val selected=liveLaunchContext("codex","other","Autre","codex","thread-a","Discussion ouverte")
        assertEquals("existing",selected.getString("mode"));assertEquals("thread-a",selected.getString("id"));assertFalse(selected.has("project"))
        assertEquals("new",liveLaunchContext("chatgpt","g","Contexte","codex","thread-a","").getString("mode"))
    }
    private fun pcm(vararg samples:Int)=samples.flatMap{listOf(it.toByte(),(it shr 8).toByte())}.toByteArray()
    private fun sample(bytes:ByteArray,index:Int)=((bytes[index*2].toInt()and 255)or(bytes[index*2+1].toInt()shl 8)).toShort().toInt()
    @Test fun voiceBoostDoublesQuietSamplesAndKeepsSilence() {
        val input=pcm(0,1000,-1000,10000,-10000);val output=boostSpeechPcm16(input)
        assertArrayEquals(pcm(0,2000,-2000,20000,-20000),output)
        assertArrayEquals(pcm(0,1000,-1000,10000,-10000),input)
    }
    @Test fun softLimiterPreservesSignAndAvoidsWrappingOrHardClipping() {
        val output=boostSpeechPcm16(pcm(16000,24000,32767,-16000,-24000,-32768))
        assertTrue(sample(output,0)>24000);assertTrue(sample(output,1)>sample(output,0));assertTrue(sample(output,2)<32767)
        assertTrue(sample(output,3)<-24000);assertTrue(sample(output,5)>-32768)
        assertArrayEquals(byteArrayOf(7),boostSpeechPcm16(byteArrayOf(7)))
    }
}
