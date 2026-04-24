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
    val transport: PulseBarTransport,
    val transportName: String,
    val endpointUrl: String,
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
    val acknowledgedSeqMax: Long,
    val acknowledgedAtIso8601: String?
)

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
}
