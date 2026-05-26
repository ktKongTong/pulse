package io.github.kt.pulsebar.core.devicev2

import kotlinx.serialization.Serializable



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