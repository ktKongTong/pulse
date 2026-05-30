package io.github.kt.pulsebar.export

import io.github.kt.pulsebar.store.config.PulseBarConfigStore
import io.github.kt.pulsebar.store.config.pulseBarConfigFileSystem
import io.github.kt.pulsebar.store.config.pulseBarConfigPath
import io.github.kt.pulsebar.logger.PulseLogCategory
import io.github.kt.pulsebar.logger.logger
import io.github.kt.pulsebar.evt.AppEvent
import io.github.kt.pulsebar.model.PulseConfigItem
import io.github.kt.pulsebar.evt.EventDispatcher
import io.github.kt.pulsebar.evt.Stream
import io.github.kt.pulsebar.export.event.ServerCommandEvent
import io.github.kt.pulsebar.export.ui.InitialMediaState
import io.github.kt.pulsebar.export.ui.UsageStats
import io.github.kt.pulsebar.model.PulseConfig
import io.github.kt.pulsebar.model.RuntimeState
import io.github.kt.pulsebar.model.connection.ConnectionState
import io.github.kt.pulsebar.ws.DeviceV2Client

import kotlin.String
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged

import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.runBlocking

@OptIn(ExperimentalStdlibApi::class)
class PulseBarBridge (
    initialMediaState: InitialMediaState
): IPulseBarBridge {
    private val coroutineExceptionHandler = CoroutineExceptionHandler { _, error ->
        logger(PulseLogCategory.AppLifecycle).e(error) { "bridge.coroutine.failed" }
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default + coroutineExceptionHandler)

    private val configStore = PulseBarConfigStore(
        fileSystem = pulseBarConfigFileSystem(),
        path = pulseBarConfigPath(),
    )

    // 构造出来的 device应该按ID 进行缓存
    // 如果被移除，应当及时清理 client 缓存
    private val deviceClientMap: MutableMap<String, DeviceV2Client> = mutableMapOf()

    private val streamClients: MutableStateFlow<Map<String, DeviceV2Client>> = MutableStateFlow(emptyMap())
    private val connectionStateFlowMap: MutableMap<String, Flow<ConnectionState>> = mutableMapOf()


    // stream, media state
    private val stream: Stream = Stream(initialMediaState)

    // handle kotlin to swift event
    private val hostCommandFlow = MutableSharedFlow<ServerCommandEvent>()
    override val serverCommands: Flow<ServerCommandEvent> = hostCommandFlow.asSharedFlow()
    val serverCommandHandler: (ServerCommandEvent)-> Unit = { command -> hostCommandFlow.tryEmit(command) }


    // uiState, media/focus
    private val _runtimeState: MutableStateFlow<RuntimeState> = MutableStateFlow(RuntimeState())
    override val runtimeState: Flow<RuntimeState> = _runtimeState.asStateFlow()
    // usage stats
    override val usageStats: Flow<UsageStats> = flow {
//        store
    }

    // handle swift to kotlin event
    private val eventDispatcher = EventDispatcher(
        scope = scope,
        state = _runtimeState,
        configStore = configStore,
        streamClients = streamClients,
        connectEndpoint = ::connectEndpoint,
        stream = stream,
    )
    override fun emitNativeEvent(event: AppEvent) {
        eventDispatcher.emitNativeEvent(event)
    }


    // connections
    @OptIn(ExperimentalStdlibApi::class)
    override val connectionStates: Flow<List<Flow<ConnectionState>>> =
        streamClients
            .asStateFlow()
            .map {
                it.values.map { client ->
                    deviceClientMap[client.endpointId] = client
                    connectionStateFlowMap.getOrPutIfMissing(client.endpointId) {
                        combine(client.deviceWsState, client.configFlow) { deviceWs, config ->
                            ConnectionState(
                                endpointId = config.endpoint.id,
                                endpointConfig = config.endpoint,
                                connection = deviceWs
                            )
                        }
                    }
                }
            }.distinctUntilChanged()

    override fun connectionState(endpointId: String): Flow<ConnectionState> = connectionStateFlowMap.getOrElse(endpointId) {
        throw Error("connection state for $endpointId not found")
    }

    // 3. config ui flow
    override val config: Flow<PulseConfig> = configStore.configFlow.distinctUntilChanged().map { it.data }

    // 4. endpoint ui state flow
    private val endpointConfigs: MutableStateFlow<Map<String, StateFlow<PulseConfigItem>>> = MutableStateFlow(
        mapOf()
    )

    // 缓存，当 endpoint 被移除时，其 flow 仍然存在。
    // 另外一种问题，endpoint config 变化时，要考虑是否自动重连
    private val endpointConfigStateflowMap: MutableMap<String, MutableStateFlow<PulseConfigItem>> = mutableMapOf()


    init {
//        logger(PulseLogCategory.AppLifecycle).i {
//            "bridge.initialized endpoints=${initial.endpoints.size} enabled=${initial.endpoints.count { it.enabled }}"
//        }
        val initialConfig = runBlocking {
            // if possible, need migrate config
            config.first().endpoints
        }

        scope.launch {
            config.collect { config ->
                logger(PulseLogCategory.ConfigStore).d {
                    "config.observed endpoints=${config.endpoints.size}" +
                            " enabled=${config.endpoints.count { it.enabled }}"
                }
                // 初始化时，更新 endpointConfig
                val configMap = config.endpoints.associate {
                    val cfg = PulseConfigItem(it)
                    // 难点在于当 endpoint 发生变化时，
                    // 比如 disabled(写入配置），新增/移除 endpoint，默认 disabled
                    val flow = endpointConfigStateflowMap.getOrElse(it.id){ MutableStateFlow(cfg) }
                    endpointConfigStateflowMap[it.id] = flow
                    flow.update { cfg }
                    it.id to flow
                }
                // 对于移除 endpoint，会体现在 config 上，
                // endpointConfig 可能直接消失，但对应的 streamClient 还并未处理
                endpointConfigs.update { configMap }
            }
        }

        // 启动时，从 config 获取 endpoints
        scope.launch {
            // TODO 当 endpoint 销毁时，应该销毁 device client。
            endpointConfigs.collect {
                val endpoints  = it.values
                endpoints.forEach { endpointConfig ->

                    val endpointId = endpointConfig.value.endpoint.id
                    endpointConfigs.value[endpointId]?.let { configFlow ->
                        deviceClientMap.getOrPutIfMissing(endpointId) {
                            DeviceV2Client(
                                endpointId = endpointId,
                                configFlow = configFlow,
                                mediaStateFlow = stream.mediaStateFlow,
                                hostCommandSink = serverCommandHandler
                            )
                        }
                    }

                    // 对于 disabled/enabled/updated 行为，由 deviceClient 自行管理声明周期。
                    val endpointIds = deviceClientMap.keys

                    streamClients.value.keys
                    endpointConfigs.value.keys
                    // recycle destroy endpoint
                }
            }
        }

    }


    private fun connectEndpoint(endpointId: String) {
        logger(PulseLogCategory.StreamSession).d { "connecting endpoint=$endpointId" }
        val sc = deviceClientMap.get(endpointId)
        sc?.start()
    }
}