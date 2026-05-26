package io.github.kt.pulsebar.export

import io.github.kt.pulsebar.core.config.PulseBarConfigStore
import io.github.kt.pulsebar.core.config.pulseBarConfigFileSystem
import io.github.kt.pulsebar.core.config.pulseBarConfigPath
import io.github.kt.pulsebar.core.config.toExport
import io.github.kt.pulsebar.core.config.toProto
import io.github.kt.pulsebar.core.log.PulseLogCategory
import io.github.kt.pulsebar.core.log.logger
import io.github.kt.pulsebar.core.stream.CommonConfig
import io.github.kt.pulsebar.core.stream.EndpointConfig
import io.github.kt.pulsebar.core.stream.PulseConfig
import io.github.kt.pulsebar.core.stream.StreamConfig
import io.github.kt.pulsebar.evt.EventDispatcher
import io.github.kt.pulsebar.evt.RuntimeState
import io.github.kt.pulsebar.evt.Stream
import io.github.kt.pulsebar.utils.nowInIso8601
import io.github.kt.pulsebar.utils.nowInMillis
import io.github.kt.pulsebar.ws.DeviceV2Client
import io.github.kt.pulsebar.ws.connection.DeviceWsPhase
import io.github.kt.pulsebar.ws.connection.DeviceWsState
import io.github.kt.pulsebar.ws.connection.WsConnectionState
import kotlin.String
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

private data class SessionState(
    val signature: String,
    val statKey: String,
    val label: String,
    val startedAtMillis: Long
)


