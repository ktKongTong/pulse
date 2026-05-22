package io.github.kt.pulsebar.core.devicev2

import io.ktor.client.plugins.websocket.ClientWebSocketSession
import io.ktor.websocket.Frame
import io.ktor.websocket.send

internal suspend fun DeviceV2Client.runPcmBatcher(session: ClientWebSocketSession) {
    for (pcm in pcmChannel) {
        updateStats {
            it.copy(
                acceptedFrames = it.acceptedFrames + (pcm.size / deviceV2BytesPerFrame(channels)).toLong(),
                acceptedBytes = it.acceptedBytes + pcm.size.toLong(),
            )
        }
        pcmBuffer = pcmBuffer + pcm
        while (pcmBuffer.size >= chunkBytes) {
            val chunk = pcmBuffer.copyOfRange(0, chunkBytes)
            pcmBuffer = pcmBuffer.copyOfRange(chunkBytes, pcmBuffer.size)
            sendChunk(session, deviceV2WrapWav(chunk, sampleRate, channels))
        }
        updateStats { it.copy(bufferedFrames = (pcmBuffer.size / deviceV2BytesPerFrame(channels)).toLong()) }
    }
}

private suspend fun DeviceV2Client.sendChunk(session: ClientWebSocketSession, bytes: ByteArray) {
    val stream = activeStream ?: return
    val seq = stream.nextSeq
    activeStream = stream.copy(nextSeq = seq + 1)
    val payload = DeviceV2AudioChunkPayload(
        streamId = stream.streamId,
        generation = stream.generation,
        seq = seq,
        sentAt = deviceV2NowIso(),
        durationMs = chunkDurationMs,
        byteLength = bytes.size,
    )
    session.send(Frame.Text(deviceV2AudioChunkFrame(payload)))
    session.send(Frame.Binary(fin = true, data = bytes))
    updateStats {
        it.copy(
            lastSendAtMillis = deviceV2NowMillis(),
            chunksSent = it.chunksSent + 1L,
            bytesSent = it.bytesSent + bytes.size.toLong(),
            lastChunkBytes = bytes.size.toLong(),
            lastSequence = seq,
            statusText = "Chunk sent seq=$seq",
        )
    }
}
