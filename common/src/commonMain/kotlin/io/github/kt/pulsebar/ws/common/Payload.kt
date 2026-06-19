package io.github.kt.pulsebar.ws.common

import io.github.kt.pulsebar.model.Endpoint
import io.github.kt.pulsebar.utils.nowInIso8601
import io.github.kt.pulsebar.ws.connection.CommonMessage
import io.github.kt.pulsebar.ws.DEVICE_WS_PROTOCOL_V2
import io.github.kt.pulsebar.ws.connection.DeviceWsConnectionMessage
import io.github.kt.pulsebar.ws.connection.WSPayload
import io.github.kt.pulsebar.ws.media.DEVICE_V2_AUDIO_CHUNK_DURATION_MS
import io.github.kt.pulsebar.ws.media.DeviceV2AudioCapabilities
import io.github.kt.pulsebar.ws.media.DeviceV2MediaCapabilities
import kotlinx.serialization.Serializable
import kotlin.time.Instant

@Serializable
@DeviceWsConnectionMessage("hello")
internal data class DeviceV2HelloPayload(
    val device: DeviceV2DeviceInfo,
    val capabilities: DeviceV2PresenceCapabilities,
    val media: DeviceV2MediaHelloCapabilities,
    val supportedProtocols: List<String>,
) : WSPayload

@Serializable
@CommonMessage("snapshot")
internal data class DeviceV2PresencePayload(
    val eventId: String,
    val seq: Long,
    val observedAt: String = nowInIso8601(),
    val sentAt: String = nowInIso8601(),
    val state: DeviceV2PresenceState,
) : WSPayload

@Serializable
@CommonMessage("heartbeat")
internal data class DeviceV2PresenceHeartbeatPayload(
    val eventId: String = "heartbeat",
    val seq: Long = 0,
    val observedAt: String = "1970-01-01T00:00:00.000Z",
    val sentAt: String = "1970-01-01T00:00:00.000Z",
) : WSPayload

@Serializable
internal data class DeviceV2PresenceState(val availability: DeviceV2Availability, val focus: DeviceV2Focus)

@Serializable
internal data class DeviceV2Availability(val state: String, val idleSeconds: Int? = null)

@Serializable
internal data class DeviceV2Focus(val app: App? = null)

@Serializable
data class App(
    val name: String? = null,
    val id: String? = null,
    val category: String? = null,
)

internal fun deviceV2Hello(config: Endpoint) = DeviceV2HelloPayload(
    device = DeviceV2DeviceInfo(
        name = config.url,
        platform = "macos",
        displayName = config.url,
    ),
    capabilities = DeviceV2PresenceCapabilities(
        focusApp = true,
        windowTitle = false,
        pageTitle = false,
        pageUrl = false,
    ),
    media = DeviceV2MediaHelloCapabilities(
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
    ),
    supportedProtocols = listOf(DEVICE_WS_PROTOCOL_V2),
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
internal data class DeviceV2MediaHelloCapabilities(
    val capabilities: DeviceV2MediaCapabilities,
    val audio: DeviceV2AudioCapabilities,
)


internal fun epochMillisToIso8601(epochMillis: Long): String =
    Instant.fromEpochMilliseconds(epochMillis).toString()


internal sealed interface CommonWsEvent {
    data object Connecting : CommonWsEvent
    data class Opened(val url: String) : CommonWsEvent
    data class HelloAccepted(val deviceSessionId: String) : CommonWsEvent
    data class Closed(val reason: String?) : CommonWsEvent
    data class Failed(val error: Throwable) : CommonWsEvent
}
