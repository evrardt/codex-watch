package fr.thomas.codexwatch

import java.io.ByteArrayInputStream
import java.util.zip.InflaterInputStream

/** The relay may compress output audio only after explicit negotiation. PCM stays bit-exact. */
internal fun decodeLiveAudio(bytes:ByteArray,encoding:String,pcmBytes:Int):ByteArray {
    if(encoding.isEmpty()||encoding=="pcm16")return bytes
    require(encoding=="deflate-pcm16"||encoding=="delta-deflate-pcm16") { "Format audio Live inconnu" }
    require(pcmBytes in 2..262144 && pcmBytes%2==0) { "Taille audio Live invalide" }
    return InflaterInputStream(ByteArrayInputStream(bytes)).use { input ->
        val pcm=ByteArray(pcmBytes);var offset=0
        while(offset<pcm.size){val n=input.read(pcm,offset,pcm.size-offset);require(n>0){"Audio Live incomplet"};offset+=n}
        require(input.read()==-1){"Audio Live trop volumineux"}
        if(encoding=="deflate-pcm16")pcm else {
            val count=pcm.size/2;val result=ByteArray(pcm.size);var previous=0
            for(i in 0 until count){
                val delta=(pcm[i].toInt() and 255) or ((pcm[count+i].toInt() and 255) shl 8)
                previous=(previous+delta) and 65535
                result[i*2]=previous.toByte();result[i*2+1]=(previous ushr 8).toByte()
            }
            result
        }
    }
}
