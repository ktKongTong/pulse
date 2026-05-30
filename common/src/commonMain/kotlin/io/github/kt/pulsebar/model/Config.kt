package io.github.kt.pulsebar.model

import kotlinx.serialization.Serializable

@Serializable
data class FocusConfig(
    val idleThresholdSeconds: Int = 300,
    val changeStabilityMillis: Int = 500,
)

@Serializable
data class StreamConfig(
    val sampleRate: Int = 48_000,
    val channels: Int = 2,
    val chunkDurationMs: Int = 500,
)

enum class StreamProvider {
    AUTO,
    SYSTEM,
    SPOTIFY,
    APPLE_MUSIC,
    TENCENT_MUSIC,
    NET_EASE_MUSIC,
}
sealed interface IStreamConfig {
    data class Auto(
        val mode: StreamProvider = StreamProvider.AUTO,
    ): IStreamConfig
}


@Serializable
data class PulseConfigItem(
    val endpoint: EndpointConfig,
    val stream: StreamConfig = StreamConfig(),
    val commonConfig: FocusConfig = FocusConfig(),
)

@Serializable
data class PulseConfig(
    val endpoints: List<EndpointConfig> = listOf(),
    val stream: StreamConfig = StreamConfig(),
    val commonConfig: FocusConfig = FocusConfig(),
)