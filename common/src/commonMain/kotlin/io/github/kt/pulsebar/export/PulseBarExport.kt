package io.github.kt.pulsebar.export

class PulseBarUsageRow(
    val key: String,
    val label: String,
    val bundleId: String,
    val totalSeconds: Int
)

enum class PulseBarTransport {
    WEBSOCKET,
    WEBHOOK,
    HTTP_BATCH
}

enum class PulseBarInteractionExecutionMode {
    CONFIRM,
    AUTO_ENQUEUE
}

enum class PulseBarInteractionPlaybackMode {
    PLAY_NOW,
    PLAY_NEXT
}

enum class PulseBarPlaybackCommand {
    PREVIOUS,
    TOGGLE_PLAY_PAUSE,
    NEXT
}

class PulseBarEndpointConfig(
    val id: String,
    val name: String,
    val enabled: Boolean,
    val disconnected: Boolean,
    val transport: PulseBarTransport,
    val transportName: String,
    val endpointUrl: String,
    val workspaceId: String,
    val siteId: String,
    val apiKey: String,
    val batchWindowSeconds: Int
)

class PulseBarConfig(
    val endpoints: List<PulseBarEndpointConfig>,
    val idleThresholdSeconds: Int,
    val changeStabilityMillis: Int,
    val heartbeatSeconds: Int,
    val appPollingMillis: Int,
    val pagePollingMillis: Int,
    val mediaPollingMillis: Int,
    val allowWebInteractions: Boolean,
    val interactionExecutionMode: PulseBarInteractionExecutionMode,
    val interactionExecutionModeName: String,
    val interactionPlaybackMode: PulseBarInteractionPlaybackMode,
    val interactionPlaybackModeName: String
)

class PulseBarMedia(
    val providerId: String,
    val source: String,
    val itemType: String,
    val title: String,
    val artist: String,
    val album: String?,
    val albumArtist: String?,
    val artworkUrl: String?,
    val progressSeconds: Double,
    val durationSeconds: Int,
    val linkUrl: String?,
    val trackId: String?,
    val isPlaying: Boolean,
    val trackNumber: Int?,
    val discNumber: Int?,
    val collectionId: String?,
    val collectionTitle: String?,
    val collectionLinkUrl: String?
)

class PulseBarSnapshot(
    val appName: String,
    val bundleId: String,
    val pageTitle: String?,
    val observedAtIso8601: String,
    val media: PulseBarMedia?
)

/** Kotlin-side epoch-millis projection of the ISO8601 field, so Swift
 *  (and any future shell) doesn't need its own parser. */
fun snapshotObservedAtEpochMillis(snapshot: PulseBarSnapshot): Long? =
    io.github.kt.pulsebar.core.platform.parseIso8601ToMillis(snapshot.observedAtIso8601)

class PulseBarMenuState(
    val snapshot: PulseBarSnapshot?,
    val firstUsage: PulseBarUsageRow?,
    val secondUsage: PulseBarUsageRow?,
    val thirdUsage: PulseBarUsageRow?
)

class PulseBarStatsPage(
    val dayIso: String,
    val totalSeconds: Int,
    val items: List<PulseBarUsageRow>
)

/**
 * Top-3 usage rows + today's total seconds, derived from the Room-backed
 * usage journal. Emitted via [PulseBarBridge.observeTodayStats] whenever the
 * Room tables change, so UIs never need to poll.
 */
class PulseBarTodayStats(
    val dayIso: String,
    val totalSeconds: Int,
    val firstUsage: PulseBarUsageRow?,
    val secondUsage: PulseBarUsageRow?,
    val thirdUsage: PulseBarUsageRow?,
    val topRows: List<PulseBarUsageRow>,
)

class PulseBarLocalStats(
    val dayIso: String,
    val appFocusSeconds: Int,
    val pageFocusSeconds: Int,
    val mediaPlaybackSeconds: Int,
    val idleSeconds: Int,
    val focusSwitchCount: Int,
    val pageSwitchCount: Int,
    val mediaSwitchCount: Int,
    val sessionCount: Int,
    val longestFocusStreakSeconds: Int,
    val topApps: List<PulseBarUsageRow>,
    val topPages: List<PulseBarUsageRow>,
    val topMedia: List<PulseBarUsageRow>
)

