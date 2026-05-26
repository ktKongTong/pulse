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

interface NativeHostCommand

data class NativeStreamRequestedCommand(
    val endpointId: String,
    val commandId: String,
    val streamId: String,
    val generation: Int,
    val sentAt: Long = nowInMillis(),
) : NativeHostCommand

data class NativeStreamStoppedCommand(
    val endpointId: String,
    val commandId: String,
    val streamId: String?,
    val generation: Int,
    val reason: String,
    val sentAt: Long = nowInMillis(),
) : NativeHostCommand
