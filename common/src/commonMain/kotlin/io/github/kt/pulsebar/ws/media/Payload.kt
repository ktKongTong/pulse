package io.github.kt.pulsebar.ws.media

import io.github.kt.pulsebar.ws.connection.MediaConnectionMessage
import io.github.kt.pulsebar.ws.connection.MediaMessage
import io.github.kt.pulsebar.ws.connection.WSPayload
import io.github.kt.pulsebar.model.stream.CaptureInfo
import io.github.kt.pulsebar.model.stream.Media
import io.github.kt.pulsebar.model.stream.StreamFormat
import io.github.kt.pulsebar.model.stream.StreamRejectedReason
import io.github.kt.pulsebar.model.stream.StreamState
import io.github.kt.pulsebar.model.stream.StreamStopReason

import io.github.kt.pulsebar.utils.nowInIso8601
import io.github.kt.pulsebar.ws.DEVICE_MEDIA_PROTOCOL_V1
import kotlinx.serialization.SerialInfo
import kotlinx.serialization.Serializable

@Serializable
@MediaConnectionMessage("hello")
internal data class DeviceV2MediaHelloPayload(
    val capabilities: DeviceV2MediaCapabilities,
    val audio: DeviceV2AudioCapabilities,
    val supportedProtocols: List<String>,
): WSPayload

@Serializable
@MediaMessage("stream.state.updated")
internal data class DeviceV2StreamStatePayload(
    val state: StreamState,
    // @Serializable(with = LongToIsoSerializer::class)
    val sentAt: String = nowInIso8601(),
): WSPayload


@Serializable
@MediaMessage("media.updated")
internal data class DeviceV2MediaUpdatePayload(
    val media: Media? = null,
    val clock: DeviceV2MediaClock? = null,
    val sentAt: String = nowInIso8601(),
): WSPayload

@Serializable
@MediaMessage("ack")
internal data class DeviceV2AcceptedAckPayload(
    val commandId: String,
    val commandType: String,
    val status: String = "accepted",
    val streamId: String,
    val generation: Int,
    val firstSeq: Long,
    val capture: CaptureInfo? = null,
    val streamFormat: StreamFormat? = null,
    val sentAt: String = nowInIso8601(),
): WSPayload


enum class StreamRequestStatus {

}

@Serializable
@MediaMessage("ack")
internal data class DeviceV2RejectedAckPayload(
    val commandId: String,
    val commandType: String,
    val status: String = "rejected",
    val rejectedReason: StreamRejectedReason,
    val sentAt: String = nowInIso8601()
): WSPayload

@Serializable
@MediaMessage("ack")
internal data class DeviceV2StoppedAckPayload(
    val commandId: String,
    val commandType: String = "stream.stop",
    val status: String = "stopped",
    val streamId: String,
    val generation: Int,
    val sentAt: String = nowInIso8601(),
): WSPayload

@Serializable
@MediaMessage("audio.chunk")
internal data class DeviceV2AudioChunkPayload(
    val streamId: String,
    val generation: Int,
    val seq: Long,
    val sentAt: String = nowInIso8601(),
    val durationMs: Int,
    val byteLength: Int,
): WSPayload

@Serializable
@MediaMessage("stream.stopped")
internal data class DeviceV2StreamStoppedPayload(
    val streamId: String,
    val generation: Int,
    val reason: StreamStopReason,
    val sentAt: String,
): WSPayload


internal const val DEVICE_V2_AUDIO_CHUNK_DURATION_MS: Int = 1000

internal fun deviceV2MediaHello() = DeviceV2MediaHelloPayload(
    capabilities = DeviceV2MediaCapabilities(
        media = true,
        localPlayback = true,
        remotePlayback = false,
        binaryAudio = true,
        localRingBuffer = false,
    ),
    audio = DeviceV2AudioCapabilities(
        codecs = listOf("pcm16-wav"),
        chunkDurationMs = DEVICE_V2_AUDIO_CHUNK_DURATION_MS,
    ),
    supportedProtocols = listOf(DEVICE_MEDIA_PROTOCOL_V1),
)



@Serializable
internal data class DeviceV2MediaCapabilities(
    val media: Boolean,
    val localPlayback: Boolean,
    val remotePlayback: Boolean,
    val binaryAudio: Boolean,
    val localRingBuffer: Boolean? = null,
    val localRingBufferSeconds: Int? = null,
)

@Serializable
internal data class DeviceV2AudioCapabilities(
    val codecs: List<String>,
    val chunkDurationMs: Int? = null,
)

@Serializable
internal data class DeviceV2MediaClock(
    val mediaProgressSeconds: Double? = null,
    val durationSeconds: Double? = null,
    val updatedAt: String? = null,
)
