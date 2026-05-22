package io.github.kt.pulsebar.core.devicev2

import kotlinx.serialization.Serializable

@Serializable
internal data class DeviceV2Frame<T>(
    val protocol: String,
    val type: String,
    val payload: T,
)

@Serializable
internal data class DeviceV2CommonHelloPayload(
    val device: DeviceV2DeviceInfo,
    val capabilities: DeviceV2PresenceCapabilities,
    val supportedProtocols: List<String>,
)

@Serializable
internal data class DeviceV2DeviceInfo(
    val name: String,
    val platform: String,
    val appVersion: String? = null,
    val mode: String? = null,
    val displayName: String? = null,
)

@Serializable
internal data class DeviceV2PresenceCapabilities(
    val focusApp: Boolean,
    val windowTitle: Boolean,
    val pageTitle: Boolean,
    val pageUrl: Boolean,
)

@Serializable
internal data class DeviceV2MediaHelloPayload(
    val capabilities: DeviceV2MediaCapabilities,
    val audio: DeviceV2AudioCapabilities,
    val supportedProtocols: List<String>,
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
internal data class DeviceV2StreamStatePayload(val sentAt: String, val state: DeviceV2StreamState)

@Serializable
internal data class DeviceV2MediaClock(
    val mediaProgressSeconds: Double? = null,
    val durationSeconds: Double? = null,
    val updatedAt: String? = null,
)

@Serializable
internal data class DeviceV2MediaUpdatePayload(
    val sentAt: String,
    val media: DeviceV2MediaItem,
    val clock: DeviceV2MediaClock? = null,
)

@Serializable
internal data class DeviceV2AcceptedAckPayload(
    val commandId: String,
    val commandType: String,
    val status: String,
    val streamId: String,
    val generation: Int,
    val firstSeq: Long,
    val capture: DeviceV2CaptureInfo? = null,
    val streamFormat: DeviceV2StreamFormat? = null,
    val sentAt: String,
)

@Serializable
internal data class DeviceV2RejectedAckPayload(
    val commandId: String,
    val commandType: String,
    val status: String,
    val rejectedReason: DeviceV2RejectedReason,
    val sentAt: String,
)

@Serializable
internal data class DeviceV2StoppedAckPayload(
    val commandId: String,
    val commandType: String,
    val status: String,
    val streamId: String,
    val generation: Int,
    val sentAt: String,
)

@Serializable
internal data class DeviceV2AudioChunkPayload(
    val streamId: String,
    val generation: Int,
    val seq: Long,
    val sentAt: String,
    val durationMs: Int,
    val byteLength: Int,
)

@Serializable
internal data class DeviceV2StreamStoppedPayload(
    val streamId: String,
    val generation: Int,
    val reason: String,
    val sentAt: String,
)
