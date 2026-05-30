package io.github.kt.pulsebar.export

import io.github.kt.pulsebar.evt.AppEvent
import io.github.kt.pulsebar.export.event.ServerCommandEvent
import io.github.kt.pulsebar.export.ui.UsageStats
import io.github.kt.pulsebar.model.PulseConfig
import io.github.kt.pulsebar.model.RuntimeState
import io.github.kt.pulsebar.model.connection.ConnectionState
import kotlinx.coroutines.flow.Flow


interface IPulseBarBridge {
    val config: Flow<PulseConfig>

    // 比如当前 focus，当前 stream，connections
    val runtimeState: Flow<RuntimeState>

    // 一些 db 驱动的统计数据
    val usageStats: Flow<UsageStats>

    val connectionStates: Flow<List<Flow<ConnectionState>>>
    // 获取某个 connection 的 stateFlow
    fun connectionState(endpointId: String): Flow<ConnectionState>

    // from kotlin to swift
    val serverCommands: Flow<ServerCommandEvent>
    // from swift to kotlin
    fun emitNativeEvent(event: AppEvent)
}
