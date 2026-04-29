package io.github.kt.pulsebar.export

actual class PulseBarBridge actual constructor() {
    actual fun readMenuState(): PulseBarMenuState =
        PulseBarMenuState(
            snapshot = null,
            firstUsage = null,
            secondUsage = null,
            thirdUsage = null
        )

    actual fun readConfig(): PulseBarConfig =
        PulseBarConfig(
            endpoints = listOf(
                PulseBarEndpointConfig(
                    id = "default-endpoint",
                    name = "Primary endpoint",
                    enabled = false,
                    transport = PulseBarTransport.WEBSOCKET,
                    transportName = PulseBarTransport.WEBSOCKET.name,
                    endpointUrl = "",
                    workspaceId = "",
                    siteId = "",
                    apiKey = "",
                    batchWindowSeconds = 15
                )
            ),
            idleThresholdSeconds = 300,
            changeStabilityMillis = 1200,
            heartbeatSeconds = 60,
            appPollingMillis = 500,
            pagePollingMillis = 2000,
            mediaPollingMillis = 500,
            allowWebInteractions = true,
            interactionExecutionMode = PulseBarInteractionExecutionMode.CONFIRM,
            interactionExecutionModeName = PulseBarInteractionExecutionMode.CONFIRM.name,
            interactionPlaybackMode = PulseBarInteractionPlaybackMode.PLAY_NEXT,
            interactionPlaybackModeName = PulseBarInteractionPlaybackMode.PLAY_NEXT.name
        )

    actual fun updateConfig(config: PulseBarConfig) = Unit

    actual fun readStats(dayIso: String, limit: Int): PulseBarStatsPage =
        PulseBarStatsPage(
            dayIso = dayIso,
            totalSeconds = 0,
            items = emptyList()
        )

    actual fun readLocalStats(dayIso: String, limit: Int): PulseBarLocalStats =
        PulseBarLocalStats(
            dayIso = dayIso,
            appFocusSeconds = 0,
            pageFocusSeconds = 0,
            mediaPlaybackSeconds = 0,
            idleSeconds = 0,
            focusSwitchCount = 0,
            pageSwitchCount = 0,
            mediaSwitchCount = 0,
            sessionCount = 0,
            longestFocusStreakSeconds = 0,
            topApps = emptyList(),
            topPages = emptyList(),
            topMedia = emptyList()
        )

    actual fun readInteractionState(): PulseBarInteractionState =
        PulseBarInteractionState(
            pendingCount = 0,
            items = emptyList(),
            lastStatus = null
        )

    actual fun readSyncState(): PulseBarSyncState =
        PulseBarSyncState(
            enabled = false,
            enabledEndpointCount = 0,
            totalEndpointCount = 1,
            status = "disabled",
            lastStatus = null,
            pendingCount = 0,
            needsAttention = false,
            endpoints = listOf(
                PulseBarEndpointSyncState(
                    id = "default-endpoint",
                    name = "Primary endpoint",
                    enabled = false,
                    transportName = PulseBarTransport.WEBSOCKET.name,
                    endpointUrl = "",
                    status = "disabled",
                    lastStatus = null,
                    pendingCount = 0,
                    needsAttention = false,
                    lastAttemptAtIso8601 = null,
                    lastProbeAtIso8601 = null,
                    lastSuccessAtIso8601 = null,
                    lastFailureAtIso8601 = null,
                    lastErrorMessage = null,
                    diagnosticMessage = null,
                    acknowledgedSeqMax = 0,
                    acknowledgedAtIso8601 = null
                )
            )
        )

    actual fun retryEndpoint(): Boolean = false

    actual fun acceptInteraction(requestId: String): Boolean = false

    actual fun dismissInteraction(requestId: String): Boolean = false

    actual fun mediaCommand(command: PulseBarPlaybackCommand): Boolean = false

    actual fun seekMedia(progressSeconds: Double): Boolean = false
}
