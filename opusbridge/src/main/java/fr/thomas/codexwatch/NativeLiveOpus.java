package fr.thomas.codexwatch;

import eu.buney.kopus.Opus;
import eu.buney.kopus.OpusDecoder;
import java.io.ByteArrayOutputStream;

/** Decode the relay's length-prefixed 20 ms packets into mono PCM16 at 24 kHz. */
public final class NativeLiveOpus implements AutoCloseable {
    private OpusDecoder decoder;

    public NativeLiveOpus() {
        // The library's singleton loads the JNI library; constructing OpusDecoder alone does not.
        Opus.INSTANCE.getOpusVersion();
        decoder = new OpusDecoder(24000, 1);
    }

    public void reset() {
        decoder.close();
        decoder = new OpusDecoder(24000, 1);
    }

    public byte[] decode(byte[] framed) {
        if (framed.length < 3 || framed.length > 30000) throw new IllegalArgumentException("Invalid Opus frame");
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        short[] pcm = new short[480];
        int offset = 0, packets = 0;
        while (offset < framed.length) {
            if (offset + 2 > framed.length || ++packets > 20) throw new IllegalArgumentException("Incomplete Opus frame");
            int size = ((framed[offset] & 255) << 8) | (framed[offset + 1] & 255);
            offset += 2;
            if (size < 1 || size > 1275 || size > framed.length - offset) throw new IllegalArgumentException("Invalid Opus packet");
            int count = decoder.decode(framed, offset, size, pcm, 0, pcm.length, false);
            if (count != 480) throw new IllegalStateException("Unexpected Opus duration");
            for (int i = 0; i < count; i++) { output.write(pcm[i] & 255); output.write((pcm[i] >>> 8) & 255); }
            offset += size;
        }
        return output.toByteArray();
    }

    @Override public void close() { if (decoder != null) { decoder.close(); decoder = null; } }
}
