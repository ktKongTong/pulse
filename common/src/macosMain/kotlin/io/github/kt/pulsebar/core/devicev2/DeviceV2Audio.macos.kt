package io.github.kt.pulsebar.core.devicev2

internal fun deviceV2ChunkBytesFor(chunkDurationMs: Int, sampleRate: Int, channels: Int): Int {
    val frames = (sampleRate.toLong() * chunkDurationMs.toLong() / 1_000L).toInt().coerceAtLeast(1)
    return frames * channels * 2
}

internal fun deviceV2WrapWav(pcm16: ByteArray, sampleRate: Int, channels: Int): ByteArray {
    val out = ByteArray(44 + pcm16.size)
    out[0] = 'R'.code.toByte(); out[1] = 'I'.code.toByte(); out[2] = 'F'.code.toByte(); out[3] = 'F'.code.toByte()
    writeLE32(out, 4, 36 + pcm16.size)
    out[8] = 'W'.code.toByte(); out[9] = 'A'.code.toByte(); out[10] = 'V'.code.toByte(); out[11] = 'E'.code.toByte()
    out[12] = 'f'.code.toByte(); out[13] = 'm'.code.toByte(); out[14] = 't'.code.toByte(); out[15] = ' '.code.toByte()
    writeLE32(out, 16, 16)
    writeLE16(out, 20, 1)
    writeLE16(out, 22, channels)
    writeLE32(out, 24, sampleRate)
    writeLE32(out, 28, sampleRate * channels * 2)
    writeLE16(out, 32, channels * 2)
    writeLE16(out, 34, 16)
    out[36] = 'd'.code.toByte(); out[37] = 'a'.code.toByte(); out[38] = 't'.code.toByte(); out[39] = 'a'.code.toByte()
    writeLE32(out, 40, pcm16.size)
    pcm16.copyInto(out, 44)
    return out
}

private fun writeLE16(buf: ByteArray, off: Int, value: Int) {
    buf[off] = (value and 0xFF).toByte()
    buf[off + 1] = ((value shr 8) and 0xFF).toByte()
}

private fun writeLE32(buf: ByteArray, off: Int, value: Int) {
    buf[off] = (value and 0xFF).toByte()
    buf[off + 1] = ((value shr 8) and 0xFF).toByte()
    buf[off + 2] = ((value shr 16) and 0xFF).toByte()
    buf[off + 3] = ((value shr 24) and 0xFF).toByte()
}

