package fr.thomas.codexwatch

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaFormat
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Prefer in-process libopus, falling back to the platform codec when unavailable. */
internal class LiveOpusDecoder:AutoCloseable {
    private val native:NativeLiveOpus? = try { NativeLiveOpus() } catch (_:LinkageError) { null } catch (_:Exception) { null }
    private val platform:PlatformOpusDecoder? = if(native==null) PlatformOpusDecoder() else null
    fun reset(){if(native!=null)native.reset() else platform!!.reset()}
    fun decode(framed:ByteArray):ByteArray = if(native!=null)native.decode(framed) else platform!!.decode(framed)
    override fun close(){if(native!=null)native.close() else platform?.close()}
}

/** Platform fallback for ordered 20 ms Opus packets. */
private class PlatformOpusDecoder:AutoCloseable {
    private val codec=MediaCodec.createDecoderByType("audio/opus")
    private var presentationUs=0L
    private var outputRate=0
    init {
        try {
            val format=MediaFormat.createAudioFormat("audio/opus",24000,1)
            val head=ByteBuffer.allocate(19).order(ByteOrder.LITTLE_ENDIAN)
            head.put(byteArrayOf(79,112,117,115,72,101,97,100)).put(1).put(1).putShort(0).putInt(24000).putShort(0).put(0).flip()
            fun nanos()=ByteBuffer.allocate(8).order(ByteOrder.nativeOrder()).apply{putLong(0);flip()}
            format.setByteBuffer("csd-0",head);format.setByteBuffer("csd-1",nanos());format.setByteBuffer("csd-2",nanos())
            codec.configure(format,null,null,0);codec.start()
        }catch(e:Exception){codec.release();throw e}
    }
    fun reset(){codec.flush();presentationUs=0}
    fun decode(framed:ByteArray):ByteArray {
        require(framed.size in 3..30000) { "Paquet Opus invalide" }
        val packets=ArrayList<ByteArray>();var pos=0
        while(pos<framed.size){
            require(pos+2<=framed.size && packets.size<20) { "Paquet Opus incomplet" }
            val size=((framed[pos].toInt() and 255) shl 8) or (framed[pos+1].toInt() and 255);pos+=2
            require(size in 1..1275&&pos+size<=framed.size) { "Paquet Opus invalide" }
            packets.add(framed.copyOfRange(pos,pos+size));pos+=size
        }
        val out=ByteArrayOutputStream();val info=MediaCodec.BufferInfo()
        fun drain(timeoutUs:Long):Boolean {
            val index=codec.dequeueOutputBuffer(info,timeoutUs)
            if(index==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED){
                val f=codec.outputFormat;outputRate=f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                require(outputRate==24000||outputRate==48000) { "Fréquence Opus non prise en charge" }
                require(f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)==1) { "Canaux Opus non pris en charge" }
                if(f.containsKey(MediaFormat.KEY_PCM_ENCODING))require(f.getInteger(MediaFormat.KEY_PCM_ENCODING)==AudioFormat.ENCODING_PCM_16BIT)
                return true
            }
            if(index<0)return false
            try {
                val b=codec.getOutputBuffer(index) ?: error("Audio Opus indisponible")
                b.position(info.offset);b.limit(info.offset+info.size);val raw=ByteArray(info.size);b.get(raw)
                if(outputRate==24000)out.write(raw) else {
                    require(outputRate==48000 && raw.size%4==0) { "Audio Opus invalide" }
                    for(i in raw.indices step 4){
                        val a=((raw[i].toInt() and 255) or (raw[i+1].toInt() shl 8)).toShort().toInt()
                        val c=((raw[i+2].toInt() and 255) or (raw[i+3].toInt() shl 8)).toShort().toInt()
                        val sample=(a+c)/2;out.write(sample and 255);out.write((sample shr 8) and 255)
                    }
                }
            } finally {codec.releaseOutputBuffer(index,false)}
            return true
        }
        for(packet in packets){
            var index=codec.dequeueInputBuffer(20000);var attempts=0
            while(index<0&&attempts++<10){drain(10000);index=codec.dequeueInputBuffer(20000)}
            check(index>=0) { "Décodeur Opus occupé" }
            val input=codec.getInputBuffer(index) ?: error("Entrée Opus indisponible")
            input.clear();input.put(packet);codec.queueInputBuffer(index,0,packet.size,presentationUs,0);presentationUs+=20000
            while(drain(0)){}
        }
        // A codec may return the last decoded frame slightly after the final input.
        // Wait briefly only while a frame is outstanding; do not add delay to a full batch.
        val expected=packets.size*960
        while(out.size()<expected&&drain(10000)){}
        while(drain(0)){}
        return out.toByteArray()
    }
    override fun close(){runCatching{codec.stop()};codec.release()}
}
