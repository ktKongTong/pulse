package io.github.kt.pulsebar.export

import io.github.kt.pulsebar.evt.AppEvent
import io.github.kt.pulsebar.evt.EventDispatcher
import io.github.kt.pulsebar.evt.Stream
import io.github.kt.pulsebar.export.event.NativeFrontmostAppChanged
import io.github.kt.pulsebar.export.event.ServerCommandEvent
import io.github.kt.pulsebar.export.ui.AppStats
import io.github.kt.pulsebar.export.ui.InitialMediaState
import io.github.kt.pulsebar.export.ui.UsageStats
import io.github.kt.pulsebar.logger.PulseLogCategory
import io.github.kt.pulsebar.logger.logger
import io.github.kt.pulsebar.model.FocusState
import io.github.kt.pulsebar.model.PulseConfig
import io.github.kt.pulsebar.model.PulseConfigItem
import io.github.kt.pulsebar.model.RuntimeState
import io.github.kt.pulsebar.model.connection.ConnectionState
import io.github.kt.pulsebar.model.stream.Media
import io.github.kt.pulsebar.model.stream.PlaybackStatus
import io.github.kt.pulsebar.model.stream.StreamFormat
import io.github.kt.pulsebar.model.stream.StreamCaptureStatus
import io.github.kt.pulsebar.model.stream.StreamPermission
import io.github.kt.pulsebar.model.stream.StreamStopReason
import io.github.kt.pulsebar.model.stream.StreamState
import io.github.kt.pulsebar.store.config.PulseBarConfigStore
import io.github.kt.pulsebar.store.config.pulseBarConfigFileSystem
import io.github.kt.pulsebar.store.config.pulseBarConfigPath
import io.github.kt.pulsebar.store.database.PulseBarRoomProvider
import io.github.kt.pulsebar.store.database.model.AppUsageOrder
import io.github.kt.pulsebar.store.repository.AppFocusSpanRecord
import io.github.kt.pulsebar.store.repository.UsageRepository
import io.github.kt.pulsebar.utils.deviceV2ChunkBytesFor
import io.github.kt.pulsebar.ws.DeviceV2Client
import kotlin.time.Clock
import kotlin.time.Duration.Companion.milliseconds
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.isActive
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.TimeZone
import kotlinx.datetime.atStartOfDayIn
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime

