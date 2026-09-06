package io.github.kt.pulsebar.model

import kotlinx.serialization.Serializable

@Serializable
data class FocusConfig(
    val idleThresholdSeconds: Int = 300,
    val changeStabilityMillis: Int = 500,
)

@Serializable
data class PulseConfig(
    val endpoint: EndpointConfig = EndpointConfig(),
    val commonConfig: FocusConfig = FocusConfig(),
)
