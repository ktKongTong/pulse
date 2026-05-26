package io.github.kt.pulsebar.export
import io.github.kt.pulsebar.utils.nowInMillis

data class ConnectEndpointCommand(
    val endpointId: String,
    val sentAt: Long = nowInMillis(),
) : NativeDeviceEvent

data class EnableEndpointCommand(
    val endpointId: String,
    val sentAt: Long = nowInMillis(),
) : NativeDeviceEvent

data class DisableEndpointCommand(
    val endpointId: String,
    val sentAt: Long = nowInMillis(),
) : NativeDeviceEvent

data class DisconnectEndpointCommand(
    val endpointId: String,
    val sentAt: Long = nowInMillis(),
) : NativeDeviceEvent

data class ReconnectEndpointCommand(
    val endpointId: String,
    val sentAt: Long = nowInMillis(),
) : NativeDeviceEvent

data class RemoveEndpointCommand(
    val endpointId: String,
    val sentAt: Long = nowInMillis(),
) : NativeDeviceEvent
