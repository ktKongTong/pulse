package io.github.kt.pulsebar.core.livelisten

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Serialization shapes for `live-listen.device.v1`. Mirrors
 * `packages/realtime-protocol/src/live-listen-v1.ts` exactly so what goes
 * over the WebSocket matches the worker's Zod schema.
 *
 * These are internal to the core module — the public surface is
 * [LiveListenClient]. The wire types are split from the state model so tests
 * can exercise serialization independently.
 */

internal const val LIVE_LISTEN_DEVICE_PROTOCOL_V1 = "live-listen.device.v1"

@Serializable
internal enum class LiveListenMediaPermission {
    @SerialName("allow") ALLOW,
    @SerialName("disallow") DISALLOW,
}

@Serializable
internal enum class LiveListenCaptureRuntime {
    @SerialName("capturing") CAPTURING,
    @SerialName("no-capture") NO_CAPTURE,
}

@Serializable
internal enum class LiveListenPlaybackWire {
    @SerialName("playing") PLAYING,
    @SerialName("paused") PAUSED,
}

@Serializable
internal enum class LiveListenBlockedReason {
    @SerialName("device_offline") DEVICE_OFFLINE,
    @SerialName("live_listen_disabled") LIVE_LISTEN_DISABLED,
    @SerialName("no_playable_media") NO_PLAYABLE_MEDIA,
    @SerialName("capture_permission_missing") CAPTURE_PERMISSION_MISSING,
    @SerialName("capture_permission_revoked") CAPTURE_PERMISSION_REVOKED,
    @SerialName("capture_source_unavailable") CAPTURE_SOURCE_UNAVAILABLE,
    @SerialName("capture_source_lost") CAPTURE_SOURCE_LOST,
    @SerialName("unsupported_app") UNSUPPORTED_APP,
    @SerialName("native_error") NATIVE_ERROR,
    @SerialName("connection_lost") CONNECTION_LOST,
    @SerialName("snapshot_unavailable") SNAPSHOT_UNAVAILABLE,
    @SerialName("auth_failed") AUTH_FAILED,
    @SerialName("protocol_error") PROTOCOL_ERROR,
    @SerialName("session_rejected") SESSION_REJECTED,
}

@Serializable
internal enum class LiveListenStopReason {
    @SerialName("last_listener_disconnected") LAST_LISTENER_DISCONNECTED,
    @SerialName("live_listen_disabled") LIVE_LISTEN_DISABLED,
    @SerialName("capture_permission_revoked") CAPTURE_PERMISSION_REVOKED,
    @SerialName("capture_source_lost") CAPTURE_SOURCE_LOST,
    @SerialName("native_shutdown") NATIVE_SHUTDOWN,
    @SerialName("manual_stop") MANUAL_STOP,
    @SerialName("no_playable_media") NO_PLAYABLE_MEDIA,
    @SerialName("capture_permission_missing") CAPTURE_PERMISSION_MISSING,
    @SerialName("capture_source_unavailable") CAPTURE_SOURCE_UNAVAILABLE,
    @SerialName("unsupported_app") UNSUPPORTED_APP,
}

@Serializable
internal data class LiveListenMedia(
    val providerId: String? = null,
    val itemType: String? = null,
    val trackId: String? = null,
    val uri: String? = null,
    val linkUrl: String? = null,
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
    val artworkUrl: String? = null,
    val durationSeconds: Double? = null,
    val playbackState: LiveListenPlaybackWire? = null,
)

@Serializable
internal data class LiveListenClock(
    val mediaProgressSeconds: Double,
    val observedAt: String,
    val sequence: Long,
    val streamLatencyMs: Int? = null,
)

@Serializable
internal data class LiveListenError(val code: String, val message: String)

@Serializable
internal data class LiveListenNativeMediaState(
    val permission: LiveListenMediaPermission,
    val playback: LiveListenPlaybackWire,
    val capture: LiveListenCaptureRuntime,
    val reason: LiveListenBlockedReason? = null,
    val message: String? = null,
    val media: LiveListenMedia? = null,
)

@Serializable
internal data class LiveListenDeviceCapabilities(
    val binaryAudio: Boolean? = null,
    val localRingBuffer: Boolean? = null,
    val localRingBufferSeconds: Int? = null,
)

// ---- device -> server (outbound) --------------------------------------------

