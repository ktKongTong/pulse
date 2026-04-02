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
            endpointEnabled = false,
            transport = PulseBarTransport.WEBSOCKET,
            transportName = PulseBarTransport.WEBSOCKET.name,
            endpointUrl = "",
            apiKey = "",
            batchWindowSeconds = 15,
            idleThresholdSeconds = 300,
            changeStabilityMillis = 1200,
            heartbeatSeconds = 60,
            appPollingMillis = 500,
            pagePollingMillis = 2000,
            mediaPollingMillis = 500
        )

    actual fun updateConfig(config: PulseBarConfig) = Unit
}