actual class PulseBarBridge actual constructor() {
    private val coroutineExceptionHandler = CoroutineExceptionHandler { _, error ->
        logger(PulseLogCategory.AppLifecycle).e(error) { "bridge.coroutine.failed" }
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default + coroutineExceptionHandler)
    private val store = PulseBarPreferencesStore()
    private val configStore = PulseBarConfigStore(
        fileSystem = pulseBarConfigFileSystem(),
        path = pulseBarConfigPath(),
    )
    private var currentSession: SessionState? = null
    private var lastObservedAtMillis: Long? = null
    private var pendingElapsedMillis: Long = 0L

    private val runtimeState: MutableStateFlow<RuntimeState> = MutableStateFlow(RuntimeState())

    private val menuStateFlow = runtimeState.map {
        PulseBarMenuState(
            snapshot = it.focusSate?.let {
                PulseBarSnapshot(
                    it.name,
                    it.id,
                    null,
                    nowInIso8601(),
                    null
                )
            },
            null,
            null,
            null,
        )
    }

    actual val menuState: Flow<PulseBarMenuState> = menuStateFlow.distinctUntilChanged()

    private val syncStateFlow = MutableStateFlow<PulseBarSyncState?>(null)

    private val eventDispatcher = EventDispatcher(
        scope = scope,
        state = runtimeState,
        configStore = configStore,
        connectEndpoint = ::connectEndpointInternal,
    )

//    configs
    actual val config: Flow<PulseBarConfig> = configStore.configs.distinctUntilChanged().map { it.toExport() }

    private val endpointConfigs: MutableStateFlow<Map<String, StateFlow<PulseConfig>>> = MutableStateFlow(
        mapOf()
    )
    // 缓存，当 endpoint 被移除时，其 flow 仍然存在。
    // 另外一种问题，endpoint config 变化时，要考虑是否自动重连
    private val endpointConfigStateflowMap: MutableMap<String, MutableStateFlow<PulseConfig>> = mutableMapOf()

    init {
        val initial = readConfig()

        logger(PulseLogCategory.AppLifecycle).i {
            "bridge.initialized endpoints=${initial.endpoints.size} enabled=${initial.endpoints.count { it.enabled }}"
        }

        scope.launch {
            configStore.configs.collect { proto ->
                val export = proto.toExport()
                logger(PulseLogCategory.ConfigStore).d {
                    "config.observed endpoints=${export.endpoints.size}" +
                        " enabled=${export.endpoints.count { it.enabled }}" +
                        " eventDriven=true"
                }
            }
        }

        scope.launch {
            config.collect { config ->
                val configMap = config.endpoints.associate {
                    val cfg = PulseConfig(
                        endpoint = EndpointConfig(
                            roomId = it.workspaceId,
                            deviceId = "owner",
                            baseUrl = it.endpointUrl,
                            workspaceId = it.workspaceId,
                            apiKey = it.apiKey,
                        ),
                        stream = StreamConfig(),
                        commonConfig = CommonConfig()
                    )
                    // 难点在于当 endpoint 发生变化时，
                    // 比如 disabled(写入配置），新增/移除 endpoint，默认 disabled
                    val flow = endpointConfigStateflowMap.getOrElse(it.id){ MutableStateFlow(cfg) }
                    endpointConfigStateflowMap[it.id] = flow
                    flow.update { cfg }
                    it.id to flow
                }
                // 对于移除 endpoint，会体现在 config 上，
                // endpointConfig 可能直接消失，对应的 streamClient 还并未处理
                endpointConfigs.update { configMap }
            }
        }
    }


    actual fun connect(endpointId: String) {
        connectEndpointInternal(endpointId)
    }

    private fun connectEndpointInternal(endpointId: String) {
        logger(PulseLogCategory.StreamSession).d { "connecting endpoint=$endpointId" }
        endpointConfigs.value[endpointId]?.let { config ->
            val scMap = eventDispatcher.streamClients.value
            if(scMap[endpointId] == null) {
                logger(PulseLogCategory.StreamSession).d { "null device client" }
                val sc = DeviceV2Client(config, Stream.streamStateFlow)
                eventDispatcher.streamClients.update {
                    logger(PulseLogCategory.StreamSession).d { "add new client" }
                    it + (endpointId to sc)
                }
            }
            val s = eventDispatcher.streamClients.value[endpointId]
            logger(PulseLogCategory.StreamSession).d { "start ${s.toString()}" }
            s?.start()
        }
    }

    actual fun emitNativeEvent(event: NativeDeviceEvent) {
        eventDispatcher.emitNativeEvent(event)
    }



//    dead code

    actual val syncState: Flow<PulseBarSyncState> = syncStateFlow.asStateFlow().filterNotNull()

    @OptIn(ExperimentalCoroutinesApi::class)
    actual val connectionStates: Flow<List<PulseBarConnectionState>> =
        combine(config, eventDispatcher.streamClients) { config, clients ->
            config.endpoints.map { endpoint ->
                val client = clients[endpoint.id]
                if (client == null) {
                    flowOf(endpoint.toConnectionState(null))
                } else {
                    client.deviceWsState.map { deviceState ->
                        endpoint.toConnectionState(deviceState)
                    }
                }
            }
        }.flatMapLatest { endpointStateFlows ->
            if (endpointStateFlows.isEmpty()) {
                flowOf(emptyList())
            } else {
                combine(endpointStateFlows) { it.toList() }
            }
        }.distinctUntilChanged()

    actual fun connectionState(endpointId: String): Flow<PulseBarConnectionState> =
        connectionStates.map { states ->
            states.firstOrNull { it.endpointId == endpointId } ?: emptyConnectionState(endpointId)
        }.distinctUntilChanged()

    actual val todayStats: Flow<PulseBarTodayStats> = flow {
        val todayIso = todayKey()
        store.rowsForDayFlow(todayIso, UsageSlice.APP, limit = 100)
            .distinctUntilChanged()
            .collect { rows ->
                emit(
                    PulseBarTodayStats(
                        dayIso = todayIso,
                        totalSeconds = rows.sumOf { it.totalSeconds },
                        firstUsage = rows.getOrNull(0),
                        secondUsage = rows.getOrNull(1),
                        thirdUsage = rows.getOrNull(2),
                        topRows = rows,
                    ),
                )
            }
    }

     fun readStats(dayIso: String, limit: Int): PulseBarStatsPage {
        val rows = store.topRowsForDay(dayIso, limit)
        return PulseBarStatsPage(
            dayIso = dayIso,
            totalSeconds = rows.sumOf { it.totalSeconds },
            items = rows
        )
    }

    fun readLocalStats(dayIso: String, limit: Int): PulseBarLocalStats =
        PulseBarLocalStats(
            dayIso = dayIso,
            appFocusSeconds = store.totalSecondsForDay(dayIso, UsageSlice.APP),
            pageFocusSeconds = store.totalSecondsForDay(dayIso, UsageSlice.PAGE),
            mediaPlaybackSeconds = store.totalSecondsForDay(dayIso, UsageSlice.MEDIA),
            idleSeconds = 0,
            focusSwitchCount = store.readCounter(dayIso, "focus_switch_count"),
            pageSwitchCount = store.readCounter(dayIso, "page_switch_count"),
            mediaSwitchCount = store.readCounter(dayIso, "media_switch_count"),
            sessionCount = store.readCounter(dayIso, "session_count"),
            longestFocusStreakSeconds = store.readCounter(dayIso, "longest_focus_streak_seconds"),
            topApps = store.rowsForDay(dayIso, UsageSlice.APP, limit),
            topPages = store.rowsForDay(dayIso, UsageSlice.PAGE, limit),
            topMedia = store.rowsForDay(dayIso, UsageSlice.MEDIA, limit)
        )

    actual fun readConfig(): PulseBarConfig = configStore.snapshot().toExport()

    actual fun updateConfig(config: PulseBarConfig) {
        configStore.replace(config.toProto())
    }

    actual fun readSyncState(): PulseBarSyncState = TODO()


//    actual fun mediaCommand(command: PulseBarPlaybackCommand): Boolean {
//        return Probe.mediaCommand(command)
//    }
//
//    actual fun seekMedia(progressSeconds: Double): Boolean {
//        return Probe.seekMedia(progressSeconds)
//    }

    private fun updateUsage(snapshot: PulseBarSnapshot) {
        val nowMillis = nowInMillis()
        val day = todayKey()
        val label = buildString {
            append(snapshot.appName)
            snapshot.pageTitle?.takeIf { it.isNotBlank() }?.let {
                append(" / ")
                append(it)
            }
        }
        val statKey = buildString {
            append(snapshot.bundleId)
            snapshot.pageTitle?.takeIf { it.isNotBlank() }?.let {
                append("::")
                append(it)
            }
            snapshot.media?.trackId?.takeIf { it.isNotBlank() }?.let {
                append("::media:")
                append(it)
            }
        }
        val signature = buildString {
            append(snapshot.bundleId)
            append("::")
            append(snapshot.pageTitle ?: "")
            append("::")
            append(snapshot.media?.trackId ?: snapshot.media?.title ?: "")
        }

        currentSession?.let { session ->
            val deltaMillis = (nowMillis - (lastObservedAtMillis ?: session.startedAtMillis)).coerceAtLeast(0L)
            val accumulatedMillis = pendingElapsedMillis + deltaMillis
            val elapsedSeconds = (accumulatedMillis / 1000L).toInt()
            pendingElapsedMillis = accumulatedMillis % 1000L
            if (elapsedSeconds > 0) {
                store.incrementUsage(
                    day = day,
                    key = session.statKey,
                    label = session.label,
                    seconds = elapsedSeconds
                )
            }
        }

        if (currentSession?.signature != signature) {
            currentSession?.let { previous ->
                val previousParts = parseSessionParts(previous)
                val nextParts = SessionParts(
                    bundleId = snapshot.bundleId,
                    pageTitle = snapshot.pageTitle,
                    mediaKey = snapshot.media?.trackId ?: snapshot.media?.title
                )
                val streakSeconds = ((nowMillis - previous.startedAtMillis).coerceAtLeast(0L) / 1000L).toInt()
                store.updateMaxCounter(day, "longest_focus_streak_seconds", streakSeconds)
                store.incrementCounter(day, "session_count")
                if (previousParts.bundleId != nextParts.bundleId) {
                    store.incrementCounter(day, "focus_switch_count")
                }
                if (previousParts.pageTitle != nextParts.pageTitle) {
                    store.incrementCounter(day, "page_switch_count")
                }
                if (previousParts.mediaKey != nextParts.mediaKey && !previousParts.mediaKey.isNullOrBlank()) {
                    store.incrementCounter(day, "media_switch_count")
                }
            } ?: store.incrementCounter(day, "session_count")
            currentSession = SessionState(
                signature = signature,
                statKey = statKey,
                label = label,
                startedAtMillis = nowMillis
            )
            pendingElapsedMillis = 0L
        }

        lastObservedAtMillis = nowMillis
    }

    private fun todayKey(): String = nowInIso8601().substring(0, 10)

    actual fun retryEndpoint(): Boolean {
        TODO("Not yet implemented")
    }
}



