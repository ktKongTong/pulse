package io.github.kt.pulsebar.app

import io.github.kt.pulsebar.monitor.MacActivityMonitor
import io.github.kt.pulsebar.report.EndpointReporter
import io.github.kt.pulsebar.shared.ActivityEnvelope
import io.github.kt.pulsebar.shared.ActivityEventType
import io.github.kt.pulsebar.shared.ActivityLogEntry
import io.github.kt.pulsebar.shared.ActivitySnapshot
import io.github.kt.pulsebar.shared.AppRule
import io.github.kt.pulsebar.shared.ClientIdentity
import io.github.kt.pulsebar.shared.MonitorConfig
import io.github.kt.pulsebar.shared.PrivacyMode
import io.github.kt.pulsebar.shared.UsageSummaryRow
import io.github.kt.pulsebar.shared.applyPrivacy
import io.github.kt.pulsebar.shared.displayName
import io.github.kt.pulsebar.shared.resolvePrivacyMode
import io.github.kt.pulsebar.shared.signature
import io.github.kt.pulsebar.storage.AppDataPaths
import io.github.kt.pulsebar.storage.ConfigStore
import io.github.kt.pulsebar.storage.LogStore
import io.github.kt.pulsebar.storage.SnapshotStore
import io.github.kt.pulsebar.storage.UsageStore
import java.net.InetAddress
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.datetime.Instant

data class AppUiState(
    val config: MonitorConfig = MonitorConfig(),
    val liveSnapshot: ActivitySnapshot? = null,
    val stableSnapshot: ActivitySnapshot? = null,
    val stableSince: Instant? = null,
    val currentLabel: String = "Starting monitor…",
    val diagnostics: List<String> = emptyList(),
    val logs: List<ActivityLogEntry> = emptyList(),
    val usageRows: List<UsageSummaryRow> = emptyList(),
    val lastPushStatus: String = "Endpoint disabled",
    val isPaused: Boolean = false,
    val suppressedReason: String? = null
)

