package io.github.kt.pulsebar.evt

import io.github.kt.pulsebar.export.NativeDeviceEvent
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

internal class NativeDeviceEventBus {
    private val _events = MutableSharedFlow<NativeDeviceEvent>(
        extraBufferCapacity = 64,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )

    val events: SharedFlow<NativeDeviceEvent> = _events.asSharedFlow()

    fun emit(event: NativeDeviceEvent) {
        _events.tryEmit(event)
    }
}