private data class SessionParts(
    val bundleId: String,
    val pageTitle: String?,
    val mediaKey: String?
)

private fun parseSessionParts(session: SessionState): SessionParts {
    val parts = session.signature.split("::")
    return SessionParts(
        bundleId = parts.getOrElse(0) { "unknown" },
        pageTitle = parts.getOrNull(1)?.takeIf { it.isNotBlank() },
        mediaKey = parts.getOrNull(2)?.takeIf { it.isNotBlank() }
    )
}

private fun PulseBarEndpointConfig.toConnectionState(device: DeviceWsState?): PulseBarConnectionState {
    val phase = device?.phase ?: DeviceWsPhase.Idle
    val connectionState = phase.toExportConnectionState()
    val common = device?.common?.connection
    val media = device?.media?.connection
    val lastConnectedAtMillis = maxOf(
        common?.lastConnectedAtMillis ?: 0L,
        media?.lastConnectedAtMillis ?: 0L,
    )
    val lastDisconnectedAtMillis = maxOf(
        common?.lastDisconnectedAtMillis ?: 0L,
        media?.lastDisconnectedAtMillis ?: 0L,
    )
    val lastErrorMessage = device?.lastErrorMessage
        ?: media?.lastErrorMessage
        ?: common?.lastErrorMessage

    return PulseBarConnectionState(
        endpointId = id,
        name = name.ifBlank { endpointUrl.ifBlank { id } },
        enabled = enabled,
        endpointUrl = endpointUrl,
        workspaceId = workspaceId,
        connectionState = connectionState,
        connectionStateName = connectionState.name,
        statusText = phase.statusText(lastErrorMessage),
        isConnecting = phase == DeviceWsPhase.Connecting || phase == DeviceWsPhase.Reconnecting,
        manuallyDisconnected = phase == DeviceWsPhase.Closed,
        lastConnectedAtMillis = lastConnectedAtMillis,
        lastDisconnectedAtMillis = lastDisconnectedAtMillis,
        nextReconnectAtMillis = device?.nextReconnectAtMillis ?: common?.nextReconnectAtMillis ?: media?.nextReconnectAtMillis ?: 0L,
        reconnectDelaySeconds = device?.reconnectDelaySeconds ?: common?.reconnectDelaySeconds ?: media?.reconnectDelaySeconds ?: 0.0,
        reconnectAttempt = device?.reconnectAttempt ?: 0,
        reconnectCount = device?.reconnectCount ?: 0L,
        lastErrorMessage = lastErrorMessage,
        common = (common ?: WsConnectionState()).toExport(),
        media = (media ?: WsConnectionState()).toExport(),
    )
}