class PulseBarBridge private constructor(
    startup: BridgeStartupState,
) : IPulseBarBridge {
    constructor(initialMedia: Media?) : this(readStartupState(initialMedia))

    private val coroutineExceptionHandler = CoroutineExceptionHandler { _, error ->
        logger(PulseLogCategory.AppLifecycle).e(error) { "bridge.coroutine.failed" }
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default + coroutineExceptionHandler)
    private val logger = logger(PulseLogCategory.AppLifecycle)

    private val configStore = startup.configStore
    private val usageRepository = UsageRepository(PulseBarRoomProvider.database.usageDao())

    private val stream: Stream = Stream(startup.initialMediaState)
    private val focusState: MutableStateFlow<FocusState?> = MutableStateFlow(null)
    private val endpointRuntimes: MutableStateFlow<Map<String, EndpointRuntime>> = MutableStateFlow(emptyMap())
    private var activeFocusSpan: ActiveFocusSpan? = null

    private val hostCommandFlow = MutableSharedFlow<ServerCommandEvent>()
    override val serverCommands: Flow<ServerCommandEvent> = hostCommandFlow.asSharedFlow()
    private val serverCommandHandler: (ServerCommandEvent) -> Unit = { command -> hostCommandFlow.tryEmit(command) }

    override val mediaFlow = stream.mediaFlowState

    override val runtimeState: Flow<RuntimeState> =
        combine(focusState, mediaFlow) { focus, mediaState ->
            RuntimeState(
                focusState = focus,
                mediaState = mediaState,
            )
        }

    @OptIn(ExperimentalCoroutinesApi::class)
    override val usageStats: Flow<UsageStats> =
        todayUsageRangeFlow()
            .flatMapLatest { range ->
                usageRepository
                    .appUsageItemsBe·tween(
                        rangeStartMs = range.startMs,
                        rangeEndMs = range.endMs,
                        order = AppUsageOrder.FOCUS_TIME,
                    )
                    .map { rows ->
                        val totalSeconds = rows.sumOf { it.totalSeconds }
                        UsageStats(
                            since = range.startMs,
                            appStats = AppStats(
                                totalSeconds = totalSeconds,
                                usages = flowOf(rows),
                            ),
                            switchCount = 0,
                            mediaSeconds = 0,
                        )
                    }
            }

    override val connectionStates: Flow<Map<String, Flow<ConnectionState>>> =
        endpointRuntimes
            .map { runtimes -> runtimes.mapValues { it.value.connectionState } }
            .distinctUntilChanged()

    override val config: Flow<PulseConfig> =
        configStore.configFlow.distinctUntilChanged().map { it.data }

    private val eventDispatcher = EventDispatcher(
        scope = scope,
        focusState = focusState,
        stream = stream,
        connectEndpoint = ::connectEndpoint,
        disconnectEndpoint = ::disconnectEndpoint,
        setEndpointEnabled = ::setEndpointEnabled,
        removeEndpoint = ::removeEndpoint,
        updateConfig = ::updateConfig,
        publishFocusChanged = ::publishFocusChanged,
        handleMediaStreamStopped = ::handleMediaStreamStopped,
    )

    init {
        logger.i {
            "bridge.initialized endpoints=${startup.config.endpoints.size} enabled=${startup.config.endpoints.count { it.enabled }}"
        }
        scope.launch {
            config.collect { config ->
                logger.d {
                    "config.changed endpoints=${config.endpoints.size}" +
                        " enabled=${config.endpoints.count { it.enabled }}"
                }
                reconcileEndpointRuntimes(config)
            }
        }
    }

    override fun emitNativeEvent(event: AppEvent) {
        eventDispatcher.emitNativeEvent(event)
    }

    private fun handleMediaStreamStopped(reason: StreamStopReason) {
        val runtimes = endpointRuntimes.value.values
        if (runtimes.isEmpty()) {
            logger.w { "stream.stop.missing reason=$reason" }
            return
        }
        runtimes.forEach { it.client.stopActiveStream(reason) }
    }

    override fun connectionState(endpointId: String): Flow<ConnectionState> =
        endpointRuntimes.value[endpointId]?.connectionState
            ?: error("connection state for $endpointId not found")

    private fun reconcileEndpointRuntimes(config: PulseConfig) {
        val current = endpointRuntimes.value
        val next = linkedMapOf<String, EndpointRuntime>()
        val endpointConfigs = config.endpoints.associateBy { it.id }

        endpointConfigs.values.forEach { endpoint ->
            val endpointId = endpoint.id
            val item = PulseConfigItem(
                endpoint = endpoint,
                stream = config.stream,
                commonConfig = config.commonConfig,
            )
            val existing = current[endpointId]
            if (existing != null) {
                existing.config.value = item
                if (!endpoint.enabled) existing.client.stop()
                next[endpointId] = existing
            } else {
                val configFlow = MutableStateFlow(item)
                val client = DeviceV2Client(
                    endpointId = endpointId,
                    configFlow = configFlow,
                    mediaStateFlow = stream.mediaState,
                    hostCommandSink = serverCommandHandler,
                )
                val connectionState = combine(client.deviceWsState, configFlow) { deviceWs, endpointConfig ->
                    ConnectionState(
                        endpointId = endpointConfig.endpoint.id,
                        endpointConfig = endpointConfig.endpoint,
                        connection = deviceWs,
                    )
                }
                next[endpointId] = EndpointRuntime(
                    endpointId = endpointId,
                    config = configFlow,
                    client = client,
                    connectionState = connectionState,
                )
            }
        }

        current
            .filterKeys { it !in endpointConfigs }
            .values
            .forEach { runtime ->
                logger.d { "endpoint.runtime.dispose endpoint=${runtime.endpointId}" }
                runtime.client.dispose()
            }

        endpointRuntimes.value = next
    }

    private fun connectEndpoint(endpointId: String) {
        val runtime = endpointRuntimes.value[endpointId]
        if (runtime == null) {
            logger.w { "endpoint.connect.missing endpoint=$endpointId" }
            return
        }
        if (!runtime.config.value.endpoint.enabled) {
            logger.d { "endpoint.connect.disabled endpoint=$endpointId" }
            return
        }
        runtime.client.start()
    }

    private fun disconnectEndpoint(endpointId: String) {
        endpointRuntimes.value[endpointId]?.client?.stop()
            ?: logger.w { "endpoint.disconnect.missing endpoint=$endpointId" }
    }

    private suspend fun setEndpointEnabled(endpointId: String, enabled: Boolean) {
        configStore.update { current ->
            current.copy(
                data = current.data.copy(
                    endpoints = current.data.endpoints.map { endpoint ->
                        if (endpoint.id == endpointId) endpoint.copy(enabled = enabled) else endpoint
                    },
                ),
            )
        }
    }

    private suspend fun removeEndpoint(endpointId: String) {
        configStore.update { current ->
            current.copy(
                data = current.data.copy(
                    endpoints = current.data.endpoints.filterNot { it.id == endpointId },
                ),
            )
        }
    }

    private suspend fun updateConfig(config: PulseConfig) {
        configStore.update { current ->
            current.copy(data = config)
        }
    }

    private suspend fun publishFocusChanged(event: NativeFrontmostAppChanged) {
        recordFocusTransition(event)
        endpointRuntimes.value.values.forEach { runtime ->
            runtime.client.publishFocusChanged(event)
        }
    }

    private fun recordFocusTransition(event: NativeFrontmostAppChanged) {
        val previous = activeFocusSpan
        if (previous == null) {
            activeFocusSpan = ActiveFocusSpan(
                bundleId = event.bundleId,
                name = event.name,
                startedAtMs = event.observedAtMillis,
            )
            return
        }

        if (previous.bundleId == event.bundleId) {
            activeFocusSpan = previous.copy(name = event.name)
            return
        }

        val endedAtMs = event.observedAtMillis
        if (endedAtMs > previous.startedAtMs) {
            scope.launch {
                usageRepository.recordFocusSpan(
                    AppFocusSpanRecord(
                        platform = "macos",
                        platformAppId = previous.bundleId,
                        displayName = previous.name,
                        startedAtMs = previous.startedAtMs,
                        endedAtMs = endedAtMs,
                    )
                )
            }
        }
        activeFocusSpan = ActiveFocusSpan(
            bundleId = event.bundleId,
            name = event.name,
            startedAtMs = event.observedAtMillis,
        )
    }
}

