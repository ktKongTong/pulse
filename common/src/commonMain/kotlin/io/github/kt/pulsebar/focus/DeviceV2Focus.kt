package io.github.kt.pulsebar.focus
import io.github.kt.pulsebar.platform.App
import kotlinx.serialization.Serializable


@Serializable
internal data class DeviceV2PresenceState(val availability: DeviceV2Availability, val focus: DeviceV2Focus)

@Serializable
internal data class DeviceV2Availability(val state: String, val idleSeconds: Int? = null)

@Serializable
internal data class DeviceV2Focus(val app: App? = null)