internal sealed interface LiveListenDeviceOutbound {
    val protocol: String
    val sentAt: String
}

@Serializable
internal data class DeviceHelloFrame(
    val deviceId: String,
    override val sentAt: String,
    val mediaState: LiveListenNativeMediaState,
    val lastStreamId: String? = null,
    val lastGeneration: Int? = null,
    val lastSeq: Long? = null,
    val capabilities: LiveListenDeviceCapabilities? = null,
    val type: String = "device.hello",
    override val protocol: String = LIVE_LISTEN_DEVICE_PROTOCOL_V1,
) : LiveListenDeviceOutbound

@Serializable
internal data class MediaStateUpdatedFrame(
    val deviceId: String,
    override val sentAt: String,
    val mediaState: LiveListenNativeMediaState,
    val type: String = "media.state.updated",
    override val protocol: String = LIVE_LISTEN_DEVICE_PROTOCOL_V1,
) : LiveListenDeviceOutbound

@Serializable
internal data class MediaUpdatedFrame(
    val deviceId: String,
    override val sentAt: String,
    val media: LiveListenMedia,
    val clock: LiveListenClock? = null,
    val type: String = "media.updated",
    override val protocol: String = LIVE_LISTEN_DEVICE_PROTOCOL_V1,
) : LiveListenDeviceOutbound

@Serializable
internal data class StreamHeartbeatFrame(
    val deviceId: String,
    val streamId: String,
    val generation: Int,
    override val sentAt: String,
    val lastSeq: Long,
    val clock: LiveListenClock? = null,
    val type: String = "stream.heartbeat",
    override val protocol: String = LIVE_LISTEN_DEVICE_PROTOCOL_V1,
) : LiveListenDeviceOutbound

@Serializable
internal data class AckFrame(
    val commandId: String,
    val status: String, // "started" | "resumed" | "resumed_with_gap" | "stopped" | "rejected" | "restarted"
    override val sentAt: String,
    val streamId: String? = null,
    val generation: Int? = null,
    val firstSeq: Long? = null,
    val missingBeforeSeq: Long? = null,
    val type: String = "ack",
    override val protocol: String = LIVE_LISTEN_DEVICE_PROTOCOL_V1,
) : LiveListenDeviceOutbound

@Serializable
internal data class StreamStoppedFrame(
    val streamId: String,
    val generation: Int,
    val reason: LiveListenStopReason,
    override val sentAt: String,
    val type: String = "stream.stopped",
    override val protocol: String = LIVE_LISTEN_DEVICE_PROTOCOL_V1,
) : LiveListenDeviceOutbound

@Serializable
internal data class ErrorFrame(
    override val sentAt: String,
    val error: LiveListenError,
    val deviceId: String? = null,
    val type: String = "error",
    override val protocol: String = LIVE_LISTEN_DEVICE_PROTOCOL_V1,
) : LiveListenDeviceOutbound

// ---- server -> device (inbound commands) -----------------------------------

@Serializable
@SerialName("command")
internal data class DeviceCommandEnvelope(
    val commandId: String,
    val sentAt: String,
    val expiresAt: String,
    val command: DeviceCommand,
    val protocol: String = LIVE_LISTEN_DEVICE_PROTOCOL_V1,
)

@Serializable
internal sealed interface DeviceCommand {

    @Serializable
    @SerialName("stream.start")
    data class StreamStart(
        val streamId: String,
        val generation: Int,
        val capture: CaptureOptions,
        val audio: AudioOptions,
    ) : DeviceCommand

    @Serializable
    @SerialName("stream.resume")
    data class StreamResume(
        val streamId: String,
        val generation: Int,
        val fromSeq: Long,
        val audio: AudioOptions,
    ) : DeviceCommand

    @Serializable
    @SerialName("stream.stop")
    data class StreamStop(
        val reason: String,
        val streamId: String? = null,
    ) : DeviceCommand

    @Serializable
    data class CaptureOptions(
        val mode: String,
        val preferredProvider: String? = null,
        val fallback: String? = null,
    )

    @Serializable
    data class AudioOptions(
        val codec: String,
        val chunkDurationMs: Int,
        val targetLatencyMs: Int,
    )
}

// ---- JSON configuration ----------------------------------------------------

internal val liveListenWireJson: Json = Json {
    classDiscriminator = "type"
    ignoreUnknownKeys = true
    encodeDefaults = true
    explicitNulls = false
}
