package io.github.kt.pulsebar.export

import io.github.kt.pulsebar.core.stream.StreamStats



private fun StreamStats.toExport(): PulseBarStreamStats =
    PulseBarStreamStats(
        connectionState = connectionState.toExport(),
        webSocketUrl = webSocketUrl,
        lastConnectedAtMillis = lastConnectedAtMillis ?: 0L,
        lastDisconnectedAtMillis = lastDisconnectedAtMillis ?: 0L,
        nextReconnectAtMillis = nextReconnectAtMillis ?: 0L,
        reconnectDelaySeconds = reconnectDelaySeconds ?: 0.0,
        lastSendAtMillis = lastSendAtMillis ?: 0L,
        lastErrorMessage = lastErrorMessage,
        acceptedFrames = acceptedFrames,
        acceptedBytes = acceptedBytes,
        droppedFrames = droppedFrames,
        droppedChunks = droppedChunks,
        lastSequence = lastSequence,
        bufferedFrames = bufferedFrames,
        queuedChunks = queuedChunks,
        queuedBytes = queuedBytes,
        queuedFirstSequence = queuedFirstSequence ?: -1L,
        queuedLastSequence = queuedLastSequence ?: -1L,
        isSending = isSending,
        maxQueuedChunks = maxQueuedChunks,
        reconnectCount = reconnectCount,
        reconnectAttempt = reconnectAttempt,
        chunksSent = chunksSent,
        bytesSent = bytesSent,
        sendBitrateKbps = sendBitrateKbps ?: 0.0,
        lastChunkBytes = lastChunkBytes,
        chunkDurationMs = chunkDurationMs,
        statusText = statusText,
        captureRequested = captureRequested,
    )
