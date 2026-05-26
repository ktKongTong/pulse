package io.github.kt.pulsebar.evt

import io.github.kt.pulsebar.core.log.PulseBarLog
import io.github.kt.pulsebar.core.log.PulseLogCategory
import io.github.kt.pulsebar.core.log.logger
import io.github.kt.pulsebar.export.NativeDeviceEvent
import io.github.kt.pulsebar.ws.DeviceV2Client
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch


internal object EventDispatcher {
    private val eventBus: NativeDeviceEventBus = NativeDeviceEventBus()
    internal val streamClients: MutableStateFlow<Map<String, DeviceV2Client>> = MutableStateFlow(emptyMap())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    init {
        scope.launch {
            eventBus.events
                .collect { event -> routeNativeEvent(event) }
        }
    }
    private val log: PulseBarLog = logger(PulseLogCategory.NativeEvent)
    fun emitNativeEvent(event: NativeDeviceEvent) {
        eventBus.emit(event)
    }

    private fun routeNativeEvent(event: NativeDeviceEvent) {
        log.i { event.toString() }
    }
}
