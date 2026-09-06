package io.github.kt.pulsebar.export

import io.github.kt.pulsebar.evt.AppEvent
import io.github.kt.pulsebar.export.event.ServerCommandEvent
import io.github.kt.pulsebar.export.ui.UsageStats
import io.github.kt.pulsebar.model.PulseConfig
import io.github.kt.pulsebar.model.RuntimeState
import io.github.kt.pulsebar.model.connection.ConnectionState
import io.github.kt.pulsebar.model.stream.MediaFlowState
import kotlinx.coroutines.flow.Flow


interface IPulseBarBridge {
    val config: Flow<PulseConfig>

    // 当前 focus，当前 stream
    val runtimeState: Flow<RuntimeState>
    val mediaFlow: Flow<MediaFlowState>

    // 一些 db 驱动的统计数据
    val usageStats: Flow<UsageStats>

    // 单 endpoint 连接状态流
    val connectionState: Flow<ConnectionState>

    // from kotlin to host
    val serverCommands: Flow<ServerCommandEvent>
    // from host to kotlin
    fun emitNativeEvent(event: AppEvent)
//    fun emitKotlinEvent(event: ServerCommandEvent)
}