class PulseBarInteractionItem(
    val requestId: String,
    val status: String,
    val provider: String,
    val uri: String,
    val title: String?,
    val issuedAtIso8601: String,
    val updatedAtIso8601: String,
    val targetDeviceId: String?,
    val errorCode: String?,
    val errorMessage: String?
)

fun interactionIssuedAtEpochMillis(item: PulseBarInteractionItem): Long? =
    io.github.kt.pulsebar.core.platform.parseIso8601ToMillis(item.issuedAtIso8601)

fun interactionUpdatedAtEpochMillis(item: PulseBarInteractionItem): Long? =
    io.github.kt.pulsebar.core.platform.parseIso8601ToMillis(item.updatedAtIso8601)

class PulseBarInteractionState(
    val pendingCount: Int,
    val items: List<PulseBarInteractionItem>,
    val lastStatus: String?
)

class PulseBarEndpointSyncState(
    val id: String,
    val name: String,
    val enabled: Boolean,
    val transportName: String,
    val endpointUrl: String,
    val status: String,
    val lastStatus: String?,
    val pendingCount: Int,
    val needsAttention: Boolean,
    val lastAttemptAtIso8601: String?,
    val lastProbeAtIso8601: String?,
    val lastSuccessAtIso8601: String?,
    val lastFailureAtIso8601: String?,
    val lastErrorMessage: String?,
    val diagnosticMessage: String?,
    val acknowledgedSeqMax: Long,
    val acknowledgedAtIso8601: String?
)

fun endpointLastAttemptAtEpochMillis(state: PulseBarEndpointSyncState): Long? =
    io.github.kt.pulsebar.core.platform.parseIso8601ToMillis(state.lastAttemptAtIso8601)

fun endpointLastProbeAtEpochMillis(state: PulseBarEndpointSyncState): Long? =
    io.github.kt.pulsebar.core.platform.parseIso8601ToMillis(state.lastProbeAtIso8601)

fun endpointLastSuccessAtEpochMillis(state: PulseBarEndpointSyncState): Long? =
    io.github.kt.pulsebar.core.platform.parseIso8601ToMillis(state.lastSuccessAtIso8601)

fun endpointLastFailureAtEpochMillis(state: PulseBarEndpointSyncState): Long? =
    io.github.kt.pulsebar.core.platform.parseIso8601ToMillis(state.lastFailureAtIso8601)

fun endpointAcknowledgedAtEpochMillis(state: PulseBarEndpointSyncState): Long? =
    io.github.kt.pulsebar.core.platform.parseIso8601ToMillis(state.acknowledgedAtIso8601)

class PulseBarSyncState(
    val enabled: Boolean,
    val enabledEndpointCount: Int,
    val totalEndpointCount: Int,
    val status: String,
    val lastStatus: String?,
    val pendingCount: Int,
    val needsAttention: Boolean,
    val endpoints: List<PulseBarEndpointSyncState>
)

/**
 * Handle returned by every `observe*` method on [PulseBarBridge]. Swift
 * callers invoke [cancel] from their Combine teardown / view lifecycle to
 * release the underlying coroutine collector.
 */
interface PulseBarCancellable {
    fun cancel()
}

enum class PulseBarLiveListenConnectionState {
    IDLE,
    CONNECTING,
    CONNECTED,
    RECONNECTING,
    STOPPING,
    STOPPED,
    FAILED,
}

/**
 * Swift-export-friendly mirror of the shared `LiveListenStats`. All fields
 * use primitives so the Swift layer doesn't have to juggle `KotlinLong?`
 * boxes — `0L`/`-1L` act as sentinels where absence matters.
 */
