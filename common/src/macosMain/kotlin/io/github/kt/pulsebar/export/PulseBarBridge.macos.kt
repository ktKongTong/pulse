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
import io.github.kt.pulsebar.evt.Stream
import io.github.kt.pulsebar.utils.nowInIso8601
import io.github.kt.pulsebar.utils.nowInMillis
import io.github.kt.pulsebar.ws.DeviceV2Client
import kotlin.String
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlin.concurrent.Volatile
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

private data class SessionState(
    val signature: String,
    val statKey: String,
    val label: String,
    val startedAtMillis: Long
)


actual class PulseBarBridge actual constructor() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val store = PulseBarPreferencesStore()
    private val configStore = PulseBarConfigStore(
        fileSystem = pulseBarConfigFileSystem(),
        path = pulseBarConfigPath(),
    )
    private var currentSession: SessionState? = null
    private var lastObservedAtMillis: Long? = null
    private var pendingElapsedMillis: Long = 0L
    @Volatile private var latestMenuState: PulseBarMenuState = emptyMenuState()

    private val menuStateFlow = MutableStateFlow(latestMenuState)
    private val syncStateFlow = MutableStateFlow<PulseBarSyncState?>(null)

    /**
     * Pure reader. Returns the most recent menu state that the bridge's tick
     * loop has materialized. No I/O, no AppleScript, no network. Safe to call
     * as often as the UI needs.
     */
    actual fun readMenuState(): PulseBarMenuState = latestMenuState

    actual val menuState: Flow<PulseBarMenuState> = menuStateFlow.asStateFlow()

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
                            deviceId = it.siteId,
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

    actual val syncState: Flow<PulseBarSyncState> = syncStateFlow.asStateFlow().filterNotNull()

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

    actual fun connect(endpointId: String) {
        endpointConfigs.value[endpointId]?.let { config ->
            val scMap = EventDispatcher.streamClients.value
            if(scMap[endpointId] == null) {
                val sc = DeviceV2Client(scope = scope, config, Stream.streamStateFlow)
                EventDispatcher.streamClients.update {
                    it + (endpointId to sc)
                }
            }
            EventDispatcher.streamClients.value[endpointId]?.start()
        }
    }

    actual fun emitNativeEvent(event: NativeDeviceEvent) {
        EventDispatcher.emitNativeEvent(event)
    }

    // 所有启动的，Command
    actual fun stopStream() {
    }

    actual fun emitStreamLocalStop() {
    }

    actual fun updateStreamMediaState(
        permissionAllow: Boolean,
        playbackPlaying: Boolean,
        captureRunning: Boolean,
    ) {
    }

    actual fun updateStreamMedia(
        providerId: String?,
        trackId: String?,
        title: String?,
        artist: String?,
        album: String?,
        artworkUrl: String?,
        progressSeconds: Double,
        durationSeconds: Double,
        isPlaying: Boolean,
    ) {

    }

    actual fun readStats(dayIso: String, limit: Int): PulseBarStatsPage {
        val rows = store.topRowsForDay(dayIso, limit)
        return PulseBarStatsPage(
            dayIso = dayIso,
            totalSeconds = rows.sumOf { it.totalSeconds },
            items = rows
        )
    }

    actual fun readLocalStats(dayIso: String, limit: Int): PulseBarLocalStats =
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


    actual fun mediaCommand(command: PulseBarPlaybackCommand): Boolean {
        return Probe.mediaCommand(command)
    }

    actual fun seekMedia(progressSeconds: Double): Boolean {
        return Probe.seekMedia(progressSeconds)
    }

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
    actual fun submitStreamPcmBase64(chunkBase64: String) {
    }

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