private fun emptyConnectionState(endpointId: String): PulseBarConnectionState =
    PulseBarConnectionState(
        endpointId = endpointId,
        name = endpointId,
        enabled = false,
        endpointUrl = "",
        workspaceId = "",
        connectionState = PulseBarStreamConnectionState.IDLE,
        connectionStateName = PulseBarStreamConnectionState.IDLE.name,
        statusText = "Connection not configured",
        isConnecting = false,
        manuallyDisconnected = false,
        lastConnectedAtMillis = 0L,
        lastDisconnectedAtMillis = 0L,
        nextReconnectAtMillis = 0L,
        reconnectDelaySeconds = 0.0,
        reconnectAttempt = 0,
        reconnectCount = 0L,
        lastErrorMessage = null,
        common = WsConnectionState().toExport(),
        media = WsConnectionState().toExport(),
    )

private fun WsConnectionState.toExport(): PulseBarConnectionWsState =
    PulseBarConnectionWsState(
        phaseName = phase.name,
        url = url,
        lastConnectedAtMillis = lastConnectedAtMillis ?: 0L,
        lastDisconnectedAtMillis = lastDisconnectedAtMillis ?: 0L,
        lastSendAtMillis = lastSendAtMillis ?: 0L,
        lastReceiveAtMillis = lastReceiveAtMillis ?: 0L,
        messagesSent = messagesSent,
        messagesReceived = messagesReceived,
        lastErrorMessage = lastErrorMessage,
    )

private fun DeviceWsPhase.toExportConnectionState(): PulseBarStreamConnectionState = when (this) {
    DeviceWsPhase.Idle -> PulseBarStreamConnectionState.IDLE
    DeviceWsPhase.Connecting -> PulseBarStreamConnectionState.CONNECTING
    DeviceWsPhase.Connected -> PulseBarStreamConnectionState.CONNECTED
    DeviceWsPhase.Reconnecting -> PulseBarStreamConnectionState.RECONNECTING
    DeviceWsPhase.Closing -> PulseBarStreamConnectionState.STOPPING
    DeviceWsPhase.Closed -> PulseBarStreamConnectionState.STOPPED
    DeviceWsPhase.Failed -> PulseBarStreamConnectionState.FAILED
}

private fun DeviceWsPhase.statusText(error: String?): String = when (this) {
    DeviceWsPhase.Idle -> "Connection idle"
    DeviceWsPhase.Connecting -> "Connecting"
    DeviceWsPhase.Connected -> "Connected"
    DeviceWsPhase.Reconnecting -> "Reconnecting"
    DeviceWsPhase.Closing -> "Closing"
    DeviceWsPhase.Closed -> "Disconnected"
    DeviceWsPhase.Failed -> error?.let { "Failed: $it" } ?: "Connection failed"
}
