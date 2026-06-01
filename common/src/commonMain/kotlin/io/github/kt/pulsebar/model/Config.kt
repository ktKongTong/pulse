package io.github.kt.pulsebar.model

import kotlinx.serialization.Serializable

@Serializable
data class FocusConfig(
    val idleThresholdSeconds: Int = 300,
    val changeStabilityMillis: Int = 500,
)

@Serializable
data class PulseConfigItem(
    val endpoint: EndpointConfig,
    val commonConfig: FocusConfig = FocusConfig(),
)

@Serializable
data class PulseConfig(
    val endpoints: List<EndpointConfig> = listOf(),
    val commonConfig: FocusConfig = FocusConfig(),
)
