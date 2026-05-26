package io.github.kt.pulsebar.ws.common

import io.github.kt.pulsebar.core.devicev2.DeviceV2DeviceInfo
import io.github.kt.pulsebar.core.devicev2.DeviceV2PresenceCapabilities
import io.github.kt.pulsebar.core.stream.EndpointConfig
import io.github.kt.pulsebar.focus.DeviceV2Availability
import io.github.kt.pulsebar.focus.DeviceV2Focus
import io.github.kt.pulsebar.focus.DeviceV2PresenceState
import io.github.kt.pulsebar.platform.getFrontmostApp
import io.github.kt.pulsebar.platform.newPulseUuid
import io.github.kt.pulsebar.utils.nowInIso8601
import io.github.kt.pulsebar.ws.connection.CommonMessage
import io.github.kt.pulsebar.ws.DEVICE_CONNECTION_PROTOCOL_V1
import io.github.kt.pulsebar.ws.connection.CommonConnectionMessage
import io.github.kt.pulsebar.ws.connection.WSPayload
import kotlinx.serialization.Serializable
import kotlin.time.Instant

@Serializable
@CommonConnectionMessage("hello")
internal data class DeviceV2CommonHelloPayload(
    val device: DeviceV2DeviceInfo,
    val capabilities: DeviceV2PresenceCapabilities,
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




internal fun deviceV2CommonHello(config: EndpointConfig) = DeviceV2CommonHelloPayload(
    device = DeviceV2DeviceInfo(
        name = config.deviceId,
        platform = "macos",
        displayName = config.deviceId,
    ),
    capabilities = DeviceV2PresenceCapabilities(
        focusApp = true,
        windowTitle = false,
        pageTitle = false,
        pageUrl = false,
    ),
    supportedProtocols = listOf(DEVICE_CONNECTION_PROTOCOL_V1),
)

internal fun deviceV2Presence(seq: Long, now: String): DeviceV2PresencePayload {
    return DeviceV2PresencePayload(
        eventId = newPulseUuid(),
        seq = seq,
        observedAt = now,
        sentAt = nowInIso8601(),
        state = DeviceV2PresenceState(
            availability = DeviceV2Availability(state = "active", idleSeconds = 0),
            focus = DeviceV2Focus(
                app = getFrontmostApp(),
            ),
        ),
    )
}

internal fun epochMillisToIso8601(epochMillis: Long): String =
    Instant.fromEpochMilliseconds(epochMillis).toString()


internal sealed interface CommonWsEvent {
    data object Connecting : CommonWsEvent
    data class Opened(val url: String) : CommonWsEvent
    data class HelloAccepted(val deviceSessionId: String) : CommonWsEvent
    data class Closed(val reason: String?) : CommonWsEvent
    data class Failed(val error: Throwable) : CommonWsEvent
}