class PulseBarLiveListenStats(
    val connectionState: PulseBarLiveListenConnectionState,
    val connectionStateName: String,
    val webSocketUrl: String?,
    val lastConnectedAtMillis: Long,        // 0 == never
    val lastDisconnectedAtMillis: Long,     // 0 == never
    val nextReconnectAtMillis: Long,        // 0 == none scheduled
    val reconnectDelaySeconds: Double,      // 0.0 == unknown
    val lastSendAtMillis: Long,             // 0 == never
    val lastErrorMessage: String?,
    val acceptedFrames: Long,
    val acceptedBytes: Long,
    val droppedFrames: Long,
    val droppedChunks: Long,
    val lastSequence: Long,
    val bufferedFrames: Long,
    val queuedChunks: Int,
    val queuedBytes: Long,
    val queuedFirstSequence: Long,          // -1 == none
    val queuedLastSequence: Long,           // -1 == none
    val isSending: Boolean,
    val maxQueuedChunks: Int,
    val reconnectCount: Long,
    val reconnectAttempt: Int,
    val chunksSent: Long,
    val bytesSent: Long,
    val sendBitrateKbps: Double,            // 0.0 == unknown
    val lastChunkBytes: Long,
    val chunkDurationMs: Int,
    val statusText: String,
    /** True when the server has issued stream.start and wants the host to pump PCM. */
    val captureRequested: Boolean,
)

/**
 * Factory for [PulseBarLiveListenStats] default instances. Lets the Swift
 * shell avoid constructing a 30-field class inline for the "no stats yet"
 * placeholder state.
 */
object PulseBarLiveListenStatsFactory {
    fun idle(): PulseBarLiveListenStats = PulseBarLiveListenStats(
        connectionState = PulseBarLiveListenConnectionState.IDLE,
        connectionStateName = PulseBarLiveListenConnectionState.IDLE.name,
        webSocketUrl = null,
        lastConnectedAtMillis = 0L,
        lastDisconnectedAtMillis = 0L,
        nextReconnectAtMillis = 0L,
        reconnectDelaySeconds = 0.0,
        lastSendAtMillis = 0L,
        lastErrorMessage = null,
        acceptedFrames = 0L,
        acceptedBytes = 0L,
        droppedFrames = 0L,
        droppedChunks = 0L,
        lastSequence = 0L,
        bufferedFrames = 0L,
        queuedChunks = 0,
        queuedBytes = 0L,
        queuedFirstSequence = -1L,
        queuedLastSequence = -1L,
        isSending = false,
        maxQueuedChunks = 0,
        reconnectCount = 0L,
        reconnectAttempt = 0,
        chunksSent = 0L,
        bytesSent = 0L,
        sendBitrateKbps = 0.0,
        lastChunkBytes = 0L,
        chunkDurationMs = 500,
        statusText = "Live Listen client idle",
        captureRequested = false,
    )
}

