package io.github.kt.pulsebar.ws.media

import io.github.kt.pulsebar.ws.connection.MediaConnectionMessage
import io.github.kt.pulsebar.ws.connection.MediaMessage
import io.github.kt.pulsebar.ws.connection.WSPayload
import io.github.kt.pulsebar.core.devicev2.DeviceV2AudioCapabilities
import io.github.kt.pulsebar.core.devicev2.DeviceV2CaptureInfo
import io.github.kt.pulsebar.core.devicev2.DeviceV2MediaCapabilities
import io.github.kt.pulsebar.core.devicev2.DeviceV2MediaClock
import io.github.kt.pulsebar.core.devicev2.DeviceV2MediaItem
import io.github.kt.pulsebar.core.devicev2.DeviceV2RejectedReason
import io.github.kt.pulsebar.core.devicev2.DeviceV2StreamFormat
import io.github.kt.pulsebar.core.devicev2.DeviceV2StreamState

import io.github.kt.pulsebar.utils.nowInIso8601
import io.github.kt.pulsebar.ws.DEVICE_MEDIA_PROTOCOL_V1
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
internal data class DeviceV2StreamStatePayload(val sentAt: String, val state: DeviceV2StreamState): WSPayload


@Serializable
@MediaMessage("media.updated")
internal data class DeviceV2MediaUpdatePayload(
    val media: DeviceV2MediaItem,
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
    val capture: DeviceV2CaptureInfo? = null,
    val streamFormat: DeviceV2StreamFormat? = null,
    val sentAt: String = nowInIso8601(),
): WSPayload

@Serializable
@MediaMessage("ack")
internal data class DeviceV2RejectedAckPayload(
    val commandId: String,
    val commandType: String,
    val status: String = "rejected",
    val rejectedReason: DeviceV2RejectedReason,
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
    val reason: String,
    val sentAt: String,
): WSPayload


internal fun deviceV2MediaHello(chunkDurationMs: Int) = DeviceV2MediaHelloPayload(
    capabilities = DeviceV2MediaCapabilities(
        media = true,
        localPlayback = true,
        remotePlayback = false,
        binaryAudio = true,
        localRingBuffer = false,
    ),
    audio = DeviceV2AudioCapabilities(
        codecs = listOf("pcm16-wav"),
        chunkDurationMs = chunkDurationMs,
    ),
    supportedProtocols = listOf(DEVICE_MEDIA_PROTOCOL_V1),
)
