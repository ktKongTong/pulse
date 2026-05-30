package io.github.kt.pulsebar.export.event
import io.github.kt.pulsebar.model.stream.StreamStopReason
import io.github.kt.pulsebar.utils.nowInMillis


data class NativeRequestedCommandEvent(
    val endpointId: String,
    val commandId: String,
    val streamId: String,
    val generation: Int,
    val sentAt: Long = nowInMillis(),
) : ServerCommandEvent

data class NativeStoppedCommandEvent(
    val endpointId: String,
    val commandId: String,
    val streamId: String?,
    val generation: Int,
    val reason: StreamStopReason,
    val sentAt: Long = nowInMillis(),
) : ServerCommandEvent