private data class EndpointRuntime(
    val endpointId: String,
    val config: MutableStateFlow<PulseConfigItem>,
    val client: DeviceV2Client,
    val connectionState: Flow<ConnectionState>,
)

private data class ActiveFocusSpan(
    val bundleId: String,
    val name: String,
    val startedAtMs: Long,
)

private data class UsageRange(
    val startMs: Long,
    val endMs: Long,
)

private data class BridgeStartupState(
    val configStore: PulseBarConfigStore,
    val config: PulseConfig,
    val initialMediaState: InitialMediaState,
)

private fun readStartupState(initialMedia: Media?): BridgeStartupState {
    val log = logger(PulseLogCategory.AppLifecycle)
    log.i { "bridge.initializing" }
    val configStore = PulseBarConfigStore(
        fileSystem = pulseBarConfigFileSystem(),
        path = pulseBarConfigPath(),
    )
    val config = runBlocking {
        log.i { "loading and watch config" }
        configStore.configFlow
            .distinctUntilChanged()
            .map { it.data }
            .first()
    }
    return BridgeStartupState(
        configStore = configStore,
        config = config,
        initialMediaState = config.toInitialMediaState(initialMedia),
    )
}

private fun todayUsageRangeFlow(): Flow<UsageRange> = flow {
    while (currentCoroutineContext().isActive) {
        val zone = TimeZone.currentSystemDefault()
        val now = Clock.System.now()
        val today = now.toLocalDateTime(zone).date
        val tomorrow = today.plus(1, DateTimeUnit.DAY)
        val startMs = today.atStartOfDayIn(zone).toEpochMilliseconds()
        val endMs = tomorrow.atStartOfDayIn(zone).toEpochMilliseconds()

        emit(UsageRange(startMs = startMs, endMs = endMs))

        val delayMs = (endMs - Clock.System.now().toEpochMilliseconds())
            .coerceAtLeast(1_000L)
        delay(delayMs)
    }
}

private fun PulseConfig.toInitialMediaState(initialMedia: Media?): InitialMediaState {
    val streamConfig = stream
    return InitialMediaState(
        streamState = StreamState(
            permission = StreamPermission.ALLOW,
            playbackStatus = initialMedia?.playbackStatus ?: PlaybackStatus.PAUSED,
            captureStatus = StreamCaptureStatus.IDLE,
            streamFormat = StreamFormat(
                codec = "pcm16-wav",
                sampleRate = streamConfig.sampleRate,
                channels = streamConfig.channels,
                bitDepth = 16,
            ),
        ),
        media = initialMedia,
        chunkDuration = streamConfig.chunkDurationMs.milliseconds,
        chunkBytes = deviceV2ChunkBytesFor(
            chunkDurationMs = streamConfig.chunkDurationMs,
            sampleRate = streamConfig.sampleRate,
            channels = streamConfig.channels,
        ),
    )
}