expect class PulseBarBridge() {
    fun readMenuState(): PulseBarMenuState
    fun readConfig(): PulseBarConfig
    fun updateConfig(config: PulseBarConfig)
    fun readStats(dayIso: String, limit: Int): PulseBarStatsPage
    fun readLocalStats(dayIso: String, limit: Int): PulseBarLocalStats
    fun readInteractionState(): PulseBarInteractionState
    fun readSyncState(): PulseBarSyncState
    fun retryEndpoint(): Boolean
    fun acceptInteraction(requestId: String): Boolean
    fun dismissInteraction(requestId: String): Boolean
    fun mediaCommand(command: PulseBarPlaybackCommand): Boolean
    fun seekMedia(progressSeconds: Double): Boolean

    /**
     * Advance the bridge one orchestration step: probe the frontmost app +
     * media, update usage counters, hand the resulting snapshot to the
     * reporter, opportunistically drain pending replays. Safe to call
     * frequently; respects the change-stability and heartbeat windows.
     *
     * Called by Kotlin's internal tick loop. Platforms should prefer
     * [forceTick] for user-driven events instead of calling this directly.
     */
    fun tick()

    /**
     * Like [tick] but forces a snapshot publish and a replay attempt. Use
     * for user-triggered actions (menubar opened, Retry pressed, settings
     * saved).
     */
    fun forceTick()

    /**
     * Subscribe to menu-state updates. The callback is invoked immediately
     * with the current cached value and then every time the bridge's tick
     * loop publishes a new one. Returns a [PulseBarCancellable] the caller
     * must invoke on teardown.
     */
    fun observeMenuState(onUpdate: (PulseBarMenuState) -> Unit): PulseBarCancellable

    /**
     * Subscribe to config updates. Emits the current persisted value on
     * subscribe and again after every write. Used by the Swift adapter to
     * drive the Settings UI without polling.
     */
    fun observeConfig(onUpdate: (PulseBarConfig) -> Unit): PulseBarCancellable

    /**
     * Subscribe to sync-state updates. Emits every time an endpoint probe /
     * drain / ack changes the sync aggregate.
     */
    fun observeSyncState(onUpdate: (PulseBarSyncState) -> Unit): PulseBarCancellable

    /**
     * Subscribe to interaction-state updates.
     */
    fun observeInteractionState(onUpdate: (PulseBarInteractionState) -> Unit): PulseBarCancellable

    /**
     * Subscribe to today's usage stats. Emits on startup, when Room's usage
     * tables are updated by a tick, and when the day rolls over. The value
     * includes today's total seconds plus the top three app rows for menubar
     * rendering.
     */
    fun observeTodayStats(onUpdate: (PulseBarTodayStats) -> Unit): PulseBarCancellable

    /**
     * Start (or restart) the Live Listen device session against the given
     * endpoint. Safe to call repeatedly: if a session is already running
     * with the same parameters this is a no-op.
     *
     * @param roomId room the device should join (typically `live-listen:<owner>`)
     * @param deviceId stable identifier for this device (typically `owner`)
     * @param baseUrl server base URL (e.g. `https://pulse.example.com`)
     * @param workspaceId workspace the endpoint belongs to
     * @param apiKey bearer token used in the `Authorization` header
     * @param sampleRate captured PCM sample rate (hint for WAV framing; defaults to 48000)
     * @param channels captured PCM channel count (hint for WAV framing; defaults to 2)
     * @param chunkDurationMs audio chunk duration in milliseconds
     */
    fun startLiveListen(
        roomId: String,
        deviceId: String,
        baseUrl: String,
        workspaceId: String,
        apiKey: String,
        sampleRate: Int,
        channels: Int,
        chunkDurationMs: Int,
    )

    /** Stop the Live Listen session. Cancels reconnects and closes the socket. */
    fun stopLiveListen()

    /**
     * Hand a PCM16 chunk (little-endian, interleaved) to the Live Listen
     * client. The Swift CoreAudio callback collects samples and forwards
     * them as a Base64-encoded string — the ByteArray construction path
     * through Swift Export is currently limited to `fatalError()`
     * initializers, so a primitive-typed envelope is used at the boundary.
     */
    fun submitLiveListenPcmBase64(chunkBase64: String)

    /**
     * Forward the owner-side media state (is media playing? permission?
     * capture runtime?) to the server. `playbackPlaying = true` means
     * the owner's app is currently playing audio; `permissionAllow = true`
     * means the owner has enabled Live Listen; `captureRunning = true` means
     * the CoreAudio tap is actively producing samples.
     */
    fun updateLiveListenMediaState(
        permissionAllow: Boolean,
        playbackPlaying: Boolean,
        captureRunning: Boolean,
    )

    /**
     * Forward the currently-playing track metadata to the server so it can
     * drive the Live Listen UI (title, artist, album art...). Pass all-null
     * to clear; pass an empty trackId when unknown. Safe to call whenever a
     * new track starts — duplicate values are de-duped by the server.
     */
    fun updateLiveListenMedia(
        providerId: String?,
        trackId: String?,
        title: String?,
        artist: String?,
        album: String?,
        artworkUrl: String?,
        durationSeconds: Double,
        isPlaying: Boolean,
    )

    /**
     * Subscribe to Live Listen telemetry (connection state, queue depth,
     * bitrate, errors). Emits the current snapshot on subscribe and every
     * time something changes.
     */
    fun observeLiveListenStats(onUpdate: (PulseBarLiveListenStats) -> Unit): PulseBarCancellable
}
