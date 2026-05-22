package io.github.kt.pulsebar.core.devicev2

import io.github.kt.pulsebar.core.platform.newPulseUuid
import io.github.kt.pulsebar.core.platform.resolveAppDisplayName
import kotlinx.serialization.Serializable
import platform.AppKit.NSWorkspace

@Serializable
internal data class DeviceV2PresencePayload(
    val eventId: String,
    val seq: Long,
    val observedAt: String,
    val sentAt: String,
    val state: DeviceV2PresenceState,
)

@Serializable
internal data class DeviceV2PresenceState(val availability: DeviceV2Availability, val focus: DeviceV2Focus)

@Serializable
internal data class DeviceV2Availability(val state: String, val idleSeconds: Int? = null)

@Serializable
internal data class DeviceV2Focus(val app: DeviceV2FocusApp? = null)

@Serializable
internal data class DeviceV2FocusApp(
    val name: String? = null,
    val id: String? = null,
    val category: String? = null,
)

internal fun deviceV2Presence(seq: Long, now: String): DeviceV2PresencePayload {
    val app = NSWorkspace.sharedWorkspace.frontmostApplication
    val bundleId = app?.bundleIdentifier
    val name = bundleId?.let { resolveAppDisplayName(it) } ?: app?.localizedName
    return DeviceV2PresencePayload(
        eventId = newPulseUuid(),
        seq = seq,
        observedAt = now,
        sentAt = now,
        state = DeviceV2PresenceState(
            availability = DeviceV2Availability(state = "active", idleSeconds = 0),
            focus = DeviceV2Focus(
                app = DeviceV2FocusApp(
                    id = bundleId?.takeIf { it.isNotBlank() },
                    name = name?.takeIf { it.isNotBlank() },
                ),
            ),
        ),
    )
}