class AppController(
    paths: AppDataPaths = AppDataPaths()
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val configStore = ConfigStore(paths)
    private val logStore = LogStore(paths)
    private val usageStore = UsageStore(paths)
    private val snapshotStore = SnapshotStore(paths)
    private val monitor = MacActivityMonitor()
    private val reporter = EndpointReporter()
    private val clientIdentity = ClientIdentity(
        deviceName = runCatching { InetAddress.getLocalHost().hostName }.getOrElse { "macOS" },
        userName = System.getProperty("user.name")
    )

    private val _uiState = MutableStateFlow(AppUiState())
    val uiState: StateFlow<AppUiState> = _uiState.asStateFlow()

    private var sequence = 0L
    private var monitorJob: Job? = null
    private var stableObservation: ObservationState? = null
    private var stableSince: Instant? = null
    private var lastHeartbeatAt: Instant? = null
    private var candidateObservation: ObservationState? = null
    private var candidateSince: Instant? = null

    fun start() {
        scope.launch {
            bindStores()

            val diagnostics = mutableListOf<String>()
            val config = runCatching { configStore.load() }
                .onFailure { diagnostics += "Config load failed: ${it.message}" }
                .getOrDefault(MonitorConfig())

            runCatching { logStore.load() }
                .onFailure { diagnostics += "Log load failed: ${it.message}" }
            runCatching { usageStore.load() }
                .onFailure { diagnostics += "Stats load failed: ${it.message}" }
            runCatching { reporter.updateConfig(config.endpoint) }
                .onFailure { diagnostics += "Endpoint setup failed: ${it.message}" }

            _uiState.value = _uiState.value.copy(
                config = config,
                diagnostics = diagnostics
            )
            startMonitorLoop()
        }
    }

    fun updateConfig(transform: (MonitorConfig) -> MonitorConfig) {
        scope.launch {
            val next = transform(configStore.config.value)
            configStore.save(next)
            reporter.updateConfig(next.endpoint)
            _uiState.value = _uiState.value.copy(
                config = next,
                lastPushStatus = next.endpoint.url.takeIf { next.endpoint.enabled && it.isNotBlank() }
                    ?.let { "Endpoint ready: $it" }
                    ?: "Endpoint disabled"
            )
        }
    }

    fun addRuleForCurrentApp(mode: PrivacyMode) {
        val current = uiState.value.liveSnapshot ?: return
        updateConfig { config ->
            config.copy(
                appRules = config.appRules + AppRule(
                    pattern = current.focus.bundleId,
                    mode = mode
                )
            )
        }
    }

    fun removeRule(index: Int) {
        updateConfig { config ->
            config.copy(appRules = config.appRules.filterIndexed { i, _ -> i != index })
        }
    }

    fun togglePaused() {
        scope.launch {
            val pause = !_uiState.value.isPaused
            if (pause) {
                closeCurrentSession("Monitoring paused by user")
            }
            _uiState.value = _uiState.value.copy(
                isPaused = pause,
                currentLabel = if (pause) "Monitoring paused" else "Resuming monitor…",
                suppressedReason = if (pause) "Paused" else null
            )
        }
    }

    suspend fun shutdown() {
        closeCurrentSession("Application shutting down")
        reporter.flush()
        reporter.close()
        scope.cancel()
    }

    private suspend fun bindStores() {
        scope.launch {
            logStore.entries.collectLatest { entries ->
                _uiState.value = _uiState.value.copy(logs = entries)
            }
        }
        scope.launch {
            usageStore.rows.collectLatest { rows ->
                _uiState.value = _uiState.value.copy(usageRows = rows)
            }
        }
        scope.launch {
            configStore.config.collectLatest { config ->
                _uiState.value = _uiState.value.copy(config = config)
            }
        }
    }

    private fun startMonitorLoop() {
        monitorJob?.cancel()
        monitorJob = scope.launch {
            while (true) {
                try {
                    val config = configStore.config.value
                    if (_uiState.value.isPaused) {
                        delay(1000)
                        continue
                    }

                    val sample = monitor.sample(config)
                    _uiState.value = _uiState.value.copy(
                        liveSnapshot = sample.snapshot,
                        diagnostics = sample.diagnostics,
                        currentLabel = sample.snapshot.displayName().ifBlank { "No active window" }
                    )
                    runCatching { snapshotStore.save(sample.snapshot) }
                    processObservation(sample.snapshot, config)
                    reporter.flush()
                    val localRefreshMillis = minOf(
                        config.appPollingMillis,
                        config.mediaPollingMillis,
                        500L
                    ).coerceAtLeast(250L)
                    delay(localRefreshMillis)
                } catch (error: Exception) {
                    _uiState.value = _uiState.value.copy(
                        diagnostics = listOf("Monitor loop failed: ${error.message ?: error::class.simpleName}"),
                        currentLabel = "Monitor recovering…"
                    )
                    delay(1500)
                }
            }
        }
    }

    private suspend fun processObservation(rawSnapshot: ActivitySnapshot, config: MonitorConfig) {
        val observed = rawSnapshot.toObservation(config)
        val now = rawSnapshot.observedAt
        val stable = stableObservation

        if (stable == null || stableSince == null) {
            commitInitial(observed, now)
            return
        }

        if (observed.signature == stable.signature) {
            candidateObservation = null
            candidateSince = null
            stableObservation = observed.refreshFrom(stable)
            publishHeartbeatIfNeeded(observed, stableSince ?: now, config)
            renderStableState()
            return
        }

        if (candidateObservation?.signature != observed.signature) {
            candidateObservation = observed
            candidateSince = now
            return
        }

        val pendingSince = candidateSince ?: now
        if (now.toEpochMilliseconds() - pendingSince.toEpochMilliseconds() >= config.changeStabilityMillis) {
            commitTransition(
                from = stable,
                to = observed,
                transitionAt = pendingSince
            )
            candidateObservation = null
            candidateSince = null
        }
    }

    private suspend fun commitInitial(observed: ObservationState, at: Instant) {
        stableObservation = observed
        stableSince = at
        lastHeartbeatAt = at
        renderStableState()
        when (observed) {
            is ObservationState.Tracked -> {
                emit(
                    observed.snapshot,
                    ActivityEventType.STATUS_CHANGED,
                    stableSince = at,
                    now = at
                )
                appendLog(ActivityEventType.STATUS_CHANGED, "Monitoring ${observed.snapshot.displayName()}", observed.snapshot)
            }

            is ObservationState.Suppressed -> {
                appendLog(
                    ActivityEventType.SESSION_ENDED,
                    "Suppressed ${observed.raw.focus.appName}: ${observed.reason}",
                    null
                )
            }
        }
    }

    private suspend fun commitTransition(from: ObservationState, to: ObservationState, transitionAt: Instant) {
        val previousStableSince = stableSince ?: transitionAt

        if (from is ObservationState.Tracked) {
            usageStore.recordSession(from.snapshot, previousStableSince, transitionAt)
        }

        when {
            from is ObservationState.Tracked && to is ObservationState.Suppressed -> {
                emit(from.snapshot, ActivityEventType.SESSION_ENDED, previousStableSince, transitionAt)
                appendLog(
                    ActivityEventType.SESSION_ENDED,
                    "Stopped tracking ${from.snapshot.displayName()} because ${to.reason}",
                    from.snapshot
                )
            }

            to is ObservationState.Tracked -> {
                emit(to.snapshot, ActivityEventType.STATUS_CHANGED, transitionAt, transitionAt)
                appendLog(
                    ActivityEventType.STATUS_CHANGED,
                    "Switched to ${to.snapshot.displayName()}",
                    to.snapshot
                )
            }

            to is ObservationState.Suppressed -> {
                appendLog(
                    ActivityEventType.SESSION_ENDED,
                    "Suppressed ${to.raw.focus.appName}: ${to.reason}",
                    null
                )
            }
        }

        stableObservation = to
        stableSince = transitionAt
        lastHeartbeatAt = transitionAt
        renderStableState()
    }

    private suspend fun publishHeartbeatIfNeeded(observed: ObservationState, stableSince: Instant, config: MonitorConfig) {
        if (observed !is ObservationState.Tracked) return
        val now = observed.snapshot.observedAt
        val last = lastHeartbeatAt ?: stableSince
        val heartbeatMs = config.heartbeatSeconds.coerceAtLeast(5) * 1000
        if (now.toEpochMilliseconds() - last.toEpochMilliseconds() < heartbeatMs) return
        emit(observed.snapshot, ActivityEventType.HEARTBEAT, stableSince, now)
        appendLog(ActivityEventType.HEARTBEAT, "Heartbeat ${observed.snapshot.displayName()}", observed.snapshot)
        lastHeartbeatAt = now
    }

    private suspend fun emit(
        snapshot: ActivitySnapshot,
        eventType: ActivityEventType,
        stableSince: Instant,
        now: Instant
    ) {
        val envelope = ActivityEnvelope(
            sequence = ++sequence,
            eventType = eventType,
            sentAt = now,
            stableSince = stableSince,
            stableForSeconds = ((now.toEpochMilliseconds() - stableSince.toEpochMilliseconds()).coerceAtLeast(0) / 1000),
            client = clientIdentity,
            snapshot = snapshot
        )
        val error = reporter.publish(envelope)
        _uiState.value = _uiState.value.copy(
            lastPushStatus = error ?: "${eventType.name.lowercase()} pushed at ${now.toString()}"
        )
    }

    private suspend fun appendLog(type: ActivityEventType, message: String, snapshot: ActivitySnapshot?) {
        logStore.append(
            ActivityLogEntry(
                id = UUID.randomUUID().toString(),
                recordedAt = Instant.fromEpochMilliseconds(System.currentTimeMillis()),
                type = type,
                message = message,
                snapshot = snapshot
            )
        )
    }

    private suspend fun closeCurrentSession(reason: String) {
        val stable = stableObservation
        val startedAt = stableSince
        val now = Instant.fromEpochMilliseconds(System.currentTimeMillis())
        if (stable is ObservationState.Tracked && startedAt != null) {
            usageStore.recordSession(stable.snapshot, startedAt, now)
            emit(stable.snapshot, ActivityEventType.SESSION_ENDED, startedAt, now)
            appendLog(ActivityEventType.SESSION_ENDED, "${stable.snapshot.displayName()} ended: $reason", stable.snapshot)
        }
        stableObservation = null
        stableSince = null
        candidateObservation = null
        candidateSince = null
        lastHeartbeatAt = null
        runCatching { snapshotStore.save(null) }
    }

    private fun renderStableState() {
        val stable = stableObservation
        val current = when (stable) {
            is ObservationState.Tracked -> stable.snapshot.displayName()
            is ObservationState.Suppressed -> "${stable.raw.focus.appName} (suppressed)"
            null -> _uiState.value.currentLabel
        }
        _uiState.value = _uiState.value.copy(
            stableSnapshot = (stable as? ObservationState.Tracked)?.snapshot,
            stableSince = stableSince,
            currentLabel = current,
            suppressedReason = (stable as? ObservationState.Suppressed)?.reason
        )
    }

    private fun ActivitySnapshot.toObservation(config: MonitorConfig): ObservationState {
        val mode = config.appRules.resolvePrivacyMode(focus)
        val redacted = applyPrivacy(mode)
        return if (redacted == null) {
            ObservationState.Suppressed(
                raw = copy(focus = focus.copy(privacyMode = PrivacyMode.EXCLUDE)),
                reason = "Excluded by privacy rule"
            )
        } else {
            ObservationState.Tracked(redacted)
        }
    }

    private fun ObservationState.refreshFrom(previous: ObservationState): ObservationState =
        when {
            this is ObservationState.Tracked && previous is ObservationState.Tracked -> copy(snapshot = snapshot)
            this is ObservationState.Suppressed && previous is ObservationState.Suppressed -> copy(raw = raw)
            else -> this
        }

    private sealed interface ObservationState {
        val signature: String

        data class Tracked(val snapshot: ActivitySnapshot) : ObservationState {
            override val signature: String = snapshot.signature()
        }

        data class Suppressed(
            val raw: ActivitySnapshot,
            val reason: String
        ) : ObservationState {
            override val signature: String = "suppressed:${raw.focus.bundleId}:${raw.presence}"
        }
    }
}
