package fr.thomas.codexwatch

import java.io.ByteArrayOutputStream
import java.util.zip.DeflaterOutputStream
import java.util.Base64
import org.junit.Assert.*
import org.junit.Test

class LiveAudioCodecTest {
    @Test fun compressedAudioDecodesWithoutChangingSamples() {
        val original=ByteArray(9600){i -> ((i/16)%13).toByte()}
        val packed=ByteArrayOutputStream().also { output -> DeflaterOutputStream(output).use{it.write(original)} }.toByteArray()
        assertTrue(packed.size<original.size)
        assertArrayEquals(original,decodeLiveAudio(packed,"deflate-pcm16",original.size))
    }
    @Test fun originalPcmRemainsCompatible() {
        val bytes=byteArrayOf(3,4,5,6)
        assertArrayEquals(bytes,decodeLiveAudio(bytes,"",-1))
    }
    @Test fun decodesDeltaPacketProducedByTheRelayIncludingSampleWraparound() {
        val expected=Base64.getDecoder().decode("AAABAP8AAAH/fwCA//8AAPQByADo/Q==")
        val packet=Base64.getDecoder().decode("eAFjYPzH+J/xP+OXKwoMDAwMdQz1DIz//gIAWJkH4g==")
        assertArrayEquals(expected,decodeLiveAudio(packet,"delta-deflate-pcm16",expected.size))
    }
    @Test fun rejectsInvalidOrOversizedDecodedData() {
        val packed=ByteArrayOutputStream().also { output -> DeflaterOutputStream(output).use{it.write(ByteArray(20))} }.toByteArray()
        assertThrows(IllegalArgumentException::class.java){decodeLiveAudio(packed,"deflate-pcm16",10)}
        assertThrows(IllegalArgumentException::class.java){decodeLiveAudio(packed,"deflate-pcm16",262146)}
        assertThrows(IllegalArgumentException::class.java){decodeLiveAudio(packed,"unknown",20)}
    }
}
