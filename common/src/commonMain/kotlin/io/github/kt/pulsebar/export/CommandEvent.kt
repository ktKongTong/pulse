package io.github.kt.pulsebar.export
import io.github.kt.pulsebar.core.stream.EndpointConfig
import io.github.kt.pulsebar.utils.nowInMillis

interface EndpointCommandEvent : NativeDeviceEvent {
    val sentAt: Long
}

data class DefaultEndpointCommandEvent (
    override val sentAt: Long = nowInMillis(),
): EndpointCommandEvent

private val base = DefaultEndpointCommandEvent()

data class ConnectEndpointCommand(
    val endpointId:String,
): EndpointCommandEvent by base


data class EnableEndpointCommand(
    val endpointId:String,
): EndpointCommandEvent by base

data class DisableEndpointCommand(
    val endpointId:String,
): EndpointCommandEvent by base

data class ReconnectEndpointCommand(
    val endpointId:String,
): EndpointCommandEvent by base

data class RemoveEndpointCommand(
    val endpointId:String,
): EndpointCommandEvent by base

data class AddEndpointCommand(
    val endpointId:String,
    val endpoint: EndpointConfig
): EndpointCommandEvent by base

data class UpdateEndpointCommand(
    val endpointId:String,
    val endpoint: EndpointConfig
): EndpointCommandEvent by base