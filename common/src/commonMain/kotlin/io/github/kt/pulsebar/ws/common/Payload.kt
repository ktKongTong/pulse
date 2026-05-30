package io.github.kt.pulsebar.ws.common

import io.github.kt.pulsebar.model.Endpoint
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

internal fun deviceV2CommonHello(config: Endpoint) = DeviceV2CommonHelloPayload(
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
    supportedProtocols = listOf(DEVICE_CONNECTION_PROTOCOL_V1),
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


internal fun epochMillisToIso8601(epochMillis: Long): String =
    Instant.fromEpochMilliseconds(epochMillis).toString()


internal sealed interface CommonWsEvent {
    data object Connecting : CommonWsEvent
    data class Opened(val url: String) : CommonWsEvent
    data class HelloAccepted(val deviceSessionId: String) : CommonWsEvent
    data class Closed(val reason: String?) : CommonWsEvent
    data class Failed(val error: Throwable) : CommonWsEvent
}
