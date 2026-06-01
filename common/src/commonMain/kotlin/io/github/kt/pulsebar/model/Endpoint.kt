package io.github.kt.pulsebar.model

import kotlinx.serialization.Serializable


data class Endpoint(
    val deviceId: String,
    val url: String,
    val apiKey: String,
)

@Serializable
data class EndpointConfig(
    val id: String,
    val name: String,
    val enabled: Boolean,
    val url: String,
    val deviceId: String,
    val apiKey: String,
)

fun EndpointConfig.getEndpoint() = Endpoint(
    deviceId = deviceId,
    url = url,
    apiKey = apiKey,
)
