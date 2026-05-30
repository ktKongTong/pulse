package io.github.kt.pulsebar.model.stream

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

//    val connectionState: PulseBarStreamConnectionState,
//    val webSocketUrl: String?,
//    val lastConnectedAtMillis: Long,        // 0 == never
//    val lastDisconnectedAtMillis: Long,     // 0 == never
//    val nextReconnectAtMillis: Long,        // 0 == none scheduled
//    val reconnectDelaySeconds: Double,      // 0.0 == unknown
//    val lastSendAtMillis: Long,             // 0 == never
//    val lastErrorMessage: String?,
//    val acceptedFrames: Long,
//    val acceptedBytes: Long,
//    val droppedFrames: Long,
//    val droppedChunks: Long,
//    val lastSequence: Long,
//
/** True when the server has issued stream.start and wants the host to pump PCM. */
//val captureRequested: Boolean,
//val reconnectCount: Long,
//val reconnectAttempt: Int,
// val isSending: Boolean,

@Serializable
enum class StreamStatus {
    @SerialName("idle") IDLE,
    @SerialName("streaming") STREAMING,
}



data class StreamStats(
    val startedAt: Long,
    val status: StreamStatus,
    val bufferedFrames: Long,
    val chunkDurationInMs: Int,
    val queuedChunks: Int,
    val queuedBytes: Long,
    val queuedFirstSequence: Long,          // -1 == none
    val queuedLastSequence: Long,           // -1 == none
    val maxQueuedChunks: Int,
    val chunksSent: Long,
    val bytesSent: Long,
    val sendBitrateKbps: Double,            // 0.0 == unknown
    val lastChunkBytes: Long,
)

