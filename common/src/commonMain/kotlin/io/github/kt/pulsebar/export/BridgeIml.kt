package io.github.kt.pulsebar.export

import io.github.kt.pulsebar.evt.AppEvent

import io.github.kt.pulsebar.evt.EventDispatcher
import io.github.kt.pulsebar.evt.Stream
import io.github.kt.pulsebar.export.event.NativeFrontmostAppChanged
import io.github.kt.pulsebar.export.event.NativeNetworkChanged
import io.github.kt.pulsebar.export.event.ServerCommandEvent
import io.github.kt.pulsebar.export.ui.AppStats
import io.github.kt.pulsebar.export.ui.InitialMediaState
import io.github.kt.pulsebar.export.ui.UsageStats
import io.github.kt.pulsebar.logger.PulseLogCategory
import io.github.kt.pulsebar.logger.logger
import io.github.kt.pulsebar.model.FocusState
import io.github.kt.pulsebar.model.PulseConfig
import io.github.kt.pulsebar.model.RuntimeState
import io.github.kt.pulsebar.model.connection.ConnectionState
import io.github.kt.pulsebar.model.stream.Media
import io.github.kt.pulsebar.model.stream.PlaybackStatus
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
import io.github.kt.pulsebar.ws.DeviceV2Client
import kotlin.time.Clock
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
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
    private val configStateFlow: MutableStateFlow<PulseConfig> = MutableStateFlow(startup.config)
    private val networkOnline: MutableStateFlow<Boolean> = MutableStateFlow(true)
    private var activeFocusSpan: ActiveFocusSpan? = null

    private val hostCommandChannel = Channel<ServerCommandEvent>(capacity = Channel.BUFFERED)
    override val serverCommands: Flow<ServerCommandEvent> = hostCommandChannel.receiveAsFlow()
    private val serverCommandHandler: (ServerCommandEvent) -> Unit = { command ->
        val result = hostCommandChannel.trySend(command)
        if (result.isFailure) {
            logger.w { "bridge.host.command.dropped command=${command::class.simpleName} reason=${result.exceptionOrNull()?.message ?: "channel_closed"}" }
        }
    }

    private val deviceClient = DeviceV2Client(
        configFlow = configStateFlow,
        mediaStateFlow = stream.mediaState,
        networkOnline = networkOnline,
        hostCommandSink = serverCommandHandler,
    )

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
                    .appUsageItemsBetween(
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

    override val connectionState: Flow<ConnectionState> =
        combine(deviceClient.deviceWsState, configStateFlow) { deviceWs, cfg ->
            ConnectionState(
                endpointConfig = cfg.endpoint,
                connection = deviceWs,
            )
        }.distinctUntilChanged()

    override val config: Flow<PulseConfig> =
        configStore.configFlow.distinctUntilChanged().map { it.data }

    private val eventDispatcher = EventDispatcher(
        scope = scope,
        focusState = focusState,
        stream = stream,
        connect = ::connect,
        disconnect = ::disconnect,
        setEndpointEnabled = ::setEndpointEnabled,
        updateConfig = ::updateConfig,
        publishFocusChanged = ::publishFocusChanged,
        handleMediaStreamStopped = ::handleMediaStreamStopped,
        handleNetworkChanged = ::handleNetworkChanged,
    )

    init {
        logger.i {
            "bridge.initialized endpointUrl=${startup.config.endpoint.url} enabled=${startup.config.endpoint.enabled}"
        }
        if (startup.config.endpoint.enabled) {
            deviceClient.start()
        }
        scope.launch {
            config.collect { nextConfig ->
                val wasEnabled = configStateFlow.value.endpoint.enabled
                configStateFlow.value = nextConfig
                if (!wasEnabled && nextConfig.endpoint.enabled) {
                    deviceClient.start()
                } else if (wasEnabled && !nextConfig.endpoint.enabled) {
                    deviceClient.stop()
                }
            }
        }
    }

    override fun emitNativeEvent(event: AppEvent) {
        eventDispatcher.emitNativeEvent(event)
    }

    private fun handleMediaStreamStopped(reason: StreamStopReason) {
        deviceClient.stopActiveStream(reason)
    }

    private fun handleNetworkChanged(event: NativeNetworkChanged) {
        networkOnline.value = event.online
        logger.i {
            "network.changed online=${event.online} expensive=${event.expensive} constrained=${event.constrained}"
        }
        deviceClient.setNetworkOnline(event.online)
    }

    private fun connect() {
        if (!configStateFlow.value.endpoint.enabled) {
            logger.d { "endpoint.connect.disabled" }
            return
        }
        deviceClient.start()
    }

    private fun disconnect() {
        deviceClient.stop()
    }

    private suspend fun setEndpointEnabled(enabled: Boolean) {
        configStore.update { current ->
            current.copy(
                data = current.data.copy(
                    endpoint = current.data.endpoint.copy(enabled = enabled),
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
        deviceClient.publishFocusChanged(event)
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
    return InitialMediaState(
        streamState = StreamState(
            permission = StreamPermission.ALLOW,
            playbackStatus = initialMedia?.playbackStatus ?: PlaybackStatus.PAUSED,
            captureStatus = StreamCaptureStatus.IDLE,
        ),
        media = initialMedia,
    )
}
